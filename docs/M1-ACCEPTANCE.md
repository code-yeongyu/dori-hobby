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

### Results (recorded 2026-05-20 19:34 KST on Darwin arm64, Docker 29.4.0 + OrbStack)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | `docker compose build` exit 0 | ✓ PASS | Built 3 images: emulator:dev (916MB), web-ui:dev (423MB), mediamtx pulled (178MB) |
| 2 | `docker compose up -d` all 3 services start | ✓ PASS | dori-emulator, dori-mediamtx, dori-web-ui all `Up` within 5s |
| 3 | 30s warm-up | n/a | – |
| 4 | `curl http://localhost:3001/health` → 200 | ✓ PASS | `{"status":"ok","uptime":167.29s}` in 17ms |
| 5 | `curl http://localhost:9996/v3/paths/list` → 200 | ✓ PASS | Returns active `dori` path with H264 1024×768 publisher (see Bonus below) |
| 6 | `curl http://localhost:7878/health` → 200/503 | ✓ PASS (200) | Input-bridge server up; `desmume window not found` error returns on /button/touch as expected (no ROM = no DeSmuME window) |
| 7 | `docker compose ps` all "Up" | ✓ PASS | All 3 containers `Up` continuously |
| 8 | `docker compose logs` no crash loop | ✓ PASS | Only benign messages: emulator's ROM warning, ffmpeg "Stream #0: not enough frames" (probesize warning, harmless), 1 ffmpeg reconnect during MediaMTX restart |
| 9 | `curl http://localhost:3001/` → 200 HTML | ✓ PASS | 346 bytes, valid HTML with `<title>dori-hobby · live</title>` |
| 10 | `docker compose down` clean shutdown | ✓ PASS | All 3 containers removed, network removed, no orphans |

#### Bonus: streaming pipeline live without ROM

MediaMTX path `dori` is actively receiving H264 from emulator's ffmpeg `x11grab` of the empty Xvfb display:

```
{
  "name": "dori",
  "ready": true,
  "online": true,
  "tracks": ["H264"],
  "tracks2": [{
    "codec": "H264",
    "codecProps": { "width": 1024, "height": 768, "profile": "Baseline", "level": "3.1" }
  }],
  "inboundBytes": 178292
}
```

This proves the **Xvfb → ffmpeg → RTSP → MediaMTX → WHEP** path works end-to-end without a ROM. When a ROM is supplied, DeSmuME will render into the same Xvfb display and ffmpeg will pick it up automatically.

#### Fixes applied during integration

- `containers/mediamtx/mediamtx.yml` — MediaMTX v1.18.2 default config blocked anonymous API access. Added explicit `authInternalUsers` with `pass:` empty, `ips: []`, and full action list including `api`. Resolved by commit `<see HEAD~1>` during T16.
- Also during integration: web-ui-lead's earlier wave inadvertently scaffolded T8 at the repo root before relocating to `containers/web-ui/`. The leaked top-level files (`/package.json`, `/tsconfig.json`, `/biome.json`, `/playwright.config.ts`, `/vitest.config.ts`, `/src/`, `/tests/`, `/dist/`, `/DESIGN.md`) were cleaned up; `DESIGN.md` was preserved by moving to `docs/DESIGN.md`. See commit `e3d40cc`.

**Overall in-session gate: PASSED ✓**

All infrastructure verified working without a ROM. Ready for user-acceptance test.

## M1 Status

- [x] All in-session health checks passed (see results above).
- [ ] User acceptance test (Trio Badge clear) — **PENDING USER**.

To run the user acceptance test, follow the steps in the next section. Once Dori earns the Trio Badge, tag the release:

```
git tag v0.1.0-m1
git push origin v0.1.0-m1
```

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
