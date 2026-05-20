#!/bin/bash
set -euo pipefail

ROM_PATH="${ROM_PATH:-/app/nds/pokemon-white.nds}"
CHEATS_PATH="${CHEATS_PATH:-/app/cheats/pokemon-white-us.dct}"
CONFIG_PATH="${CONFIG_PATH:-/app/config/desmume.ini}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
export DISPLAY=":${DISPLAY_NUM}"

# Debian installs game binaries in /usr/games — make sure desmume is on PATH.
export PATH="/usr/games:${PATH}"

cleanup() {
	if [ -n "${FFMPEG_PID:-}" ] && ps -p "${FFMPEG_PID}" >/dev/null 2>&1; then
		kill "${FFMPEG_PID}" || true
	fi
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
	# DeSmuME 0.9.11 CLI is intentionally small: NO --ini-file, NO --cheat-list,
	# NO --cheat-file. Cheats are loaded via the UI menu (Tools > Cheats > List)
	# OR by dropping a cheat .dct file in the user config dir. We do that
	# separately (copy into the matching XDG path).
	echo "[entrypoint] launching desmume with ROM=${ROM_PATH}"
	DESMUME_ARGS=(
		"--start-paused=0"
		"--disable-sound"      # no ALSA inside container
		"--load-type=1"        # load 256MB ROM entirely to RAM (more reliable than streaming)
		"--3d-engine=1"        # internal software rasterizer (no GL needed)
		"--save-type=0"        # autodetect savetype
	)
	# Pre-stage cheats into DeSmuME's XDG config path so the user can enable
	# them via UI / Tools menu without further work.
	if [ -f "${CHEATS_PATH}" ]; then
		mkdir -p "${HOME}/.config/desmume/cheats" 2>/dev/null || true
		cp -f "${CHEATS_PATH}" "${HOME}/.config/desmume/cheats/" 2>/dev/null || true
	fi
	# Launch openbox with sloppy/under-mouse focus so xdotool's XTEST keys
	# (which need a focused window) land on whichever window the mouse is
	# hovering. The input-bridge moves the cursor over the DeSmuME canvas
	# before sending keys, which gives it focus instantly.
	mkdir -p "${HOME}/.config/openbox"
	cat > "${HOME}/.config/openbox/rc.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <focus>
    <focusNew>yes</focusNew>
    <followMouse>yes</followMouse>
    <focusLast>yes</focusLast>
    <underMouse>yes</underMouse>
    <focusDelay>0</focusDelay>
    <raiseOnFocus>yes</raiseOnFocus>
  </focus>
</openbox_config>
XML
	openbox-session >/tmp/openbox.log 2>&1 &
	sleep 0.5
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

# --- 4. Wait for mediamtx + start ffmpeg RTSP push ---
MEDIAMTX_RTSP_URL="${MEDIAMTX_RTSP_URL:-rtsp://mediamtx:8554/dori}"
MEDIAMTX_HEALTH_URL="${MEDIAMTX_HEALTH_URL:-http://mediamtx:9996/v3/paths/list}"

echo "[entrypoint] waiting for mediamtx at ${MEDIAMTX_HEALTH_URL}..."
for i in $(seq 1 30); do
	if curl -fsS --max-time 1 "${MEDIAMTX_HEALTH_URL}" >/dev/null 2>&1; then
		echo "[entrypoint] mediamtx ready"
		break
	fi
	sleep 1
	if [ "${i}" = "30" ]; then
		echo "[entrypoint] WARNING: mediamtx not detected — ffmpeg will retry"
	fi
done

(
	while true; do
		echo "[entrypoint] starting ffmpeg → ${MEDIAMTX_RTSP_URL}"
		ffmpeg -hide_banner -loglevel warning \
			-f x11grab -framerate 30 -video_size 1024x768 -i ":${DISPLAY_NUM}" \
			-an \
			-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline \
			-pix_fmt yuv420p -g 30 -keyint_min 30 -sc_threshold 0 \
			-b:v 2M -maxrate 2M -bufsize 4M \
			-f rtsp -rtsp_transport tcp "${MEDIAMTX_RTSP_URL}" || true
		echo "[entrypoint] ffmpeg exited — restarting in 5s"
		sleep 5
	done
) &
FFMPEG_PID=$!

# --- 5. Start input-bridge ---
echo "[entrypoint] starting input-bridge on :7878..."
cd /app/input-bridge
exec bun run src/server.ts
