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

const resolveLocation = (base: string, location: string): string => {
  if (location.startsWith("http://") || location.startsWith("https://")) {
    return location;
  }
  if (location.startsWith("/")) {
    return new URL(location, window.location.origin).toString();
  }
  return new URL(location, new URL(base, window.location.origin)).toString();
};

export const createWhepClient = (
  options: CreateWhepClientOptions,
): WhepClient => {
  let connection: RTCPeerConnection | undefined;
  let sessionUrl: string | undefined;

  // Best-effort DELETE on close. Per WHEP (RFC 9725) this is how the server
  // releases the peer session — without it, mediamtx keeps a zombie session
  // around until its idle timeout expires.
  const releaseSession = (): void => {
    if (sessionUrl === undefined) {
      return;
    }
    const target = sessionUrl;
    sessionUrl = undefined;
    try {
      fetch(target, { method: "DELETE", keepalive: true }).catch(() => {});
    } catch {
      // Ignore: page may be unloading and fetch is throwing synchronously.
    }
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

      // Trickle ICE: send each locally-gathered candidate to mediamtx via
      // PATCH against the session URL the server returned in `Location`.
      // Firefox is stricter than Chromium about trickling — without this
      // PATCH the peer often stalls on the host-only initial offer.
      connection.onicecandidate = (event) => {
        if (event.candidate === null || sessionUrl === undefined) {
          return;
        }
        const fragment = `a=ice-options:trickle\r\na=${event.candidate.candidate}\r\n`;
        try {
          fetch(sessionUrl, {
            method: "PATCH",
            headers: { "content-type": "application/trickle-ice-sdpfrag" },
            body: fragment,
          }).catch(() => {});
        } catch {
          // Ignore: network errors during trickle are non-fatal; ICE will
          // succeed if the original offer's candidates are sufficient.
        }
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
        sessionUrl = resolveLocation(options.url, locationHeader);
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
      options.onState("disconnected");
    },
  };
};
