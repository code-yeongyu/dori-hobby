import { Hono } from "hono";

const MEDIAMTX_WHEP =
  process.env.MEDIAMTX_WHEP ?? "http://mediamtx:8889/dori/whep";

export const streamProxy = new Hono();

// Initial WHEP POST: browser sends SDP offer, we forward to mediamtx,
// mediamtx returns SDP answer + a `Location` header pointing at the new
// session (e.g. `/dori/whep/<session-id>`). The browser uses that
// Location for follow-up trickle-ICE PATCH and session DELETE.
streamProxy.all("/whep", async (c) => {
  const requestBody =
    c.req.method === "POST" || c.req.method === "PATCH"
      ? await c.req.arrayBuffer()
      : undefined;
  const requestInit: RequestInit = {
    method: c.req.method,
    headers: c.req.raw.headers,
  };
  if (requestBody !== undefined) {
    requestInit.body = requestBody;
  }
  const upstream = await fetch(MEDIAMTX_WHEP, requestInit);
  return relayResponse(upstream);
});

// Follow-up trickle-ICE PATCH + session DELETE land on the path mediamtx
// returned in the Location header — typically `/dori/whep/<session-id>`.
// Without this catch Firefox (which is stricter about WHEP's trickle-ICE
// negotiation than Chromium) hits 404 here and the peer connection dies.
streamProxy.all("/whep/:session", async (c) => {
  const session = c.req.param("session");
  const target = upstreamSessionUrl(session);
  const requestBody =
    c.req.method === "POST" || c.req.method === "PATCH"
      ? await c.req.arrayBuffer()
      : undefined;
  const requestInit: RequestInit = {
    method: c.req.method,
    headers: c.req.raw.headers,
  };
  if (requestBody !== undefined) {
    requestInit.body = requestBody;
  }
  const upstream = await fetch(target, requestInit);
  return relayResponse(upstream);
});

const upstreamSessionUrl = (session: string): string => {
  const base = MEDIAMTX_WHEP.replace(/\/whep$/, "");
  return `${base}/whep/${session}`;
};

const relayResponse = async (upstream: Response): Promise<Response> => {
  const body = await upstream.arrayBuffer();
  // Rewrite Location to stay under our own /stream/whep mount so the
  // browser keeps hitting the proxy for PATCH/DELETE, not mediamtx
  // directly (which it can't reach when behind Docker bridge).
  const headers = new Headers(upstream.headers);
  const location = headers.get("location");
  if (location !== null) {
    headers.set("location", rewriteLocation(location));
  }
  return new Response(body, { status: upstream.status, headers });
};

const rewriteLocation = (location: string): string => {
  const sessionMatch = /\/whep\/([^/?]+)/.exec(location);
  if (sessionMatch === null) {
    return location;
  }
  return `/stream/whep/${sessionMatch[1] ?? ""}`;
};
