# Architecture

## Overview

dori-hobby is a containerized system that lets an AI agent (Dori, from
Sisyphus Labs) play Pokémon White on a Nintendo DS emulator, with the
gameplay live-streamed to a web browser and human intervention possible
via a chat panel.

The system splits into three Docker services plus a host-side process:
- **emulator** — runs DeSmuME on a virtual framebuffer, accepts input via
  an HTTP bridge, and pushes video to an RTSP server.
- **mediamtx** — ingests the RTSP stream and serves it back out via
  WebRTC (WHEP) for low-latency browser viewing.
- **web-ui** — serves a React SPA with a video player and chat panel.
- **senpi (host)** — the agent runtime that loads the
  `senpi-dori-desmume` extension; its tools hit the emulator bridge and
  its intervention WebSocket server receives chat messages from the web UI.

## Component map

```
                  Host (macOS / Linux)
   +------------------------------------------------------+
   |  senpi process (Bun)                                 |
   |   + senpi-dori-desmume extension                     |
   |     - tools: nds_capture_screen, _press_button,    |
|              _touch  → HTTP to :8787                 |
   |     - intervention WS server → :7979                 |
   +------------------------------------------------------+
│ :8787 HTTP                ▲ :7979 WS
         ▼                           │
   ┌─────────────────┐    ┌─────────────────────┐
   │ emulator        │    │ web-ui              │
   │ - Xvfb :99      │    │ - Hono :3001        │
   │ - DeSmuME (X11) │    │ - React SPA         │
   │ - xdotool       │    │ - /chat WS → :7979  │
   │ - ffmpeg →RTSP  │◀┐  │ - WebRTC viewer ←┐  │
   │ - input-bridge  │ │  │                  │  │
   └─────────────────┘ │  └──────────────────┼──┘
                       │                     │
                       ▼                     │
              ┌─────────────────────────┐    │
              │ mediamtx                │    │
              │ - RTSP :8554 (ingress)│    │
              │ - WebRTC :8889 (egress)│────┘
              │ - HTTP API :9996        │
              │ - fMP4 recording        │
              └─────────────────────────┘
```

## Port table

| Service            | Port        | Proto   | Purpose                       |
|--------------------|-------------|---------|-------------------------------|
| input-bridge       | 8787        | HTTP    | button / touch / screenshot   |
| senpi intervention | 7979        | WS      | chat → pi.sendUserMessage     |
| web-ui HTTP        | 3001        | HTTP    | SPA + /health + /stream/whep  |
| web-ui WS          | 3001/3002   | WS      | /chat → senpi intervention    |
| mediamtx RTSP      | 8554        | TCP     | publisher input               |
| mediamtx WHEP      | 8889        | HTTP    | WebRTC viewer (browser)       |
| mediamtx API       | 9996        | HTTP    | recording control, path list  |
| mediamtx ICE       | 8189        | UDP/TCP | WebRTC peer connectivity      |

## Data flow

- Agent decides → calls a senpi tool → tool HTTP-POSTs to input-bridge :8787.
- input-bridge translates to xdotool key/mouse against the DeSmuME X11 window.
- Xvfb captures the resulting framebuffer at :99.
- ffmpeg x11grab → RTSP push → mediamtx :8554.
- Browser opens web-ui :3001 → loads React → WHEP connects to mediamtx :8889/dori/whep → WebRTC video.
- Human types in chat panel → WS to web-ui :3001/chat → web-ui WS → senpi intervention :7979 → `pi.sendUserMessage()` → agent loop receives the text.

## Coordinate system

The combined DS screenshot returned by `nds_capture_screen()` is 256 px
wide × 384 px tall:

- Top screen: y = 0..191 (view-only, no touch interaction possible)
- Bottom (touch) screen: y = 192..383 in the screenshot

For `nds_touch({ x, y })`, coordinates are relative to the bottom screen's
own top-left:

- x ∈ [0, 255]
- y ∈ [0, 191]   ← y=0 means the top of the bottom screen, not the top of
the full image

Conversion: if you see a target at screenshot_y = 300, then touch y =
300 − 192 = 108.

## Technology stack

- Runtime: Bun
- HTTP server: Hono
- Validation: TypeBox
- Linter: Biome
- Frontend: React 18 + esbuild
- Container: Debian bookworm-slim + tini
- Streaming: ffmpeg + MediaMTX (WebRTC/WHEP)
- Emulator: DeSmuME on Xvfb
- Input: xdotool
- Tests: vitest + Playwright
