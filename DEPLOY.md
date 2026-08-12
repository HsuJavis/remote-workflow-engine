# 部署 / 維運手冊 — remote-workflow-engine

> 人類導向文件（繁體中文）。由 Gate 7.5 validator 依實際部署步驟撰寫，步驟可重跑。
> 凡 validator 為了把系統跑起來而做、但 README quickstart 未涵蓋的動作，都記在這裡。
>
> 目前部署狀態（v11 FIX-MODE，2026-08-10）：systemd user service `rwe.service`，綁定
> `0.0.0.0:8787`（ufw 白名單 `192.168.0.0/24` + SSH），`workRoot=/home/user/.local/share/rwe-data`，
> `gateway:"sdk"` + managed LiteLLM proxy。36 個 MCP 工具，含首頁工作流程卡片（`GET /api/home`，
> RUNNING/REGISTERED/OTHER 三組 + 平均成功率/平均執行時間）、Issues 儀表板（`/dashboard/issues`）、
> `issue_report` 版本自動填入、標籤觸發式自動更新（`POST /github/webhook`）。
> 自動更新設定見 §6b；Gate 7.5 v11 FIX-MODE 驗證**已通過**（VAL-083/084 綠：真實 `/api/home` + 接受測試 5/5）。完整驗證證據見
> `.sdlc/features/001-remote-workflow-engine/08-validation.md`。


## §0 Quickstart — 開機序列（可逐字貼上執行）

> 以下指令與 README quickstart 一致，是 v11 validator 實際跑過的步驟，本輪零文件缺口。

```bash
# 步驟 1：安裝 Node 依賴
npm install
# 預期：node_modules/ 建立，無錯誤

# 步驟 2：型別檢查（健檢）
npm run typecheck
# 預期：無輸出（clean）

# 步驟 3：建立 LiteLLM Python venv（一次性，gateway:"sdk" 需要）
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv python install 3.12
uv venv --python 3.12 ~/.rwe-litellm-venv
uv pip install --python ~/.rwe-litellm-venv/bin/python "litellm[proxy]"
# 預期：Successfully installed litellm...

# 步驟 4：複製設定檔並設定 workRoot（必須在任何 .git/CLAUDE.md 祖先之外）
cp rwe.config.example.json rwe.config.json
# 設定 workRoot 為 repo 外的絕對路徑，例：/home/<user>/.local/share/rwe-data
# 設定 aliases 指向你的供應商/模型

# 步驟 5：設定環境變數（見 §1 設定總表）
export PATH="$HOME/.rwe-litellm-venv/bin:$PATH"   # litellm 必須在 PATH 上
export ANTHROPIC_API_KEY=sk-ant-...               # 或其他供應商 key
# export RWE_SECRET_GITHUB_TOKEN=ghp_...          # issue_report/Issues 儀表板需要

# 步驟 6：啟動（開發/測試）
node node_modules/tsx/dist/cli.mjs src/main.ts
# 預期：[remote-workflow-engine] listening on http://127.0.0.1:8787/mcp (workRoot=...)
#        [remote-workflow-engine] ready

# ── 已安裝 systemd user service 時，重啟套用更新：
# systemctl --user restart rwe.service
# systemctl --user status rwe.service   → Active: active (running)
```

```bash
# 健康確認（服務啟動後）
curl -s http://localhost:8787/api/status
# 預期：{"agentSemaphore":{"total":32,"inUse":0,"queued":0},"version":"1.x.x"}

curl -s -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print('tools:', len(d['result']['tools']))"
# 預期：tools: 36
```

## 情境配方：gateway:sdk + LiteLLM 前置「外部 OpenAI 相容端點」跑完整 sdlc-run
>
> 目標：把引擎部署在一台**自架多個開源大模型、對外只暴露一個 OpenAI 相容 `/v1` 端點**的環境上，
> 讓遠端 agent 走**完整 Claude harness**（工具迴圈 + agentType + MCP），能跑真正的 iso-agile-sdlc
> `sdlc-run`。以下每一步都經本機端對端實測（用 Ollama 的 `/v1` 代打「外部端點」驗證整條鏈路）。
>
> ### 0) 那個端點是什麼牌子其實不重要
> 我們**自己再跑一個 LiteLLM** 擋在前面，把它端點當成「一個 OpenAI 相容 server」。你只需確認
> `POST $BASE/v1/chat/completions`（OpenAI 格式）能正常回應即可（要辨牌子見本文件底部「附錄：辨識端點」）。
> `provider` 別名只支援 `anthropic|openai|gemini|ollama` 四種前綴；**任何 OpenAI 相容端點一律用
> `provider:"openai"` + `OPENAI_API_BASE` 指過去**（vLLM/TGI/llama.cpp server/LiteLLM… 皆同一招）。
>
> ### 1) 設定檔（`rwe.config.json`）
> ```json
> {
>   "bind": "127.0.0.1", "port": 8787,
>   "workRoot": "/var/lib/remote-workflow-engine",   ⟵ 必須在任何 .git/CLAUDE.md 祖先之外（見 v3 塊第4點）
>   "timeoutMs": 300000, "gateway": "sdk",
>   "agentDefinitionsDir": "/opt/rwe-sdlc-agents",   ⟵ 見第3步：放 iso-agile-sdlc 的 sdlc-*.md
>   "defaultAllowedTools": ["Read","Write","Edit","Glob","Grep","Bash"],
>   "aliases": {
>     "default":           { "provider": "openai", "model": "<你端點上的某個模型id>" },
>     "claude-opus-4-8":   { "provider": "openai", "model": "<最強的那顆，給架構/設計決策 gate>" },
>     "claude-sonnet-4-6": { "provider": "openai", "model": "<中階，給實作/驗證/審查>" },
>     "haiku":             { "provider": "openai", "model": "<便宜快的，給 precheck/referee>" }
>   }
> }
> ```
> 別名右邊的 `model` 就是**打到 `$BASE/v1/models` 看到的那些 id**。`sdlc-run` 內部用
> `claude-opus-4-8`/`claude-sonnet-4-6`/`haiku` 這三個別名選 tier（角色→tier 對照見 iso-agile-sdlc 的 SKILL.md §2.5 表），
> 所以**這三個別名一定要在 aliases 表裡**、指向你端點上實際存在的模型。
> **模型能力提醒**：架構/設計是「決策 + 產生可追溯文件 + 工具呼叫」的 gate，**別用太小的模型**
> （7B 級的原生 tool-use 不穩、且當 synthesizer 會亂丟 `request-panel` 無限升級）；決策 gate 請挑
> 你環境裡最能穩定做 native tool-use 的那顆（實測 gpt-4.1 級可、qwen2.5:7b 不行）。
>
> ### 2) 憑證環境變數（指向外部端點的關鍵）
> ```bash
> export OPENAI_API_BASE="http://<那台或端點host>:<port>/v1"   # ← 讓所有 openai/ 別名導向你的端點
> export OPENAI_API_KEY="<端點需要的 key；不需認證就給任意非空字串，如 sk-dummy>"
> ```
> LiteLLM 子行程以 `{...process.env}` 繼承這兩個變數，`openai/<model>` 就會打到 `OPENAI_API_BASE`
> 而非 api.openai.com——**這是純設定、不需改任何程式**（本機用 Ollama `/v1` 端對端實測通過）。
> ⚠️ **key 檔格式坑**：若你的 key 存成 `OPENAI_API_KEY=sk-...` 這種**整行**檔，別直接 `$(cat 檔)`
> （會把 `OPENAI_API_KEY=` 也當成 key 值 → LiteLLM 401）。要萃取值：
> `export OPENAI_API_KEY="$(grep -oE 'sk-[A-Za-z0-9_-]+' 你的keyfile | head -1)"`。
> ⚠️ **PATH**：`gateway:sdk` 開機會 `spawn('litellm')`，systemd/啟動 unit 的 `PATH` 必須含 litellm
> venv 的 `bin/`（見 v3 塊第1點），否則 `ENOENT`。
>
> ### 3) 放 sdlc 角色 agent 定義（跑 sdlc-run 必要）
> `sdlc-run` 每個 gate 用 `agentType` 分派到 `sdlc-architect`/`sdlc-designer`/`sdlc-verifier`/
> `sdlc-implementer`/`sdlc-validator`/`sdlc-reviewer`/`sdlc-task-planner`。把 iso-agile-sdlc plugin 的
> `agents/sdlc-*.md` 複製進 `agentDefinitionsDir`：
> ```bash
> mkdir -p /opt/rwe-sdlc-agents
> cp <plugin>/skills/iso-agile-sdlc/agents/sdlc-*.md /opt/rwe-sdlc-agents/
> ```
> loader 用檔案 frontmatter 的 `name:`（**裸名**，如 `sdlc-architect`）當註冊鍵。各 agent frontmatter 的
> `model:` 值（`claude-opus-4-8` 等）必須對應到你 aliases 表裡的別名（第1步已備妥）。
>
> ### 4) 實際跑 sdlc-run（透過 rwe-plugin 或直接 `workflow_run`）
> 關鍵參數 **`args.agentPrefix: ""`（必填）**：`AT()` 預設會加 `iso-agile-sdlc:` 前綴，但引擎註冊的是
> 裸名 → 不加空前綴會 `Unknown agentType: iso-agile-sdlc:sdlc-architect` 讓整個 run 失敗。範例 args：
> ```json
> { "feature":"NNN-slug", "sdlcDir":".sdlc/features/NNN-slug", "skillDir":"_skillref",
>   "mode":"new", "safetyClass":"QM", "agentPrefix":"", "tier":"lean" }
> ```
> - **seed**：把 skill 目錄（放 `_skillref/`，**不要**放 `.claude/skills/` 以免被 CLI 當 project skill 載入）
>   + `.sdlc/features/NNN/{01-requirements.md,state.yaml}` + `.sdlc/trace(.py)` 一起用 `workflow_run` 的
>   `seed:[{path,contentB64}]` 帶上（Gate 1 需求要先在本地備好，state.yaml 的 `gates.requirements.passed=true`）。
> - **git baseline 自動**：引擎會在 seed 落地後自動 `git init`+baseline commit（REQ-027），precheck 的
>   `git rev-parse --is-inside-work-tree` 會通過——**你不用手動 seed `.git`**（materializeSeed 本來就會擋）。
> - **model shorthand 自動處理**：`haiku`/`sonnet`/`opus` 被 CLI 展開成 Anthropic id 的老問題已由
>   `proxyModelName` 前綴根治，你不需做任何事。
> - **budget**：sdlc 全流程**吃 input token 很兇**（每個 agent 重讀 seed/docs，實作階段還會裝 venv 撐大
>   context）。設 `budget`（token 數）當硬上限；實測一次 lean 全流程到 Gate 6 約 ~3M token。撞上限會在
>   當前 gate 停（非 bug），可用 `resumeFromRunId` 續跑或調高 budget。
> - **拉回產物**：完成後用 plugin 的 `pull_workspace`（`workflow_artifacts` + `workflow_artifact_get`）把
>   `src/`、`tests/`、`.sdlc/*.md` 拉回本地；`.git/` 與 venv 不會列進 artifact（引擎已排除 `.git/`）。
>
> ### 5) 驗證這條路通了（花錢前先確認）
> ```bash
> # A. 我方 LiteLLM 真的把 openai/<model> 導到你的端點：
> LPORT=$(pgrep -af '[l]itellm --config' | grep -oE 'port [0-9]+' | awk '{print $2}')
> curl -s -X POST http://127.0.0.1:$LPORT/v1/messages -H 'content-type: application/json' \
>   -H 'x-api-key: dummy' -H 'anthropic-version: 2023-06-01' \
>   -d '{"model":"rwe-proxy-default","max_tokens":10,"messages":[{"role":"user","content":"ping"}]}'
> #   → 回 anthropic 格式 message + usage>0 ⇒ 端點通；回 401/No deployments ⇒ 檢查 OPENAI_API_BASE/KEY。
> # B. 一個極小 agent 端對端（透過引擎 /mcp 的 workflow_run，script: 'return agent("say ROUTED",{model:"default"})'）
> #    回 "ROUTED" 且 agent tokens>0 ⇒ 整條 gateway:sdk→LiteLLM→你的端點 打通。
> ```
>
## 區網部署 + remote→local 落地
>
> ### A. 綁到區網（LAN）給其他機器用
> 引擎預設綁 `127.0.0.1`（只本機）。要讓區網其他機器連進來:
> 1. 把 bind 改成**這台的 LAN IP**（不要用 `0.0.0.0` 全開）。優先改 systemd unit 的
>    `Environment=RWE_BIND=<你的 LAN IP>`（unit env 覆蓋 config），例:
>    `Environment=RWE_BIND=192.168.0.125`，然後 `systemctl --user daemon-reload && systemctl --user restart rwe.service`。
>    確認: `ss -ltnp | grep :8787` 應顯示 `192.168.0.125:8787`（不是 `127.0.0.1`）。
> 2. **防火牆白名單（必做）**——引擎 **v3 前無任何 auth**,綁上區網 = 任何能連到 `/mcp` 的裝置都能
>    送 workflow，讓 Bash agent 在**這台主機上執行任意程式碼**、`asset_push` 任意寫檔。用 OS 防火牆
>    把 8787 限制到你信任的來源:
>    ```bash
>    sudo ufw allow from 192.168.0.0/24 to any port 8787 proto tcp comment 'rwe LAN'  # 或改成單一具體 IP
>    sudo ufw deny to any port 8787 proto tcp
>    sudo ufw reload && sudo ufw status numbered
>    ```
>    **綁 LAN 但還沒上防火牆的期間 = 對整個區網全開,請先上規則再對外用。**
> 3. **DHCP 注意**: LAN IP 若是 DHCP 動態配發,重開機可能改變 → bind 會失效。請在路由器做 **DHCP
>    保留 / 靜態 IP**,或改綁一個固定的 LAN IP。
> 4. 仍建議: 跨機器的更安全選項是**維持 `127.0.0.1` + SSH 通道**
>    （`ssh -L 8787:127.0.0.1:8787 user@<host>`）——零網路曝露,適合單人/跨網段。多租戶要等 v3 auth。
>
> ### B. 讓遠端 run 的程式碼變更「落地」到你本地(rwe-apply v1)
> 引擎的 agent 被 **jail 在 server 端 per-run workspace**,碰不到 client 機器（設計如此）。要把
> 「遠端推理」的程式碼變更帶回本地工作副本,用 **patch-in-result** 模式（設計由專家 panel 產出,
> 見 client plugin `remote-workflow-plugin` 的 `skills/rwe-apply/`）:
> 1. **workflow 回傳 git patch envelope**——用參考模式 `rwe-patch-return`（`skills/rwe-apply/references/`）:
>    seed client 傳來的 bounded base（`args.files`=[{path,contentB64}]、`args.baseSha`）→ agent 編輯 →
>    最後 `git diff --binary` → 腳本 `return { format:'git', baseSha, diff, touchedPaths, stats }`
>    （`workflow_result` 原樣帶回,引擎零改動）。
> 2. **client 端套用**——`/rwe-apply <runId>` skill:取 `workflow_result` → `apply_patch.py` 驗
>    envelope + **路徑守衛**（拒絕 `../`/絕對/`.git` 內部）+ 驗 baseSha + `git apply --check --3way`
>    dry-run → 經你**自己 session 的權限確認**套到新 `rwe/run-<id>` 分支（原分支不動）。變更只以
>    **可審查的 diff** 越過邊界,server 永遠拿不到你機器的寫入權。
> - **模型注意**: patch 模式的 git-plumbing agent(seed/finalize)**需要「真的會執行 Bash」的模型**。
>   qwen2.5:7b 會把工具呼叫吐成文字(D-F11 能力層)沒真跑 → 這幾步請指定 Claude 或夠大的本地模型;
>   引擎執行與 client 套用機制本身與模型無關,皆已驗證。
> - **v1.5/v2 工具(支援大 patch / 整樹開發)**: `workflow_artifacts`(遞迸列檔 + sha256)、
>   `workflow_artifact_get(runId,path,offset?,length?)`(分塊、限大小、realpath 封閉的 byte 取回,給太大塞不進
>   inline result 的 patch/bundle)、`workspace_purge(runId)`(刪除 terminal run 的 workspace)。`workflow_run` 新增
>   選填 `seed:[{path,contentB64}]`—引擎在 agents 啟動前把整棵 tree materialize 進 workspace(**strip 掉
>   `.claude/settings*.json`+hooks**,關 RCE),讓 agents 直接編輯真實專案(而非只給 prompt 的 bounded base)。
>   請求 body 上限 8 MiB(超過回 413,防 OOM)。選填 `workspaceTtlMs` 開啟周期 GC 回收舊 workspace。


