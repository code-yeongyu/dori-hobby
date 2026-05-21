import { describe, expect, it, vi } from "vitest";
import { resolveWhepLocation } from "../src/client/lib/whep-client.js";

const originalWindow = globalThis.window;

const stubWindow = (origin: string): void => {
  vi.stubGlobal("window", { location: { origin } } as unknown as Window);
};

const restoreWindow = (): void => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    vi.stubGlobal("window", originalWindow);
  }
};

describe("resolveWhepLocation", () => {
  it("returns absolute Location headers verbatim", () => {
    stubWindow("http://example.com");
    expect(
      resolveWhepLocation(
        "/stream/whep",
        "http://mediamtx:8889/dori/whep/abc-123",
      ),
    ).toBe("http://mediamtx:8889/dori/whep/abc-123");
    restoreWindow();
  });

  it("resolves a leading-slash Location against the request URL's origin", () => {
    stubWindow("http://localhost:3001");
    expect(
      resolveWhepLocation("/stream/whep", "/stream/whep/session-7"),
    ).toBe("http://localhost:3001/stream/whep/session-7");
    restoreWindow();
  });

  it("preserves the WHEP request path when Location is a relative ID", () => {
    stubWindow("http://localhost:3001");
    expect(resolveWhepLocation("/stream/whep", "session-7")).toBe(
      "http://localhost:3001/stream/session-7",
    );
    restoreWindow();
  });

  it("handles absolute WHEP base + relative Location", () => {
    stubWindow("http://localhost:3001");
    expect(
      resolveWhepLocation(
        "http://mediamtx:8889/dori/whep",
        "/dori/whep/session-9",
      ),
    ).toBe("http://mediamtx:8889/dori/whep/session-9");
    restoreWindow();
  });
});
