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

    // mediamtx tears down idle WebRTC peer connections on its own (~60s
    // for us in practice), and Safari/Chromium drop the connection on
    // tab-backgrounding sleep too. The previous version of this effect
    // surfaced that as a permanent "Disconnected" overlay until the
    // user clicked Retry. That's user-hostile for a passive monitor:
    // the user opens the page once and expects it to recover on its
    // own no matter how many times the underlying peer dies.
    //
    // Strategy: track the current client + a reconnect timer in
    // closure-local refs. On any non-live state, schedule a reconnect
    // with exponential backoff (1s → 2s → 4s → 8s ceiling). Reset the
    // attempt counter on a successful "live". On unmount, raise the
    // stopped flag so an in-flight `close()` (which itself fires
    // onState("disconnected")) cannot retrigger another reconnect.
    let stopped = false;
    let currentClient: ReturnType<typeof createWhepClient> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const clearReconnectTimer = (): void => {
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const teardownClient = (): void => {
      if (currentClient !== undefined) {
        currentClient.close();
        currentClient = undefined;
      }
    };

    const handleState = (next: StreamState): void => {
      if (stopped) {
        return;
      }
      setState(next);
      onStreamStatus(next);
      if (next === "live") {
        attempt = 0;
        return;
      }
      if (next === "disconnected") {
        scheduleReconnect();
      }
    };

    const tryConnect = async (url: string): Promise<boolean> => {
      if (stopped) {
        return false;
      }
      teardownClient();
      const client = createWhepClient({ url, videoEl: video, onState: handleState });
      currentClient = client;
      try {
        await client.connect();
        return !stopped;
      } catch {
        return false;
      }
    };

    const scheduleReconnect = (): void => {
      if (stopped || reconnectTimer !== undefined) {
        return;
      }
      // 1s, 2s, 4s, 8s, then stay at 8s. Connectivity blips usually
      // clear inside two cycles; longer outages keep retrying at 8s so
      // the page heals itself the moment mediamtx becomes reachable.
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void runConnectChain();
      }, delay);
    };

    const runConnectChain = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      const primaryOk = await tryConnect("/stream/whep");
      if (primaryOk || stopped) {
        return;
      }
      const fallbackOk = await tryConnect(fallbackWhepUrl());
      if (!fallbackOk && !stopped) {
        scheduleReconnect();
      }
    };

    void runConnectChain();

    return () => {
      stopped = true;
      clearReconnectTimer();
      teardownClient();
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
