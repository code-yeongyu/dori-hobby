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

export const createWhepClient = (
  options: CreateWhepClientOptions,
): WhepClient => {
  let connection: RTCPeerConnection | undefined;

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

      const answer = await response.text();
      await connection.setRemoteDescription({ type: "answer", sdp: answer });
    },

    close() {
      if (connection !== undefined) {
        connection.close();
      }
      connection = undefined;
      options.onState("disconnected");
    },
  };
};
