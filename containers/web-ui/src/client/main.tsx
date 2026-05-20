import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("missing #app");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