## 1. 前置條件
- **Node.js 22.6 以上**（沙箱子行程 `src/sandbox/child-entry.ts` 與啟動用的 `tsx` 都依賴 Node 22
  原生 `--experimental-transform-types` type-stripping；本次驗證環境為 Node v22.22.3）。
- npm（隨 Node 附帶）。
- **Python 3.11 或 3.12（第二輪驗證發現）**：`agent()` 的兩條 gateway 路徑（預設的
  `"sdk"` 與可選的 `"direct-fetch"` 搭配 `useLiteLLMProxy:true`）都會啟動一個真實的
  `litellm --config ... --port ...` Python 子行程（`src/gateway/litellm-proxy.ts`
  `LiteLLMProxyManager`，直接從 `PATH` 找 `litellm` 執行檔）。本次驗證環境的系統 Python 是
  3.14，`pip install 'litellm[proxy]'` 會因為 `uvloop`/`orjson`/`websockets` 這幾個相依套件
  在 3.14 上沒有預編譯 wheel（需要從原始碼編譯，缺 `build-essential`/`python3-dev` 會直接失敗）
  而裝不起來。**驗證時採用的解法**（不需要 root/系統套件管理員權限）：
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh      # 安裝 uv 到 ~/.local/bin
  export PATH="$HOME/.local/bin:$PATH"
  uv python install 3.12                                # 下載一份獨立的 CPython 3.12（不動系統 Python）
  uv venv --python 3.12 <你的-litellm-venv-路徑>
  uv pip install --python <你的-litellm-venv-路徑>/bin/python "litellm[proxy]"
  ```
  接著**啟動伺服器前**，把這個 venv 的 `bin/` 目錄加進 `PATH`（`LiteLLMProxyManager` 是直接
  `spawn('litellm', [...])`，靠 `PATH` 解析，不是寫死路徑）：
  ```bash
  export PATH="<你的-litellm-venv-路徑>/bin:$PATH"
  ```
  若你的系統本來就有 Python 3.11/3.12（`python3.12 --version` 有輸出），可以省略 `uv`，直接
  `python3.12 -m venv <venv路徑> && <venv路徑>/bin/pip install 'litellm[proxy]'`。
  **不需要 `agent()`**（純跑工作流程腳本邏輯）的部署可以完全跳過這一步。
  **v1 提醒（第五輪起）已於 v2 TASK-027 修復，本輪（Gate 7.5 v2 ROUND 2）重新以真實 process
  確認**：正常關機（`SIGTERM`）現在真的會連帶停掉這個子行程，不再留孤兒；且可以在
  `rwe.config.json` 用 `litellmPort` 鍵讓每個實例指定不同 port（不再固定 4000），見 §1b/§6 第 7/8
  項。啟動前確認沒有孤兒 `litellm` process（下方 §2 步驟 5）仍建議保留作為額外保險，但已不是唯一
  防線。
- 外部依賴：不需要資料庫伺服器（狀態存在本機檔案：SQLite + JSONL journal，路徑見 `workRoot`）。
- LLM 供應商（依你要用的模型別名擇一或多個）：

  | 變數 | 用途 | 範例/來源 |
  |------|------|-----------|
  | `ANTHROPIC_API_KEY` | `provider:"anthropic"` 別名（預設 `sonnet`/`haiku`/`opus`/`default` 皆指向此） | Anthropic Console 的 API key，或內部 sandbox key |
  | `OPENAI_API_KEY` | `provider:"openai"` 別名 | OpenAI Platform 的 API key |
  | `GEMINI_API_KEY` | `provider:"gemini"` 別名 | Google AI Studio 的 API key |
  | `OLLAMA_BASE_URL` | `provider:"ollama"` 別名（本機/內網模型，免金鑰） | 預設 `http://localhost:11434`；本次驗證即用此跑 `qwen2.5:7b` 全程真實測試，`OLLAMA_BASE_URL` 未設也能用；**但見下方已知限制第 1 條：目前無法真的用工具讀寫檔案（模型能力上限，非程式碼缺陷）** |
  | `OPENROUTER_API_KEY` | `provider:"openrouter"` 別名 + passthrough `agent({model:"openrouter/<id>"})`（v7） | OpenRouter 的 API key（`sk-or-...`）；LiteLLM 以原生 `openrouter/<model>` 路由自動讀取。一把 key 開放整個 OpenRouter 目錄（`models_list` 可查、含 tool-use 標籤） |
  | `CLAUDE_CODE_OAUTH_TOKEN` | `provider:"anthropic"` **直連**的**訂閱制**認證(v7,`anthropicAuth:"subscription"`) | 用 `claude setup-token`(Pro/Max 帳號)產生;走訂閱額度、無 API 帳單;設定時**不要**同時設 `ANTHROPIC_API_KEY`。API-key 模式則沿用上面 `ANTHROPIC_API_KEY`(v7 起 anthropic 別名走**直連**、bypass LiteLLM,保原生 tool schema) |

  **未設定的供應商不會擋住啟動** —— 對應別名的 `agent()` 呼叫只會在真正被呼叫時，走 D-G 電路斷路器
  邏輯解析成 `null`（run 繼續跑，不會掛住），已於 Gate 7.5 對真實不可達端點與缺金鑰兩種情境都實測確認
  （`gateway:"sdk"`/`"direct-fetch"` 兩條路徑皆適用）。

## 1b. 設定檔（config files）
> Gate 7.5 檢查：本次迭代是否需要更新設定檔？**第六輪發現並修正了一個文件漂移（config-doc drift）**：
> `rwe.config.example.json` 早在前一輪就已經加上 `defaultAllowedTools` 這個鍵（D-F11 的實作成果），
> 但本文件（`DEPLOY.md`）§1b 的設定檔內容表格/JSON 範例卻從未提到它——這正是「程式碼期待某個設定鍵，
> 但文件沒提到」的真實缺口。**本輪已修正**：下方 JSON 範例與說明都補上了 `defaultAllowedTools`。
> 除此之外，其餘文件化鍵（`bind`/`port`/`workRoot`/`timeoutMs`/`retries`/`gateway`/
> `agentDefinitionsDir`/`aliases`）本輪重新驗證全部正確且真的生效（含 `defaultAllowedTools` 本身，
> 已用真實 `ps aux` 確認送給模型的工具清單真的被縮減，見 §6 第 1 項）。本輪新發現/確認的其他項目
> （in-flight 狀態觀察、resume 重新執行、port 4000 碰撞風險）皆為程式碼/操作層級的缺口，不是設定
> 缺口。
>
> **Gate 7.5 v2 D-V2G8-1/2 安全性重新驗證這一輪（本輪）新發現並修正的第二個 config drift（更嚴重）**：
> 前一輪（Gate 8 v2 route-back, IMPL-064）已經把程式碼內建的 fallback 從 `["Read","Write","Bash"]`
> 改成不含 `Bash` 的 `["Read","Write"]`（D-V2G8-1(b)，見 §1c 安全模型），**但當時沒有同步檢查已進
> 版控的 `rwe.config.example.json`**——它自己仍然明文寫著
> `"defaultAllowedTools": ["Read", "Write", "Bash"]`，而 README.md/本文件 §2 步驟 3 的 quickstart
> 都指示使用者直接 `cp rwe.config.example.json rwe.config.json`。結果是：**任何依照文件步驟部署的
> 人，實際拿到的預設工具面仍然含 `Bash`**——設定檔本身把 D-V2G8-1(b) 這個「Bash 預設關閉、需明確
> opt-in」的修復整個蓋掉了，等於這個 HIGH 安全修復從未在真實部署路徑上生效過。**本輪已修正**：
> `rwe.config.example.json` 與下方 JSON 範例都已改成 `["Read", "Write"]`（不含 `Bash`），與程式碼
> 內建 fallback、§1c 安全模型描述的行為重新一致。這是 Gate 7.5 §4b「config drift = deploy failure
> waiting to happen」條款存在的確切理由——本輪視為一個真實發現+已修正的缺口記錄於此，並在
> `08-validation.md` 留下對應證據，不是靜默補丁。
> **（v3 更新，2026-07-11）**：上述 v2 敘述已被 D-V3M-3 取代——預設集現在**刻意含 `Bash`**（confined
> 在工作目錄下），範例與內建 fallback 皆為 `["Read","Write","Edit","Glob","Grep","Bash"]`。詳見頂部
> ⭐v3 塊與 §1c(b)。

| 設定檔 | 用途 | 本次是否異動 | 需補的鍵/值 |
|--------|------|--------------|-------------|
| `rwe.config.json`（不進版控；由 `.example` 複製而來，本身**不含機密**） | 伺服器啟動設定：`bind`、`port`、`workRoot`、`timeoutMs`、`retries`、`gateway`（`"sdk"｜"direct-fetch"`，見下）、`agentDefinitionsDir`（`agents/*.md` 定義目錄，見下）、`defaultAllowedTools`（見下）、`aliases`（模型別名 → provider/model 對照表）、**v2 新增選填鍵**：`schedulerDbPath`（排程 SQLite 檔路徑，省略預設 `$workRoot/schedules.db`）、`assetRoot`（`asset_push` 資產儲存根目錄，省略預設 `$workRoot/assets`）、`litellmPort`（見下方 Gate 7.5 v2 ROUND 2 補充——**現在可以設定**，用來避開多實例的 4000 port 碰撞） | 是（本輪 Gate 7.5 v2 ROUND 2 補充說明，見下） | 見下方「設定檔內容」；金鑰一律用環境變數，絕不寫進此檔 |
| `rwe.config.example.json`（**已進版控**） | 上述設定檔的範本，含一組可運作的預設別名表 + 建議的 `gateway` 值 | 否（本輪確認內容仍正確，`defaultAllowedTools` 已存在） | — |
| `agents/`（**已進版控**，範例目錄） | D-F2 agentType composition-root loader 的範例輸入：`researcher.md`/`writer.md`（`name`/`model`/`tools` frontmatter + 內文即 systemPrompt） | 否（本輪確認仍正確可用，見 08-validation.md VAL-003 的 agentType 解析 repro） | 依需求增刪 `*.md` 檔案；`model:` 的值須對應 `aliases` 表裡的一個別名名稱 |
| `package.json` | npm scripts | 否 | — |

**設定檔內容**（`rwe.config.json` / `rwe.config.example.json`，皆為單一 JSON 物件，選填欄位省略即用內建預設）：
```json
{
  "bind": "127.0.0.1",
  "port": 8787,
  "workRoot": "./data",
  "timeoutMs": 15000,
  "retries": 1,
  "gateway": "sdk",
  "agentDefinitionsDir": "./agents",
  "defaultAllowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  "maxWorkflowDepth": 4,
  "maxWorkflowDescendants": 256,
  "aliases": {
    "sonnet":  { "provider": "anthropic", "model": "claude-3-5-sonnet-20241022" },
    "haiku":   { "provider": "anthropic", "model": "claude-3-5-haiku-20241022" },
    "opus":    { "provider": "anthropic", "model": "claude-opus-4-5" },
    "default": { "provider": "anthropic", "model": "claude-3-5-sonnet-20241022" },
    "local":   { "provider": "ollama", "model": "qwen2.5:7b" }
  }
}
```
**（Gate 8 追加，D-G8-4）`timeoutMs` 零設定保底值**：即使 `rwe.config.json` 完全不存在（純
`npm run start` 零設定啟動），`gateway:"sdk"` 路徑現在也會套用與上表相同的 `15000`（毫秒）保底值
——先前這個零設定情境下 `timeoutMs` 會是 `undefined`，`ClaudeAgentSdkGatewayClient.invoke()` 完全
沒有逾時保護，一個沒有回應的本機供應商會讓整個 run（含佔用的並行槽位）無限期卡住。此保底值只在
`rwe.config.json`/環境變數都沒有明確指定 `timeoutMs` 時套用；設定檔中明確指定的值一律優先。

`provider` 只能是 `"anthropic" | "openai" | "gemini" | "ollama"` 之一。`gateway` 只能是
`"sdk"`（省略此鍵時的內建預設值、**目前建議的部署設定**——真正的 `@anthropic-ai/claude-agent-sdk`
headless session；**但見已知限制第 1 條：對本機 7B 級 Ollama 模型而言，其工具迴圈目前並不會真的
執行，屬於模型能力上限**）或 `"direct-fetch"`（文件化的退回選項，回退到直接對各供應商 `fetch()`，
或搭配 `useLiteLLMProxy:true` 走 LiteLLM 代理——這條路徑本來就不具備工具迴圈能力，不受已知限制第 1
條影響，因為它本來就不宣稱有這個能力；適合純本機/內網部署且不需要 SDK 工具迴圈的場景）。
`defaultAllowedTools`（**第六輪補上文件說明，v2 Gate 8 review 後修正**）：`gateway:"sdk"` 路徑下，
當一次 `agent()` 呼叫沒有自帶 `opts.allowedTools`（且對應的 `agentType` 定義也沒有 `tools:`
frontmatter）時，套用的預設工具清單——縮小送給模型的工具面，避免小型本機模型被完整 Claude Code CLI
工具面（含此主機環境自己的外掛/MCP 工具）淹沒而放棄嘗試工具呼叫；省略此鍵時內建預設值是
**`["Read","Write","Edit","Glob","Grep","Bash"]`**（v3 D-V3M-3；`Bash` 已在預設但被工作目錄邊界
封閉，`WebFetch`/`WebSearch`/`Task`/`Agent` 仍需 opt-in——見下方「安全模型」(b)/(d)）。
優先序：呼叫端 `opts.allowedTools` > `agentType` 定義的 `tools:` > 這個設定鍵 > 內建預設，永遠不會
不設限。不提供 `aliases` 時，伺服器內建預設值等同上面拿掉 `local` 那份（全指向 anthropic）。
`agentDefinitionsDir` 省略時 agentType 註冊表為空（每個 `agentType` 都會回報 unknown，不影響不用
`agentType` 的腳本）。
`maxWorkflowDepth`（型別 `number`，選填，**v8 新增**）/ `maxWorkflowDescendants`（型別 `number`，
選填，**v8 新增**）：控制具名 `workflow()` 巢狀組合（N 層 composition）的兩個獨立上限。`maxWorkflowDepth`
限制單一分支的巢狀深度（頂層 run=0，第一個 `workflow()` 呼叫=1），超過時該次呼叫回傳可分支的
`NESTING_DEPTH_EXCEEDED` 錯誤（不會讓父 run 卡住或崩潰），省略時預設 **4**；`maxWorkflowDescendants`
限制整棵樹（fan-out × depth）的巢狀 `workflow()` 呼叫總數，超過回 `DESCENDANT_CAP_EXCEEDED`，省略時
預設 **256**。兩者皆在啟動載入設定時驗證：值 ≤0 或非整數會被拒絕並回報明確錯誤。（另有一個祖先環
偵測 `NESTING_CYCLE` 一律啟用、不需設定：`workflow()` 目標若是自己巢狀鏈上的祖先即拒絕，但兩條
兄弟分支各自呼叫同一個「非祖先」工作流（diamond）是允許的。）

`maxConcurrentRuns`（型別 `number`，選填，**v8 Slice 4 新增**）：頂層 run 的並行上限（run-admission
counter），省略時預設 **64**，啟動載入時驗證（值 ≤0 或非整數會被拒絕）。當現有「非終態」（`queued`／
`running`／`suspended`）頂層 run 數已達上限，`start()` 會在**做任何昂貴/持久化動作之前**（不建 run 列、
不建工作區、不 seed、不 fork sandbox）就以 `RUN_ADMISSION_LIMIT` 拒絕——這是全域 agent semaphore 沒有
提供的 DoS 阻塞點（semaphore 只限 `agent()` 派工，不限 run 數/sandbox fork/工作區生成）。巢狀
`workflow()` **不佔用**槽位（不是頂層 `start()`）；run 進入終態即釋放槽位。
`continuationDbPath`（型別 `string`，選填，**v8 Slice 4 新增**）：on-completion chaining 續接的 SQLite
檔路徑（引擎自有 side table，與 v1 core 的 RunSpec/RunStore 無關，作法同 `schedulerDbPath`），省略時
預設 `$workRoot/continuations.db`；一般部署可省略不填。

