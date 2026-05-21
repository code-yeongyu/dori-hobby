import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { playtimeProxy } from "../src/server/playtime-proxy.js";

const fetchMock = vi.fn<typeof fetch>();

describe("playtime proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it("proxies GET /api/playtime to the emulator playtime endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          total_seconds: 60,
          formatted: "0h 01m 00s",
          started_at_ms: 1,
          last_tick_epoch_ms: 2,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = new Hono();
    app.route("/api", playtimeProxy);

    const response = await app.request("/api/playtime");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      total_seconds: 60,
      formatted: "0h 01m 00s",
      started_at_ms: 1,
      last_tick_epoch_ms: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://emulator:8787/playtime",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
