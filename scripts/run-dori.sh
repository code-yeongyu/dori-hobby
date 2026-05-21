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
#   DORI_TOOLS      comma-separated tool allowlist (default: the NDS tools)
#   DORI_ANTHROPIC_COMPUTER_USE_BETA  documented native Anthropic beta string
#   DORI_OPENAI_COMPUTER_USE_MODEL     documented OpenAI Responses computer-use model
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
SENPI_BIN="${DORI_SENPI_BIN:-${REPO_ROOT}/senpi-dori-desmume/node_modules/.bin/senpi}"
PROVIDER="${DORI_PROVIDER:-anthropic}"
# Default: claude-opus-4-7 with max thinking via the user's local
# anthropic-compatible gateway (configured in ~/.senpi/agent/auth.json:
# base_url=https://ccapi.labs.mengmota.com/anthropic, key=sk-yeongyu-*).
# Senpi's anthropic provider uses native model ids with DASHES
# (claude-opus-4-7), NOT OpenRouter's dot form. The OpenRouter catalog
# does not host opus-4.7 yet, so we route directly through ccapi.
MODEL="${DORI_MODEL:-claude-opus-4-7}"
THINKING="${DORI_THINKING:-max}"
TOOLS="${DORI_TOOLS:-nds_capture_screen,nds_press_button,nds_touch,nds_press_sequence,nds_a_until_dialog,NdsAUntilDialog,nds_notepad_read,nds_notepad_append}"
ANTHROPIC_COMPUTER_USE_BETA="${DORI_ANTHROPIC_COMPUTER_USE_BETA:-computer-use-2025-11-24}"
OPENAI_COMPUTER_USE_MODEL="${DORI_OPENAI_COMPUTER_USE_MODEL:-gpt-5.4}"

export DORI_ANTHROPIC_COMPUTER_USE_BETA="${ANTHROPIC_COMPUTER_USE_BETA}"
export DORI_OPENAI_COMPUTER_USE_MODEL="${OPENAI_COMPUTER_USE_MODEL}"

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

case "${PROVIDER}" in
	anthropic)
		echo "[run-dori] Anthropic native computer-use beta documented: ${ANTHROPIC_COMPUTER_USE_BETA}"
		echo "[run-dori] senpi exposes request mutation via extensions; no safe native computer tool is registered by this NDS extension."
		;;
	openai|openai-responses)
		echo "[run-dori] OpenAI computer-use requires Responses API model/tool: ${OPENAI_COMPUTER_USE_MODEL} + computer tool."
		echo "[run-dori] this NDS extension uses senpi tools, not provider-native OpenAI computer actions."
		;;
	openrouter)
		echo "[run-dori] OpenRouter does not passthrough Anthropic computer-use beta headers/tool types; using in-context computer-use priming."
		;;
	*)
		echo "[run-dori] provider ${PROVIDER}: no verified native computer-use passthrough; using in-context computer-use priming."
		;;
esac

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
#
# --no-extensions: skip auto-discovered extensions (notably pi-macos-cua,
# which registers a `computer_20250124` Anthropic Computer-Use tool type
# that ccapi/anthropic API rejects with "tools.N: Input tag ... does not
# match any of the expected tags". Dori only needs OUR explicit
# nds_* extension, not the macOS-CUA one. The explicit -e flag still
# loads our extension.
SENPI_ARGS=(
	"--provider" "${PROVIDER}"
	"--model" "${MODEL}"
	"--thinking" "${THINKING}"
	"--session-dir" "${SESSION_DIR}"
	"--no-extensions"
	"--no-builtin-tools"
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
	echo "[run-dori] attempt ${attempt}: ${SENPI_BIN} ${SENPI_ARGS[*]}"
	if "${SENPI_BIN}" "${SENPI_ARGS[@]}"; then
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
