import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("missing #app");
}

// NOTE: deliberately NOT wrapped in <StrictMode>. The chat WebSocket
// client is a persistent long-lived resource — StrictMode's double-mount
// in dev attaches our message handler twice (once per mount, only one
// cleanup fires synchronously), which surfaces every broadcast as a
// duplicate row in the activity log. Production builds wouldn't show
// the bug, but the dev experience is what the human watches live, so
// we keep it simple.
createRoot(root).render(<App />);