`webhookDbPath`（型別 `string`，選填，**v8 Defer B 新增**）：webhook 註冊表（`webhooks` +
`webhook_deliveries` 兩張表）的 SQLite 檔路徑（引擎自有 side table，作法同 `schedulerDbPath`／
`continuationDbPath`），省略時預設 `$workRoot/webhooks.db`；一般部署可省略不填。此檔存放每個 webhook 的
`{id, workflow, secret, enabled}`——**secret 是明文儲存**（HMAC 驗簽必須用到金鑰，同 GitHub/Stripe 的
webhook 模型，單向雜湊無法驗 HMAC），因此此檔的存取權限即等同 webhook 金鑰的機密邊界，請比照
`schedules.db` 保護；`webhook_list` 只會回傳 secret 的 sha256 前綴指紋，永不回傳 secret 本身。

`casDir`（型別 `string`，選填，**v10 新增**）：內容定址 blob 儲存庫（CAS，供高效工作區 seeding 用）的
目錄路徑。此目錄下有一個不可變 blob pool（`blobs/<sha[0:2]>/<sha>`）與一張 SQLite `refs.db`（per-namespace
refset，作法同其他引擎自有 side table），省略時預設 `$workRoot/cas`；一般部署可省略不填。`blob_put` 上傳的
blob 以其**內容的 sha256** 為鍵存放（伺服器 byte-verify、以計算出的 hash 存放、絕不用宣稱的 hash），
`seed_plan`／`workflow_run` 的 `seedManifest` 僅以 hash 參照——因此此目錄即所有 seed blob 的實體儲存邊界，
請比照 workspace 保護。`missing`/`hasRef` 為 per-namespace（非全域存在性），跨租戶不共享 dedup。

`updateFlagPath`（型別 `string`，選填，**v11 Sprint 2 新增**）：引擎在收到已驗簽的 GitHub tag webhook 後，
以**原子方式（temp+rename）寫入的更新旗標檔**路徑（mode 0600）。systemd `.path` 單元監看此檔觸發
`rwe-update.service`，由特權 bash helper 讀取標籤、checkout、build、重啟。**必須在所有 `workRoot` 之外**
（引擎啟動時驗證，違反則以 `UPDATE_FLAG_INSIDE_WORKROOT` 拒絕啟動——這是 RCE 防護邊界）。建議路徑：
`/home/<user>/.local/share/rwe-flags/update.flag`（引擎使用者可寫、權限 0700 的目錄）。省略時
`/github/webhook` 路由遇到已驗簽且需 arm 的事件回 503，其餘功能不受影響。
`updateResultPath`（型別 `string`，選填，**v11 Sprint 2 新增**）：特權 bash helper（`deploy/rwe-update.sh`）
以原子方式寫入更新結果 JSON（`{tag, status:'applied'|'failed'|'skipped', ts, detail?}`）的路徑。引擎在
啟動時（covers `applied` case：systemd 重啟後 helper 的結果已 flush）與 `GET /api/status` 懶惰讀取時
（covers `failed` case：引擎沒重啟時仍可觀察到 helper 失敗）讀取此檔，回傳為 `lastUpdate` 欄位。讀取為
容錯式（absent/malformed/half-written → null，永不 throw，`detail` 上限 4 KB）。同樣**必須在所有
`workRoot` 之外**。建議路徑：`/home/<user>/.local/share/rwe-flags/update-result.json`。
`selfUpdateDbPath`（型別 `string`，選填，**v11 Sprint 2 新增**）：自更新的 SQLite DB 路徑（delivery
去重表 `update_deliveries` + 單列 pending outcome 表 `update_outcome`），省略時預設
`$workRoot/self-update.db`；一般部署可省略不填。

**Gate 7.5 v2 ROUND 2 config-file sync check 補充（本輪新發現的文件漂移，已修正）**：`litellmPort`
（型別 `number`，選填）在 v2 TASK-027 就已經被 `composeConfig()` 真的接進
`LiteLLMProxyManager(aliases, {port: fileConfig.litellmPort})`（`tests/unit/
compose-config-v2-wiring.test.ts` 綠燈確認）。**v3 D-V3M-4 更新**：省略 `litellmPort` 時**不再預設
4000，而是綁一個 OS 分配的 ephemeral 空閒 port**（`net` 綁 `:0` 取得），徹底避開多實例/測試撞
port 的問題（實測常駐 sdk 服務跑在動態 port，可與完整測試套件並存）；明確指定 `litellmPort` 仍
有效，會走既有的 stale-owner pre-bind 檢查。`schedulerDbPath`/`assetRoot` 兩個 v2 鍵
（型別皆 `string`，選填）也是同一批新增鍵，皆有可用預設值，一般部署可以省略不填。

環境變數也可覆蓋設定檔部分欄位（不需要設定檔也能啟動）：
| 環境變數 | 對應 | 預設 |
|----------|------|------|
| `RWE_CONFIG_PATH` | 要讀取的 JSON 設定檔路徑 | `./rwe.config.json`（不存在則略過，全用內建預設） |
| `RWE_BIND` | `bind` | `127.0.0.1` |
| `RWE_PORT` | `port` | `8787` |
| `RWE_WORK_ROOT` | `workRoot`（狀態/journal/工作目錄根） | 設定檔值，否則系統暫存目錄下自動建立 |
| `RWE_SECRET_<NAME>` | 伺服器端 secret store（REQ-018）。provisioned MCP config 裡的 `${secret:NAME}` handle 由這個 env var 解析（`<NAME>` 對應 handle 裡的名稱，大小寫敏感）。引擎啟動時不驗證，只在有 run 引用 MCP 時才解析——缺少則該 run 以 `SECRET_MISSING` 報錯，從不外洩 handle 值或靜默跳過。**絕不放進 `rwe.config.json`（config 只存 handle，不存值）**；建議透過 systemd unit 的 `Environment=` 或 `EnvironmentFile=` 注入，或者 `export RWE_SECRET_MY_TOKEN=<value>` 方式設定。 | 無預設（缺少且 MCP 有引用時 run 報錯） |
| `RWE_SECRET_GITHUB_TOKEN` | **issue_report / Issues 儀表板需要**（REQ-027..030, REQ-066, REQ-067）。GitHub Personal Access Token（PAT）或 Fine-grained token，須有目標 repo 的 `issues:write` 權限。引擎讀此鍵為 `RWE_SECRET_GITHUB_TOKEN`（命名遵循 secret store 慣例）。缺少時 `issue_report` 回 `GITHUB_TOKEN_MISSING`；`GET /api/issues` 回 HTTP 200 `{degraded:"GitHub not configured"}`（不 500）。**絕不放進設定檔**；透過 `EnvironmentFile=~/.config/rwe.env` 注入（見 §2b systemd unit 範例）。 | 無預設（缺少時功能降級，非崩潰） |
| `RWE_SECRET_GITHUB_WEBHOOK_SECRET` | **v11 Sprint 2（REQ-068）標籤觸發式自動更新需要**。GitHub webhook 的共享 HMAC 密鑰，對應在 GitHub 介面設定的「Secret」欄位。引擎讀此鍵為 `RWE_SECRET_GITHUB_WEBHOOK_SECRET`（secret store 慣例）。`POST /github/webhook` 路由以此金鑰對**原始 body bytes**（非解碼後）計算 HMAC-SHA256，並與 `X-Hub-Signature-256` 標頭做常數時間比對。缺少時（同時沒有設定 `updateFlagPath`）整條路由回 503 `UPDATE_WEBHOOK_UNCONFIGURED`，不影響其他功能。**絕不放進設定檔**；透過 `EnvironmentFile=~/.config/rwe.env` 注入。 | 無預設（缺少時自動更新功能停用，其餘功能不受影響） |

## 1c. 安全模型（Security Model，v2 Gate 8 review 收尾修復，D-V2G8-1(a)(b)(c)(d)）

> 本節記錄 `gateway:"sdk"` 路徑（`ClaudeAgentSdkGatewayClient`）的 agent 工具權限、供應商金鑰
> 存放、以及 run 工作目錄隔離這三件事**實際**如何運作——修復對象是 v2 Gate 8 review 發現的
> V3 HIGH 缺陷：舊版把 `permissionMode:'bypassPermissions'`（跳過每一次工具呼叫的裁決）與預設
> 就含 `Bash` 的工具面、外加只有 `cwd` 而無任何路徑邊界檢查三者疊加，讓任何 `agent()` prompt
> 都能誘使 CLI 讀取工作目錄以外的任意路徑（例如 LiteLLM 代理自己的 `config.yaml`——內含供應商
> API 金鑰——或另一個 run 的工作目錄）。**本節描述的是修復後的行為，也是目前的實際行為**——不是
> 尚待實作的計畫。

**(a) 不再用 `bypassPermissions`**：`options.permissionMode` 固定是 `'default'`（不是舊版的
`'bypassPermissions'`）。headless 模式下仍然不會卡在互動式權限提示——因為下面 (d) 的
`canUseTool`/`PreToolUse` 回呼一律會同步回傳一個明確決策（`allow` 或 `deny`），從不回傳
`null`/pending。

**(b) 預設工具面 = 受限的檔案+搜尋+shell 集（v3 D-V3M-3 更新，取代舊的「不含 Bash」）**：
`gateway:"sdk"` 路徑下，一次 `agent()` 呼叫若沒有自帶 `opts.allowedTools`（且對應 `agentType`
定義也沒有 `tools:` frontmatter）、也沒有設定 `defaultAllowedTools`，套用的內建預設工具清單是
**`["Read","Write","Edit","Glob","Grep","Bash"]`**——與真實 dynamic-workflow agent 的工作工具面
對齊。**`Bash` 現在在預設集裡，但被 (d) 的工作目錄邊界封閉**（`cwd`=該次 run 工作目錄 + 每次呼叫
的 realpath 路徑檢查；一個試圖逃出工作目錄的 Bash 指令會被 `deny`）。這**刻意反轉**了 v2 當初把
Bash 排除於預設的決定：那個排除只在「還沒有 fs jail」時成立（Bash 預設 + `bypassPermissions` 會
在父信任區跑任意 shell）；現在兩半都變了——`permissionMode` 是 `'default'`（見 (a)）、且 (d) 的
realpath 邊界對每次呼叫強制，jail 已存在，所以 Bash 以「限制在固定工作目錄下」的形式回到預設。
**仍不在預設、需明確 opt-in 的**：`WebFetch`/`WebSearch`（對外網連線，破壞工作目錄封閉性）與
`Task`/`Agent`（在 agent 內再生子 agent，繞過引擎自己的 orchestration+DOS 追蹤模型）——所有工具
仍可透過 `agentType` 的 `tools:` frontmatter 或呼叫端 `opts.allowedTools` 明確啟用，只是預設集不
含它們。

**(c) 供應商 API 金鑰的存放位置**：真實的供應商金鑰（`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/...）
只存在於「啟動這個伺服器的那個 process 自己的環境變數」與「伺服器內部管理的 LiteLLM 代理子行程
自己的環境變數」這兩個地方（`LiteLLMProxyManager._doStart()` 明確用 `env: { ...process.env }`
把這些真實金鑰交給代理子行程——這是它需要真的把呼叫路由到對應供應商所必需的）。**被 spawn 出來、
實際執行 agent 工具迴圈的 `claude` CLI 子行程，拿到的環境變數是一份明確的白名單**
（`buildSubprocessEnv()`：`PATH`/`HOME`/`SHELL`/`LANG`/`LC_ALL`/`TMPDIR`/`TERM` 這幾個 CLI
自己要能正常運作所需的變數 + 覆寫過的 `ANTHROPIC_BASE_URL`（指向本機代理）+ 一個**假的**
`ANTHROPIC_API_KEY`（非空字串，但從來不是真的憑證）——真實金鑰從未出現在這份白名單裡，agent
自己的 prompt/工具呼叫無法透過環境變數讀到它。同樣地，代理子行程自己產生的 `config.yaml`
（`generateLiteLLMConfig()`）裡也從來不寫入原始金鑰值本身（由 LiteLLM 自己在啟動時從環境變數
讀取），所以就算 agent 真的讀得到那個檔案（見下方 (d) 這條路徑本來就會被擋下），內容也不含金鑰。

**(d) 每次 run 的工作目錄互相隔離、且讀寫被限制在自己的工作目錄子樹內**：每個 run 都有自己專屬的
磁碟工作目錄（`RunManager`/`WorkflowCatalog.runWorkspace()`），`agent()` 呼叫時這個 `workspace`
會被當成 `options.cwd`，**且同時**被當成一個路徑邊界檢查的 root，透過兩層機制強制執行（雙重
保險，見程式碼內 `src/gateway/claude-agent-sdk-client.ts` 的 `toolUsePreCheck()`/
`makeCanUseTool()`/`makePreToolUseHook()` 註解）：
  1. SDK 自己文件化的 `options.canUseTool` 回呼——檢查一次工具呼叫自己帶的路徑參數
     （Read/Write 的 `file_path`，或 Bash 逃逸嘗試時 SDK 回報的 `blockedPath`）是否落在這次 run
     自己的工作目錄之內；不在的話回傳 `deny`。
  2. **同一個決策也另外接到 `options.hooks.PreToolUse`**——這是因為經真實 SDK 執行驗證後發現：
     當 `allowedTools` 裡列的是「裸」工具名稱（例如預設的 `'Read'`，不是 `'Read(某個規則)'`
     這種帶規則內容的形式）時，SDK 會直接自動核准該次呼叫、**完全不會呼叫 `canUseTool`**
     （SDK 自己的 `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 執行期警告訊息即為此行為的官方說明，且它
     自己建議的因應方式正是改用一個 `PreToolUse` hook）——而 D-F11/UT-024 這條既有規則要求
     `allowedTools` 永遠是裸名稱、非空（絕不能留空，否則會退回 SDK CLI 完整未經篩選的工具面）。
     所以這裡選擇兩者並存：不管 SDK 實際上是透過哪一條路徑做核准決策，工作目錄邊界檢查都會被
     執行到——已用一個指向工作目錄以外真實路徑（`/etc/hostname`）的真實 Read 呼叫、對真實 SDK
     `query()` 端對端驗證過會被擋下（`deny`，訊息為 `path outside run workspace: ...`），工作目錄
     內的路徑則正常放行。
  3. 沒有已知工作目錄 root 時（例如直接呼叫 `invoke()` 的單元測試情境，既無 `req.workspace`
     也未設定 `cwd`）——沒有邊界可執行，維持放行（不是這個機制要處理的情境）。

**這個安全模型不是作業系統層級的 sandbox/jail**（沒有 container/namespace/chroot 隔離）——它是
應用層的權限裁決 + 路徑邊界檢查，防的是「agent 被 prompt 誘導、透過 SDK 自己文件化的工具參數去
讀寫工作目錄以外的路徑」這一類攻擊路徑；不是防一個真的被入侵、能直接呼叫任意系統呼叫繞過 SDK
本身的惡意子行程。

## 2. 部署步驟（依序）
```bash
# 步驟 1：取得程式碼 / 安裝 Node 依賴
npm install

# 步驟 2：準備 LiteLLM 子行程用的 Python 3.12（見 §1；只有需要 agent() 才必要）
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv python install 3.12
uv venv --python 3.12 /opt/rwe-litellm-venv
uv pip install --python /opt/rwe-litellm-venv/bin/python "litellm[proxy]"
export PATH="/opt/rwe-litellm-venv/bin:$PATH"   # 常駐部署請把這行放進啟動 unit 的 Environment

# 步驟 3：設定環境（模型別名設定檔 + LLM 憑證環境變數）
cp rwe.config.example.json rwe.config.json
# 依需求編輯 rwe.config.json（別名、bind、port、workRoot、gateway、agentDefinitionsDir、
# defaultAllowedTools）
export ANTHROPIC_API_KEY=sk-ant-...          # 依實際要用的 provider 擇一或多個設定
# export OLLAMA_BASE_URL=http://localhost:11434
# 指向「外部 OpenAI 相容端點」（自架 OSS 大模型）時，改設這兩個 —— 見頂部「⭐ 情境配方」：
# export OPENAI_API_BASE=http://<端點host>:<port>/v1
# export OPENAI_API_KEY=<key，或不需認證就給任意非空字串>   # openai/ 別名全導向此端點

# 步驟 4：無需資料庫遷移/初始化 —— SQLite schema 由伺服器啟動時自動建立於 $workRoot/store

# 步驟 5（v2 TASK-027 修復後為額外保險，非唯一防線；正常 SIGTERM 關機已會自動清掉）：
# 啟動前先確認沒有非正常關機（如 kill -9）殘留的孤兒 litellm process 占著 4000 port
# （或你在 rwe.config.json 設定的 litellmPort）
ps aux | grep '[l]itellm --config' && echo "先清掉這些 process 再繼續！" \
  || echo "乾淨，可以啟動"
# 若有殘留： ps aux | grep '[l]itellm --config' | awk '{print $2}' | xargs -r kill

# 步驟 6：啟動服務
RWE_CONFIG_PATH=./rwe.config.json RWE_WORK_ROOT=/var/lib/remote-workflow-engine npm run start
# 建議用 systemd / pm2 / docker 常駐；此指令本身是前景長駐程序，SIGINT/SIGTERM 會優雅關閉
# （但見 §6「仍待下一輪修復」第 1 條：目前優雅關閉不會連帶停掉內部的 litellm 子行程，需另外清理，
#  且見上方步驟 5：下次啟動前務必先清乾淨，否則有誤連舊代理的風險）
```

