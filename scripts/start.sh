#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

ROM_PATH="./nds/pokemon-white.nds"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required but not found in PATH" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose v2 is required" >&2
  exit 1
fi

if [ ! -f "${ROM_PATH}" ]; then
  echo "WARNING: ROM not found at ${ROM_PATH}"
  echo "         The emulator container will start, but DeSmuME will not launch a game."
  echo "         See docs/ROM-PLACEMENT.md for download + placement instructions."
  echo ""
  read -r -p "Continue without ROM? [y/N] " yn
  case "${yn}" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

echo "▸ Building images (cached layers reused)..."
docker compose build

echo "▸ Starting services..."
docker compose up -d

echo "▸ Waiting for services to become healthy (up to 60s)..."

wait_for() {
  local name="$1" url="$2"
  for i in $(seq 1 60); do
    if curl -fsS --max-time 1 "${url}" >/dev/null 2>&1; then
      echo "  ✓ ${name} ready"
      return 0
    fi
    sleep 1
  done
  echo "  ✗ ${name} not ready after 60s — check 'docker compose logs ${name}'" >&2
  return 1
}

wait_for "web-ui"  "http://localhost:3001/health"          || true
wait_for "mediamtx" "http://localhost:9996/v3/paths/list"  || true
# input-bridge may take longer if DeSmuME has to launch
wait_for "input-bridge" "http://localhost:7878/health"     || true

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  dori-hobby is live"
echo "═══════════════════════════════════════════════════════════════"
echo "  Web UI:      http://localhost:3001"
echo "  WebRTC:      http://localhost:8889/dori/whep"
echo "  Bridge:      http://localhost:7878"
echo "  MediaMTX API: http://localhost:9996"
echo ""
echo "  Next: start senpi on the host with the senpi-dori-desmume extension:"
echo "    senpi -e ./senpi-dori-desmume/extensions/index.ts \\"
echo "          --system-prompt-file=./data/system-prompt.md \\"
echo "          --context-file=./data/walkthrough.md"
echo ""
echo "  To stop:   ./scripts/stop.sh"
echo "═══════════════════════════════════════════════════════════════"
