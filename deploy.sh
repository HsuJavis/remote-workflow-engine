#!/usr/bin/env bash
# 一鍵部署 One-command deploy — install -> configure -> start -> healthcheck.
# 從一個乾淨的 git checkout 執行本腳本，即可把服務跑起來並自我驗證。
#
# 用法:
#   ./deploy.sh                 # 前景啟動 (Ctrl+C 停止；適合第一次跑/除錯)
#   ./deploy.sh --background    # 背景啟動 (寫 PID 到 .rwe.<instance>.pid，適合驗證腳本/CI)
#   ./deploy.sh --dry-run       # 只印出解析到的 PID/log 路徑就結束，不裝依賴也不啟動任何東西
#
# 冪等：已存在的設定檔 ($RWE_CONFIG_PATH，預設 repo 根目錄的 rwe.config.json) / litellm venv 不會被覆蓋或重建。
# 任何無法自動化的步驟，本腳本會停下並印出清楚的下一步指示，而不是猜測。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

RWE_PORT="${RWE_PORT:-8787}"
RWE_BIND="${RWE_BIND:-127.0.0.1}"

# 引擎讀哪一個設定檔由 RWE_CONFIG_PATH 決定（未設定時才是 repo 根目錄的 rwe.config.json）。
# 這一段必須在步驟 1 之前解析：否則跑第二個實例（RWE_CONFIG_PATH 指到別處）時，步驟 2 會去檢查、
# 建立、並回報 repo 根目錄那一份「引擎根本不會讀」的檔案（v26 Gate 7.5 round 6 defect D14），而
# --dry-run 也需要在花時間 npm install 之前就能印出這兩個路徑並結束。
# PID／log 檔名跟著設定檔走（config 的 basename），而不是固定的 .rwe.pid/.rwe.log：同一目錄下的
# 第二個實例（RWE_CONFIG_PATH 指到別處，通常就在同一目錄，因為預設值就是 $(pwd)/rwe.config.json）
# 才不會覆蓋掉第一個實例的控制檔（ADR-078）。
export RWE_CONFIG_PATH="${RWE_CONFIG_PATH:-$(pwd)/rwe.config.json}"
RWE_INSTANCE="$(basename "$RWE_CONFIG_PATH" .json)"
RWE_PID_FILE="$(dirname "$RWE_CONFIG_PATH")/.rwe.${RWE_INSTANCE}.pid"
RWE_LOG_FILE="$(dirname "$RWE_CONFIG_PATH")/.rwe.${RWE_INSTANCE}.log"
# umask 必須關在子 shell 裡：擺在最上層會被 nohup 起的引擎行程繼承，變成把每一個 SQLite db、
# workspace、CAS blob 都變成 0600 的全艦隊權限變更（一個 pid 檔需求夾帶進來的）。log 只 touch、
# 從不用 `>`／`: >` 截斷——這份 log 是唯一存在的稽核紀錄 (ADR-076)，重啟不能把正在查的事故洗掉。
(umask 077; touch "$RWE_LOG_FILE")
chmod 600 "$RWE_LOG_FILE"

if [ "${1:-}" = "--dry-run" ]; then
  echo "RWE_PID_FILE=$RWE_PID_FILE"
  echo "RWE_LOG_FILE=$RWE_LOG_FILE"
  exit 0
fi

# 非致命 preflight：只示警、不擋部署繼續進行。bwrap/socat 任一缺席，或 AppArmor 巢狀
# unprivileged user namespace 限制生效，都會讓開機時的 Bash 圍籠探測量成 unconfined
# （本機送出的 run 仍照跑，遠端送出的會被拒絕）——完整原因/修法見 DEPLOY.md §1c(e)。
if ! command -v bwrap >/dev/null 2>&1; then
  echo "⚠ 找不到 bwrap（bubblewrap）— Bash 圍籠會是 unconfined，詳見 DEPLOY.md §1c(e)（sudo apt install bubblewrap socat）。" >&2
fi
if ! command -v socat >/dev/null 2>&1; then
  echo "⚠ 找不到 socat — Bash 圍籠會是 unconfined，詳見 DEPLOY.md §1c(e)（sudo apt install bubblewrap socat）。" >&2
fi
APPARMOR_USERNS_RESTRICT=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
if [ -r "$APPARMOR_USERNS_RESTRICT" ] && [ "$(cat "$APPARMOR_USERNS_RESTRICT" 2>/dev/null)" = "1" ]; then
  echo "⚠ AppArmor 巢狀 unprivileged user namespace 限制生效中（$APPARMOR_USERNS_RESTRICT = 1）— 巢狀 bwrap 探測可能失敗，詳見 DEPLOY.md §1c(e)。" >&2
fi

echo "== 步驟 1/5：安裝 Node 依賴 (npm install) =="
npm install