## 2b. 容器化 / systemd 常駐化 / 上線前煙霧測試（v2, REQ-011, DES-022, TASK-023）

> 本節記錄 v2 新增的三個部署封裝產物：`docker-compose.yml`、`deploy/rwe.service`（systemd
> unit）、`scripts/smoke.sh`（非互動式、以結束碼判斷成敗的煙霧測試）。**本機與遠端主機的部署
> 步驟完全相同**——沒有「本機才有的捷徑」。

**docker-compose**（不需要另外寫 Dockerfile；直接把 repo 掛進官方 Node 22 image，跑與手動部署
完全相同的 `npm ci && npm run start`）：
```bash
docker compose up                              # 預設 profile：只跑 server，走免依賴的
                                                # direct-fetch/SDK 路徑，不需要 LiteLLM/Python
docker compose --profile litellm up server-litellm
                                                # 選用 profile：容器內額外安裝 Python 3.11 +
                                                # litellm[proxy]（同 §1 的 D-R3 版本 pin 理由）
```

**systemd**（`deploy/rwe.service`，`Restart=on-failure` 自我修復）：
```bash
sudo cp deploy/rwe.service /etc/systemd/system/rwe.service
sudo systemctl daemon-reload
sudo systemctl enable --now rwe.service
```
`ExecStart` 用的是與本文件 §2 步驟 6 完全相同的 `npm run start`（此 repo 沒有另外維護一份編譯產
物 `dist/main.js`，見該檔案內註解）。

### 無 root 部署：systemd **user** service + 本地 Ollama（實測路徑，2026-07-07 驗證）

> 沒有 sudo/root 時的正解——用 systemd 的 **user instance**（`systemctl --user`），unit 放
> `~/.config/systemd/user/`，完全不需要 root。附檔 `deploy/rwe.user.service` 是這個版本的範本。
> 全程只用本地 Ollama（`qwen2.5`），**零 API 金鑰、零 LiteLLM/Python 依賴**。

```bash
# 1. 安裝 unit（用 cp，不要手打 heredoc——長行/縮排容易被貼壞）
cp deploy/rwe.user.service ~/.config/systemd/user/rwe.service
cat ~/.config/systemd/user/rwe.service          # 確認完整 17 行、有 ExecStart 才繼續

# 2. 啟用 + 啟動 + 讓它在登出後仍續存
systemctl --user daemon-reload
systemctl --user enable --now rwe.service
loginctl enable-linger "$USER"                   # 登出/重開機後 user service 仍運行

# 3. 驗證（看到 active + dashboard=200 即成功）
systemctl --user is-active rwe.service
curl -s -o /dev/null -w "dashboard=%{http_code}\n" http://127.0.0.1:8787/dashboard
```

**搭配的 `rwe.config.json`（Ollama-only、免依賴）**：
```json
{
  "bind": "127.0.0.1", "port": 8787, "workRoot": "./data",
  "timeoutMs": 300000, "gateway": "direct-fetch", "useLiteLLMProxy": false,
  "aliases": { "default": { "provider": "ollama", "model": "qwen2.5:7b" } }
}
```

**三個實際會踩到的坑（本次實測排除，v2.1 已修 + 補測試）**：
1. **`ExecStart` 不要用 `npm`** —— 若 node 是用版本管理器裝的（例如在 `~/.local/node/bin/`），
   `/usr/local/bin/npm` 可能是失效 symlink，而 systemd 用最小環境看不到互動 shell 的 PATH →
   `status=203/EXEC`。範本改用 **node 絕對路徑直接跑 tsx**：
   `ExecStart=<node 絕對路徑> node_modules/tsx/dist/cli.mjs src/main.ts`，並在 unit 裡設
   `Environment=PATH=<node bin 目錄>:/usr/bin:/bin`。用 `node -e 'console.log(process.execPath)'`
   查你的 node 真實路徑。
2. **免依賴啟動要設 `useLiteLLMProxy:false`** —— 否則開機/首次 `agent()` 會去 `spawn litellm`，
   沒裝就 `ENOENT` 崩潰。設 `gateway:"direct-fetch"` + `useLiteLLMProxy:false`，ollama 走原生直連
   `localhost:11434`，完全不碰 LiteLLM。
3. **`timeoutMs` 是「單次 `agent()` LLM 呼叫」的斷路器，不是整體 workflow 逾時**（workflow 本身
   非同步、無總時長限制）。本地 7B 生成大回應會超過預設 15 秒 → 被切成 null；跑本地模型建議調高
   到 `300000`（5 分鐘）。

**上線前煙霧測試**（`scripts/smoke.sh`，非互動式、結束碼 0=成功）：
```bash
scripts/smoke.sh
```
啟動伺服器 → 送出一個**不呼叫 `agent()`** 的範例 `workflow_run` → 輪詢 `workflow_status`/
`workflow_result` 至完成 → 關閉伺服器。不需要任何 LLM 供應商金鑰或 LiteLLM/Python，只驗證
`workflow_run`/`workflow_status`/`workflow_result` 這條核心路徑本身能不能跑完。

### 沒有身份驗證的已知風險（v2 no-auth caveat，D5/C4）

**`asset_push` 目前會把任意內容真實寫入伺服器端磁碟**（`$workRoot/assets/<kind>/<name>/...`，
已對真實 process 驗證）。v2 完全沒有 authentication/authorization（v3 才會補上 OIDC
resource-server，見 ARCH 決策 D5/C4）——任何能連到 `/mcp` 這個 HTTP 端點的人都能呼叫
`asset_push`。**在 v3 補上真正的身份驗證之前，遠端部署只能透過 SSH 通道（例如
`ssh -L 8787:127.0.0.1:8787 user@host`）或 VPN 存取這台伺服器，絕對不要把 `asset_push` 所在的
port 直接暴露在公開網路上。**

> **Gate 7.5 v2 ROUND 1 更正（本輪發現的文件與現實落差）**：本節先前的文字說推送的 skill/hook
> 檔案「之後會被真實載入/執行」——**這在目前版本並不成立**：已對真實獨立 process 確認，
> `agent()` 呼叫（`ClaudeAgentSdkGatewayClient`）目前寫死 `settingSources:[]`（略過所有檔案系統
> skill 探索）與 `strictMcpConfig:true`（`mcpServers` 從未被填入），且 `composeConfig()`/
> `createServer()` 從未把 `AssetSyncService` 存的資產接進 gateway。**推送的 skill/MCP config 目前
> agent 完全用不到**，見 `.sdlc/features/001-remote-workflow-engine/08-validation.md` 的
> `VAL-017`。上述「任意寫入磁碟」的風險本身依然真實存在（`asset_push` 仍是真實的伺服器端檔案
> 寫入能力），SSH 通道/VPN 的建議維持不變；只是「寫入後會被執行」這個額外風險，在這個接線缺口
> 修好之前，**目前並不成立**。

## 3. 健康檢查（怎麼確認起來了）
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
判定標準：回傳 `200`，且 body 的 `result.tools` 陣列包含 **10** 個 `workflow_*` 工具名稱（含
`workflow_artifacts`）；終端機/日誌會印出 `[remote-workflow-engine] ready`。本輪（第六輪）驗證
另外用真實 HTTP 客戶端對 5 個**獨立啟動的真實 process**（非測試框架內程序）打了完整的
`workflow_run`→`workflow_status`→`workflow_result` 流程，`agent()`（純文字問答成功案例、逾時綁定、
agentType 解析、工具呼叫失敗案例、in-flight 狀態觀察）、`workflow_suspend`/`resume`/`stop`（含真實
子行程存活時間量測、含中止後續跑真的重新執行、含帶編輯腳本的快取前綴重播）、
`workflow_register`/`workflow_artifacts`、`bind:"0.0.0.0"` 對外監聽、跨重啟存活（2 次真實
`SIGTERM`+重啟，其中一次是暫停中的 run），證據見
`.sdlc/features/001-remote-workflow-engine/08-validation.md`。

## 4. 回滾
```bash
# 停掉目前的 process（Ctrl-C 或）：
kill -TERM <pid>          # 會走 SIGTERM 優雅關閉（等 HTTP server 收乾連線）
# v2 TASK-027 起：這個 SIGTERM 現在會自動連帶砍掉伺服器內部管理的 litellm 子行程（見 §6 第 7 項，
# 本輪已用真實 SIGTERM 重新確認）。若你懷疑仍有非正常關機（kill -9）留下的孤兒，手動確認/清理：
ps aux | grep '[l]itellm --config' | awk '{print $2}' | xargs -r kill

# 回到前一個 git 版本後，重新安裝依賴 + 啟動：
git checkout <前一個 commit/tag>
npm install
npm run start
```
狀態（run 記錄、journal、具名工作流程註冊表）存在 `workRoot`（SQLite + `agent-*.jsonl`），回滾程式碼
**不會**清掉這些檔案；若新舊版本的資料格式不相容，需另外決定是否保留/搬移 `workRoot`。

## 5. 疑難排解 Troubleshooting
| 症狀 | 可能原因 | 處置 |
|------|----------|------|
| 啟動失敗 `EADDRINUSE` | port 已被另一個 remote-workflow-engine process 占用 | `RWE_PORT=<other>` 換一個 port，或先確認/停掉舊 process（`ps aux \| grep "main.ts"`） |
| `pip install 'litellm[proxy]'` 失敗（`uvloop`/`orjson` 編譯錯誤） | 系統 Python 版本太新（如 3.13/3.14），沒有預編譯 wheel | 用 §1 的 `uv python install 3.12` 取得一份獨立的 3.12，改用它裝 |
| `agent()` 一律回傳 `null`、`workflow_status.agents[].state === "failed"` | 該別名對應的 provider 沒有可用憑證/端點（D-G：伺服器不會掛住，只會讓該次呼叫失敗回 `null`） | 確認 `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`/`OLLAMA_BASE_URL` 已正確設定，且 `rwe.config.json` 的 `aliases` 有指到你要的 provider/model |
| `workflow_run` 回 `UNKNOWN_ALIAS` | 腳本裡 `agent(prompt,{model:'xxx'})` 的別名沒在 `aliases` 設定檔裡 | 補上該別名，或改用已存在的別名——這是在**送出（submission）當下**就報錯，不會跑到一半才失敗 |
| 腳本內 `budget.spent()` 一直是 `0`、`budget.remaining()` 一直等於 `budget.total` | 該次執行可能尚未完成任何一次 `agent()` 呼叫 | 第一筆用量要等第一次 `agent()` 回應後才會同步（多輪皆已用真實 token 數確認即時同步正常） |
| `rwe.config.json` 設定的 `timeoutMs`/`retries` 對 `gateway:"sdk"` 沒有作用 | 應已修復——多輪 Gate 7.5 對獨立真實 process 重新確認已修復：本輪實測 `timeoutMs:1500,retries:0` 時，一次真實 `agent()` 呼叫在 1.677 秒內正確中止 | 若仍遇到逾時無效，確認 `rwe.config.json` 確實有 `timeoutMs`/`retries` 鍵且伺服器有重新啟動讀取新設定 |
| `agent(prompt,{agentType:'...'})` 在正式環境一律回傳 `"Unknown agentType: ..."` | 應已修復——已知型別（如 `researcher`）能正確解析並套用其 frontmatter 定義；未知型別仍快速報錯（不會卡住） | 若仍遇到，確認 `rwe.config.json` 的 `agentDefinitionsDir` 指向正確目錄、檔案為 `*.md` 且 frontmatter `name:`（或檔名）與腳本裡的 `agentType` 相符 |
| `workflow_suspend` 之後懷疑「暫停沒有真的省到錢/砍掉底層呼叫」 | 應已修復——多輪 Gate 7.5 對獨立真實 process + 真實 `claude` CLI 子行程重新確認已修復：實測暫停後底層 CLI 子行程約 2 秒內就消失 | 若仍觀察到子行程沒被砍掉，回報並附上 `ps aux` 時間序列 |
| **`agent()` 要求讀檔/寫檔，回傳的內容看起來像結果，但檔案沒真的被寫入 / 讀到的內容是編造的** | **第五輪發現、第六輪確認「程式碼修復已生效但問題仍在」，正式歸類為本機小模型能力上限**：對本機 7B 級 Ollama 模型而言，即使已將工具清單縮減到最小（`Read`/`Write`/`Bash`），SDK 的工具迴圈仍從未真正被觸發，模型直接生成一段編造的「工具結果」文字。已排除模型本身不支援 tool-calling（直接對 Ollama 原生 API 測試正常） | 目前沒有繞過方法；若你的工作流程依賴 agent 真的讀寫檔案，本機 7B 級 Ollama + `gateway:"sdk"` 尚不能滿足這個需求，建議改用更大的本機模型（例如 32B 級）或已驗證憑證的付費供應商 |
| `workflow_status.agents[].state` 看不到 `"queued"`/`"running"`，只看得到 `"done"`/`"failed"` | **已修復（第六輪確認）**：`workflow_status` 現在會在 agent 呼叫排隊/執行中時就即時顯示對應狀態 | 若仍只看到 `"done"`/`"failed"`，確認伺服器版本包含 D-F12 修復（`src/run-manager.ts` 的 `markQueued`/`markRunning`） |
| `workflow_suspend` 之後 `workflow_resume`，續跑後的結果永遠是 `null` | **已修復（第六輪確認）**：被中止的呼叫現在會在續跑時真的重新執行，journal 能正確分辨「中止產生的 null」與「真的執行完的合法 null」 | 若仍觀察到續跑秒殺回傳 `null`，確認伺服器版本包含 D-F13 修復（journal `aborted` 欄位、`ResumeCache.Plan.replay` 邏輯） |
| 續跑（`workflow_resume`）之後，原本被中止那次呼叫的紀錄一直卡在 `"state":"running"` | 已知的小瑕疵（第六輪新發現，非阻斷）：中止的呼叫紀錄不會自己轉成終止狀態，續跑會多出一筆新紀錄 | 純顯示瑕疵，不影響最終 `workflow_result` 的正確性；可忽略舊的那筆紀錄 |
| 關掉伺服器後還有一個 `litellm --config ...` process 留著 | **v2 TASK-027 修復前**（v1 已知限制）：優雅關閉不會連帶停掉子行程。**v2 起已修復**（本輪 Gate 7.5 v2 ROUND 2 config-sync check 重新以真實 `SIGTERM` 確認）：正常 `SIGTERM`/`SIGINT` 關機現在真的會連帶砍掉內部管理的 `litellm` 子行程，2 秒內從 `ps aux` 消失，不留孤兒。若你仍看到殘留 process，多半是非正常關機（如 `kill -9`）留下的 | 手動 `ps aux \| grep litellm` 找到後 `kill`；正常關機（`SIGTERM`/Ctrl-C）應已足夠，不需要每次都手動檢查；也可以用 §1b 的 `litellmPort` 鍵讓每個實例用不同 port，徹底避開誤連風險 |
| Node 啟動就報 SyntaxError / 找不到 `--experimental-transform-types` | Node 版本 < 22.6 | 升級 Node 到 22.6 以上（`node --version` 確認） |

## 6. 維運注意事項 / 已知限制（第六輪 Gate 7.5：對獨立真實 process + 真實 Ollama 重新驗證，
本輪 GATE 通過，測試證據見 `08-validation.md` VAL-001~007/013/014/015）

- 日誌位置：目前僅 stdout/stderr（`[remote-workflow-engine] ...` 前綴），交給你的 process manager
  （systemd/pm2/docker）收集；沒有另外寫檔案 log。
- 狀態位置：`$workRoot/store`（SQLite run 索引 + 具名工作流程註冊表）與
  `$workRoot/workflows/<name>/runs/<runId>/`（每次執行的工作目錄，含 `agent-*.jsonl` transcript
  事件檔）。
