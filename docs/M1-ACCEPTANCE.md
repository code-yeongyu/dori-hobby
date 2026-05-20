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