echo "== 步驟 2/5：確認設定檔 ($RWE_CONFIG_PATH) =="
if [ ! -f "$RWE_CONFIG_PATH" ]; then
  cp rwe.config.example.json "$RWE_CONFIG_PATH"
  echo "已從 rwe.config.example.json 建立 $RWE_CONFIG_PATH — 請視需要編輯 workRoot。"
  if [ -z "${RWE_WORK_ROOT:-}" ]; then
    # 範例設定檔的 workRoot 預設為系統路徑 (/var/lib/remote-workflow-engine)，非 root 無法寫入。
    # 首次部署且呼叫端未指定 RWE_WORK_ROOT 時，改用使用者可寫的預設路徑，讓一鍵部署免 root 也能成功；
    # 這只在「剛建立全新設定檔」時發生一次，不會覆蓋既有部署的設定。
    export RWE_WORK_ROOT="${RWE_WORK_ROOT:-$HOME/.local/share/remote-workflow-engine}"
    echo "首次部署且未指定 RWE_WORK_ROOT：改用非 root 可寫的預設路徑 $RWE_WORK_ROOT（如需自訂，設定環境變數 RWE_WORK_ROOT 或編輯 $RWE_CONFIG_PATH 的 workRoot 後重跑）。"
  fi
  # 只把 export 出去的 RWE_WORK_ROOT 環境變數寫回剛建立的設定檔本身，否則它只對這一次
  # `deploy.sh` 啟動的行程有效：第二次 `./deploy.sh`（沒重新設 RWE_WORK_ROOT）、純粹的
  # `npm start`、systemd unit、以及自我更新的 `--check-config`，全都只看設定檔，會落回範例檔
  # 原本的系統路徑 (/var/lib/remote-workflow-engine)，資料看起來像憑空消失（A5）。用 node（已在
  # 步驟 1 裝好）原地改寫，不依賴 jq。
  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const workRoot = process.argv[2];
    const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
    cfg.workRoot = workRoot;
    fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
  ' "$RWE_CONFIG_PATH" "$RWE_WORK_ROOT"
  echo "已把 workRoot=$RWE_WORK_ROOT 寫回 $RWE_CONFIG_PATH（往後不帶 RWE_WORK_ROOT 重跑也會用同一個路徑）。"
else
  echo "$RWE_CONFIG_PATH 已存在，保留不覆蓋。"
fi

echo "== 步驟 3/5：確認 LiteLLM Python venv (gateway:\"sdk\" 需要) =="
LITELLM_VENV="${RWE_LITELLM_VENV:-$HOME/.rwe-litellm-venv}"
if [ -x "$LITELLM_VENV/bin/litellm" ]; then
  echo "litellm 已存在於 $LITELLM_VENV/bin/litellm，略過建立。"
else
  if ! command -v uv >/dev/null 2>&1; then
    echo "無法自動安裝：找不到 uv (Python 套件管理工具)。"
    echo "請先手動安裝並重跑本腳本："
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    exit 1
  fi
  uv python install 3.12
  uv venv --python 3.12 "$LITELLM_VENV"
  uv pip install --python "$LITELLM_VENV/bin/python" "litellm[proxy]"
fi
export PATH="$LITELLM_VENV/bin:$PATH"

echo "== 步驟 4/5：啟動服務 (RWE_BIND=$RWE_BIND RWE_PORT=$RWE_PORT) =="
export RWE_BIND RWE_PORT

start_cmd=(node node_modules/tsx/dist/cli.mjs src/main.ts)

nohup "${start_cmd[@]}" >> "$RWE_LOG_FILE" 2>&1 &
RWE_PID=$!
echo "$RWE_PID" > "$RWE_PID_FILE"
echo "啟動中，PID=$RWE_PID，log 在 $RWE_LOG_FILE"

echo "== 步驟 5/5：健康檢查 (等待 /api/status 回應) =="
deadline=$((SECONDS + 30))
# 健康檢查目的地依 $RWE_BIND 決定，不能無條件打 127.0.0.1 或無條件打 $RWE_BIND：
# - RWE_BIND=0.0.0.0（或 ::）是「監聽所有介面」的萬用位址，不是真實可連的目的地/Host 名稱——
#   伺服器的 Host-header 允許清單 (net-guard.ts D-BIND/REQ-056) 刻意不把它當合法 Host，用它當
#   目的地一定收到伺服器主動回的 403；這種情況一律改連 127.0.0.1（loopback，一律在允許清單內）。
# - RWE_BIND=<實際 LAN IP>（如 §2 systemd 範例的 192.168.0.125）時，服務只監聽該介面，
#   127.0.0.1 完全連不上（connection refused，不是 403）——這種情況必須用 $RWE_BIND 本身。
# - RWE_BIND=127.0.0.1（預設）兩種寫法等價。
if [ "$RWE_BIND" = "0.0.0.0" ] || [ "$RWE_BIND" = "::" ]; then
  HEALTHCHECK_HOST="127.0.0.1"
else
  HEALTHCHECK_HOST="$RWE_BIND"
fi
until curl -s -o /dev/null -w '%{http_code}' "http://${HEALTHCHECK_HOST}:${RWE_PORT}/api/status" 2>/dev/null | grep -q 200; do
  if [ $SECONDS -ge $deadline ]; then
    echo "健康檢查逾時 (30s) — 服務未在 http://${HEALTHCHECK_HOST}:${RWE_PORT}/api/status 回應 200。"
    echo "請查看 log（前景模式看終端輸出；背景模式看 $RWE_LOG_FILE）。"
    exit 1
  fi
  sleep 1
done

echo "健康檢查通過："
curl -s "http://${HEALTHCHECK_HOST}:${RWE_PORT}/api/status"
echo
echo "部署完成。服務位址：http://${RWE_BIND}:${RWE_PORT}/mcp"

if [ "${1:-}" = "--background" ]; then
  echo "背景模式：服務持續在背景執行（PID=$RWE_PID）。停止：kill \$(cat $RWE_PID_FILE)"
else
  echo "前景模式：Ctrl+C 停止服務（或另開終端機 kill \$(cat $RWE_PID_FILE)）。"
  wait "$RWE_PID"
fi