- **composite 呼叫樹可觀測（v8 Slice 2）**：對 in-process（執行中或剛完成）的 composite run，
  `workflow_status`／`GET /api/runs/:id` 現在會多回傳呼叫樹資料——每個 agent 記錄帶 `frame`（所在
  巢狀 frame，頂層 `""`），以及 `workflowNodes: [{frame,name,parentFrame,depth}]`（每次巢狀
  `workflow()` 一個節點）；用戶端據此重建 DAG 並用 `workflow_agent_log(runId, agentId)` 下鑽到每個
  節點的 log。跨重啟後 `workflowNodes` 回傳 `[]`（樹只存在於行程內記憶體，尚未持久化）。
- **儀表板 UI：卡片 → 巢狀 DAG → agent log（v8 Slice 3）**：`GET /dashboard` 首頁現在同時列出
  **已註冊工作流程卡片**（來自新端點 `GET /api/workflows`）與 **run 卡片**（來自 `GET /api/runs`，
  每張顯示 `runId` 與 `status · name`）；點一張 run 卡片開啟 `/dashboard/<runId>`，會抓 **新端點
  `GET /api/runs/:id/dag`**（後端由純函式 `buildDagModel` 依上述 `frame`/`workflowNodes` 重建呼叫樹）
  並渲染成 **巢狀樹**——每個 composite 子工作流程是一個帶標題（`workflow <name> · depth N`）的群組，
  內含依 3 態（`queued`/`running`/`done`/`failed`）上色、顯示 model 的 agent 節點；點一個 agent 節點
  載入它的 transcript。頁面以 3 秒輪詢自動更新。跨重啟後該 run 已不在行程內，`/api/runs/:id/dag`
  會攤平（`getRun` 回傳 `workflowNodes: []`）——即 REQ-047 記載的「跨重啟持久化不在範圍」。Gate 7.5
  v8 Slice 3 ROUND 1 PASSED（headless browser 實測，VAL-057/058）。
- **即時執行細節：phase 時間軸 + 每個 agent 的耗時（v8 Slice 2b）**：`workflow_status`／`GET
  /api/runs/:id` 現在讓每個 `phases[]` 項目帶 `ts`（進入該 `phase()` 的 ISO 時間，依呼叫順序、`ts`
  非遞減）；當 run 仍在 `running` 時，最後一個 phase 就是**目前步驟**。每個 agent 記錄多帶
  `startedAt`（被派工到 gateway、取得並行槽的時間）與 `endedAt`（結束時間，`endedAt ≥ startedAt`）；
  仍在執行的 agent 只有 `startedAt`，尚未派工的兩者皆無。`GET /api/runs/:id/dag` 的 agent 節點據此
  導出 `durationMs`（未完成則為 `undefined`）。`/dashboard/<runId>` 詳情頁會渲染 **phase 時間軸**
  （每個 phase 一個 chip、`ts` 為 tooltip、`running` 時最後一個標為目前步驟）與**每個 agent 節點的
  耗時**（`<n> ms`）。Gate 7.5 v8 Slice 2b ROUND 1 PASSED（真實 opus agent 實測 `5325 ms`，
  VAL-059/060）。**尚未支援**：parallel-group 標記、跨重啟的 phase／樹持久化、SSE（維持 3 秒輪詢）、
  樹的靜態預讀+快取。
- **跨觸發串接 + run-admission（v8 Slice 4）**：新增兩個 MCP 工具——`chain_create({afterRunId,
  run:{workflow, args?, budget?}})` 註冊一個**持久化的完成續接**（當 `afterRunId` 進入 `completed` 時，
  恰好啟動一次 `run.workflow`；`failed`／`stopped` 則標為 `skipped`；`afterRunId` 未知回
  `CHAIN_TARGET_NOT_FOUND`），回傳 `{chainId}`；`chain_list`（零參數）列出每個續接的 `status`
  （`pending`／`fired`／`skipped`）、`rootRunId` 世系與已觸發後的 `spawnedRunId`。續接持久化於
  `continuationDbPath`（見上），跨重啟由 boot reconcile 補觸發（因 `hydrateAll` 會把跨重啟仍 running 的
  run 標為 failed，開機時目標必為終態）；同一 run 的多次終態轉換（stop→resume→complete）最多只啟動一次
  下游 run（原子 `WHERE status='pending'` 認領）。並行上限由 `maxConcurrentRuns`（見上）以
  `RUN_ADMISSION_LIMIT` 把關。Gate 7.5 v8 Slice 4 ROUND 1 PASSED（真實 service 30 tools、真串接執行、
  in-flight onTerminal 實測，VAL-061/062/063）。**尚未支援**：外部 ingress 安全（Defer B，已於下方 Defer B
  段落補上）、跨重啟 in-flight 呼叫樹 suspend/resume（Defer A，已於下方 Defer A 段落補上）。
- **跨重啟 DAG 持久化（v8 Slice 2c）**：以往一個 composite run 一旦行程結束，重啟後 `workflow_status`／
  `GET /api/runs/:id`／`/api/runs/:id/dag` 會攤平（`phases:[]`／`workflowNodes:[]`、agent 失去 `frame`）。
  現在引擎在**權威的終態轉換**（單一 `_transition`，涵蓋 `completed`／`failed`／`stopped`）**一次性**寫入一
  份 DAG 快照（`phases` + `workflowNodes` + 完整 agent 記錄含 `label`／`phase`／`frame`／`startedAt`／
  `endedAt`）到引擎自有的 `run_snapshots` side table（在 `$workRoot/store/index.db`，migration-free），
  `getRun` 讀回時 overlay 這份快照——所以重啟後 `buildDagModel` 能重建**同一棵**巢狀樹（composite 群組保留、
  agent 依 frame 分組、顯示耗時），儀表板不再攤平已完成的 composite run。向後相容：改動前留下的 run（無快照）
  仍以既有方式重建（phases:[]/workflowNodes:[]、agent 由 token 導出），不會更差、不會崩。Gate 7.5 v8 Slice
  2c ROUND 1 PASSED（真實 service 重啟後 DAG 不攤平實測，VAL-064）。**尚未支援**：SSE（Item B）、
  parallel-group 標記（Item C，需 sandbox-IPC 改動）、靜態預讀骨架+快取（Item D）。
- **外部 ingress 安全：Host/Origin 白名單 + webhook 入口（v8 Defer B，OIDC 前的過渡管控）**：
  - **Host/Origin 白名單（永遠開啟，不需設定）**：HTTP handler 最頂端對每一條路由（`/mcp`、`/api/*`、
    `/dashboard`、`/hooks/*`）一致把關。外來 `Host`（DNS-rebinding）→ 403；帶有且非白名單的 `Origin`
    （瀏覽器 drive-by CSRF）→ 403；**缺少 `Origin` 則放行**（fail-open——所有程式化 MCP client／測試都不
    送 Origin，若 fail-closed 會打斷所有非瀏覽器呼叫者）。白名單為 loopback（`127.0.0.1`/`localhost`/`::1`）
    在 server port，加上設定的非 loopback `bind` 主機；是真正的 authority 比對（`127.0.0.1.evil.example.com`
    這種前綴繞過會被拒）。
  - **Webhook 入口 `POST /hooks/:id`（fail-closed）**：驗證順序為 id 存在且 enabled → `X-RWE-Signature:
    sha256=<hex>` 以 `HMAC-SHA256(secret, 原始 body)` 常數時間比對（在 JSON parse 之前，對原始位元組驗）→
    `X-RWE-Timestamp` 在 ±300 秒內 → `X-RWE-Delivery` 去重（原子 `INSERT OR IGNORE`，重放 → 200 不重跑）→
    啟動**預先綁定**的工作流程（名稱來自註冊、絕不取自 request body，無 workflow 選擇注入），body 以
    `args.event` 傳入，回 202 `{runId}`。
  - **管理工具**：`webhook_create({workflow, enabled?})` 驗證工作流程已註冊（否則 `WORKFLOW_NOT_FOUND`），
    server 端產生隨機 secret 並**只回傳一次**（`{webhookId, url, secret}`）；`webhook_list`（零參數）只回
    `{id, workflow, enabled, secretFingerprint}`（sha256 前綴，**永不回 secret**）；`webhook_delete({id})`。
    註冊表持久化於 `webhookDbPath`（見上），跨重啟可用。
  - **Bind 安全（OIDC 前的已知注意事項）**：admin-write ingress 目前靠 loopback/LAN bind + 上述 Host/Origin
    白名單管控。**在公開 `0.0.0.0` bind 且未接 OIDC（REQ-012，D5 延後）的情況下，任何能連到該 port 的人都能
    呼叫這些工具**——這是已記錄的部署注意事項（見 §2b「沒有身份驗證的已知風險」），白名單是過渡管控、不是
    OIDC 的替代品。
  - Gate 7.5 v8 Defer B ROUND 1 PASSED（真實 service 33 tools、`Host: evil` → 403、`Origin: evil` POST
    /mcp → 403、簽章 `POST /hooks/:id` → 202 且真跑、重放 → 200 不重跑、`webhook_list` 只回指紋，
    VAL-065/066/067）。
- **當機可續跑（v8 Defer A，crash durability）**：以往一個 run 在引擎當機／重啟時若還在 `running`，重啟後會被
  永久標成 `failed`（無法續跑）。現在引擎在開機恢復（`hydrateAll`）時把仍為 `running` 的 run 重新分類為
  **`interrupted`**（可續跑、非終態，有別於使用者 `suspended`／`stopped`），開機日誌會印
  `hydrateAll: … N re-classified running→interrupted (resumable)`；`workflow_status` 會回 `interrupted`，
  之後 `workflow_resume(runId)` 即可續跑。續跑時**已寫入日誌（journal.jsonl）的 `agent()`／`workflow()`
  呼叫會從持久化日誌重播**（新增 `RunStore.getJournal` 讀回，填入 ResumeCache），gateway 不會為已結算的呼叫
  重打——只有尚未完成的尾段才真的重跑（與 suspend/resume 相同語意）。run 的工作目錄（name+runId 的決定性
  函數）在重啟後保留，當機前 agent 產生的檔案狀態仍在。作法為 **Option X**：重用既有的 ResumeCache／日誌重播
  ＋一個非終態狀態＋日誌讀回，**沒有**新的 sandbox checkpoint／VM snapshot 協定。**已知注意事項**：當機瞬間
  正在飛行中（已派發但尚未寫入日誌）的那一次呼叫，續跑時無日誌命中 → 會真的重跑（cache MISS）——這與
  suspend/resume 一直以來的語意相同，非靜默遺失；若該次呼叫有非冪等副作用（例如已寄出的信）可能重複，由
  工作流程作者負責冪等性。Gate 7.5 v8 Defer A ROUND 1 PASSED（真實 service：跑一個 5 圈 opus loop 的具名
  工作流程，`kill -9` 引擎於執行中、systemd 重啟後 `workflow_status` 回 `interrupted`、`workflow_resume`
  續跑至 `completed` 並回傳 5 元素真實 opus 回應陣列，VAL-068/069）。**尚未支援**：SSE、parallel-group 標記
  （需 sandbox-IPC 改動）、靜態預讀骨架+快取。

- **重用前先看用途 + DAG（v9 workflow discovery）**：在重用一個已註冊工作流程前，不必執行也不必讀 script 即可
  查其用途與形狀。`workflow_list` 每筆現在多回傳 `description`（由 `meta.description` 隨查即時解析）；新增
  MCP 工具 `workflow_get({name})` 回傳完整 `{name, version, createdAt, description, phases, script,
  skeleton}`（未知名稱 → `WORKFLOW_NOT_FOUND` envelope）；`workflow_get.skeleton` 與新端點
  `GET /api/workflows/:name/skeleton` 回傳一份**預測的靜態 DAG 骨架**（純靜態掃描 `phase`/`agent`/`parallel`/
  `workflow` 呼叫，帶 parallel 群組 id 與子工作流程名稱，loop/conditional 內節點標 `dynamic:true`；掃描不執行
  script、不丟例外）。儀表板工作流程卡片顯示 description、可點擊 → 渲染預測 DAG。Gate 7.5 v9 ROUND 1 PASSED
  （VAL-070/071）。純唯讀、附加層——無破壞性變更、無新設定鍵、無遷移動作（description 隨查即時解析、非儲存欄位）。
- **高效大型程式庫 seeding：gzip 請求體 + 內容定址 blob（v10）**：兩個切片。（切片 1，REQ-063）`/mcp`
  請求體現在接受 `Content-Encoding: gzip|deflate`——可壓縮的程式碼 seed/asset payload（約壓 3–5×）得以塞進
  線上 8 MiB body cap 之下；解壓有**雙重上限**（壓縮輸入 `MAX_BODY_BYTES` 8 MiB + 解壓輸出 8×），gzip bomb
  會在解壓途中被擋、不會 OOM。body 若無 `Content-Encoding` 行為完全與以往相同。超過任一上限時回傳**具型別的
  413**：JSON body 帶 `{code:'BODY_TOO_LARGE', cap, phase:'compressed'|'decompressed', hint}`（hint 指明「用
  gzip 壓縮或拆分 payload」），不再是不透明的原始 413。webhook `POST /hooks/:id` 仍讀**原始** body（HMAC 需
  對交付位元組驗簽、不可自動解壓），僅同樣改回具型別 413。（切片 2，REQ-064/065）新增內容定址 blob 儲存庫
  `CasStore` 與兩個 MCP 工具：**`blob_put{namespace, sha256, contentB64}`**（伺服器 byte-verify、以計算出的
  hash 存放、絕不用宣稱的 hash；claim/upload 不符 → `BLOB_HASH_MISMATCH` 且不存任何東西；immutable、idempotent）
  與 **`seed_plan{namespace, manifest}`** → `{missing:[sha256…]}`（此 namespace 尚須上傳的 blob；per-namespace、
  非全域存在性，關閉跨租戶 dedup oracle）。`workflow_run` 新增 **`seedManifest:[{path, sha256, exec?}]`** 與
  `seedNamespace`——引擎以 hash 從 CAS 讀 bytes、透過與 `materializeSeed` **相同**的 per-path 守衛（`.claude`
  strip / `.git` reject / realpath-contained）組裝工作區，`exec?` 套用遮罩後的執行位元（`0o755`/`0o644`，
  setuid/setgid/sticky 不可表達；僅限一般檔案、永不支援 symlink/mode int）；若 `seedManifest` 參照到未上傳的
  blob，`workflow_run` 在任何持久化動作之前以 **`MISSING_BLOBS`** fail-fast（不建立 run row）。新增設定鍵
  `casDir`（預設 `$workRoot/cas`）。Gate 7.5 v10 ROUND 1 PASSED（真實 service 36 tools 含 `blob_put`/`seed_plan`：
  gzip `tools/list` 解碼、超大未壓縮 body → 具型別 413、blob 上傳 + `seed_plan` 2→0 missing + `workflow_run`
  seedManifest 組裝出 byte-identical 工作區、on-disk 模式 `0755`/`0644`、未上傳 blob → `MISSING_BLOBS`，
  VAL-072/073/074）。**尚未支援（後續增量，見 `docs/seed-sync-architecture.md` roadmap）**：raw-streaming
  blob 端點 `POST /assets/blob/<sha256>`（免 base64、免 8 MiB cap）、per-tenant quota + immutable-pool GC、
  client `push_workspace.py`（git 作為 client 端 stat-cache）+ `rwe seed` CLI、`seedRef` engine-pull。純附加
  層——無破壞性變更；inline `{path,contentB64}` seed 與 `asset_push` 不受影響；`workflow_run` 新欄位為選填、
  兩個新工具與 `casDir` 為附加，既有用戶端可忽略。**已知注意事項**：公開 `0.0.0.0` bind 且未接 OIDC（REQ-012，
  D5 延後）時，能連到 port 的人皆可呼叫 `blob_put`/`seed_plan`——Host/Origin 白名單是過渡管控（未來 raw blob
  端點沿用同一管控）。

