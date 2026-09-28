#!/usr/bin/env bash
# deploy/migrate-to-service-user.sh — move a running remote-workflow-engine deployment from the
# operator's own login account (systemd --user units of e.g. uid 1000) to a dedicated, unprivileged
# system user (default `rwe`, home /home/rwe). See DEPLOY.md「以獨立系統使用者執行（建議）」.
#
# Run AS THE OPERATOR (the account that runs the engine today), never as root. Privileged steps call
# `sudo` themselves; work that must be owned by the service user runs through `sudo -u rwe -H`.
# Every phase is idempotent and prints each command before it runs it (`+ ...`).
#
#   deploy/migrate-to-service-user.sh [--dry-run] [--yes] [--force] <phase>
#
#   phase1    create the system user, chmod 750 its home, enable linger
#   phase2    toolchain for the service user: node (copied from the operator's install),
#             ~/.local/bin/{node,npm,npx}, uv, LiteLLM venv (same litellm version)
#   phase3    generate the service user's GitHub deploy key, print the PUBLIC key, stop
#   phase3b   (after the key is added on GitHub) pin github.com host key, clone over SSH,
#             check out the tag the operator's checkout runs, npm ci
#   phase4    config + secrets: rwe.config.json with paths rewritten, rwe.env copied (600),
#             optional Google client-secret rotation (read -s, never echoed)
#   phase5    DOWNTIME: stop the operator's engine, copy workRoot to the service user
#   phase6    install + start the service user's systemd units, disable the operator's
#   phase7    verify (banner, /api/version, smoke.sh, public /mcp 401, uid isolation, git over SSH)
#   rollback  stop/disable the service user's units, re-enable the operator's units
#
#   --dry-run  print every command, execute nothing that changes state (no sudo needed)
#   --yes      do not ask for confirmation before the downtime / rollback steps
#   --force    phase4: overwrite an existing config/env; phase5: replace an existing copied workRoot
#              (the old copy is moved aside to <dir>.bak-<timestamp>, never deleted)
#
# Everything host-specific is an environment variable with a default derived from the operator's
# current deployment (see the block below) — override any of them on another server, e.g.
#   RWE_USER=engine OP_CHECKOUT=/srv/me/remote-workflow deploy/migrate-to-service-user.sh phase1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SELF="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
# `sudo -u rwe` keeps the caller's cwd; the operator's home is 750, so a service-user command started
# from inside it fails with "could not change directory". Every path below is absolute.
cd /

DRY_RUN=0 ASSUME_YES=0 FORCE=0 PHASE=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,32p' "$SELF" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $a" >&2; exit 2 ;;
    *) [ -z "$PHASE" ] || { echo "only one phase per invocation" >&2; exit 2; }; PHASE="$a" ;;
  esac
done
[ -n "$PHASE" ] || { sed -n '2,32p' "$SELF" | sed 's/^# \{0,1\}//'; exit 2; }
if [ "$(id -u)" = 0 ]; then echo "run this as the operator account, not as root (it calls sudo itself)" >&2; exit 2; fi

# ── host-specific values (override via env) ───────────────────────────────────────────────────────
RWE_USER="${RWE_USER:-rwe}"
RWE_HOME="${RWE_HOME:-/home/$RWE_USER}"
RWE_CHECKOUT="${RWE_CHECKOUT:-$RWE_HOME/remote-workflow}"
RWE_WORKROOT="${RWE_WORKROOT:-$RWE_HOME/.local/share/rwe-data}"
RWE_LITELLM_VENV="${RWE_LITELLM_VENV:-$RWE_HOME/.rwe-litellm-venv}"
OP_HOME="${OP_HOME:-$HOME}"
OP_UID="$(id -u)"
OP_CHECKOUT="${OP_CHECKOUT:-$OP_HOME/Documents/remote-workflow}"
OP_CONFIG="${OP_CONFIG:-$OP_CHECKOUT/rwe.config.json}"
OP_ENV="${OP_ENV:-$OP_HOME/.config/rwe.env}"
OP_NODE_DIR="${OP_NODE_DIR:-$OP_HOME/.local/node}"
OP_LITELLM_VENV="${OP_LITELLM_VENV:-$OP_HOME/.rwe-litellm-venv}"
OP_UV="${OP_UV:-$(command -v uv 2>/dev/null || echo "$OP_HOME/.local/bin/uv")}"
OP_UPDATE_DIR="${OP_UPDATE_DIR:-$OP_HOME/.local/share/rwe-update}"
# The port the public tunnel/reverse proxy forwards to. Kept identical so the tunnel needs no change.
RWE_PORT_VALUE="${RWE_PORT_VALUE:-$(sed -n 's/^Environment=RWE_PORT=\([0-9]*\).*/\1/p' "$OP_HOME/.config/systemd/user/rwe.service.d/override.conf" 2>/dev/null | tail -1)}"
RWE_PORT_VALUE="${RWE_PORT_VALUE:-8787}"
SMOKE_PORT="${SMOKE_PORT:-8799}"
# auth.googleClientSecret becomes "${secret:<name>}" in the service user's config; the value lives in
# its rwe.env as RWE_SECRET_<name> (resolved at boot by src/main.ts).
GOOGLE_SECRET_NAME="${GOOGLE_SECRET_NAME:-GOOGLE_CLIENT_SECRET}"
# GitHub's published ed25519 host-key fingerprint (https://api.github.com/meta → ssh_key_fingerprints).
# phase3b cross-checks the live API against this pin; set it empty to trust the API alone.
GITHUB_ED25519_FP="${GITHUB_ED25519_FP-SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU}"

