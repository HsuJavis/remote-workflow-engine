#!/usr/bin/env bash
# scripts/smoke.sh -- non-interactive, exit-code deploy smoke check (REQ-011, DES-022, TASK-023).
#
# Boots the real server as a background process, submits a sample workflow via
# workflow_run/tools/call, polls workflow_status/workflow_result until it completes, then shuts
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

extract() {
  # $1 = raw JSON-RPC envelope, $2 = JS field-access expression on the tool's own JSON result
  node -e "
    const envelope = JSON.parse(process.argv[1]);
    const result = JSON.parse(envelope.result.content[0].text);
    console.log(String(result[process.argv[2]]));
  " "$1" "$2"
}

echo "[smoke] submitting sample workflow_run..."
RUN_RESPONSE=$(call_tool workflow_run '{"script":"return 42;"}')
RUN_ID=$(extract "$RUN_RESPONSE" runId)
if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "undefined" ]; then
  echo "[smoke] FAIL: workflow_run did not return a runId: ${RUN_RESPONSE}" >&2
  exit 1
fi
echo "[smoke] runId=${RUN_ID}"

STATUS=""
for _ in $(seq 1 50); do
  STATUS_RESPONSE=$(call_tool workflow_status "{\"runId\":\"${RUN_ID}\"}")
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

RESULT_RESPONSE=$(call_tool workflow_result "{\"runId\":\"${RUN_ID}\"}")
RESULT=$(extract "$RESULT_RESPONSE" result)
if [ "$RESULT" != "42" ]; then
  echo "[smoke] FAIL: unexpected result: ${RESULT}" >&2
  exit 1
fi

echo "[smoke] PASS: sample workflow completed with result=${RESULT}"
exit 0
