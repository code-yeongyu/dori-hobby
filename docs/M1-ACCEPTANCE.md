# Milestone 1 Acceptance

## In-Session Verification (no ROM required)

Run these checks to verify the stack builds and starts cleanly before
attaching a ROM or running the agent.

1. `docker compose build` → exit 0
2. `docker compose up -d` → all 3 services start
3. Wait 30s
4. `curl http://localhost:3001/health` → 200 `{"status":"ok",...}`
5. `curl http://localhost:9996/v3/paths/list` → 200 JSON
6. `curl http://localhost:7878/health` → 200 OR 503 (acceptable without
   ROM; 503 means DeSmuME hasn't launched a game yet)
7. `docker compose ps` → all 3 "Up"
8. `docker compose logs --tail=50` → no crash/OOM
9. `curl http://localhost:3001/` → 200 HTML (SPA loads)
10. `docker compose down` → clean shutdown, 0 orphan containers

#### Results (recorded automatically by T16)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | `docker compose build` exit 0 | ✓ PASS | Build completed successfully (`/tmp/dori-build.log`). |
| 2 | `docker compose up -d` all 3 services start | ✓ PASS | `dori-emulator`, `dori-mediamtx`, `dori-web-ui` all started. |
| 3 | 30s warm-up | n/a | Waited 30 seconds before checks. |
| 4 | `curl http://localhost:3001/health` → 200 | ✓ PASS | `{"status":"ok","uptime":51.839212691}` |
| 5 | `curl http://localhost:9996/v3/paths/list` → 200 | ✓ PASS | 200 JSON with online `dori` path, H264 track present. |
| 6 | `curl http://localhost:7878/health` → 200 or 503 | ✓ PASS (200) | `{"status":"ok"}`; no-ROM mode still allowed. |
| 7 | `docker compose ps` all "Up" | ✓ PASS | All three services in `Up` state. |
| 8 | `docker compose logs` no crash loop | ✓ PASS | No crash loops or OOMs; only expected ROM-missing warning in emulator logs. |
| 9 | `curl http://localhost:3001/` → 200 HTML | ✓ PASS | 200 HTML includes `<title>dori-hobby · live</title>`. |
| 10 | `docker compose down` clean shutdown | ✓ PASS | Containers and network removed cleanly; `docker ps -a | grep dori-` empty. |

**Playwright smoke tests (optional)**: Not run in T16.

##### Fixes applied during T16

- `containers/mediamtx/mediamtx.yml`
  - `recordPath` changed to include `%path` (fixed MediaMTX restart loop: `ERR: 'recordPath' must contain %path`).
  - `webrtcAllowOrigin` updated to `webrtcAllowOrigins` (deprecation cleanup).
  - Added local-dev API/read/publish auth permissions for anonymous access so `GET /v3/paths/list` returns 200 for acceptance checks.

**Overall in-session gate**: PASSED ✓

**Recorded on**: 2026-05-20 19:36 KST
**Docker version**: Docker version 29.4.0, build 9d7ad9f
**Host OS**: Darwin mengmotaMac 25.3.0 arm64

## With-ROM Verification (Pokemon White boots end-to-end)

Performed after dropping `pokemon-white.nds` (256 MiB, game code IRAO,
SHA-1 `bc696a0dfb448c7b3a8a206f0f8214411a039208`) into `./nds/`.

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| A | DeSmuME launches under Xvfb | ✓ PASS | Window class `desmume` + title `DeSmuME - 60fps, 0 skipped, draw: 60fps` |
| B | ROM loads (no CLI parse errors) | ✓ PASS | `/tmp/desmume.log` shows only ALSA warnings, no "Unknown option" |
| C | Game advances past Nintendo logo → title screen | ✓ PASS | Top: Reshiram silhouette + glowing red eye. Bottom: "POKEMON WHITE VERSION" logo + "Developed by GAME FREAK inc." |
| D | `POST /button {button:"A"}` advances dialog | ✓ PASS | 5 sequential A-presses observed in 3 distinct dialog frames: "Welcome to the world of Pokémon!" → "My name is Professor Juniper. Everyone calls me the Pokémon Profe..." (mid-typing) → "Everyone calls me the Pokémon Professor!" |
| E | `POST /touch {x,y}` reaches canvas (XTEST path) | ✓ PASS | Returns `{ok:true}`; mouse hover transfers focus via openbox sloppy focus before XTEST click |
| F | `GET /screenshot` returns valid 1024×768 PNG | ✓ PASS | base64-encoded PNG decodes to a frame showing the current DS scene |
| G | `ffmpeg -i rtsp://localhost:8554/dori` returns live frames | ✓ PASS | One-frame capture shows Professor Juniper live in stream; MediaMTX H264 track present in `/v3/paths/list` |
| H | input-bridge vitest suite | ✓ PASS | 15/15 pass; `bunx tsc --noEmit` clean; biome clean |

### Fixes applied during with-ROM bring-up

1. `containers/emulator/entrypoint.sh`: stripped unknown DeSmuME CLI
   flags (`--ini-file`, `--cheat-list`) that were causing the argument
   parser to bail out before loading the ROM. Added real flags:
   `--start-paused=0 --disable-sound --load-type=1 --3d-engine=1`. AR
   cheats are pre-staged into the user XDG config so they can be
   toggled via the in-emulator UI later.
2. `containers/emulator/Dockerfile`: installed `openbox`. Without a
   WM, X has no concept of "focused window", so xdotool's XTEST events
   went into the void.
3. `containers/emulator/entrypoint.sh`: wrote
   `~/.config/openbox/rc.xml` with `<followMouse>yes</followMouse>` +
   `<underMouse>yes</underMouse>` so hovering the canvas instantly
   transfers focus to DeSmuME.
4. `containers/emulator/input-bridge/src/desmume-driver.ts`: rewrote
   key/touch injection to use bare `xdotool key`/`mousemove`/`click`
   (XTEST extension, real events) after `xdotool mousemove 517 500` to
   hover the canvas. The previous `xdotool key --window <id>` path
   used XSendEvent, which sets `synthetic=YES` on the X event — GDK
   drops synthetic key events as a security feature, so DeSmuME never
   saw them. Also switched window search to
   `--onlyvisible --name fps` to skip the hidden 10x10 GTK helper
   window. `captureScreen()` now uses `import -window root` (per-window
   capture intermittently failed with "Resource temporarily
   unavailable" on Xvfb).
5. `containers/emulator/input-bridge/test/*.test.ts`: updated mocks
   for the new XTEST-based xdotool invocation sequence.

**Overall with-ROM gate**: PASSED ✓

## M1 Status

- [x] All in-session health checks passed (see results above).
- [x] With-ROM bring-up verified (Pokemon White boots + agent inputs
  advance dialog).
- [ ] User acceptance test (Trio Badge clear) — PENDING USER.

To run the user acceptance test, follow "User Acceptance Test" above.

Once complete, tag the release:

    git tag v0.1.0-m1
    git push origin v0.1.0-m1

## User Acceptance Test (requires ROM + LLM API key + ~30-60 min)

1. Place ROM at `./nds/pokemon-white.nds`.
2. `./scripts/verify-rom.sh` → prints SHA-1 + size; sanity check.
3. `./scripts/start.sh` → starts compose, runs health checks, prints URLs.
4. Open http://localhost:3001/ in a browser; you should see Dori's stream
   connecting → live.
5. Start senpi in a separate terminal with the `senpi-dori-desmume`
   extension linked:
   ```
   cd /Users/yeongyu/local-workspaces/dori-hobby
   senpi -e ./senpi-dori-desmume/extensions/index.ts \
         --system-prompt-file=./data/system-prompt.md \
         --context-file=./data/walkthrough.md
   ```
6. Dori begins capturing/pressing buttons. Watch the web-ui stream.
7. (Optional) Type into chat to nudge her if she gets stuck.
8. **SUCCESS = Trio Badge appears in her Trainer Card** (X menu →
   Trainer Card → Badges screen shows the Trio Badge filled in).
9. Estimated wall time: 30-60 minutes from new game.
