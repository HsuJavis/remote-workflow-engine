#!/usr/bin/env bash
# 一鍵部署 One-command deploy — install -> configure -> start -> healthcheck.
# 從一個乾淨的 git checkout 執行本腳本，即可把服務跑起來並自我驗證。
#
# 用法:
#   ./deploy.sh                 # 前景啟動 (Ctrl+C 停止；適合第一次跑/除錯)
#   ./deploy.sh --background    # 背景啟動 (寫 PID 到 .rwe.pid，適合驗證腳本/CI)
#
# 冪等：已存在的 rwe.config.json / litellm venv 不會被覆蓋或重建。
# 任何無法自動化的步驟，本腳本會停下並印出清楚的下一步指示，而不是猜測。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

RWE_PORT="${RWE_PORT:-8787}"
RWE_BIND="${RWE_BIND:-127.0.0.1}"

echo "== 步驟 1/5：安裝 Node 依賴 (npm install) =="
npm install

echo "== 步驟 2/5：確認設定檔 (rwe.config.json) =="
if [ ! -f rwe.config.json ]; then
  cp rwe.config.example.json rwe.config.json
  echo "已從 rwe.config.example.json 建立 rwe.config.json — 請視需要編輯 workRoot / aliases。"
  if [ -z "${RWE_WORK_ROOT:-}" ]; then
    # 範例設定檔的 workRoot 預設為系統路徑 (/var/lib/remote-workflow-engine)，非 root 無法寫入。
    # 首次部署且呼叫端未指定 RWE_WORK_ROOT 時，改用使用者可寫的預設路徑，讓一鍵部署免 root 也能成功；
    # 這只在「剛建立全新設定檔」時發生一次，不會覆蓋既有部署的設定。
    export RWE_WORK_ROOT="${RWE_WORK_ROOT:-$HOME/.local/share/remote-workflow-engine}"
    echo "首次部署且未指定 RWE_WORK_ROOT：改用非 root 可寫的預設路徑 $RWE_WORK_ROOT（如需自訂，設定環境變數 RWE_WORK_ROOT 或編輯 rwe.config.json 的 workRoot 後重跑）。"
  fi
else
  echo "rwe.config.json 已存在，保留不覆蓋。"
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
export RWE_CONFIG_PATH="${RWE_CONFIG_PATH:-$(pwd)/rwe.config.json}"

start_cmd=(node node_modules/tsx/dist/cli.mjs src/main.ts)

nohup "${start_cmd[@]}" > .rwe.log 2>&1 &
RWE_PID=$!
echo "$RWE_PID" > .rwe.pid
echo "啟動中，PID=$RWE_PID，log 在 .rwe.log"

echo "== 步驟 5/5：健康檢查 (等待 /api/status 回應) =="
deadline=$((SECONDS + 30))
until curl -s -o /dev/null -w '%{http_code}' "http://${RWE_BIND}:${RWE_PORT}/api/status" 2>/dev/null | grep -q 200; do
  if [ $SECONDS -ge $deadline ]; then
    echo "健康檢查逾時 (30s) — 服務未在 http://${RWE_BIND}:${RWE_PORT}/api/status 回應 200。"
    echo "請查看 log（前景模式看終端輸出；背景模式看 .rwe.log）。"
    exit 1
  fi
  sleep 1
done

echo "健康檢查通過："
curl -s "http://${RWE_BIND}:${RWE_PORT}/api/status"
echo
echo "部署完成。服務位址：http://${RWE_BIND}:${RWE_PORT}/mcp"

if [ "${1:-}" = "--background" ]; then
  echo "背景模式：服務持續在背景執行（PID=$RWE_PID）。停止：kill \$(cat .rwe.pid)"
else
  echo "前景模式：Ctrl+C 停止服務（或另開終端機 kill \$(cat .rwe.pid)）。"
  wait "$RWE_PID"
fi
