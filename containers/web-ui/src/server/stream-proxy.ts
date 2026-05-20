import { Hono } from "hono";

const MEDIAMTX_WHEP =
  process.env.MEDIAMTX_WHEP ?? "http://mediamtx:8889/dori/whep";

export const streamProxy = new Hono();

streamProxy.all("/whep", async (c) => {
  const requestBody =
    c.req.method === "POST" ? await c.req.arrayBuffer() : undefined;
  const requestInit: RequestInit = {
    method: c.req.method,
    headers: c.req.raw.headers,
  };
  if (requestBody !== undefined) {
    requestInit.body = requestBody;
  }
  const upstream = await fetch(MEDIAMTX_WHEP, {
    ...requestInit,
  });
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: upstream.status,
    headers: upstream.headers,
  });
});
