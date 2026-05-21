export interface WhepClient {
  connect(): Promise<void>;
  close(): void;
}

type StreamState = "connecting" | "live" | "disconnected";

interface CreateWhepClientOptions {
  readonly url: string;
  readonly videoEl: HTMLVideoElement;
  readonly onState: (state: StreamState) => void;
}

const isAbsoluteUrl = (value: string): boolean =>
  value.startsWith("http://") || value.startsWith("https://");

// Resolve the WHEP Location header against the request URL — NOT against
// window.location.origin alone. mediamtx may emit either an absolute URL
// or a relative path; both must round-trip through our /stream/whep proxy
// origin, not the bare page origin, so PATCH/DELETE reach mediamtx.
export const resolveWhepLocation = (
  whepRequestUrl: string,
  locationHeader: string,
): string => {
  if (isAbsoluteUrl(locationHeader)) {
    return locationHeader;
  }
  const base = isAbsoluteUrl(whepRequestUrl)
    ? new URL(whepRequestUrl)
    : new URL(whepRequestUrl, window.location.origin);
  return new URL(locationHeader, base).toString();
};

export const createWhepClient = (
  options: CreateWhepClientOptions,
): WhepClient => {
  let connection: RTCPeerConnection | undefined;
  let sessionUrl: string | undefined;
  // Buffer ICE candidates that fire BEFORE the WHEP POST returns its
  // Location header — local-network gathering can outrun the POST round
  // trip. Discarding pre-Location candidates weakens the trickle ICE
  // check set Firefox relies on.
  const pendingCandidates: string[] = [];

  const sendTrickle = (candidate: string): void => {
    if (sessionUrl === undefined) {
      pendingCandidates.push(candidate);
      return;
    }
    Promise.resolve(
      fetch(sessionUrl, {
        method: "PATCH",
        headers: { "content-type": "application/trickle-ice-sdpfrag" },
        body: `a=ice-options:trickle\r\na=${candidate}\r\n`,
      }),
    ).catch(() => {});
  };

  const flushPendingCandidates = (): void => {
    if (sessionUrl === undefined) {
      return;
    }
    const queued = pendingCandidates.splice(0, pendingCandidates.length);
    for (const candidate of queued) {
      sendTrickle(candidate);
    }
  };

  // Best-effort DELETE on close (RFC 9725 session release). keepalive lets
  // the request survive page unload, but the browser is free to drop it —
  // mediamtx will eventually reap idle sessions either way.
  const releaseSession = (): void => {
    if (sessionUrl === undefined) {
      return;
    }
    const target = sessionUrl;
    sessionUrl = undefined;
    Promise.resolve(
      fetch(target, { method: "DELETE", keepalive: true }),
    ).catch(() => {});
  };

  return {
    async connect() {
      options.onState("connecting");

      connection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      connection.addTransceiver("video", { direction: "recvonly" });

      connection.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream !== undefined) {
          options.videoEl.srcObject = stream;
        }
      };

      connection.onicecandidate = (event) => {
        if (event.candidate === null) {
          return;
        }
        sendTrickle(event.candidate.candidate);
      };

      connection.onconnectionstatechange = () => {
        if (connection === undefined) {
          return;
        }
        if (connection.connectionState === "connected") {
          options.onState("live");
          return;
        }
        if (
          connection.connectionState === "failed" ||
          connection.connectionState === "disconnected" ||
          connection.connectionState === "closed"
        ) {
          options.onState("disconnected");
        }
      };

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      if (offer.sdp === undefined) {
        options.onState("disconnected");
        throw new Error("WHEP offer missing SDP");
      }

      const response = await fetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/sdp" },
        body: offer.sdp,
      });

      if (!response.ok) {
        options.onState("disconnected");
        throw new Error(`WHEP failed: ${response.status}`);
      }

      const locationHeader = response.headers.get("location");
      if (locationHeader !== null && locationHeader.length > 0) {
        sessionUrl = resolveWhepLocation(options.url, locationHeader);
        flushPendingCandidates();
      }

      const answer = await response.text();
      await connection.setRemoteDescription({ type: "answer", sdp: answer });
    },

    close() {
      releaseSession();
      if (connection !== undefined) {
        connection.close();
      }
      connection = undefined;
      pendingCandidates.length = 0;
      options.onState("disconnected");
    },
  };
};
