import { useCallback, useEffect, useRef, useState } from "react";
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<StreamState>("connecting");
  const [muted, setMuted] = useState<boolean>(true);
  const [fullscreen, setFullscreen] = useState<boolean>(false);

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

  // Track REAL fullscreen state from the browser, not just our toggle —
  // ESC, F11, etc. all change it without going through our button.
  useEffect(() => {
    const sync = (): void => {
      setFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
    };
  }, []);

  const toggleFullscreen = useCallback((): void => {
    const target = containerRef.current;
    if (target === null) {
      return;
    }
    if (document.fullscreenElement === null) {
      void target.requestFullscreen().catch(() => {
        // Ignore: some browsers block fullscreen from non-user-gesture paths.
      });
    } else {
      void document.exitFullscreen().catch(() => {
        // Ignore: already exited.
      });
    }
  }, []);

  // Keyboard shortcut: F or f → toggle fullscreen (matches YouTube, Twitch).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") {
          return;
        }
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [toggleFullscreen]);

  return (
    <section
      ref={containerRef}
      className={`stream-viewer${fullscreen ? " is-fullscreen" : ""}`}
      aria-label="Live stream viewer"
    >
      <video
        className="stream-video"
        ref={videoRef}
        muted={muted}
        autoPlay
        playsInline
        controls={false}
        onDoubleClick={toggleFullscreen}
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

      <div className="stream-controls">
        {muted ? (
          <button
            type="button"
            className="btn stream-ctrl"
            onClick={() => {
              setMuted(false);
              const video = videoRef.current;
              if (video !== null) {
                video.muted = false;
              }
            }}
            title="Unmute (audio)"
          >
            Unmute
          </button>
        ) : null}
        <button
          type="button"
          className="btn stream-ctrl"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title="Fullscreen (F or double-click)"
        >
          {fullscreen ? "Exit" : "Fullscreen"}
        </button>
      </div>
    </section>
  );
};
