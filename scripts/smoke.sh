#!/usr/bin/env bash
# scripts/smoke.sh -- non-interactive, exit-code deploy smoke check (REQ-011, DES-022, TASK-023).
#
# Boots the real server as a background process, submits a sample workflow via
# v24 (integrator): the whole submit half was dead TWICE — `workflow_run` is not a tool any more
# (-32601) and inline `script` at run time is closed (INLINE_SCRIPT_CLOSED, REQ-098). The smoke
# check now walks the real v24 path an operator must use: workflow_register (with the REQUIRED
# mermaid diagram) -> workflow_publish -> run_start -> poll run_status -> run_result.
# run_start/tools/call, polls run_status/run_result until it completes, then shuts
# the server down. Exit code 0 = pass, non-zero = fail (CI/cron-friendly).
#
# The sample workflow below never calls agent()/workflow(), so this smoke check exercises the
# dependency-free path unconditionally -- no LLM provider keys, no LiteLLM/Python subprocess
# required to get a green smoke.sh, regardless of which gateway/profile the deployment picked.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${RWE_PORT:-8799}"
BASE_URL="http://127.0.0.1:${PORT}/mcp"
LOG_FILE="$(mktemp)"
# gateway:"direct-fetch" (no useLiteLLMProxy) keeps this smoke check on the dependency-free path --
# it never spawns the managed LiteLLM/Python subprocess, so it passes on a bare Node 22.6+ host
# with no Python/litellm installed at all (the "server" docker-compose profile's own default).
CONFIG_FILE="$(mktemp)"
echo '{"gateway":"direct-fetch"}' >"$CONFIG_FILE"

echo "[smoke] starting server on port ${PORT}..."
# setsid: `npm run start` itself spawns a `tsx` child which in turn spawns the actual node
# process -- plain `kill $SERVER_PID` only reaps npm's own direct child, leaving the real server
# process orphaned (observed while developing this script). Putting the whole tree in its own
# process group lets cleanup() signal all of it at once via `kill -- -$SERVER_PID`.
export RWE_PORT="$PORT" RWE_BIND=127.0.0.1 RWE_CONFIG_PATH="$CONFIG_FILE"
setsid npm run start >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

cleanup() {
  echo "[smoke] shutting down server (pid ${SERVER_PID})..."
  kill -TERM -- "-${SERVER_PID}" >/dev/null 2>&1 || kill "$SERVER_PID" >/dev/null 2>&1 || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -f "$LOG_FILE" "$CONFIG_FILE"
}
trap cleanup EXIT

READY=0
for _ in $(seq 1 60); do
  if grep -q '\[remote-workflow-engine\] ready' "$LOG_FILE" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 0.5
done
if [ "$READY" -ne 1 ]; then
  echo "[smoke] FAIL: server did not become ready in time" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi
echo "[smoke] server ready"

call_tool() {
  local name="$1" args="$2"
  curl -sf -X POST "$BASE_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"${name}\",\"arguments\":${args}}}"
}

extract_nested() {
  # v24: workflow_register/publish answer `{result:{…}}` — the field lives one level in.
  node -e "
    const envelope = JSON.parse(process.argv[1]);
    const result = JSON.parse(envelope.result.content[0].text);
    console.log(String((result.result ?? result)[process.argv[2]]));
  " "$1" "$2"
}

extract() {
  # $1 = raw JSON-RPC envelope, $2 = JS field-access expression on the tool's own JSON result
  node -e "
    const envelope = JSON.parse(process.argv[1]);
    const result = JSON.parse(envelope.result.content[0].text);
    console.log(String(result[process.argv[2]]));
  " "$1" "$2"
}

# A minimal, REAL v24 workflow: no agent() call at all, so it needs no model provider, and a
# header-only diagram, which `checkMermaid` accepts for a script with zero agent labels.
SMOKE_WF="rwe-smoke-$$"
echo "[smoke] registering sample workflow ${SMOKE_WF}..."
REG_RESPONSE=$(call_tool workflow_register "{\"name\":\"${SMOKE_WF}\",\"script\":\"return 42;\",\"mermaid\":\"graph TD;\"}")
VERSION=$(extract_nested "$REG_RESPONSE" version)
if [ -z "$VERSION" ] || [ "$VERSION" = "undefined" ]; then
  echo "[smoke] FAIL: workflow_register did not return a version: ${REG_RESPONSE}" >&2
  exit 1
fi

echo "[smoke] publishing ${SMOKE_WF}@${VERSION} onto release..."
PUB_RESPONSE=$(call_tool workflow_publish "{\"name\":\"${SMOKE_WF}\",\"version\":\"${VERSION}\",\"channel\":\"release\"}")
case "$PUB_RESPONSE" in
  *'"error"'*) echo "[smoke] FAIL: workflow_publish refused: ${PUB_RESPONSE}" >&2; exit 1 ;;
esac

echo "[smoke] submitting sample run_start..."
RUN_RESPONSE=$(call_tool run_start "{\"name\":\"${SMOKE_WF}\"}")
RUN_ID=$(extract "$RUN_RESPONSE" runId)
if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "undefined" ]; then
  echo "[smoke] FAIL: run_start did not return a runId: ${RUN_RESPONSE}" >&2
  exit 1
fi
echo "[smoke] runId=${RUN_ID}"

STATUS=""
for _ in $(seq 1 50); do
  STATUS_RESPONSE=$(call_tool run_status "{\"runId\":\"${RUN_ID}\"}")
  STATUS=$(extract "$STATUS_RESPONSE" status)
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
  sleep 0.2
done

if [ "$STATUS" != "completed" ]; then
  echo "[smoke] FAIL: sample workflow did not complete (last status: ${STATUS})" >&2
  exit 1
fi

RESULT_RESPONSE=$(call_tool run_result "{\"runId\":\"${RUN_ID}\"}")
RESULT=$(extract "$RESULT_RESPONSE" result)
if [ "$RESULT" != "42" ]; then
  echo "[smoke] FAIL: unexpected result: ${RESULT}" >&2
  exit 1
fi

echo "[smoke] PASS: sample workflow completed with result=${RESULT}"
call_tool workflow_deregister "{\"name\":\"${SMOKE_WF}\"}" >/dev/null 2>&1 || true
exit 0
