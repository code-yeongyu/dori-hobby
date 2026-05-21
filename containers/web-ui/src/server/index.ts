import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import type { ServerToClient } from "../shared/types.js";
import { handleBunMessage, subscribeToUpstream } from "./chat-ws.js";
import { playtimeProxy } from "./playtime-proxy.js";
import { streamProxy } from "./stream-proxy.js";

// `createBunWebSocket()` returns the `upgradeWebSocket` route helper
// AND the `websocket` handler object that Bun.serve REQUIRES under
// the `websocket` key. Importing `upgradeWebSocket` directly from
// `hono/bun` looks tempting but breaks at runtime because Bun won't
// know how to handle the upgrade without the paired `websocket` object.
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

const app = new Hono();

const decodeWsData = async (
  data: string | ArrayBuffer | SharedArrayBuffer | Uint8Array | Blob,
): Promise<string> => {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Blob) {
    const bytes = await data.arrayBuffer();
    return new TextDecoder().decode(bytes);
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof SharedArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  return new TextDecoder().decode(data);
};

app.get("/health", (c) => {
  return c.json({ status: "ok", uptime: process.uptime() });
});

app.route("/stream", streamProxy);
app.route("/api", playtimeProxy);

// Emulator health proxy: the browser can't reach :8787 directly (CORS +
// container topology), so we expose a same-origin `/emulator/health` that
// shells out to the input-bridge. Used by the client to drive the emulator
// status pill instead of hard-coding `disconnected`.
const emulatorBridgeUrl = (): string => {
  const host = process.env.EMULATOR_HOST ?? "emulator";
  const port = Number(process.env.EMULATOR_PORT ?? 8787);
  return `http://${host}:${port}/health`;
};

app.get("/emulator/health", async (c) => {
  try {
    const response = await fetch(emulatorBridgeUrl(), {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
      return c.json({ status: "disconnected" }, 200);
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.status === "string" && data.status === "ok") {
      return c.json({ status: "connected" });
    }
    return c.json({ status: "disconnected" });
  } catch {
    return c.json({ status: "disconnected" });
  }
});

app.get(
  "/chat",
  upgradeWebSocket(() => {
    let unsubscribe: (() => void) | undefined;
    return {
      onOpen(_event, ws) {
        const send = (message: ServerToClient): void => {
          ws.send(JSON.stringify(message));
        };
        unsubscribe = subscribeToUpstream(send);
      },
      onMessage(event, ws) {
        void (async () => {
          const payload = await decodeWsData(event.data);
          const send = (message: ServerToClient): void => {
            ws.send(JSON.stringify(message));
          };
          await handleBunMessage(payload, send);
        })();
      },
      onClose() {
        if (unsubscribe !== undefined) {
          unsubscribe();
          unsubscribe = undefined;
        }
      },
    };
  }),
);

app.get("/", serveStatic({ path: "./dist/index.html" }));
app.get("/main.js", serveStatic({ path: "./dist/main.js" }));
app.get("/styles.css", serveStatic({ path: "./dist/styles.css" }));

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
  websocket,
};
