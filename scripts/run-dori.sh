#!/usr/bin/env bash
# scripts/run-dori.sh — auto-resume senpi runner for Dori.
#
# Wraps `senpi` with three behaviors:
#   1. Sessions live in ./.dori-sessions/ (project-local, gitignored) so
#      they survive when this repo is the only thing on disk.
#   2. `--continue` re-attaches to the most recent session by default, so
#      crashing senpi (or Ctrl+C'ing it) and re-running this script picks
#      up where Dori left off WITHOUT replaying her bedroom intro.
#   3. The script crash-loops senpi forever (with backoff) so OOM/network
#      blips don't strand her. Ctrl+C in the tmux pane stops the loop
#      because we trap SIGINT and exit before the next iteration.
#
# Flags:
#   --fresh         start a brand-new session (ignore existing sessions)
#   --model <id>    override the model (default: anthropic/claude-sonnet-4.6)
#   --no-loop       run senpi exactly once; surface its exit code
#
# Env:
#   DORI_MODEL      same as --model
#   DORI_PROVIDER   senpi provider name (default: openrouter)
#   DORI_TOOLS      comma-separated tool allowlist (default: the 3 nds_ tools)
#
# Usage:
#   ./scripts/run-dori.sh                      # resume last session, loop
#   ./scripts/run-dori.sh --fresh              # new session
#   DORI_MODEL='kimi-k2.6' ./scripts/run-dori.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_DIR="${REPO_ROOT}/.dori-sessions"
EXTENSION_PATH="${REPO_ROOT}/senpi-dori-desmume/extensions/index.ts"
SYSTEM_PROMPT_PATH="${REPO_ROOT}/data/system-prompt.md"
PROVIDER="${DORI_PROVIDER:-openrouter}"
MODEL="${DORI_MODEL:-anthropic/claude-sonnet-4.6}"
TOOLS="${DORI_TOOLS:-nds_capture_screen,nds_press_button,nds_touch}"

FRESH=0
LOOP=1
while [[ $# -gt 0 ]]; do
	case "$1" in
		--fresh) FRESH=1; shift ;;
		--no-loop) LOOP=0; shift ;;
		--model) MODEL="$2"; shift 2 ;;
		*) echo "unknown flag: $1" >&2; exit 2 ;;
	esac
done

mkdir -p "${SESSION_DIR}"

CONTINUE_FLAG="--continue"
if [[ "${FRESH}" -eq 1 ]]; then
	CONTINUE_FLAG=""
	echo "[run-dori] --fresh: starting a brand-new session"
fi

# Pre-flight: only resume if there's a recent session file. senpi with
# --continue on an empty dir errors out; better to silently fall back.
if [[ -n "${CONTINUE_FLAG}" ]] && ! ls -1 "${SESSION_DIR}"/*.json >/dev/null 2>&1; then
	echo "[run-dori] no prior session in ${SESSION_DIR} — starting fresh"
	CONTINUE_FLAG=""
fi

# Build the senpi invocation as an array so spaces in paths are safe.
SENPI_ARGS=(
	"--provider" "${PROVIDER}"
	"--model" "${MODEL}"
	"--session-dir" "${SESSION_DIR}"
	"-e" "${EXTENSION_PATH}"
	"--append-system-prompt" "$(cat "${SYSTEM_PROMPT_PATH}")"
	"--tools" "${TOOLS}"
)
if [[ -n "${CONTINUE_FLAG}" ]]; then
	SENPI_ARGS=("${CONTINUE_FLAG}" "${SENPI_ARGS[@]}")
fi

trap 'echo "[run-dori] received SIGINT — exiting loop"; exit 0' INT

attempt=0
while true; do
	attempt=$((attempt + 1))
	echo "[run-dori] attempt ${attempt}: senpi ${SENPI_ARGS[*]}"
	if senpi "${SENPI_ARGS[@]}"; then
		echo "[run-dori] senpi exited cleanly"
		[[ "${LOOP}" -eq 0 ]] && break
	else
		code=$?
		echo "[run-dori] senpi exited code=${code}"
		[[ "${LOOP}" -eq 0 ]] && exit "${code}"
	fi

	# Backoff: 1s, 2s, 5s, 10s, 30s, then cap at 60s. Prevents tight
	# crash loops from melting CPU when senpi is fundamentally broken.
	sleep_s=$((attempt < 5 ? attempt : 30))
	if [[ "${attempt}" -ge 6 ]]; then sleep_s=60; fi
	echo "[run-dori] restarting in ${sleep_s}s..."
	sleep "${sleep_s}"

	# After the first successful boot, switch to --continue regardless
	# of how the user invoked us, so the loop self-recovers.
	if [[ "${CONTINUE_FLAG}" != "--continue" ]]; then
		CONTINUE_FLAG="--continue"
		SENPI_ARGS=("${CONTINUE_FLAG}" "${SENPI_ARGS[@]}")
	fi
done