- **本輪對獨立真實 process 重新確認「真的修復」（D-F12/D-F13，全部確認）**：
  1. **（D-F12）in-flight agent 狀態即時可觀察**：真實 3 個並行 `agent()` 呼叫，`status:"running"`
     期間輪詢 `workflow_status`，全部 agent 正確顯示 `state:"running"`（第五輪的 `agents:[]` 問題
     已修復）。
  2. **（D-F13）暫停中止的呼叫在續跑時真的重新執行**：實測暫停一個約 57 秒才會自然完成的生成任務，
     續跑後花費 27 秒、產出 940 個真實輸出 token（而非秒殺回傳 `null`）。
  3. （附帶驗證）`workflow_stop` + 帶編輯腳本的 `workflow_resume`：未變更的 `agent()` 呼叫從快取
     重播（同樣的 token 數，沒有新子行程），變更過的那次真的重新執行並反映新內容——第一輪之後
     首次以真實 process 重新證實。
  4. （D-F10a/b/c，非本輪新修但再次以獨立真實 process 確認未退步）逾時綁定、agentType 解析、
     suspend 真的砍掉底層子行程。
  5. （D-F6/D-F8/D-F9b，同上再次確認）thinking 政策、即時預算 IPC、重啟後 per-agent 記錄。
  6. `bind:"0.0.0.0"` 對外監聽——本輪首次重新以真實 process 驗證（`ss -tlnp` 確認、真實 `curl`
     取得 200）。

- **本輪（第六輪）確認：以下 1 項的程式碼修復已生效，但正式歸類為「本機小模型能力上限」，
  非程式碼缺陷**：
  1. **`agent()` 工具迴圈（讀檔/寫檔）對本機 7B 級 Ollama 模型完全不會真的執行**：伺服器已將送給
     模型的工具清單從「整個 Claude Code CLI 完整工具面」縮減到最小集合（`ps aux` 確認真實子行程
     的 `--allowedTools Read,Write,Bash --tools Read,Write,Bash --setting-sources= --strict-mcp-
     config` 旗標；單次呼叫真實 token 用量從約 4095 降到約 1550-2016，證實縮減確實生效），但即使
     如此，模型仍然只回傳編造的、看起來像工具呼叫結果的文字，從未真正發出工具呼叫（直接對 SDK
     `query()` 探測確認 `num_turns:1`，從未出現任何 `tool_use` 訊息）。本環境沒有比 7B 更大的
     本機模型可供測試。**這是 REQ-003 最核心的驗收標準（agent 真的用工具讀檔），已正式記錄為
     「已知模型能力上限」（類似付費供應商未驗證的性質），不是待修的程式碼缺陷，不會擋部署決策**——
     若你的部署需要 agent 真的讀寫檔案，請改用較大的本機模型或已驗證憑證的付費供應商。

- **仍待處理的操作面風險（v1 文字，第二/五輪起已知——見下方 v2 TASK-027 修復說明，7/8 已解決）**：
  7. ~~正常關機不會停止內部管理的 `litellm` 子行程（孤兒 process，需手動清理）~~ **已在 v2
     TASK-027（DES-022，orphan-reap）修復，Gate 7.5 v2 ROUND 1/2 皆對獨立真實 process 重新確認，
     本輪（v2 ROUND 2 config-sync check）再次親自重跑確認仍然成立**：對一個真實 `gateway:"sdk"`
     實例（自己會 spawn 真實 `litellm[proxy]` 子行程）送一個真實 `SIGTERM`，Node 主行程與
     `litellm` 子行程兩者皆在 2 秒內從 `ps aux` 消失，沒有孤兒殘留。其暫存設定目錄
     （`/tmp/rwe-litellm-*`）目前仍不會自動清除（純磁碟空間問題，非阻斷）。
  8. ~~`LiteLLMProxyManager` 固定使用 4000 port，結合上一項的孤兒行程問題，第二個伺服器實例可能
     誤連到殘留自前一個實例的舊代理~~ **v2 TASK-027 引入 `litellmPort` 設定鍵後風險大幅降低**：
     (a) 正常關機現在真的會清掉子行程（見上一項），不再留下孤兒；(b) 即使仍想保守起見，每個實例
     可以在自己的 `rwe.config.json` 明確指定不同的 `litellmPort`，讓多實例天生就不會共用同一個
     port（見 §1b）。啟動前確認沒有孤兒 `litellm` process 這個操作習慣（見 §1/§2/§4/§5）仍建議
     保留作為額外保險，但不再是唯一防線。

- **新發現的小瑕疵（第六輪，非 REQ 阻斷）**：
  9. 被 `workflow_suspend`/`workflow_stop` 中止的那次 agent 呼叫，其紀錄會永遠停在
     `"state":"running"`（不會自己轉成任何終止狀態），續跑後會多出一筆新紀錄。最終 `result` 本身
     正確，純屬輪詢畫面上的顯示瑕疵。

- `gateway:"direct-fetch"` 現在的定位：不需要真實 SDK CLI 子行程（也因此不受上方已知限制第 1 項的
  工具迴圈限制影響——它本來就不宣稱有工具迴圈能力）、不需要對第三方
  `@anthropic-ai/claude-agent-sdk` 套件的部署環境相容性，適合只需要純 `fetch()`-shaped provider
  呼叫、不需要 SDK 工具迴圈的本機/內網部署（`"sdk"` 仍是零設定的建議預設值）。

- **先前各輪確認已修復、本輪重新驗證仍然成立**：`workflow_agent_log` 回傳真實逐字稿（含跨重啟）；
  `workflow_artifacts` 可列出實際產生的檔案；具名工作流程的 `scriptVersion`/註冊清單（含跨重啟
  持久化、含版本更新後舊 run 仍保留原版本號）都正確；`gateway:"sdk"` 正確把呼叫端指定的模型/別名
  帶入 SDK session 的 `options.model`；供應商真實錯誤（`is_error:true`）正確解析成 `null`；2 層
  巢狀 `workflow()` 正確被拒絕、1 層正確允許；未知模型別名在送出時就被拒絕。

- 未驗證的真實依賴：本環境沒有 `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`，故 anthropic/
  openai/gemini 供應商分支只驗證了「缺憑證 → terminal → null」這條路徑，未驗證真正成功呼叫這些付費
  供應商的情境（也因此未驗證付費供應商模型是否有能力正確使用工具迴圈——上方已知限制第 1 項的工具
  呼叫缺陷目前只在本機 Ollama 上確認）。`gateway:"sdk"`（預設值）+ 本機 Ollama 的純文字問答成功
  案例已完整重新驗證；部署到正式環境前，建議至少用一組 sandbox/test key 針對付費供應商 +
  `gateway:"sdk"` 跑一次 `agent()` 成功案例，並特別驗證需要讀寫檔案的工作流程在該供應商上是否
  正常（見上方已知限制第 1 項）。

- **Gate 8 收尾修復（IMPL-051）— 第七輪 Gate 7.5 對獨立真實 process 重新驗證結果**：
  1. **零設定逾時保底（D-G8-4）— CONFIRMED（第七輪真實驗證）**：見 §1b 說明；`gateway:"sdk"` 路徑
     現在即使在完全零設定（無 `rwe.config.json`）情境下也有 `15000` 毫秒逾時保底，不會再無限期
     卡住。**真實驗證**：完全零設定啟動（`ls rwe.config.json` 確認不存在）+ 一個真實、永久不回應的
     TCP 端點（接受連線但永不回傳任何 byte，直接對它 `curl` 確認真的會無限期卡住）作為
     `ANTHROPIC_BASE_URL` 的路由目標——真實 `agent()` 呼叫在 5.2 秒內正確回傳 `result:null`、run
     進入 `completed`，從未卡住；另外直接對真實（未 mock）`composeConfig()`/
     `ClaudeAgentSdkGatewayClient` 程式碼確認零設定下解析出的 `timeoutMs` 確實是 `15000`
     （非 `undefined`），且對一個真的永久卡住的 session，逾時保底在 15014 毫秒真實觸發
     （`{ok:false,reason:'timeout'}`）。
  2. **子行程環境變數白名單（D-G8-5，安全性）— 本輪範圍：由回歸測試涵蓋 + 原始碼確認掛載點，未
     獨立重跑真實 process**：`gateway:"sdk"` 路徑產生的 `claude` CLI 子行程，其環境變數現在是明確
     白名單（`PATH`/`HOME`/`SHELL`/`LANG`/`LC_ALL`/`TMPDIR`/`TERM` + 覆寫過的
     `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`），不再是先前的「整個 `process.env` 原封不動傳入」
     ——避免執行本伺服器的主機上任何其他機密環境變數（如 `OPENAI_API_KEY`、雲端憑證）意外流入子
     行程。純子行程執行所需（PATH 解析執行檔、HOME 相依設定/快取路徑、locale/shell）之外的主機
     環境變數一律不會傳遞。`tests/unit/claude-agent-sdk-gateway-env-allowlist.test.ts` 綠燈；
     `src/gateway/claude-agent-sdk-client.ts` 原始碼確認 `buildSubprocessEnv()` 真的被
     `query()` 呼叫的 `options.env` 使用。
  3. **`workflow_agent_log` 真實訊息事件（D-G8-2）— CONFIRMED（第七輪真實驗證）**：`_drain` 先前只
     保留最終 `usage` 摘要、丟棄所有中間訊息；現在會擷取真實的 `message`/`tool_call`/`tool_result`
     事件。**真實驗證**：真實本機 Ollama（`local` 別名）的真實 `agent()` 呼叫，`workflow_agent_log`
     回傳真實 `"message"` 事件（`{"type":"text","text":"..."}`），不再只有 `"usage"`。
  4. **`tools/list` 真實 schema（D-G8-3）— CONFIRMED（第七輪真實驗證）**：見 §3 健康檢查說明；真實
     HTTP `tools/list` 回應對全部 10 個工具都有真實描述與真實 `inputSchema.properties`/`required`。
  5. **巢狀 resume callSeq 命名空間（D-G8-1，REQ-006）— 本輪範圍：由回歸測試涵蓋 + 原始碼確認掛載
     點，未獨立重跑真實 process**：`tests/integration/nested-workflow-callseq-resume.test.ts` 綠燈；
     `src/run-manager.ts`'s `_nestedCallSeq()` 原始碼確認真的在巢狀 `workflow()` 派送點被呼叫。
  6. **並行預算保留（D-G8-6，REQ-002）— 本輪範圍：由回歸測試涵蓋 + 原始碼確認掛載點，未獨立重跑
     真實 process**：`tests/integration/parallel-budget-concurrency.test.ts` 綠燈；
     `src/run-guard.ts`'s `reserve()`/`releaseReserved()` 原始碼確認真的在 `src/run-manager.ts`
     的 `_handleAgentRequest` 派送點同步呼叫（`assertBudget()`與`reserve()`之間無`await`）。

  完整證據（含真實指令、真實時間量測、真實 `curl`/`ps aux` 輸出）見
  `.sdlc/features/001-remote-workflow-engine/08-validation.md` 的「ROUND 7」章節。

- **v1.1 backlog（非 v1 REQ 範圍內的改善建議，不影響本輪 gate 判定）**：見
  `.sdlc/features/001-remote-workflow-engine/08-validation.md` 的「v1.1 backlog」章節——包含
  給中止的 agent 紀錄一個專屬終止狀態、拿更大的本機模型或付費供應商重測工具呼叫能力等項目。
  ~~修掉 `litellm` port 4000 碰撞風險~~ **已在 v2 TASK-027 解決**（orphan-reap + `litellmPort`
  設定鍵，見上方第 7/8 項與 §1b），不再是待辦項。

## §6b 標籤觸發式自動更新（v11 Sprint 2，REQ-068/069/070）

> **範圍：僅限 systemd 部署。** Docker Compose 部署需手動更新（`git pull` + `npm ci` + `npm run build` + 重啟容器），不使用本節機制。

### 概覽

特權分離架構：

```
GitHub → POST /github/webhook → 引擎（UNPRIVILEGED）
                                     │ HMAC-SHA256 驗簽（原始 body）
                                     │ delivery-id 去重
                                     │ upsert pending 結果列
                                     ↓
                              updateFlagPath（0600）
                                     │
                              deploy/rwe-update.path（PathExists=）
                                     ↓
                              deploy/rwe-update.service（PRIVILEGED）
                              └── deploy/rwe-update.sh
                                       │ flock + 消費旗標
                                       │ git fetch --tags（只接 RWE_OFFICIAL_REMOTE）
                                       │ 解析 tag→SHA（array-args，永不 shell-eval）
                                       │ git checkout <SHA>
                                       │ npm ci && npm run build
                                       │   ↓ 成功
                                       │ 寫 applied 結果（atomic）→ sync
                                       │ systemctl restart rwe
                                       │   ↓ 失敗（safe-fail）
                                       └─ 寫 failed 結果，中止（不重啟）
                                          服務繼續在舊版本上執行
```

### 步驟一：GitHub Webhook 設定

在 GitHub repo 的 **Settings → Webhooks → Add webhook** 頁面：

| 欄位 | 值 |
|------|----|
| **Payload URL** | `https://your-domain/github/webhook`（見步驟二反向代理） |
| **Content type** | **`application/json`**（⚠ HIGH：必須選此項——form-encoded body 雖然 HMAC 驗過，但 JSON parse 會失敗導致 tag 無法提取，等同靜默 no-op；絕對不要用預設的 `application/x-www-form-urlencoded`） |
| **Secret** | 隨機高熵字串（建議 32+ bytes hex），記下來（稍後設入環境變數） |
| **Which events would you like to trigger this webhook?** | 選 **Let me select individual events**，勾選：**Branch or tag creation** + **Pushes**（涵蓋 `create` + `push` 兩種事件類型，GitHub 推送 tag 時兩者皆會發送） |
| **Active** | ✓ |

### 步驟二：反向代理（只轉發 webhook 路由）

引擎綁定 `127.0.0.1`（loopback），外部流量由反向代理轉入。**只轉發 `POST /github/webhook`**，其餘路由不對外曝露：

```nginx
# nginx 範例
location = /github/webhook {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    # 不需改寫 X-Hub-Signature-256（HMAC 對原始 body 驗簽，代理不動 body）
}
# 其餘路由不反向代理到 rwe（僅 loopback 直連）
```

> **Host 白名單豁免**：`POST /github/webhook` 路由在 Host/Origin 白名單**之前**處理（HMAC 是此路由的認證，GitHub 傳入的 Host 是公網域名；白名單是對其他路由的 DNS-rebinding/CSRF 防護）。引擎程式碼確保此路由不受白名單影響。

### 步驟三：旗標與結果路徑（**必須在所有 workRoot 之外**）

建立一個引擎使用者可讀寫的目錄（權限 `0700`，**不在任何 `workRoot` 下**，否則啟動時報 `UPDATE_FLAG_INSIDE_WORKROOT`）：

```bash
mkdir -p ~/.local/share/rwe-flags
chmod 0700 ~/.local/share/rwe-flags
```

### 步驟四：設定環境變數與 rwe.config.json

在 `~/.config/rwe.env`（已被 systemd unit 的 `EnvironmentFile=` 讀入）加入：

```bash
RWE_SECRET_GITHUB_WEBHOOK_SECRET=<你在 GitHub 設的 Secret>
```

在 `rwe.config.json` 加入：

```json
{
  "updateFlagPath":   "/home/<user>/.local/share/rwe-flags/update.flag",
  "updateResultPath": "/home/<user>/.local/share/rwe-flags/update-result.json"
}
```

（`selfUpdateDbPath` 省略即用預設 `$workRoot/self-update.db`。）

### 步驟五：安裝特權更新 systemd 單元

> 特權 helper（`deploy/rwe-update.sh`）負責 git checkout + build + restart，須以有 `systemctl restart rwe` 權限的使用者執行。對 systemd user service 部署，`rwe-update.service` 作為 user service 即可（user service 可 `systemctl --user restart` 自己的服務）。

```bash
# 填入實際路徑後安裝
envsubst < deploy/rwe-update.path > ~/.config/systemd/user/rwe-update.path
envsubst < deploy/rwe-update.service > ~/.config/systemd/user/rwe-update.service
systemctl --user daemon-reload
systemctl --user enable rwe-update.path  # 讓 .path 在登入後自動監看

# 設定 helper 所需的環境變數（寫進 systemd unit 的 Environment 或 EnvironmentFile）
# 至少需要：
#   RWE_UPDATE_FLAG   = /home/<user>/.local/share/rwe-flags/update.flag
#   RWE_UPDATE_RESULT = /home/<user>/.local/share/rwe-flags/update-result.json
#   RWE_UPDATE_LOCK   = /home/<user>/.local/share/rwe-flags/update.lock
#   RWE_OFFICIAL_REMOTE = <git remote URL，只接受此來源的 tag>
```

`deploy/rwe-update.path` 使用 `PathExists=` + `PathChanged=`（**不**用 `PathModified=`，避免
只修改 metadata 的 rename 不觸發）監看旗標檔出現。`deploy/rwe-update.service` 為 `Type=oneshot`。

### 可觀測性

