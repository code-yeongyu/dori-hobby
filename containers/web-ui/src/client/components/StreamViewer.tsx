import { useEffect, useRef, useState } from "react";
import { createWhepClient } from "../lib/whep-client.js";

type StreamState = "connecting" | "live" | "disconnected";

interface StreamViewerProps {
  readonly onStreamStatus: (state: StreamState) => void;
}

const fallbackWhepUrl = (): string => {
  return `http://${window.location.hostname}:8889/dori/whep`;
};

export const StreamViewer = ({
  onStreamStatus,
}: StreamViewerProps): JSX.Element => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<StreamState>("connecting");
  const [muted, setMuted] = useState<boolean>(true);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }

    let stopped = false;
    let client = createWhepClient({
      url: "/stream/whep",
      videoEl: video,
      onState: (next) => {
        if (!stopped) {
          setState(next);
          onStreamStatus(next);
        }
      },
    });

    const connect = async (): Promise<void> => {
      try {
        await client.connect();
      } catch {
        if (stopped) {
          return;
        }
        client.close();
        client = createWhepClient({
          url: fallbackWhepUrl(),
          videoEl: video,
          onState: (next) => {
            if (!stopped) {
              setState(next);
              onStreamStatus(next);
            }
          },
        });
        await client.connect().catch(() => {
          if (!stopped) {
            setState("disconnected");
            onStreamStatus("disconnected");
          }
        });
      }
    };

    void connect();

    return () => {
      stopped = true;
      client.close();
    };
  }, [onStreamStatus]);

  return (
    <section className="stream-viewer" aria-label="Live stream viewer">
      <video
        className="stream-video"
        ref={videoRef}
        muted={muted}
        autoPlay
        playsInline
        controls={false}
      />

      {state !== "live" ? (
        <div className="overlay" data-state={state}>
          <div className="overlay-inner">
            {state === "connecting" ? (
              <span className="spinner" aria-hidden="true" />
            ) : null}
            <span>
              {state === "connecting" ? "Connecting..." : "Disconnected"}
            </span>
            {state === "disconnected" ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  window.location.reload();
                }}
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {muted ? (
        <button
          type="button"
          className="btn stream-unmute"
          onClick={() => {
            setMuted(false);
            const video = videoRef.current;
            if (video !== null) {
              video.muted = false;
            }
          }}
        >
          Unmute
        </button>
      ) : null}
    </section>
  );
};
