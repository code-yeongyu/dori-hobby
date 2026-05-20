import { Hono } from "hono";
import { serveStatic, upgradeWebSocket } from "hono/bun";
import type { ServerToClient } from "../shared/types.js";
import { handleBunMessage } from "./chat-ws.js";
import { streamProxy } from "./stream-proxy.js";

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

app.get(
  "/chat",
  upgradeWebSocket(() => {
    return {
      onMessage(event, ws) {
        void (async () => {
          const payload = await decodeWsData(event.data);
          const send = (message: ServerToClient): void => {
            ws.send(JSON.stringify(message));
          };
          await handleBunMessage(payload, send);
        })();
      },
    };
  }),
);

app.get("/", serveStatic({ path: "./dist/index.html" }));
app.get("/main.js", serveStatic({ path: "./dist/main.js" }));
app.get("/styles.css", serveStatic({ path: "./dist/styles.css" }));

const port = Number(process.env["PORT"] ?? 3001);

export default {
  port,
  fetch: app.fetch,
};