```bash
# 觀察最後一次更新的結果
curl -s http://localhost:8787/api/status | jq .lastUpdate
# 範例輸出（已 apply）：
# { "tag": "v1.5.0", "status": "applied", "ts": "2026-08-09T12:34:56Z" }
# 範例輸出（build 失敗）：
# { "tag": "v1.5.0", "status": "failed", "ts": "2026-08-09T12:35:10Z", "detail": "npm ci failed ..." }

# 觀察目前版本
curl -s http://localhost:8787/api/version
# { "version": "1.5.0" }  (或 git-describe 值)

# 儀表板 /dashboard 標頭區顯示更新面板（pending/applied/failed/skipped + tag）
```

### 已延後的強化項目（Deferred Hardening）

- **GPG 簽章驗證**：目前只驗 HMAC（GitHub 送來的 body 簽章），不驗 git tag 的 GPG 簽章（tag 可能由任何能推送 tag 的協作者建立）。
- **`npm ci --ignore-scripts`**：目前 `npm ci` 會執行套件的 `postinstall` 等 scripts，可能在 build 時執行任意程式碼；`--ignore-scripts` 可防此類攻擊（待有需要時加）。

### 單一實例上限（Single-Instance Ceiling）

本機制設計只支援**單一引擎實例**。多實例部署（多個 rwe 綁不同 port 共用同一 git 工作目錄）會造成 helper 在其中一個實例的 `systemctl restart rwe` 時中斷另一個，不在支援範圍內。多實例需求請用多套獨立部署（各自的 git clone + service unit + flag 路徑）。

## 附錄：辨識端點是 LiteLLM / vLLM / Ollama / 其他（`⭐ 情境配方` §0 引用）

> 對本部署**不影響做法**（一律當 OpenAI 相容端點用 `provider:"openai"` + `OPENAI_API_BASE` 接），
> 純供判斷對方在跑什麼。由能連到端點的機器執行，`BASE=http://那台:PORT`：

```bash
BASE=http://那台:PORT
curl -s $BASE/health/liveliness ; echo    # LiteLLM ⇒ "I'm alive!"（其他多半 404）
curl -s $BASE/version ; echo              # vLLM ⇒ {"version":"0.x.x"}
curl -s $BASE/api/version ; echo          # Ollama ⇒ {"version":"0.x.x"}（另有 /api/tags）
curl -s $BASE/v1/models | head -c 400     # 通用：看有哪些模型 id（右邊 aliases.model 就填這些）
# 最有力：真打一次，看『回應標頭』指紋
curl -s -D - -o /dev/null -X POST $BASE/v1/chat/completions \
  -H 'content-type: application/json' -H 'authorization: Bearer dummy' \
  -d '{"model":"<某個model>","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | grep -iE 'server:|x-litellm|x-vllm|openai-|via:'
```
- 回應標頭有 `x-litellm-*` ⇒ **LiteLLM**；`server: uvicorn` + 有 `/version` ⇒ **vLLM**；
  有 `/api/version` ⇒ **Ollama**；三個探針都 404 但 `/v1/chat/completions` 正常 ⇒ 其他直連
  OpenAI 相容 server（TGI/llama.cpp/LMDeploy…）。**只要最後那條 `/v1/chat/completions` 通，就能接。**

## §7 變更紀錄

