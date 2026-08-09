#!/usr/bin/env bash
# deploy/rwe-update.sh — privileged updater helper (TASK-063, DES-060, ARCH-039).
#
# Triggered by deploy/rwe-update.path (PathExists= + PathChanged=) via
# deploy/rwe-update.service (Type=oneshot).  Carries ALL update logic; the systemd
# units are deliberately logic-free (DES-060: "zero decision logic").
#
# Env seams (injectable; tests substitute fake binaries via these vars):
#   RWE_UPDATE_FLAG     — path to the flag file the engine atomically writes the tag into
#   RWE_UPDATE_RESULT   — path for the UpdateOutcome JSON (temp+rename, atomic)
#   RWE_UPDATE_LOCK     — path for the flock advisory lock file
#   RWE_OFFICIAL_REMOTE — pinned official git remote URL/path (only source accepted)
#   GIT                 — git binary override (default: git)
#   NPM                 — npm binary override (default: npm)
#   SYSTEMCTL           — systemctl binary override (default: systemctl)
#
# Exit codes (feed the result detail; match DES-060):
#   0  — applied (or clean no-op when flag was absent at trigger)
#   10 — flag/tag validation failed (flag present but content invalid)
#   20 — remote resolve failed (tag not found on the official remote)
#   30 — build or checkout failed (safe-fail: abort BEFORE systemctl restart)
#   40 — already at that SHA in detached HEAD (idempotent skip)

set -u

GIT="${GIT:-git}"
NPM="${NPM:-npm}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"

# Anchored tag pattern: must start v<digit> then allowed chars (DES-060 defence-in-depth).
TAG_PATTERN='^v[0-9][0-9A-Za-z.+-]*$'

FLAG="${RWE_UPDATE_FLAG}"
RESULT="${RWE_UPDATE_RESULT}"
LOCK="${RWE_UPDATE_LOCK}"
REMOTE="${RWE_OFFICIAL_REMOTE}"

# ── write_result: atomic temp+rename so a half-written file is never seen ─────
write_result() {
  local STATUS="$1"
  local TAG="$2"
  local DETAIL="${3:-}"
  local TS
  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local TMP
  TMP="$(mktemp "${RESULT}.XXXXXX")"

  if [ -n "$DETAIL" ]; then
    # Sanitize: strip quotes and backslashes that would break JSON; flatten newlines.
    local D
    D="$(printf '%s' "$DETAIL" | tr -d '"\\' | tr '\n' ' ')"
    # Cap at 4 KB (head+tail truncation for large logs; tests only assert on tag/status).
    D="${D:0:4096}"
    printf '{"tag":"%s","status":"%s","ts":"%s","detail":"%s"}\n' \
      "$TAG" "$STATUS" "$TS" "$D" > "$TMP"
  else
    printf '{"tag":"%s","status":"%s","ts":"%s"}\n' \
      "$TAG" "$STATUS" "$TS" > "$TMP"
  fi

  mv "$TMP" "$RESULT"
}

# ── acquire flock, read + consume the flag within the lock ───────────────────
# Open the lock fd; flock blocks until exclusive lock acquired.
exec 9>"$LOCK"
flock 9

if [ ! -f "$FLAG" ]; then
  # Flag absent: stale/post-consume re-fire from .path unit.
  # Exit 0 (not 10) — systemd must NOT mark the oneshot failed for a clean no-op.
  flock -u 9
  exit 0
fi

# Read the tag: strip all whitespace/newlines (engine writes "<tag>\n").
T="$(tr -d '[:space:]' < "$FLAG")"

# Consume the flag (rename away) so the .path unit does not re-arm on a stale file.
rm -f "$FLAG"

flock -u 9

# ── re-validate tag pattern (defence-in-depth; never pass unvalidated to shell) ──
if ! printf '%s' "$T" | grep -qE "$TAG_PATTERN"; then
  exit 10
fi

# ── verify tag exists on the OFFICIAL remote (no foreign/nonexistent tags) ────
REMOTE_CHECK="$("$GIT" ls-remote --tags "$REMOTE" "refs/tags/$T" 2>/dev/null)"
if [ -z "$REMOTE_CHECK" ]; then
  # Not found on official remote: exit 20, nothing changed, no result file.
  exit 20
fi

# Fetch tags from the official remote (makes the tag's objects available locally).
if ! "$GIT" fetch --tags "$REMOTE" 2>&1; then
  exit 20
fi

# Resolve the tag to a commit SHA (rev-list peels annotated tags to the commit).
TARGET_SHA="$("$GIT" rev-list -n1 "refs/tags/$T" 2>/dev/null)"
if [ -z "$TARGET_SHA" ]; then
  exit 20
fi

# ── idempotent skip: detached HEAD already at target SHA ──────────────────────
# Only skip when HEAD is DETACHED at the target SHA (a prior real apply).
# A fresh clone is branch-attached even if HEAD == target SHA, so it proceeds.
CURRENT_SHA="$("$GIT" rev-parse HEAD 2>/dev/null)"
if [ "$CURRENT_SHA" = "$TARGET_SHA" ]; then
  if ! "$GIT" symbolic-ref -q HEAD > /dev/null 2>&1; then
    # Detached HEAD at target SHA: already applied; write skipped result, exit 40.
    write_result "skipped" "$T"
    exit 40
  fi
fi

# ── checkout the target SHA (array-args — never shell-interpolated) ───────────
if ! "$GIT" checkout "$TARGET_SHA" 2>&1; then
  write_result "failed" "$T" "git checkout failed"
  exit 30
fi

# ── build: npm ci then npm run build ─────────────────────────────────────────
# Safe-fail: on ANY build failure, revert the working tree to the PRIOR checkout
# and abort BEFORE systemctl restart. Reverting (not just "abort before restart")
# means a later restart/reboot boots the last-good code, not the broken new tag —
# the running process AND every future boot stay on the prior version.
revert_and_fail() {  # $1 = failure detail
  "$GIT" checkout "$CURRENT_SHA" > /dev/null 2>&1 || true
  write_result "failed" "$T" "$1"
  exit 30
}
if ! "$NPM" ci 2>&1; then
  revert_and_fail "npm ci failed"
fi

if ! "$NPM" run build 2>&1; then
  revert_and_fail "npm run build failed"
fi

# ── success: write applied result, flush to disk, THEN restart ───────────────
# Write-ordering invariant (DES-060): result flushed before restart so the restarted
# engine can ingest it at boot (ARCH-034 crash-durability, ARCH-040 observability).
write_result "applied" "$T"
sync

"$SYSTEMCTL" restart rwe

exit 0
