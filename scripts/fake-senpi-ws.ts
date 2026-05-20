// Throwaway: emulate the senpi intervention WS endpoint by emitting
// agent-action + agent-thinking messages on a steady cadence. Used to QA
// the web-ui activity log + status flow without running the real LLM agent.
// Run with: bun run scripts/fake-senpi-ws.ts
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 7979);
const wss = new WebSocketServer({ port: PORT });
const buttons = ["A", "B", "Up", "Down", "Left", "Right", "Start"] as const;

const thinkingLines = [
  "Looking at the screen: Professor Juniper is talking.",
  "Need to advance the dialog with the A button.",
  "Plan: tap A, capture, then re-read the screen.",
  "Battle screen detected. Picking move with highest type advantage.",
  "Bottom screen has menu options; will touch (128, 96).",
  "Player position looks correct, walking north toward Striaton.",
];

let counter = 0;
console.log(`[fake-senpi-ws] listening on :${PORT}, waiting for client...`);

wss.on("connection", (sock) => {
  console.log(`[fake-senpi-ws] client connected (clients=${wss.clients.size})`);
  sock.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
    const text = raw.toString();
    console.log(`[fake-senpi-ws] message from client: ${text}`);
  });
});

setInterval(() => {
  if (wss.clients.size === 0) {
    return;
  }
  counter += 1;
  const isThinking = counter % 3 === 0;
  const button = buttons[counter % buttons.length];
  const thinking = thinkingLines[counter % thinkingLines.length];
  const message = isThinking
    ? {
        type: "agent-thinking",
        id: `m-${counter}`,
        timestamp: Date.now(),
        text: thinking,
      }
    : {
        type: "agent-action",
        id: `m-${counter}`,
        timestamp: Date.now(),
        action: counter % 5 === 0 ? "screenshot" : "button",
        detail:
          counter % 5 === 0 ? "captured both screens" : `${button} button`,
      };
  const json = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(json);
    }
  }
}, 1200);
