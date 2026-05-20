#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

ROM_PATH="./nds/pokemon-white.nds"

if [ ! -f "${ROM_PATH}" ]; then
  echo "ERROR: ROM not found at ${ROM_PATH}" >&2
  echo "       See docs/ROM-PLACEMENT.md for download + placement instructions." >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  SHA1=$(shasum -a 1 "${ROM_PATH}" | awk '{print $1}')
elif command -v sha1sum >/dev/null 2>&1; then
  SHA1=$(sha1sum "${ROM_PATH}" | awk '{print $1}')
else
  echo "ERROR: need either shasum or sha1sum" >&2
  exit 1
fi

SIZE_BYTES=$(stat -f%z "${ROM_PATH}" 2>/dev/null || stat -c%s "${ROM_PATH}")
SIZE_MB=$((SIZE_BYTES / 1024 / 1024))

echo "ROM file: ${ROM_PATH}"
echo "  SHA-1:  ${SHA1}"
echo "  Size:   ${SIZE_BYTES} bytes (~${SIZE_MB} MiB)"
echo ""
echo "Note: the official US Pokémon White v1.0 ROM is ~256 MiB."
echo "      We do NOT hardcode the expected SHA-1 because dump variants exist."
