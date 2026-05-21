import { Hono } from "hono";

const EMULATOR_PLAYTIME_URL =
  process.env.EMULATOR_PLAYTIME_URL ?? "http://emulator:8787/playtime";

export const playtimeProxy = new Hono();

playtimeProxy.get("/playtime", async (c) => {
  try {
    const upstream = await fetch(EMULATOR_PLAYTIME_URL, {
      signal: AbortSignal.timeout(2000),
    });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch (error) {
    if (error instanceof Error) {
      return c.json({ error: "playtime unavailable" }, 503);
    }
    throw error;
  }
});