RWE_PATH="$RWE_HOME/.local/bin:$RWE_HOME/.local/node/bin:/usr/local/bin:/usr/bin:/bin"

# ── helpers ───────────────────────────────────────────────────────────────────────────────────────
say()  { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
show() { printf '+'; printf ' %q' "$@"; printf '\n'; }
# run CMD... — echo, then execute unless --dry-run.
run()  { show "$@"; [ "$DRY_RUN" = 1 ] || "$@"; }
# as_rwe CMD... — run as the service user with its own HOME and a PATH that finds its toolchain.
as_rwe() { run sudo -u "$RWE_USER" -H env PATH="$RWE_PATH" "$@"; }
# write_as_rwe DEST MODE SOURCE-DESC < content — the service user creates DEST from stdin (the
# operator's files are unreadable to it, and nothing secret ever lands in argv, env or a temp file).
write_as_rwe() {
  local dest="$1" mode="$2"
  printf '+ %s | (as %s) write %s mode %s\n' "${3:-stdin}" "$RWE_USER" "$dest" "$mode"
  if [ "$DRY_RUN" = 1 ]; then cat >/dev/null; return 0; fi
  # shellcheck disable=SC2016  # $1/$2 expand in the inner sh, by design
  sudo -u "$RWE_USER" sh -c 'umask 077; cat > "$1.tmp" && chmod "$2" "$1.tmp" && mv "$1.tmp" "$1"' sh "$dest" "$mode"
}
user_exists() { id -u "$RWE_USER" >/dev/null 2>&1; }
rwe_uid() {
  if user_exists; then id -u "$RWE_USER"
  elif [ "$DRY_RUN" = 1 ]; then echo "<uid-of-$RWE_USER>"
  else die "user $RWE_USER does not exist yet — run phase1 first"; fi
}
# The service user's own systemd instance (it has no login session, so point systemctl at its
# runtime dir/bus explicitly — the same thing deploy/rwectl does).
rwe_systemctl() {
  local uid; uid="$(rwe_uid)"
  run sudo -u "$RWE_USER" env XDG_RUNTIME_DIR="/run/user/$uid" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user "$@"
}
# set_rwe_env_secret FILE KEY < value — (re)place KEY=value in the service user's env file, 600.
# The value arrives on stdin only (printf is a builtin: never in argv / /proc).
set_rwe_env_secret() {
  local f="$1" key="$2" v
  IFS= read -r v || true
  [ -n "$v" ] || die "empty secret for $key"
  case "$v" in *[!A-Za-z0-9._~+/=-]*) die "the value for $key has characters an env file would mangle — not written";; esac
  printf '+ <secret via stdin> | (as %s) set %s in %s (mode 600)\n' "$RWE_USER" "$key" "$f"
  # shellcheck disable=SC2016
  printf '%s=%s\n' "$key" "$v" | sudo -u "$RWE_USER" sh -c 'umask 077; { grep -v "^$2=" "$1" 2>/dev/null; cat; } > "$1.tmp" && chmod 600 "$1.tmp" && mv "$1.tmp" "$1"' sh "$f" "$key"
  v=""
}
rwe_test() { [ "$DRY_RUN" = 0 ] && user_exists && sudo -u "$RWE_USER" test "$@" 2>/dev/null; }
confirm() {
  if [ "$ASSUME_YES" = 1 ] || [ "$DRY_RUN" = 1 ]; then return 0; fi
  local ans; read -r -p "$1 [y/N] " ans; [ "$ans" = y ] || [ "$ans" = Y ] || die "aborted"
}
need_rwe() { user_exists || [ "$DRY_RUN" = 1 ] || die "user $RWE_USER does not exist yet — run phase1 first"; }
json_get() {  # json_get FILE KEY.PATH — print a (non-secret) config value
  python3 -c 'import json,sys
v=json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."): v=(v or {}).get(k) if isinstance(v,dict) else None
print("" if v is None else v)' "$1" "$2"
}
op_workroot() { json_get "$OP_CONFIG" workRoot; }
deploy_tag() {
  [ -n "${DEPLOY_TAG:-}" ] && { echo "$DEPLOY_TAG"; return; }
  git -C "$OP_CHECKOUT" describe --tags --exact-match 2>/dev/null \
    || die "the operator checkout is not exactly at a tag ($(git -C "$OP_CHECKOUT" describe --tags 2>/dev/null)) — set DEPLOY_TAG=<tag>"
}
repo_ssh_url() {
  [ -n "${REPO_SSH:-}" ] && { echo "$REPO_SSH"; return; }
  local url; url="$(git -C "$OP_CHECKOUT" remote get-url origin)"
  case "$url" in
    https://github.com/*) url="${url#https://github.com/}"; echo "git@github.com:${url%.git}.git" ;;
    git@github.com:*) echo "$url" ;;
    *) die "cannot derive an SSH remote from '$url' — set REPO_SSH=git@host:owner/repo.git" ;;
  esac
}
# %h-relative form of the service user's checkout for the unit templates.
unit_checkout() {
  case "$RWE_CHECKOUT" in "$RWE_HOME"/*) echo "%h/${RWE_CHECKOUT#"$RWE_HOME"/}" ;; *) echo "$RWE_CHECKOUT" ;; esac
}
wait_http() {  # wait_http URL SECONDS
  [ "$DRY_RUN" = 1 ] && { show curl -fsS "$1"; return 0; }
  local _
  for _ in $(seq 1 "$2"); do curl -fsS "$1" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}

# ── phases ────────────────────────────────────────────────────────────────────────────────────────
phase1() {
  say "phase1: create the system user '$RWE_USER' (home $RWE_HOME, no login shell, no sudo), enable linger"
  if user_exists; then note "user $RWE_USER already exists — not re-creating"
  else
    run sudo useradd --system --user-group --create-home --home-dir "$RWE_HOME" \
      --shell /usr/sbin/nologin --comment "remote-workflow-engine service" "$RWE_USER"
  fi
  run sudo chmod 750 "$RWE_HOME"
  if [ "$DRY_RUN" = 0 ]; then
    local groups; groups=" $(id -nG "$RWE_USER") "
    for g in sudo admin wheel adm "$(id -gn)"; do
      case "$groups" in *" $g "*) die "$RWE_USER is in group '$g' — remove it (gpasswd -d $RWE_USER $g)";; esac
    done
    note "groups of $RWE_USER:$groups(ok)"
  fi
  run sudo loginctl enable-linger "$RWE_USER"
  local uid; uid="$(rwe_uid)"
  say "waiting for the $RWE_USER user manager (/run/user/$uid/systemd/private)"
  if [ "$DRY_RUN" = 0 ]; then
    local _; for _ in $(seq 1 30); do rwe_test -S "/run/user/$uid/systemd/private" && break; sleep 1; done
    rwe_test -S "/run/user/$uid/systemd/private" || die "user@$uid.service did not come up — check: systemctl status user@$uid.service"
    note "user manager for $RWE_USER is running"
  fi
}

phase2() {
  need_rwe
  say "phase2: toolchain for $RWE_USER — node copied from $OP_NODE_DIR (same build, no download)"
  [ -x "$OP_NODE_DIR/bin/node" ] || die "no node at $OP_NODE_DIR/bin/node — set OP_NODE_DIR"
  local want; want="$("$OP_NODE_DIR/bin/node" -v)"
  note "operator node: $want"
  run sudo install -d -o "$RWE_USER" -g "$RWE_USER" -m 755 "$RWE_HOME/.local" "$RWE_HOME/.local/bin" "$RWE_HOME/.local/share"
  local have=""; rwe_test -x "$RWE_HOME/.local/node/bin/node" && have="$(sudo -u "$RWE_USER" "$RWE_HOME/.local/node/bin/node" -v)"
  if [ "$have" = "$want" ]; then note "$RWE_USER already has node $have — skipping copy"
  else
    # An official node tarball is relocatable (npm/npx are relative symlinks inside it); cp -a keeps
    # them. Copy to a temp dir and swap so a half-finished copy is never live.
    run sudo rm -rf "$RWE_HOME/.local/node.new"
    run sudo cp -a "$OP_NODE_DIR" "$RWE_HOME/.local/node.new"
    run sudo chown -R "$RWE_USER:$RWE_USER" "$RWE_HOME/.local/node.new"
    run sudo rm -rf "$RWE_HOME/.local/node"
    run sudo mv "$RWE_HOME/.local/node.new" "$RWE_HOME/.local/node"
  fi
  for b in node npm npx; do as_rwe ln -sfn "$RWE_HOME/.local/node/bin/$b" "$RWE_HOME/.local/bin/$b"; done
  # The Claude CLI sandbox binds ~/.npm/_logs (and ~/.claude/debug) writable into every agent Bash
  # sandbox whenever they EXIST (DEPLOY.md §1c(f)) — keep npm's own logs out of ~/.npm/_logs for good.
  if ! rwe_test -f "$RWE_HOME/.npmrc" || ! sudo -u "$RWE_USER" grep -q '^logs-dir=' "$RWE_HOME/.npmrc"; then
    printf 'logs-dir=%s/.cache/npm-logs\n' "$RWE_HOME" | write_as_rwe "$RWE_HOME/.npmrc" 644 "printf logs-dir=$RWE_HOME/.cache/npm-logs"
  fi
  if [ "$DRY_RUN" = 0 ]; then
    have="$(sudo -u "$RWE_USER" -H env PATH="$RWE_PATH" node -v)"
    [ "$have" = "$want" ] || die "node version mismatch: $RWE_USER has $have, operator has $want"
    note "node $have / npm $(sudo -u "$RWE_USER" -H env PATH="$RWE_PATH" npm -v) as $RWE_USER (matches)"
  fi

  say "phase2: LiteLLM venv at $RWE_LITELLM_VENV (uv venv + uv pip install, same as deploy.sh)"
  if [ ! -x "$OP_LITELLM_VENV/bin/litellm" ]; then
    note "operator has no LiteLLM venv at $OP_LITELLM_VENV — skipping (only gateway:\"sdk\" needs it)"; return 0
  fi
  local llv; llv="$("$OP_LITELLM_VENV/bin/python" -c 'import importlib.metadata as m; print(m.version("litellm"))')"
  note "operator litellm: $llv"
  # Never copy the venv itself: its pyvenv.cfg points at the operator's uv-managed interpreter under
  # $OP_HOME, which the service user must not be able to read. uv is one static binary — copy it.
  [ -x "$OP_UV" ] || die "uv not found (OP_UV=$OP_UV) — install uv for the operator or set OP_UV"
  run sudo install -o "$RWE_USER" -g "$RWE_USER" -m 755 "$OP_UV" "$RWE_HOME/.local/bin/uv"
  local have_llv=""
  rwe_test -x "$RWE_LITELLM_VENV/bin/python" && have_llv="$(sudo -u "$RWE_USER" "$RWE_LITELLM_VENV/bin/python" -c 'import importlib.metadata as m; print(m.version("litellm"))' 2>/dev/null || true)"
  if [ "$have_llv" = "$llv" ]; then note "$RWE_USER already has litellm $have_llv — skipping"; return 0; fi
  note "needs network access (python.org build via uv + PyPI)"
  as_rwe uv python install 3.12
  rwe_test -x "$RWE_LITELLM_VENV/bin/python" || as_rwe uv venv --python 3.12 "$RWE_LITELLM_VENV"
  as_rwe uv pip install --python "$RWE_LITELLM_VENV/bin/python" "litellm[proxy]==$llv"
  if [ "$DRY_RUN" = 0 ]; then
    have_llv="$(sudo -u "$RWE_USER" "$RWE_LITELLM_VENV/bin/python" -c 'import importlib.metadata as m; print(m.version("litellm"))')"
    [ "$have_llv" = "$llv" ] || die "litellm version mismatch: $have_llv vs $llv"
    as_rwe "$RWE_LITELLM_VENV/bin/litellm" --version
  fi
}

phase3() {
  need_rwe
  say "phase3: GitHub deploy key for $RWE_USER ($RWE_HOME/.ssh/id_ed25519)"
  as_rwe install -d -m 700 "$RWE_HOME/.ssh"
  if rwe_test -f "$RWE_HOME/.ssh/id_ed25519"; then note "key already exists — reusing it"
  else as_rwe ssh-keygen -q -t ed25519 -N '' -C "$RWE_USER@$(hostname) remote-workflow-engine deploy key" -f "$RWE_HOME/.ssh/id_ed25519"
  fi
  as_rwe chmod 600 "$RWE_HOME/.ssh/id_ed25519"
  local slug; slug="$(repo_ssh_url)"; slug="${slug#*:}"; slug="${slug%.git}"
  say "PUBLIC key (safe to paste):"
  if [ "$DRY_RUN" = 1 ]; then show sudo cat "$RWE_HOME/.ssh/id_ed25519.pub"; else sudo cat "$RWE_HOME/.ssh/id_ed25519.pub"; fi
  cat <<EOF

STOP — add this key on GitHub, then run phase3b:
  1. https://github.com/$slug/settings/keys → "Add deploy key"
  2. Title: $RWE_USER@$(hostname)   Key: the line above
  3. Leave "Allow write access" UNCHECKED (read-only: the engine only fetches tags)
  4. deploy/migrate-to-service-user.sh phase3b
EOF
}

phase3b() {
  need_rwe
  local url tag; url="$(repo_ssh_url)"; tag="$(deploy_tag)"
  say "phase3b: pin github.com's ed25519 host key for $RWE_USER"
  if rwe_test -f "$RWE_HOME/.ssh/known_hosts" && sudo -u "$RWE_USER" grep -q '^github.com ssh-ed25519 ' "$RWE_HOME/.ssh/known_hosts"; then
    note "github.com already in $RWE_HOME/.ssh/known_hosts"
  else
    show ssh-keyscan -t ed25519 github.com
    show curl -fsS https://api.github.com/meta
    if [ "$DRY_RUN" = 0 ]; then
      local line fp api
      line="$(ssh-keyscan -t ed25519 github.com 2>/dev/null | grep '^github.com ssh-ed25519 ')" || die "ssh-keyscan github.com failed"
      fp="$(printf '%s\n' "$line" | ssh-keygen -lf - -E sha256 | awk '{print $2}')"
      api="SHA256:$(curl -fsS https://api.github.com/meta | python3 -c 'import json,sys; print(json.load(sys.stdin)["ssh_key_fingerprints"]["SHA256_ED25519"])')" \
        || die "could not fetch GitHub's published fingerprints"
      note "scanned $fp / published $api${GITHUB_ED25519_FP:+ / pinned $GITHUB_ED25519_FP}"
      [ "$fp" = "$api" ] || die "github.com host key does not match GitHub's published fingerprint — do NOT continue"
      [ -z "$GITHUB_ED25519_FP" ] || [ "$fp" = "$GITHUB_ED25519_FP" ] \
        || die "GitHub's published fingerprint differs from the pin in this script — verify at https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints and set GITHUB_ED25519_FP"
      printf '%s\n' "$line" | sudo -u "$RWE_USER" tee -a "$RWE_HOME/.ssh/known_hosts" >/dev/null
    fi
  fi

  say "phase3b: check the deploy key can read the repo"
  show sudo -u "$RWE_USER" -H git ls-remote "$url" "refs/tags/$tag"
  if [ "$DRY_RUN" = 0 ]; then
    sudo -u "$RWE_USER" -H env GIT_SSH_COMMAND="ssh -o BatchMode=yes" git ls-remote "$url" "refs/tags/$tag" | grep -q . \
      || die "$RWE_USER cannot read $url (or tag $tag is not there) — is the deploy key added? (ssh -T git@github.com as $RWE_USER)"
  fi

  say "phase3b: clone $url → $RWE_CHECKOUT at $tag (the tag $OP_CHECKOUT runs)"
  if rwe_test -d "$RWE_CHECKOUT/.git"; then
    note "checkout exists — fetching tags"
    as_rwe git -C "$RWE_CHECKOUT" fetch --tags origin
  else
    as_rwe git clone "$url" "$RWE_CHECKOUT"
  fi
  as_rwe git -C "$RWE_CHECKOUT" -c advice.detachedHead=false checkout "refs/tags/$tag"
  if [ "$DRY_RUN" = 0 ]; then
    local a b; a="$(git -C "$OP_CHECKOUT" rev-parse HEAD)"; b="$(sudo -u "$RWE_USER" git -C "$RWE_CHECKOUT" rev-parse HEAD)"
    [ "$a" = "$b" ] || die "HEAD mismatch: operator $a vs $RWE_USER $b"
    note "HEAD $b (same commit as the operator's checkout)"
  fi
  as_rwe env -C "$RWE_CHECKOUT" npm ci
}

phase4() {
  need_rwe
  local dest="$RWE_CHECKOUT/rwe.config.json" envf="$RWE_HOME/.config/rwe.env"
  local handle="\${secret:$GOOGLE_SECRET_NAME}" envkey="RWE_SECRET_$GOOGLE_SECRET_NAME"
  [ -r "$OP_CONFIG" ] || die "cannot read $OP_CONFIG"

  say "phase4: $envf (copied byte-for-byte, mode 600, never printed)"
  as_rwe install -d -m 700 "$RWE_HOME/.config"
  if rwe_test -f "$envf" && [ "$FORCE" = 0 ]; then note "already present — keeping it (use --force to recopy)"
  else
    [ -r "$OP_ENV" ] || die "cannot read $OP_ENV"
    write_as_rwe "$envf" 600 "cat $OP_ENV" < "$OP_ENV"
  fi

  say "phase4: $dest from $OP_CONFIG — paths moved under $RWE_HOME, no plaintext Google client secret"
  if rwe_test -f "$dest" && [ "$FORCE" = 0 ]; then
    note "$dest already exists — keeping it (use --force to regenerate)"
  else
    note "workRoot:         $(op_workroot) → $RWE_WORKROOT"
    note "updateFlagPath:   → $RWE_HOME/rwe-update.flag   (must equal %h/rwe-update.flag in rwe-update.path)"
    note "updateResultPath: → $RWE_HOME/.local/share/rwe-update/result.json"
    local current secret="" source=""
    current="$(json_get "$OP_CONFIG" auth.googleClientSecret)"
    if [ -n "$current" ]; then
      # The handle is only safe on engine code that resolves it (a version without that support would
      # send the literal "${secret:…}" to Google). Checked against the checkout rwe will actually run.
      if [ "$DRY_RUN" = 1 ]; then note "(dry-run: would require $RWE_CHECKOUT/src/main.ts to resolve auth \${secret:…} handles)"
      elif ! sudo -u "$RWE_USER" grep -q 'resolveAuthSecrets' "$RWE_CHECKOUT/src/main.ts"; then
        die "the checked-out tag ($(deploy_tag)) cannot resolve \${secret:…} in auth.googleClientSecret — deploy a release that includes it (DEPLOY_TAG=<tag> phase3b) and rerun phase4"
      fi
      note "auth.googleClientSecret → \"$handle\"; the value goes to $envf as $envkey"
      note "(to rotate: Google Cloud Console → Credentials → the OAuth client → \"Add secret\" first)"
      if [ "$DRY_RUN" = 1 ]; then note "(dry-run: would ask for a NEW rotated secret; Enter = move the current value)"
      else
        read -r -s -p "    NEW rotated googleClientSecret (not echoed; Enter = keep the current one): " secret; echo
        if [ -n "$secret" ]; then source="rotated"
        else
          # shellcheck disable=SC2016  # a literal ${secret: prefix
          case "$current" in '${secret:'*)
            note "current value is already a handle ($current) — nothing to move; make sure $envf has its RWE_SECRET_ line"
            source="handle" ;;
          *) source="moved" ;;
          esac
        fi
      fi
    fi
    # The config rewrite; the secret value itself never passes through here.
    # shellcheck disable=SC2016
    local py='import json,sys
cfg=json.load(open(sys.argv[1])); home,wr,handle,old=sys.argv[2],sys.argv[3],sys.argv[4],sys.argv[5]
cfg["workRoot"]=wr
cfg["updateFlagPath"]=home+"/rwe-update.flag"
cfg["updateResultPath"]=home+"/.local/share/rwe-update/result.json"
if (cfg.get("auth") or {}).get("googleClientSecret"): cfg["auth"]["googleClientSecret"]=handle
def walk(v,p):
    if isinstance(v,dict): [walk(x,p+"."+k) for k,x in v.items()]
    elif isinstance(v,list): [walk(x,"%s[%d]"%(p,i)) for i,x in enumerate(v)]
    elif isinstance(v,str) and old and old in v: sys.stderr.write("    WARNING: %s still points under %s — edit it by hand\n"%(p,old))
walk(cfg,"")
json.dump(cfg,sys.stdout,indent=2); sys.stdout.write("\n")'
    if [ "$DRY_RUN" = 1 ]; then
      python3 -c "$py" "$OP_CONFIG" "$RWE_HOME" "$RWE_WORKROOT" "$handle" "$OP_HOME" \
        | python3 -c 'import json,sys; c=json.load(sys.stdin); [print("    rendered %s = %s" % (k, c[k])) for k in ("workRoot","updateFlagPath","updateResultPath")]; a=c.get("auth") or {}; a.get("googleClientSecret") and print("    rendered auth.googleClientSecret = %s" % a["googleClientSecret"])'
      printf '+ python3 <rewrite> %s | (as %s) write %s mode 600\n' "$OP_CONFIG" "$RWE_USER" "$dest"
      [ -z "$current" ] || printf '+ <secret via stdin> | (as %s) set %s in %s (mode 600)\n' "$RWE_USER" "$envkey" "$envf"
    else
      # secret first: a config that references a handle must never land before the value it needs
      case "$source" in
        rotated) printf '%s\n' "$secret" | set_rwe_env_secret "$envf" "$envkey" ;;
        moved)   json_get "$OP_CONFIG" auth.googleClientSecret | set_rwe_env_secret "$envf" "$envkey" ;;
      esac
      secret=""
      python3 -c "$py" "$OP_CONFIG" "$RWE_HOME" "$RWE_WORKROOT" "$handle" "$OP_HOME" \
        | write_as_rwe "$dest" 600 "python3 <rewrite> $OP_CONFIG"
      [ "$source" = rotated ] && note "rotated secret stored; after phase7 passes and a real login works, DISABLE the old secret in Google Cloud Console"
    fi
  fi

  if [ "$DRY_RUN" = 0 ]; then
    note "key names in $RWE_USER's rwe.env: $(sudo -u "$RWE_USER" sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$envf" | tr '\n' ' ')"
  fi
  # check-config sees rwe.env's RWE_SECRET_* lines exactly the way the self-update helper feeds them
  # (RWE_CONFIG_ENV_FILE, deploy/rwe-update.sh) — so a handle that won't resolve fails HERE, pre-downtime.
  show sudo -u "$RWE_USER" -H env RWE_CONFIG_PATH="$dest" RWE_CONFIG_ENV_FILE="$envf" "<check-config via deploy/rwe-update.sh's env loader>"
  if [ "$DRY_RUN" = 0 ]; then
    sudo -u "$RWE_USER" -H env -C "$RWE_CHECKOUT" PATH="$RWE_PATH" RWE_CONFIG_PATH="$dest" bash -s -- "$envf" <<'LOADER' \
      || die "check-config refused the new config"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in RWE_SECRET_*=*) ;; *) continue ;; esac
  key="${line%%=*}"; val="${line#*=}"
  case "$key" in *[!A-Za-z0-9_]*) continue ;; esac
  case "$val" in \"*\") val="${val#\"}"; val="${val%\"}" ;; \'*\') val="${val#\'}"; val="${val%\'}" ;; esac
  export "$key=$val"
done < "$1"
exec npm run --silent check-config
LOADER
  fi
}

phase5() {
  need_rwe
  local wr; wr="$(op_workroot)"
  [ -d "$wr" ] || die "operator workRoot $wr not found"
  say "phase5 (DOWNTIME STARTS): stop the operator's engine, copy $wr → $RWE_WORKROOT"
  if rwe_test -e "$RWE_WORKROOT"; then
    [ "$FORCE" = 1 ] || die "$RWE_WORKROOT already exists — phase5 already ran. Re-copying would discard anything the $RWE_USER engine wrote since; pass --force to move it aside and copy again"
  fi
  confirm "Stop the production engine now?"
  run systemctl --user stop rwe-update.path rwe.service
  # an in-flight self-update would still be writing the operator checkout — let it finish
  if [ "$DRY_RUN" = 0 ]; then
    while systemctl --user is-active --quiet rwe-update.service; do note "waiting for rwe-update.service to finish"; sleep 2; done
    ! systemctl --user is-active --quiet rwe.service || die "rwe.service is still active"
  fi
  if rwe_test -e "$RWE_WORKROOT"; then run sudo mv "$RWE_WORKROOT" "$RWE_WORKROOT.bak-$(date +%Y%m%d%H%M%S)"; fi
  run sudo install -d -o "$RWE_USER" -g "$RWE_USER" -m 755 "$(dirname "$RWE_WORKROOT")"
  # SQLite DBs are copied with their -wal/-shm siblings, service stopped → a consistent snapshot.
  # Rehearsed: no stored row/file needs a path rewrite (run workspaces, CAS, assets, skills and
  # trigger rows are all resolved relative to workRoot at runtime). The original stays untouched.
  run sudo cp -a "$wr" "$RWE_WORKROOT"
  run sudo chown -R "$RWE_USER:$RWE_USER" "$RWE_WORKROOT"
  run sudo chmod 700 "$RWE_WORKROOT"
  note "original kept at $wr (rollback uses it as-is)"
  note "downtime continues until phase6 starts the $RWE_USER units"
}

phase6() {
  need_rwe
  local url co tpl; url="$(repo_ssh_url)"; co="$(unit_checkout)"; tpl="$REPO_DIR/deploy"
  local ud="$RWE_HOME/.config/systemd/user"
  say "phase6: install systemd --user units for $RWE_USER (from $tpl, repo path → $co, remote → $url, port $RWE_PORT_VALUE)"
  as_rwe install -d -m 755 "$RWE_HOME/.config/systemd" "$ud" "$ud/rwe.service.d"
  as_rwe install -d -m 700 "$RWE_HOME/.local/share/rwe-update"
  sed "s#%h/Documents/remote-workflow#$co#g" "$tpl/rwe.user.service" \
    | write_as_rwe "$ud/rwe.service" 644 "sed <repo path> $tpl/rwe.user.service"
  sed "s#^Environment=RWE_PORT=.*#Environment=RWE_PORT=$RWE_PORT_VALUE#" "$tpl/rwe.service.d/override.conf" \
    | write_as_rwe "$ud/rwe.service.d/override.conf" 644 "sed <port> $tpl/rwe.service.d/override.conf"
  sed -e "s#%h/Documents/remote-workflow#$co#g" -e "s#^Environment=RWE_OFFICIAL_REMOTE=.*#Environment=RWE_OFFICIAL_REMOTE=$url#" \
    "$tpl/rwe-update.service" | write_as_rwe "$ud/rwe-update.service" 644 "sed <repo path, remote> $tpl/rwe-update.service"
  write_as_rwe "$ud/rwe-update.path" 644 "cat $tpl/rwe-update.path" < "$tpl/rwe-update.path"
  write_as_rwe "$RWE_HOME/.local/share/rwe-update/systemctl-user" 755 "cat $tpl/systemctl-user" < "$tpl/systemctl-user"
  # carry the last update outcome over so the dashboard's update panel keeps its history
  if [ -r "$OP_UPDATE_DIR/result.json" ] && ! rwe_test -f "$RWE_HOME/.local/share/rwe-update/result.json"; then
    write_as_rwe "$RWE_HOME/.local/share/rwe-update/result.json" 600 "cat $OP_UPDATE_DIR/result.json" < "$OP_UPDATE_DIR/result.json"
  fi

  if [ "$DRY_RUN" = 0 ] && ss -ltnH "sport = :$RWE_PORT_VALUE" | grep -q .; then
    die "port $RWE_PORT_VALUE is still in use — run phase5 first (the operator's engine must be stopped)"
  fi
  # §1c(f): these two are bound writable into every agent sandbox if they exist — remove before start.
  as_rwe rm -rf "$RWE_HOME/.npm/_logs" "$RWE_HOME/.claude/debug"
  rwe_systemctl daemon-reload
  rwe_systemctl enable --now rwe.service rwe-update.path
  say "phase6: disable (not delete) the operator's units so a reboot cannot start them again"
  run systemctl --user disable rwe.service rwe-update.path
  say "phase6: waiting for http://127.0.0.1:$RWE_PORT_VALUE/api/version"
  wait_http "http://127.0.0.1:$RWE_PORT_VALUE/api/version" 90 || die "engine did not come up — deploy/rwectl logs -n 100; or run: $0 rollback"
  note "DOWNTIME ENDS — the engine now runs as $RWE_USER. Next: $0 phase7"
}

phase7() {
  need_rwe
  local uid fail=0 tag issuer; uid="$(rwe_uid)"; tag="$(deploy_tag)"
  ok()  { printf '    PASS %s\n' "$*"; }
  bad() { printf '    FAIL %s\n' "$*"; fail=1; }
  say "phase7: verify"
  if [ "$DRY_RUN" = 1 ]; then
    show sudo journalctl _UID="$uid" _SYSTEMD_USER_UNIT=rwe.service -n 300 -o cat
    show curl -fsS "http://127.0.0.1:$RWE_PORT_VALUE/api/version"
    show sudo -u "$RWE_USER" -H env -C "$RWE_CHECKOUT" PATH="$RWE_PATH" RWE_PORT="$SMOKE_PORT" bash scripts/smoke.sh
    show curl -s -X POST "<auth.issuer>/mcp"
    show sudo -u "$RWE_USER" ls "$OP_HOME" "/tmp/claude-$OP_UID"
    show sudo -u "$RWE_USER" -H git ls-remote "$(repo_ssh_url)" "refs/tags/$tag"
    return 0
  fi
  local pid owner log
  pid="$(sudo -u "$RWE_USER" env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user show -p MainPID --value rwe.service)"
  owner="$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ')"
  if [ "$owner" = "$RWE_USER" ]; then ok "engine pid $pid runs as $owner"; else bad "engine pid '$pid' runs as '$owner'"; fi
  log="$(sudo journalctl _UID="$uid" _SYSTEMD_USER_UNIT=rwe.service -n 300 -o cat --no-pager)"
  local banner; banner="$(printf '%s\n' "$log" | grep 'Bash confinement:' | tail -1)"
  case "$banner" in *"confinement: CONFINED"*) ok "banner: CONFINED" ;; *) bad "banner: ${banner:-<none in journal>}" ;; esac
  if printf '%s\n' "$log" | grep -q "listening on http://[^ ]*:$RWE_PORT_VALUE/mcp"; then ok "listening on :$RWE_PORT_VALUE"
  else bad "no 'listening on …:$RWE_PORT_VALUE' line"; fi
  local v; v="$(curl -fsS "http://127.0.0.1:$RWE_PORT_VALUE/api/version" || true)"
  case "$v" in *"($tag)"*) ok "/api/version $v" ;; *) bad "/api/version '$v' (expected tag $tag)" ;; esac
  if sudo -u "$RWE_USER" -H env -C "$RWE_CHECKOUT" PATH="$RWE_PATH" RWE_PORT="$SMOKE_PORT" bash scripts/smoke.sh >/dev/null 2>&1; then
    ok "scripts/smoke.sh as $RWE_USER (port $SMOKE_PORT)"; else bad "scripts/smoke.sh as $RWE_USER — rerun it by hand to see output"; fi
  issuer="$(sudo -u "$RWE_USER" python3 -c 'import json,sys; print((json.load(open(sys.argv[1])).get("auth") or {}).get("issuer") or "")' "$RWE_CHECKOUT/rwe.config.json")"
  if [ -n "$issuer" ]; then
    local hdr; hdr="$(curl -s -o /dev/null -D - -X POST -H 'Content-Type: application/json' -d '{}' "$issuer/mcp" || true)"
    if printf '%s' "$hdr" | head -1 | grep -q ' 401' && printf '%s' "$hdr" | grep -qi '^www-authenticate:.*scope='; then
      ok "public $issuer/mcp → 401 with WWW-Authenticate scope"
    else bad "public $issuer/mcp: $(printf '%s' "$hdr" | head -1)"; fi
  else note "SKIP public /mcp check (auth.issuer not set)"; fi
  local p
  for p in "$OP_HOME" "$OP_HOME/.config/rwe.env" "$OP_CONFIG" "/tmp/claude-$OP_UID"; do
    if sudo -u "$RWE_USER" sh -c 'ls -- "$1" >/dev/null 2>&1 || cat -- "$1" >/dev/null 2>&1' sh "$p"; then
      bad "$RWE_USER CAN read $p"
    elif [ ! -e "$p" ]; then note "SKIP $p (does not exist)"
    else ok "$RWE_USER cannot read $p"; fi
  done
  if sudo -u "$RWE_USER" -H env GIT_SSH_COMMAND="ssh -o BatchMode=yes" git ls-remote "$(repo_ssh_url)" "refs/tags/$tag" | grep -q .; then
    ok "self-update remote reachable over SSH as $RWE_USER"
  else bad "git ls-remote over SSH as $RWE_USER (self-update would exit 20)"; fi
  if sudo -u "$RWE_USER" env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user is-active --quiet rwe-update.path; then
    ok "rwe-update.path active"; else bad "rwe-update.path not active"; fi
  for p in "$RWE_HOME/.npm/_logs" "$RWE_HOME/.claude/debug"; do
    if rwe_test -e "$p"; then bad "$p exists (bound writable into every agent sandbox — remove it)"; else ok "$p absent"; fi
  done
  if systemctl --user is-enabled --quiet rwe.service 2>/dev/null; then bad "operator's rwe.service is still enabled"; else ok "operator's rwe.service disabled"; fi
  [ "$fail" = 0 ] || die "phase7: some checks failed (see above); '$0 rollback' restores the operator's engine"
  say "phase7: ALL CHECKS PASSED"
}

rollback() {
  say "rollback: stop/disable $RWE_USER's units, re-enable the operator's (data in $(op_workroot) is used as it was at phase5)"
  note "anything the $RWE_USER engine wrote since phase5 stays in $RWE_WORKROOT and is NOT merged back"
  confirm "Roll back to the operator's engine now?"
  if user_exists || [ "$DRY_RUN" = 1 ]; then rwe_systemctl disable --now rwe.service rwe-update.path || true; fi
  run systemctl --user enable --now rwe.service rwe-update.path
  wait_http "http://127.0.0.1:$RWE_PORT_VALUE/api/version" 90 || die "operator engine did not come up — journalctl --user -u rwe.service -n 100"
  note "operator engine is back on :$RWE_PORT_VALUE"
}

case "$PHASE" in
  phase1|phase2|phase3|phase3b|phase4|phase5|phase6|phase7|rollback) [ "$DRY_RUN" = 0 ] || say "DRY RUN — nothing below is executed"; "$PHASE" ;;
  *) echo "unknown phase: $PHASE (see --help)" >&2; exit 2 ;;
esac
