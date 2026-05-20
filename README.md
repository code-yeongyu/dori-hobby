# dori-hobby

Dori's hobby playground — sisyphuslabs.ai's AI assistant plays Pokémon White, live-streamed and human-intervenable.

## About Dori

Dori is the personal AI assistant introduced in [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)'s README (the "Meet your own Jobdori — Dori" line, via Sisyphus Labs). This repo is where she does her hobbies in her downtime.

## Milestone 1

Goal: agent earns the Striaton Trio Badge in Pokémon White, end-to-end, with a human able to intervene mid-play.

## Architecture (brief)

3 Docker services (emulator/DeSmuME, mediamtx for WebRTC, web-ui for viewer + chat) plus a host-side senpi process running the `senpi-dori-desmume` extension. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full breakdown.

## Quick Start

Run `./scripts/start.sh` once the ROM is placed at `./nds/pokemon-white.nds` — see [`docs/ROM-PLACEMENT.md`](docs/ROM-PLACEMENT.md) for details.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture and component interactions
- [`docs/ROM-PLACEMENT.md`](docs/ROM-PLACEMENT.md) — how to place your ROM and BIOS files
- [`docs/CHEATS.md`](docs/CHEATS.md) — cheat codes and save-state helpers for Milestone 1
- [`docs/M1-ACCEPTANCE.md`](docs/M1-ACCEPTANCE.md) — acceptance criteria and test results for Milestone 1

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
