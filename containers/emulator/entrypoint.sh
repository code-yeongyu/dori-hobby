#!/bin/bash
set -euo pipefail

ROM_PATH="${ROM_PATH:-/app/nds/pokemon-white.nds}"
CHEATS_PATH="${CHEATS_PATH:-/app/cheats/pokemon-white-us.dct}"
CONFIG_PATH="${CONFIG_PATH:-/app/config/desmume.ini}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
export DISPLAY=":${DISPLAY_NUM}"

cleanup() {
	if [ -n "${DESMUME_PID:-}" ] && ps -p "${DESMUME_PID}" >/dev/null 2>&1; then
		kill "${DESMUME_PID}" || true
	fi
	if [ -n "${XVFB_PID:-}" ] && ps -p "${XVFB_PID}" >/dev/null 2>&1; then
		kill "${XVFB_PID}" || true
	fi
}
trap cleanup EXIT TERM INT

# --- 1. Start Xvfb ---
echo "[entrypoint] starting Xvfb on :${DISPLAY_NUM}..."
Xvfb ":${DISPLAY_NUM}" -screen 0 1024x768x24 -ac &
XVFB_PID=$!

# Wait for display
for i in $(seq 1 30); do
	if xdpyinfo -display ":${DISPLAY_NUM}" >/dev/null 2>&1; then
		echo "[entrypoint] Xvfb ready"
		break
	fi
	sleep 0.5
	if [ "${i}" = "30" ]; then
		echo "[entrypoint] ERROR: Xvfb did not start"
		exit 1
	fi
done

# --- 2. Verify ROM ---
if [ ! -f "${ROM_PATH}" ]; then
	echo "[entrypoint] WARNING: ROM not found at ${ROM_PATH}"
	echo "[entrypoint] DeSmuME will not launch. Input-bridge will start, but /screenshot will fail."
	echo "[entrypoint] Place the ROM and restart the container. See docs/ROM-PLACEMENT.md."
	DESMUME_PID=""
else
	# --- 3. Launch DeSmuME ---
	echo "[entrypoint] launching desmume with ROM=${ROM_PATH}"
	DESMUME_ARGS=()
	if [ -f "${CONFIG_PATH}" ]; then
		DESMUME_ARGS+=("--ini-file=${CONFIG_PATH}")
	fi
	if [ -f "${CHEATS_PATH}" ]; then
		DESMUME_ARGS+=("--cheat-file=${CHEATS_PATH}")
	fi
	desmume "${DESMUME_ARGS[@]}" "${ROM_PATH}" >/tmp/desmume.log 2>&1 &
	DESMUME_PID=$!

	# Wait for desmume window
	for i in $(seq 1 30); do
		if xdotool search --class desmume >/dev/null 2>&1; then
			echo "[entrypoint] DeSmuME window ready"
			break
		fi
		sleep 0.5
		if [ "${i}" = "30" ]; then
			echo "[entrypoint] WARNING: DeSmuME window not detected — proceeding anyway"
			break
		fi
	done
fi

# --- 4. Wait for mediamtx (T12 finalizes this) ---
# Placeholder for T12. T12 owns the ffmpeg → RTSP push command.
echo "[entrypoint] (ffmpeg streaming will be added by T12 — skipping for now)"

# --- 5. Start input-bridge ---
echo "[entrypoint] starting input-bridge on :7878..."
cd /app/input-bridge
exec bun run src/server.ts
