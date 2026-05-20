#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "▸ Stopping dori-hobby services..."
docker compose down
echo "  ✓ All services stopped"
