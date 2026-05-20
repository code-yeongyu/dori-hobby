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
# 1024x900 — the DeSmuME GTK toplevel + decoration is ~258x515 placed by
# openbox roughly around (390, 293), which means it can run off the
# bottom of a 768-tall Xvfb. Bumping height gives ffmpeg's x11grab a safe
# margin to crop the canvas without "outside the screen size" errors.
# Clear any stale X server lock so `docker restart` doesn't leave us with
# "Server is already active for display 99" — that lock survives the
# previous Xvfb exit when the container is stopped without a clean
# shutdown.
echo "[entrypoint] clearing stale X locks if any..."
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}" 2>/dev/null || true
echo "[entrypoint] starting Xvfb on :${DISPLAY_NUM}..."
Xvfb ":${DISPLAY_NUM}" -screen 0 1024x900x24 -ac &
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
	# DeSmuME 0.9.11 auto-loads `<rom>.dct` from the SAME dir as the ROM
	# at boot. We drop ours there. The Serial header in the .dct file MUST
	# match the loaded ROM's gamecode + CRC32 (we set IRAO-B552501C for
	# Pokemon White US, see cheats/pokemon-white-us.dct).
	if [ -f "${CHEATS_PATH}" ]; then
		ROM_DIR="$(dirname "${ROM_PATH}")"
		ROM_BASE="$(basename "${ROM_PATH}" .nds)"
		# Copy (not symlink) so DeSmuME can read it even if the host bind
		# mount drops symlink permissions.
		cp -f "${CHEATS_PATH}" "${ROM_DIR}/${ROM_BASE}.dct" 2>/dev/null || true
		echo "[entrypoint] cheats staged at ${ROM_DIR}/${ROM_BASE}.dct"
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

	# openbox places the toplevel wherever it likes, which sometimes puts
	# the game canvas below the Xvfb screen bottom and crashes our ffmpeg
	# crop. Force the toplevel frame to (10, 10) so the canvas always
	# falls inside the 1024x900 root.
	sleep 1
	GAME_WIN="$(xdotool search --onlyvisible --name "fps" 2>/dev/null | head -1 || true)"
	if [ -n "${GAME_WIN}" ]; then
		# Walk up to the top-level frame so the WHOLE window moves, not just
		# the canvas child. xdotool windowmove on a child does the right
		# thing in practice (openbox reroutes to the toplevel), but pinning
		# 10,10 here makes the geometry deterministic regardless.
		xdotool windowmove "${GAME_WIN}" 10 10 2>/dev/null || true
		echo "[entrypoint] forced DeSmuME window to (10, 10)"
	fi
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

# ffmpeg input geometry — cropped to the DeSmuME game canvas so the stream
# is just the DS screens, not the Xvfb wallpaper. We resolve the canvas
# position dynamically because openbox decides where to place the window
# at runtime.
#
# Fallback if window-not-found: capture the full 1024x768 root so the user
# at least sees SOMETHING in the stream.
resolve_capture_geometry() {
	local win
	# Give DeSmuME's GTK a beat to finish laying out the toplevel + canvas.
	sleep 1
	win="$(DISPLAY=":${DISPLAY_NUM}" xdotool search --onlyvisible --name "fps" 2>/dev/null | head -1 || true)"
	if [ -z "${win}" ]; then
		echo "[entrypoint] WARNING: DeSmuME window not found for ffmpeg crop — falling back to full Xvfb capture" >&2
		echo "1024 768 0 0"
		return
	fi
	# Use xwininfo (NOT xdotool getwindowgeometry) — the former exposes the
	# true root-window absolute upper-left, the latter returns coordinates
	# offset by GTK frame metrics that slice through the menu bar.
	local raw
	raw="$(DISPLAY=":${DISPLAY_NUM}" xwininfo -id "${win}" 2>/dev/null || true)"
	if [ -z "${raw}" ]; then
		echo "[entrypoint] WARNING: xwininfo failed — using full Xvfb capture" >&2
		echo "1024 768 0 0"
		return
	fi
	local x y w h
	x=$(echo "${raw}" | awk '/Absolute upper-left X:/ {print $NF}')
	y=$(echo "${raw}" | awk '/Absolute upper-left Y:/ {print $NF}')
	w=$(echo "${raw}" | awk '/^  Width:/ {print $NF}')
	h=$(echo "${raw}" | awk '/^  Height:/ {print $NF}')
	# Skip the GTK menu/toolbar (top) and the status bar (bottom) so the
	# RTSP feed shows JUST the two DS screens. These offsets are matched
	# to the input-bridge driver's GTK_CHROME_TOP_PX / BOTTOM_PX constants
	# (measured empirically: window rows 0..84 menu+toolbar, 85..276 top
	# screen, 277..468 bottom screen, 470..489 status bar).
	local CHROME_TOP=85
	local CHROME_BOTTOM=21
	y=$(( y + CHROME_TOP ))
	h=$(( h - CHROME_TOP - CHROME_BOTTOM ))
	# H.264 requires even dimensions. Pad up by 1 px when odd.
	w=$(( w + (w % 2) ))
	h=$(( h + (h % 2) ))
	echo "${w} ${h} ${x} ${y}"
}

read -r CAP_W CAP_H CAP_X CAP_Y < <(resolve_capture_geometry)
echo "[entrypoint] ffmpeg capture geometry: ${CAP_W}x${CAP_H}+${CAP_X},${CAP_Y}"

# Scale 2x with lanczos for crisp pixel-art upscaling. Padding (if any) is
# absorbed by the encoder's stride; we don't add letterboxing because the
# DS aspect (≈1:1.91 stacked) is what we want the viewer to see at-1.
OUT_W=$(( CAP_W * 2 ))
OUT_H=$(( CAP_H * 2 ))

(
	while true; do
		echo "[entrypoint] starting ffmpeg → ${MEDIAMTX_RTSP_URL} (cap ${CAP_W}x${CAP_H}@${CAP_X},${CAP_Y} → ${OUT_W}x${OUT_H})"
		ffmpeg -hide_banner -loglevel warning \
			-f x11grab -framerate 30 -video_size "${CAP_W}x${CAP_H}" \
			-i ":${DISPLAY_NUM}.0+${CAP_X},${CAP_Y}" \
			-an \
			-vf "scale=${OUT_W}:${OUT_H}:flags=lanczos" \
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