| 日期 | 迭代 | 變更 | 遷移動作 |
|------|------|------|----------|
| 2026-07-03 | v1 | 初版上線：MCP server + workflow runtime + agent SDK + LiteLLM proxy + SQLite store | 全新安裝，見 §2 |
| 2026-07-04 | v2 | Dashboard（`GET /dashboard`）、asset sync（skill/MCP config 真實接入 agent session）、scheduler、client plugin、systemd unit、REQ-009 D-V2V-1 修復、D-V2G8-1/2 安全修復（bypassPermissions 移除、tool 白名單、key 隔離、workspace boundary realpath 封閉）、LiteLLM port 動態化（D-V3M-4）、孤兒 litellm 優雅關機（TASK-027） | `npm install`；複製 `rwe.config.example.json`→`rwe.config.json`，移除 `defaultAllowedTools:["Read","Write","Bash"]` 的 Bash（舊 example 有此鍵）；systemd unit 加 `PATH` 含 litellm venv bin/ |
| 2026-07-11 | v3 | workRoot 隔離保護（boot fail-fast WORKROOT_INSIDE_PROJECT）、預設工具面恢復含 Bash（D-V3M-3，fs jail 已存在）、MCP provisioning registry（`mcp_provision` + `${secret:NAME}` handle 機制）、hook 封鎖（HOOKS_UNSUPPORTED）、SDK gateway thinking disabled for non-Anthropic（D-F6）、SDK gateway timeout（val-023 2/2）、REQ-021 | 確認 `workRoot` 在任何 `.git`/`CLAUDE.md` 祖先之外；`export RWE_SECRET_<NAME>=<value>` 注入 secret；`rwe.config.json` 的 `defaultAllowedTools` 改為 `["Read","Write","Edit","Glob","Grep","Bash"]` |
| 2026-07-18 | v3 | Gate 7.5 v3 ROUND 1 PASSED：REQ-016..021 全部真實驗證（VAL-025..030）；`RWE_SECRET_<NAME>` 加入文件 env var 表；README tool 清單更新為 22 個工具 | 無破壞性變更，無遷移必要 |
| 2026-07-30 | v8 | Slice 1：具名 `workflow()` 巢狀升級為 N 層 composition（原本只允許 1 層 → `NESTING_ERROR`）；新增設定鍵 `maxWorkflowDepth`（預設 4）/`maxWorkflowDescendants`（預設 256），啟動時驗證 ≤0/非整數；新增守衛 `NESTING_DEPTH_EXCEEDED`/`NESTING_CYCLE`/`DESCENDANT_CAP_EXCEEDED`（皆為 envelope 錯誤，不崩父 run）；巢狀 journal callSeq 改為 additive frame-based keying（修掉舊乘法式 `(parentCallSeq+1)*1e6+n` 在 ~depth 2 之後溢出 `MAX_SAFE_INTEGER` 的問題，resume 重播確定性不變）。Gate 7.5 v8 Slice 1 ROUND 1 PASSED（VAL-050..053） | 無破壞性變更；兩個新鍵皆選填、有預設值，一般部署可省略；巢狀行為向後相容（單層組合結果不變） |
| 2026-07-30 | v8 | Slice 2（dashboard 資料層第一增量）：`workflow_status`／`GET /api/runs/:id` 現在多回傳 composite 呼叫樹的兩個結構欄位——每個 agent 記錄帶 `frame`（所在的巢狀 frame；頂層 script `""`，巢狀 `workflow()` 內的 agent frame 以其父 frame 為嚴格前綴），以及 `workflowNodes: [{frame,name,parentFrame,depth}]`（每次巢狀 `workflow(name)` 呼叫一個節點）。用戶端只憑這兩者即可重建整棵呼叫樹（依 `frame` 分組 agent、依 `parentFrame` 巢狀 frame），並用既有的 `workflow_agent_log(runId, agentId)` 下鑽到每個節點的 transcript。Gate 7.5 v8 Slice 2 ROUND 1 PASSED（VAL-054..056）。**尚未支援**：跨重啟的樹持久化（重啟後 `workflowNodes` 回傳 `[]`；活動中的樹在行程內記憶體）、parallel-group 標記、phase 持久化/current-step/計時 | 無破壞性變更；`workflowNodes` 為新增欄位、`frame` 為選填欄位，既有用戶端可忽略；無新設定鍵、無遷移動作 |
| 2026-07-31 | v8 | Slice 3（儀表板 UI：卡片 → 即時 DAG → agent log）：`GET /dashboard` 首頁列出已註冊工作流程卡片與 run 卡片；新增唯讀端點 `GET /api/workflows`（已註冊工作流程目錄）與 `GET /api/runs/:id/dag`（後端純函式 `buildDagModel` 依 Slice-2 的 `frame`/`workflowNodes` 重建呼叫樹）；重寫自成一體的 SPA（`src/dashboard-page.ts`）——run 詳情頁把 DAG 渲染成巢狀樹（composite 子工作流程為帶標題群組、agent 節點依 3 態上色並顯示 model，點擊下鑽 transcript），3 秒輪詢。修掉一個路由缺口：頂層 router 原本只 match `/api/runs*`，`/api/workflows` 會掉進 `/mcp` handler 回 `-32601`——已把 dispatch 條件擴到也 match `/api/workflows`（Gate 7.5 真跑抓到、IT-048 回歸鎖定）。Gate 7.5 v8 Slice 3 ROUND 1 PASSED（headless browser 實測，VAL-057/058）。**尚未支援**：SSE（維持 3 秒輪詢）、parallel-group 標記、phase 持久化/current-step/計時、樹的靜態預讀+快取、跨重啟樹持久化 | 無破壞性變更；兩個新端點皆唯讀、與 `/mcp` 共用同一 port/server；無新設定鍵、無遷移動作 |
| 2026-07-31 | v8 | Slice 2b（即時執行細節：phase 時間軸 + 每個 agent 的耗時）：`workflow_status`／`GET /api/runs/:id` 現在讓每個 `phases[]` 項目帶 `ts`（進入 `phase()` 的 ISO 時間，依序、非遞減；`running` 時最後一個為目前步驟），每個 agent 記錄帶 `startedAt`（派工/取得並行槽的時間）與 `endedAt`（結束時間，`endedAt ≥ startedAt`）；`GET /api/runs/:id/dag` 的 agent 節點導出 `durationMs`（未完成為 `undefined`）；`/dashboard/<runId>` 詳情頁渲染 phase 時間軸（chip + `ts` tooltip + 目前步驟標記）與每個 agent 節點的 `<n> ms` 耗時。純讀模型/可觀測性擴充，無執行語意變更（沿用既有 `Clock`/`markRunning`/`capture` seam）。Gate 7.5 v8 Slice 2b ROUND 1 PASSED（真實 opus agent 實測 `5325 ms`，VAL-059/060）。**尚未支援**：parallel-group 標記、跨重啟 phase/樹持久化、SSE、樹的靜態預讀+快取 | 無破壞性變更；`PhaseView.ts`/`AgentRecord.startedAt`/`endedAt` 為新增欄位，既有用戶端可忽略；無新端點、無新設定鍵、無遷移動作 |
| 2026-08-01 | v8 | Slice 4（跨觸發串接 + run-admission）：新增權威的 `onTerminal(runId,status)` hook（自單一 `_transition` 觸發、fire-and-forget、涵蓋 `stopped`）+ `maxConcurrentRuns` 並行上限（預設 64，啟動驗證，`start()` 於任何持久化動作前以 `RUN_ADMISSION_LIMIT` 把關，巢狀 `workflow()` 不佔槽）；新增引擎自有的持久化續接 side table `ContinuationStore`（SQLite+WAL，作法同 scheduler）+ 兩個 MCP 工具 `chain_create`／`chain_list`（完成即啟動下游 run，恰好一次；failed/stopped→skipped；`CHAIN_TARGET_NOT_FOUND`；跨重啟 boot reconcile；`rootRunId` 世系；stop→resume→complete 只啟動一次）；新設定鍵 `maxConcurrentRuns`（預設 64）/`continuationDbPath`（預設 `$workRoot/continuations.db`）。Gate 7.5 v8 Slice 4 ROUND 1 PASSED（真實 service 30 tools、真串接執行 + in-flight onTerminal 實測，VAL-061/062/063）。**尚未支援**：外部 ingress 安全（Defer B）、跨重啟 in-flight 呼叫樹 suspend/resume（Defer A） | 無破壞性變更；兩個新鍵皆選填、有預設值，一般部署可省略；兩個新工具為附加、既有用戶端可忽略；無遷移動作 |
| 2026-08-01 | v8 | Slice 2c（跨重啟 DAG 持久化）：引擎在權威的終態 `_transition`（涵蓋 `completed`/`failed`/`stopped`）一次性寫入一份 DAG 快照（`phases` + `workflowNodes` + 完整 agent 記錄含 `label`/`phase`/`frame`/`startedAt`/`endedAt`）到引擎自有的 migration-free side table `run_snapshots`（在 `$workRoot/store/index.db`），`getRun` 讀回時 overlay——修掉「重啟後 composite run 的巢狀 DAG/phases 攤平（`phases:[]`/`workflowNodes:[]`、agent 失去 frame）」的真實資料遺失；`buildDagModel` 重啟後能重建同一棵巢狀樹。向後相容：無快照的舊 run 仍以既有方式重建、不會更差不會崩。Gate 7.5 v8 Slice 2c ROUND 1 PASSED（真實 service 重啟後 DAG 不攤平實測，VAL-064）。**尚未支援**：SSE（Item B）、parallel-group 標記（Item C，需 sandbox-IPC）、靜態預讀+快取（Item D） | 無破壞性變更；無新設定鍵（快照存於既有 `$workRoot/store/index.db` 的新 side table，migration-free）；既有用戶端可忽略；無遷移動作 |
| 2026-08-01 | v8 | Defer B（外部 ingress 安全，OIDC 前過渡管控）：HTTP handler 最頂端對每條路由（`/mcp`/`/api/*`/`/dashboard`/`/hooks/*`）一致的 **Host/Origin 白名單**（外來 Host → 403 防 DNS-rebinding；帶有且非白名單 Origin → 403 防 CSRF；缺 Origin 放行 = fail-open，不打斷程式化 client）；新增 **webhook 入口 `POST /hooks/:id`**（fail-closed：exists+enabled → HMAC-SHA256 常數時間比對原始 body → ±300s 時戳 → deliveryId 去重 → 啟動預先綁定工作流程，body 以 `args.event` 傳入，回 202）；新增三個 MCP 工具 `webhook_create`（server 端產生 secret 只回一次）/`webhook_list`（只回 sha256 指紋，永不回 secret）/`webhook_delete`；新增引擎自有的持久化 webhook 註冊表 side table（`webhooks` + `webhook_deliveries`）+ 新設定鍵 `webhookDbPath`（預設 `$workRoot/webhooks.db`）。secret 為明文儲存（HMAC 驗簽需金鑰，同 GitHub/Stripe 模型）。Gate 7.5 v8 Defer B ROUND 1 PASSED（真實 service 33 tools、`Host: evil` → 403、`Origin: evil` POST /mcp → 403、簽章 `POST /hooks/:id` → 202 真跑、重放 → 200 不重跑，VAL-065/066/067）。**已知注意事項**：公開 `0.0.0.0` bind 且未接 OIDC（REQ-012，D5 延後）時，能連到 port 的人皆可呼叫這些工具——白名單是過渡管控、非 OIDC 替代 | 無破壞性變更；`webhookDbPath` 選填有預設值、一般部署可省略；三個新工具為附加、既有用戶端可忽略；Host/Origin 白名單永遠開啟且對正常 loopback/LAN 呼叫無影響（缺 Origin fail-open）；無遷移動作 |
| 2026-08-01 | v8 | Defer A（當機可續跑，crash durability，Option X）：**一個當機/重啟時仍 `running` 的 run 現在會被重新分類為 `interrupted`（可續跑、非終態）而非永久 `failed`**——開機恢復（`hydrateAll`）改標 `running`→`interrupted`（日誌印 `… N re-classified running→interrupted (resumable)`），`workflow_status` 回 `interrupted`，`workflow_resume(runId)` 即可續跑；`RunStatus` union 新增 `'interrupted'`。新增 `RunStore.getJournal` 讀回 journal.jsonl（丟棄 `{type:'result'}` 標記、對當機截斷的最後一行容錯），`_requireLive` 用它填入 ResumeCache——**續跑時已結算的 `agent()`/`workflow()` 呼叫從持久化日誌重播、gateway 不重打**，只重跑未完成尾段（原本 hard-code `journal:[]` 會全部重跑）。同時修掉一個**既有 bug**：具名工作流程（`start({name})`）的 spec 不存 inline script，`_requireLive` 舊用 `spec.script ?? ''` 會跑空 script 回 `undefined`——改為和 `start()` 一樣從 catalog 重解析 script（影響所有具名工作流程的重啟續跑，非只當機）。Option X：重用既有 ResumeCache/日誌重播，**無**新的 sandbox checkpoint/VM snapshot 協定。Gate 7.5 v8 Defer A ROUND 1 PASSED（真實 service：具名 5 圈 opus loop 工作流程執行中 `kill -9`、systemd 重啟後 `workflow_status` 回 `interrupted`、`workflow_resume` 續跑至 `completed` 回 5 元素真實 opus 陣列，VAL-068/069）。**已知注意事項**：當機瞬間飛行中（已派發未寫日誌）的呼叫續跑時會真的重跑（cache MISS，與 suspend/resume 同語意）；非冪等副作用可能重複，由工作流程作者負責冪等性 | 無破壞性變更；`interrupted` 為 `RunStatus` 新增值、既有用戶端遇到時視為可續跑狀態即可；無新設定鍵、無遷移動作（journal.jsonl 與 SQLite `runs` 表沿用既有格式） |
| 2026-08-01 | v9 | 工作流程探索 / 重用決策（workflow discovery，REQ-061/062）：在重用一個已註冊工作流程（或決定另寫新的）之前，不必執行、也不必讀 script 即可查其**用途**與**形狀**。（用途，REQ-061）`workflow_list` 現在每筆多回傳 `description`（由工作流程的 `export const meta.description` 隨查即時解析，永遠與現行 script 同步、無需 migration）；新增 MCP 工具 **`workflow_get({name})`**——回傳完整 `{name, version, createdAt, description, phases, script, skeleton}`，未知名稱回 `WORKFLOW_NOT_FOUND`（envelope，不丟例外）；無 meta/無 description 者退化為空字串、非錯誤。（形狀，REQ-062）`workflow_get.skeleton` 與新端點 **`GET /api/workflows/:name/skeleton`** 回傳一份**預測的靜態 DAG 骨架**——純靜態掃描 script 的 `phase()`/`agent()`/`parallel()`/`workflow()` 呼叫，依序列出節點（parallel 群組 id、子工作流程名稱），loop/conditional 內的節點標 `dynamic:true`（best-effort，因真實形狀只在執行期決定）；掃描**從不執行 script、不丟例外**。儀表板工作流程卡片現在顯示 description 且可點擊 → 渲染預測 DAG（parallel group 群組、`×? (dynamic)` 標記、description 作為用途文字）。Gate 7.5 v9 ROUND 1 PASSED（真實 service 重啟：註冊 `disc-demo`、`workflow_list` 回 description、`workflow_get` 回 description+phases+skeleton `[agent(parallel:1), agent(parallel:1), agent, workflow:notify]`、Playwright headless 儀表板卡片點擊 → 預測 DAG，VAL-070/071）。**尚未支援（沿用 v8，未變）**：SSE、RUN dag 的 parallel-group 標記（需 sandbox-IPC；此處是 STATIC 骨架有帶 parallel 群組，但即時執行的 DAG 仍未帶）、OIDC（REQ-012，D5） | 無破壞性變更；`workflow_get` 為新增工具、`GET /api/workflows/:name/skeleton` 為新增唯讀端點、`workflow_list` 的 `description` 為新增欄位（既有用戶端可忽略）；無新設定鍵、無遷移動作（description 隨查即時解析、非儲存欄位） |
| 2026-08-01 | v10 | 高效大型程式庫 seeding 切片 1（壓縮請求體 + 具型別過大錯誤，REQ-063）：`/mcp` 請求體現在接受 `Content-Encoding: gzip\|deflate`——可壓縮程式碼 seed/asset payload（約壓 3–5×）得以塞進 8 MiB body cap 之下；解壓有**雙重上限**（壓縮輸入 `MAX_BODY_BYTES` 8 MiB + 解壓輸出 `MAX_DECOMPRESSED_BYTES` 8×），gzip bomb 在解壓途中被擋、不會 OOM；無 `Content-Encoding` 的 body 行為與以往完全相同。超過任一上限時回傳**具型別 413**：`{code:'BODY_TOO_LARGE', cap, phase:'compressed'\|'decompressed', hint}`（hint 指明用 gzip 壓縮或拆分）。webhook `POST /hooks/:id` 仍讀**原始** body（HMAC 對交付位元組驗簽、不可自動解壓），僅同樣改回具型別 413。（`readBody` 拆成 raw 的 `readBodyBuffer` + 解碼的 `readBodyDecoded`。）Gate 7.5 v10 ROUND 1 PASSED（真實 service：gzip `tools/list` 解碼 34 tools、超大未壓縮 body → 413 `{code:'BODY_TOO_LARGE', cap:8388608, hint:…}`，VAL-072） | 無破壞性變更；無新設定鍵；只影響 HTTP body 讀取層與兩處 413 catch，無工具 payload 形狀變更；無遷移動作 |
| 2026-08-01 | v10 | 高效大型程式庫 seeding 切片 2（CAS 基座，REQ-064/065）：新增內容定址 blob 儲存庫 `CasStore`（不可變 blob pool `blobs/<sha[0:2]>/<sha>` + SQLite per-namespace refset）與兩個 MCP 工具 **`blob_put{namespace, sha256, contentB64}`**（byte-verify、以**計算出的** hash 存放絕不用宣稱值 → 關 hash-poisoning + confused-deputy；claim 不符 → `BLOB_HASH_MISMATCH` 不存任何東西；immutable、idempotent）與 **`seed_plan{namespace, manifest}`** → `{missing:[sha256…]}`（per-namespace、非全域存在性 → 關跨租戶 dedup oracle）。`workflow_run` 新增 **`seedManifest:[{path, sha256, exec?}]`** + `seedNamespace`——引擎以 hash 從 CAS 讀 bytes、透過與 `materializeSeed` **相同**的 per-path 守衛（`.claude` strip/`.git` reject/realpath-contained，抽出共用 `seedPathVerdict`）組裝工作區，`exec?` 套用遮罩執行位元（`0o755`/`0o644`；僅一般檔案、永不支援 symlink/mode int）；`seedManifest` 參照到未上傳 blob → 於任何持久化動作前以 **`MISSING_BLOBS`** fail-fast（不建 run row）。順帶修掉一個**既有 bug**：`toErrEnvelope` 舊回 Error name，導致 run-manager 的 coded error（`RUN_ADMISSION_LIMIT`/`NESTING_*`/新的 `MISSING_BLOBS`）透過 `workflow_run` 都變成無用的 `'Error'`——改為優先取 `.code`。新增設定鍵 `casDir`（預設 `$workRoot/cas`）。Gate 7.5 v10 ROUND 1 PASSED（真實 service 36 tools：blob 上傳 namespace `liveproj`、`seed_plan` 2→0 missing、`workflow_run` seedManifest 組裝出 byte-identical 工作區、on-disk 模式 `0755`(`exec:true`)/`0644`(`exec:false`)、未上傳 blob → `MISSING_BLOBS`，VAL-073/074）。**尚未支援（後續增量，見 `docs/seed-sync-architecture.md` roadmap）**：raw-streaming blob 端點 `POST /assets/blob/<sha256>`（免 base64、免 8 MiB cap）、per-tenant quota + immutable-pool GC、client `push_workspace.py`（git 作 client 端 stat-cache）+ `rwe seed` CLI、`seedRef` engine-pull | 無破壞性變更；`casDir` 選填有預設值、一般部署可省略；`workflow_run` 新欄位為選填、兩個新工具為附加，既有用戶端可忽略；inline `{path,contentB64}` seed 與 `asset_push` 不受影響；無遷移動作 |
| 2026-08-09 | v11 | issue 可觀測性（REQ-066/067）：`issue_report` 新增 `version` 欄位（caller 可覆寫；省略時引擎自動填入 `pkg.version + git-describe`，保證非空），Environment 區塊五個欄位（repro/version/severity/analysis/log）一律渲染、缺席欄位填 `_none_` placeholder。新增唯讀 API `GET /api/issues`（`{open:[...],resolved:[...]}` 依 `agent-reported` label + state 分組）、`GET /api/issues/:number`（完整 IssueView）；無 token → HTTP 200 `{degraded}` 而非 500。`GET /dashboard/issues` 新增 Issues 頁面（Open/Resolved 分組 + 點擊顯示 detail，所有遠端內容以 textContent 渲染，XSS 安全）。引擎 `ENGINE_VERSION` 常數改由 `resolveEngineVersion()` 動態計算（`initialize` response 的 `serverInfo.version` 現在回真實版本串，含 git-describe）。Gate 7.5 v11 ROUND 1 PASSED（VAL-075/076，real:true；issues #7/#8 真實 filed + body 驗證，已 close） | 無設定檔變更；`RWE_SECRET_GITHUB_TOKEN` 為既有 secret store 鍵、已在本版 §1b 設定總表補上文件行；無遷移動作 |
| 2026-08-10 | v11 FIX-MODE | 首頁工作流程卡片（REQ-074/075）：`GET /api/home` 新端點回傳 `{running:[],registered:[],other:[]}` 三組 `WorkflowCard[]`（依 ACTIVE_STATUSES 分組）；每張卡片帶 description、`metrics:{successRate,avgDurationMs,terminalCount}`（4 completed+1 failed → `successRate:0.8`；零 run → `null`，永不 NaN）。`buildHomeView`/`computeWorkflowMetrics` 純函式；`RunSummary.terminalAt?` 累積式欄位（DES-071 向後相容：前版 run 缺此欄 → `avgDurationMs` 為 null，非 NaN）。儀表板首頁渲染 `renderHomeGroup`/`renderMiniSkeletonAsync`/`fmtMetric`（null→'—'）。Gate 7.5 v11 FIX-MODE PASSED（VAL-083/084 real:true；接受測試 5/5；回歸 838/838） | 無設定檔變更；無遷移動作；`GET /api/home` 為新增唯讀端點、既有用戶端可忽略 |
| 2026-08-09 | v11 Sprint 2 | 標籤觸發式特權分離自動更新（REQ-068/069/070）：新增 `POST /github/webhook` 路由（Host 白名單豁免，HMAC-SHA256 對**原始 body bytes** 驗簽，delivery-id 去重）在收到已驗簽 tag create/push 事件後原子寫入更新旗標（mode 0600）並回 202；無 secret+flagPath → 503 `UPDATE_WEBHOOK_UNCONFIGURED`；新增 `deploy/rwe-update.sh`（特權 bash helper：flock+消費旗標 → git fetch + resolve tag SHA → checkout → npm ci + npm run build，safe-fail 在 **restart 之前**中止，寫 `applied`/`failed` 結果 JSON，exit code 0/10/20/30/40）+ `deploy/rwe-update.path`（PathExists= + PathChanged=）+ `deploy/rwe-update.service`（Type=oneshot）；新增 `GET /api/version` 端點（`{version}`，重用 `resolveEngineVersion()`）；`GET /api/status` 新增 `version`、`lastUpdate?: UpdateOutcome`（boot 時讀取 + `/api/status` 懶惰讀取，stale-tag guard：pending 列只被同 tag 的 result 覆寫）、`interruptedRuns?`；`GET /dashboard` 伺服器端注入更新面板（textContent-only，XSS 安全）；`src/update-types.ts` 為共享合約（`UpdateStatus: pending|applied|failed|skipped` + `UpdateOutcome`）；boot guard `assertUpdatePathsOutsideWorkRoot`（旗標/結果路徑必須在所有 `workRoot` 之外，否則 `UPDATE_FLAG_INSIDE_WORKROOT`）。新設定鍵：`updateFlagPath` / `updateResultPath` / `selfUpdateDbPath`（預設 `$workRoot/self-update.db`）。新環境變數：`RWE_SECRET_GITHUB_WEBHOOK_SECRET`（缺少時功能停用）。**Content-type HIGH：GitHub Webhook 必須設 `application/json`，否則 tag 提取靜默 no-op**。Gate 7.5 v11 Sprint 2 **PASSED**（VAL-077/078/079 real:true）。**活體驗證**(真 tsx 引擎行程 + 真 git,非 mock)：`POST /github/webhook` 真 HMAC → 202 + 0600 旗標、錯簽 401、重播 200、非 tag 200；真 helper checkout 新 tag → **真 `npm run build`(tsc)** → `applied` + `systemctl restart`；build 失敗 → **還原到先前 SHA** + 不 restart + `failed`；從 tag checkout 啟動的引擎 `/api/version` 回該 tag。**兩個活體才抓到並已修的整合缺口**：(1) `composeConfig`(production 入口)未透傳 `updateFlagPath`/`updateResultPath`/`selfUpdateDbPath` → 真實部署 webhook 路由本會永遠 503(built-but-unwired,已加 3 個透傳測試);(2) 本專案無 `build` script(tsx 直跑)→ helper 的 `npm run build` 本必失敗,已加 `"build": "tsc --noEmit"`(型別把關兼 safe-fail 訊號) | 新設定鍵全部選填、有預設值；缺少 secret + flagPath 時整條路由 503 降級，不影響其他功能；`GET /api/status` 新欄位向後相容（既有用戶端可忽略）；需安裝 `deploy/rwe-update.{path,service}` systemd 單元才啟用自動更新（見 §6b）；無遷移動作 |
| 2026-08-11 | v11 | 自我更新觸發源改為 GitHub `release`（published）事件，取代原本的 tag `create` 事件——部署管線改為**嚴格串行**：push tag → `release.yml` CI（typecheck + 全套）→ 綠 → `gh release create` 發布 Release → `release` webhook → 才自我更新（附自身 test-gate）→ restart。CI 紅 ⇒ 不發布 Release ⇒ 不更新（原本 release CI 與自我更新皆綁同一 tag push、並行執行）。`extractTag` 新增 `release` 分支，只在 `action === 'published'` 且 `prerelease !== true` 時 arm（發布一個正式 release 會觸發 `created`/`published`/`released` 多筆投遞，只認 `published` → 恰好 arm 一次；pre-release `vX.Y.Z-rc1` 雖通過 TAG_PATTERN 但永不自動上 prod）。GitHub webhook（id 664074853）訂閱事件由 `["create"]` 改為 `["release"]`。 | 無破壞性變更；`create`/`push` 事件處理保留（無害），移除並行的關鍵是 webhook 訂閱由 `create` 翻成 `release`（已於本次 rollout 一次性完成）；無新設定鍵、無遷移動作 |
| 2026-08-13 | v11 | agent-reported issue 修復兩則。**#21**：`workflow_run` 的 MCP `inputSchema` 原本只宣告 `{name,script,args,budget}`、漏了 `seed`/`seedManifest`/`seedNamespace`，schema-validating client 把陣列字串化 → `run-manager` 對字串 `.map` 爆 `TypeError` → CAS seeding（`blob_put`→`seed_plan`→`seedManifest`）經 MCP 完全不能用。修：三參數補進 schema（含 element schema）+ 修 dispatch cast 型別謊言 + `run-manager` 加 typed `INVALID_SEED_SPEC` guard（拒非陣列、不再裸 TypeError）。**#20**：run 進行中 `workflow_status` 的 agent record 一路 `model:""`/`provider:""`/`tokens:0/0`，正常 agent 與掛住 agent 無法區分。修：`HarnessDescriptor` 加 `provider`;gateway 建 session 時（onHarness，首 token 前）經新的 `AgentTranscriptSink.markHarness` 把 model/provider 即時蓋到 live record（merge、不覆蓋 state/startedAt）;`capture()` 的 failed 分支不再把 model 抹成 `''`（保留驗屍用）;`deriveAgentRecords`（重啟路徑）也從 harness descriptor 讀 provider（舊 transcript 缺則退 `unknown`）。 | 無破壞性變更；`HarnessDescriptor.provider` 為新增欄位（redactHarness 一律填、預設空字串）、既有用戶端可忽略;`INVALID_SEED_SPEC` 為新 error code;無新設定鍵、無遷移動作 |
| 2026-08-13 | v11 | **#24** MCP schema 自描述:光靠 tool schema 無法 author/run workflow(script DSL、`agent()` 選項面、model-string join 規則、budget 語意全無文件)。修(純 description 充實,無新工具、無邏輯變更):`workflow_run.script`+`workflow_register.script` description 加共用 `SCRIPT_DSL_DOC`——注入 globals(`args`/`budget`/`agent()`/`parallel()`/`pipeline()`/`phase()`/`workflow()`)、`agent()` 選項面(含 `effort` enum)、model-string 規則(用 alias 或 `provider+'/'+model`)、return 契約、`meta` 為**選填**(裸 `agent()` script 可跑)、最小範例;`budget` description 補語意(input+output token 共享 pool、agent() 呼叫間檢查、首次超額仍跑完);`workflow_run` description 改為回 envelope `{runId,status,result}`;`models_list` description 加 model-string join 規則。**未做(out of scope)**:caller-settable `timeout` 參數(屬 #22 硬化,新功能非文件)、獨立 `dsl_reference` 工具(description 實戰不足才做)。 | 無破壞性變更;純 tool description 文字變更(每次 tools/list 多帶一段 DSL 契約 token);無新設定鍵、無新工具、無遷移動作 |
