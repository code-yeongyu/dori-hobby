# dori-hobby

Dori's hobby playground — sisyphuslabs.ai's AI assistant plays Pokémon White, live-streamed and human-intervenable.

## About Dori

Dori is the personal AI assistant introduced in [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)'s README (the "Meet your own Jobdori — Dori" line, via Sisyphus Labs). This repo is where she does her hobbies in her downtime.

## Milestone 1

Goal: agent earns the Striaton Trio Badge in Pokémon White, end-to-end, with a human able to intervene mid-play.

## Architecture (brief)

3 Docker services (emulator/DeSmuME, mediamtx for WebRTC, web-ui for viewer + chat) plus a host-side senpi process running the `senpi-dori-desmume` extension. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full breakdown.

## Prerequisites

- Docker 24+ with Docker Compose v2
- Bun 1.3+ (for the host-side senpi agent)
- A Pokémon White (US) NDS ROM placed at `./nds/pokemon-white.nds`
- An LLM API key configured in senpi

## Quick Start

1. Place your ROM at `./nds/pokemon-white.nds` (see [`docs/ROM-PLACEMENT.md`](docs/ROM-PLACEMENT.md)).
2. Run `./scripts/verify-rom.sh` to sanity-check the file.
3. Run `./scripts/start.sh` to build and start the Docker services.
4. Open http://localhost:3001/ in a browser to watch the stream.
5. In a separate terminal, start senpi with the dori-desmume extension:
   ```
   senpi -e ./senpi-dori-desmume/extensions/index.ts \
         --system-prompt-file=./data/system-prompt.md \
         --context-file=./data/walkthrough.md
   ```
6. Dori begins playing. Type into the chat panel to intervene if she gets stuck.
7. Success = Trio Badge appears in her Trainer Card.

See [`docs/M1-ACCEPTANCE.md`](docs/M1-ACCEPTANCE.md) for the full acceptance checklist.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture and component interactions
- [`docs/ROM-PLACEMENT.md`](docs/ROM-PLACEMENT.md) — how to place your ROM and BIOS files
- [`docs/CHEATS.md`](docs/CHEATS.md) — cheat codes and save-state helpers for Milestone 1
- [`docs/M1-ACCEPTANCE.md`](docs/M1-ACCEPTANCE.md) — acceptance criteria and test results for Milestone 1

## Project structure

```
containers/
  emulator/          — DeSmuME + Xvfb + ffmpeg + input-bridge
  mediamtx/          — MediaMTX WebRTC/RTSP config
  web-ui/            — Hono backend + React frontend
senpi-dori-desmume/ — senpi extension (tools + intervention WS)
data/               — walkthrough + system prompt
docs/               — architecture, cheats, ROM placement, acceptance
scripts/            — start.sh, stop.sh, verify-rom.sh
nds/                — ROM directory (gitignored)
recordings/         — fMP4 recordings (gitignored)
```

## Stack

- Bun
- Hono
- React
- TypeBox
- Biome
- DeSmuME
- MediaMTX
- Docker

## License

MIT
