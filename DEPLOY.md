# 部署 / 維運手冊 — remote-workflow-engine

> 人類導向文件（繁體中文）。本文件描述系統**目前**的部署方式與行為——不是變更歷程；每次迭代都會
> 整份改寫成當下事實。歷史紀錄只在 `.sdlc/` 追溯帳本內（`journal.md`、`08-validation.md`），不在
> 這份手冊裡。完整真實層驗證證據見
> `.sdlc/features/001-remote-workflow-engine/08-validation.md`。

這是一個可遠端操控的 **Claude 工作流程執行引擎**：一台常駐伺服器，透過 **MCP Streamable HTTP**
介面對外提供 **35 個工具**（`workflow_*` 7、`run_*` 8、`workspace_*` 6、`schedule_*` 4、`webhook_*` 3、
`issue_*` 5、`models_list`/`system_info`），並把每個 `agent()` 呼叫路由到你設定的 LLM 供應商
（Anthropic / OpenAI / Gemini / 本機 Ollama）。狀態全存在本機檔案（SQLite + JSONL journal），
不需要外部資料庫伺服器。**權威工具清單是 `src/tool-specs.ts`**——不在那張表上的名字，引擎一律回
JSON-RPC `-32601 Unknown tool`。

OAuth 2.0（opt-in，`auth.enabled:true`）：引擎自身即授權伺服器，以 Google 為 IdP，支援
RFC 7591 動態用戶端註冊、authorization-code + PKCE、OAuth2 `state`/`iss` round-trip（RFC 6749
§4.1.2 / RFC 9207）、refresh token 輪換（RFC 9700 single-use rotation）、工作流程擁有權、
per-run principal attribution、D-BIND fail-closed（非 loopback 來源無有效 bearer → 401）。
完整鍵值見下方 §1b 設定總表。


## §0 一鍵部署 One-command Deploy

**在一個乾淨的 git checkout 目錄下，這一條指令會把服務跑起來並自我驗證**（安裝依賴 → 準備設定檔 →
啟動 → 健康檢查）：

```bash
./deploy.sh --background
```

無法自動化的步驟（例如系統缺 `uv`）會讓腳本停下並印出明確的下一步指示，不會用猜的。冪等：已存在的
`rwe.config.json` 與 litellm venv 不會被覆蓋或重建，可重複執行。實際跑過的輸出：

```
== 步驟 1/5：安裝 Node 依賴 (npm install) ==
== 步驟 2/5：確認設定檔 (rwe.config.json) ==
已從 rwe.config.example.json 建立 rwe.config.json — 請視需要編輯 workRoot / aliases。
首次部署且未指定 RWE_WORK_ROOT：改用非 root 可寫的預設路徑 ~/.local/share/remote-workflow-engine
（如需自訂，設定環境變數 RWE_WORK_ROOT 或編輯 rwe.config.json 的 workRoot 後重跑）。
== 步驟 3/5：確認 LiteLLM Python venv (gateway:"sdk" 需要) ==
litellm 已存在於 ~/.rwe-litellm-venv/bin/litellm，略過建立。
== 步驟 4/5：啟動服務 (RWE_BIND=127.0.0.1 RWE_PORT=8787) ==
啟動中，PID=xxxxx，log 在 .rwe.log
== 步驟 5/5：健康檢查 (等待 /api/status 回應) ==
健康檢查通過：
{"agentSemaphore":{"total":32,"inUse":0,"queued":0},"version":"0.1.0 (...)"}
部署完成。服務位址：http://127.0.0.1:8787/mcp
背景模式：服務持續在背景執行（PID=xxxxx）。停止：kill $(cat .rwe.pid)
```

同一台機器要跑第二個實例（例如驗證用），用 `RWE_BIND` / `RWE_PORT` / `RWE_CONFIG_PATH` 覆蓋即可，
腳本本身不變（三個鍵的說明見 §1b）：

```bash
RWE_CONFIG_PATH=/path/to/another/rwe.config.json RWE_BIND=127.0.0.1 RWE_PORT=8792 ./deploy.sh --background
```

系統概觀：

```
     curl / MCP client                              agent() 呼叫
              │                                            │
              ▼                                            ▼
   ┌─────────────────────┐                    ┌──────────────────────┐
   │  remote-workflow-   │───────────────────▶│  LiteLLM proxy 子行程 │
   │  engine (Node,      │       spawn        │  （gateway:"sdk" 預設）│
   │  MCP Streamable HTTP)│◀──────────────────│                      │
   └─────────┬───────────┘        結果        └──────────┬───────────┘
             │                                            │
             ▼                                            ▼
   本機檔案：SQLite + JSONL journal             Anthropic / OpenAI / Gemini
   （$workRoot/store、run 工作目錄、           / 本機 Ollama
     資產樹、每個版本的 mermaid 圖）
```
（`workflow_register` 不經過 gateway：結構圖由作者自己附上 `mermaid`，引擎不畫圖；
LiteLLM 只服務 `agent()` 這一個消費者。）

停止服務：`kill $(cat .rwe.pid)`。不加 `--background` 則前景執行、Ctrl-C 停止。

⚠ `.rwe.pid` 與 `.rwe.log` 都寫在 **這個 checkout 的根目錄**：從同一個 checkout 再跑一次
`./deploy.sh --background`（例如上面的第二個實例）會把前一個實例的 PID 檔與 log **覆蓋掉**。要同時
跑多個實例，啟動後先把 `.rwe.pid` 複製到別處（`cp .rwe.pid /path/to/instance-A.pid`），停止時用
那份；log 則各自看 `ps`／process manager 的輸出。

### 展開版 Quickstart（逐步、每步都有預期輸出）

`deploy.sh` 內部就是以下步驟；需要客製設定或除錯時可逐步手動執行：

```bash
# 步驟 1：安裝 Node 依賴
npm install
# 預期：node_modules/ 建立，無錯誤

# 步驟 2：型別檢查（健檢，非啟動必需）
npm run typecheck
# 預期：無輸出（clean）

# 步驟 3：建立 LiteLLM Python venv（一次性，gateway:"sdk" 需要；純工作流程邏輯不呼叫
# agent() 可略過）
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv python install 3.12
uv venv --python 3.12 ~/.rwe-litellm-venv
uv pip install --python ~/.rwe-litellm-venv/bin/python "litellm[proxy]"
# 預期：Successfully installed litellm...

# 步驟 4：複製設定檔並設定 workRoot（必須在任何 .git/CLAUDE.md 祖先之外，見下方
# 「workRoot 隔離」）
cp rwe.config.example.json rwe.config.json
# 設定 workRoot 為 repo 外的絕對路徑，例：/home/<user>/.local/share/rwe-data
# （deploy.sh 走一鍵路徑時，若是全新設定檔且未指定 RWE_WORK_ROOT，會自動用這個非 root
#   可寫的預設路徑，不需手動編輯；這裡列出是給手動逐步部署或想自訂路徑的人看）
# 設定 aliases 指向你的供應商/模型（見 §1b 設定總表 aliases 行）

# 步驟 5：設定環境變數（每個鍵的用途見 §1b 設定總表）
export PATH="$HOME/.rwe-litellm-venv/bin:$PATH"   # litellm 必須在 PATH 上
export ANTHROPIC_API_KEY=sk-ant-...               # 或其他供應商 key
# export RWE_SECRET_GITHUB_TOKEN=ghp_...          # issue_report/Issues 儀表板需要

# 步驟 6：啟動
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
# 預期：{"agentSemaphore":{"total":32,"inUse":0,"queued":0},"version":"0.1.0 (<git describe>)"}

curl -s -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print('tools:', len(d['result']['tools']))"
# 預期：tools: 35

# 主機系統資源快照（第一次呼叫 utilizationPct=null；第二次有值）
curl -s http://localhost:8787/api/system | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print('cpu cores:', d['cpu']['cores'], '/ mem usedPct:', round(d['memory']['usedPct'],1))"
# 預期：cpu cores: N / mem usedPct: X.X

# 統一模型目錄
curl -s http://localhost:8787/api/models | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print('models:', len(d), '/ first:', d[0]['provider']+'/'+d[0]['model'])"
# 預期：models: N / first: ollama/...（或 anthropic/...，依 aliases）
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
>   "workRoot": "/var/lib/remote-workflow-engine",   ⟵ 必須在任何 .git/CLAUDE.md 祖先之外（見 §1b workRoot 行）
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
> venv 的 `bin/`（見 §1a 前置條件），否則 `ENOENT`。
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
> ### 4) 實際跑 sdlc-run（透過 rwe-plugin 或直接 `run_start`）
> 關鍵參數 **`args.agentPrefix: ""`（必填）**：`AT()` 預設會加 `iso-agile-sdlc:` 前綴，但引擎註冊的是
> 裸名 → 不加空前綴會 `Unknown agentType: iso-agile-sdlc:sdlc-architect` 讓整個 run 失敗。範例 args：
> ```json
> { "feature":"NNN-slug", "sdlcDir":".sdlc/features/NNN-slug", "skillDir":"_skillref",
>   "mode":"new", "safetyClass":"QM", "agentPrefix":"", "tier":"lean" }
> ```
> - **seed**：把 skill 目錄（放 `_skillref/`，**不要**放 `.claude/skills/` 以免被 CLI 當 project skill 載入）
>   + `.sdlc/features/NNN/{01-requirements.md,state.yaml}` + `.sdlc/trace(.py)` 一起用 `run_start` 的
>   `seed:[{path,contentB64}]` 帶上（Gate 1 需求要先在本地備好，state.yaml 的 `gates.requirements.passed=true`）。
> - **git baseline 自動**：引擎會在 seed 落地後自動 `git init`+baseline commit（REQ-027），precheck 的
>   `git rev-parse --is-inside-work-tree` 會通過——**你不用手動 seed `.git`**（materializeSeed 本來就會擋）。
> - **model shorthand 自動處理**：`haiku`/`sonnet`/`opus` 被 CLI 展開成 Anthropic id 的老問題已由
>   `proxyModelName` 前綴根治，你不需做任何事。
> - **budget**：sdlc 全流程**吃 input token 很兇**（每個 agent 重讀 seed/docs，實作階段還會裝 venv 撐大
>   context）。設 `budget`（token 數）當硬上限；實測一次 lean 全流程到 Gate 6 約 ~3M token。撞上限會在
>   當前 gate 停（非 bug），可用 `resumeFromRunId` 續跑或調高 budget。
> - **拉回產物**：完成後用 plugin 的 `pull_workspace`（引擎側是 `workspace_list` 遞迴列檔 +
>   `workspace_pull` 分塊取回）把
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
> # B. 一個極小 agent 端對端：先 workflow_register（腳本 `return await agent('probe',{prompt:'say ROUTED'})`
> #    ＋ 契約 meta.params.agents.probe ＋ mermaid `graph TD;\nprobe(["probe"])`）→ workflow_publish → run_start
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
> 2. **防火牆白名單（必做）**——`auth.enabled:false`（預設）時引擎無訪問控制，綁上區網 = 任何能連到 `/mcp` 的裝置都能
>    送 workflow，讓 Bash agent 在**這台主機上執行任意程式碼**、`workspace_push` 任意寫檔。用 OS 防火牆
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
>    （`ssh -L 8787:127.0.0.1:8787 user@<host>`）——零網路曝露,適合單人/跨網段。多租戶/token auth 見 §1b 的 `auth` 區塊。
>
> ### B. 讓遠端 run 的程式碼變更「落地」到你本地(rwe-apply v1)
> 引擎的 agent 被 **jail 在 server 端 per-run workspace**,碰不到 client 機器（設計如此）。要把
> 「遠端推理」的程式碼變更帶回本地工作副本,用 **patch-in-result** 模式（設計由專家 panel 產出,
> 見 client plugin `remote-workflow-plugin` 的 `skills/rwe-apply/`）:
> 1. **workflow 回傳 git patch envelope**——用參考模式 `rwe-patch-return`（`skills/rwe-apply/references/`）:
>    seed client 傳來的 bounded base（`args.files`=[{path,contentB64}]、`args.baseSha`）→ agent 編輯 →
>    最後 `git diff --binary` → 腳本 `return { format:'git', baseSha, diff, touchedPaths, stats }`
>    （`run_result` 原樣帶回,引擎零改動）。
> 2. **client 端套用**——`/rwe-apply <runId>` skill:取 `run_result` → `apply_patch.py` 驗
>    envelope + **路徑守衛**（拒絕 `../`/絕對/`.git` 內部）+ 驗 baseSha + `git apply --check --3way`
>    dry-run → 經你**自己 session 的權限確認**套到新 `rwe/run-<id>` 分支（原分支不動）。變更只以
>    **可審查的 diff** 越過邊界,server 永遠拿不到你機器的寫入權。
> - **模型注意**: patch 模式的 git-plumbing agent(seed/finalize)**需要「真的會執行 Bash」的模型**。
>   qwen2.5:7b 會把工具呼叫吐成文字(D-F11 能力層)沒真跑 → 這幾步請指定 Claude 或夠大的本地模型;
>   引擎執行與 client 套用機制本身與模型無關,皆已驗證。
> - **大 patch / 整樹開發用的工具**: `workspace_list({runId})`(遞迴列檔 + sha256)、
>   `workspace_pull({runId,path,offset?,length?})`(分塊、限大小、realpath 封閉的 byte 取回,給太大塞不進
>   inline result 的 patch/bundle)、`workspace_purge({runId})`(刪除 terminal run 的 workspace)。`run_start` 有
>   選填 `seed:[{path,contentB64}]`—引擎在 agents 啟動前把整棵 tree materialize 進 workspace(**strip 掉
>   `.claude/settings*.json`+hooks**,關 RCE),讓 agents 直接編輯真實專案(而非只給 prompt 的 bounded base)。
>   請求 body 上限 8 MiB(超過回 413,防 OOM)。選填 `workspaceTtlMs` 開啟周期 GC 回收舊 workspace。


## 1a. 前置條件
- **Node.js 22.6 以上**（沙箱子行程 `src/sandbox/child-entry.ts` 與啟動用的 `tsx` 都依賴 Node 22
  原生 `--experimental-transform-types` type-stripping）。
- npm（隨 Node 附帶）。
- **Python 3.11 或 3.12**：`agent()` 的兩條 gateway 路徑（預設的 `"sdk"` 與可選的
  `"direct-fetch"` 搭配 `useLiteLLMProxy:true`）都會啟動一個真實的
  `litellm --config ... --port ...` Python 子行程（`src/gateway/litellm-proxy.ts`
  `LiteLLMProxyManager`，直接從 `PATH` 找 `litellm` 執行檔）。若系統 Python 版本較新（3.13+）沒有
  `uvloop`/`orjson`/`websockets` 的預編譯 wheel，用 `uv` 取得一份獨立的 3.12（不需要 root）：
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh      # 安裝 uv 到 ~/.local/bin
  export PATH="$HOME/.local/bin:$PATH"
  uv python install 3.12                                # 下載一份獨立的 CPython 3.12（不動系統 Python）
  uv venv --python 3.12 <你的-litellm-venv-路徑>
  uv pip install --python <你的-litellm-venv-路徑>/bin/python "litellm[proxy]"
  ```
  **啟動伺服器前**，把這個 venv 的 `bin/` 目錄加進 `PATH`（`LiteLLMProxyManager` 是直接
  `spawn('litellm', [...])`，靠 `PATH` 解析，不是寫死路徑）：
  ```bash
  export PATH="<你的-litellm-venv-路徑>/bin:$PATH"
  ```
  若系統本來就有 Python 3.11/3.12（`python3.12 --version` 有輸出），可以省略 `uv`，直接
  `python3.12 -m venv <venv路徑> && <venv路徑>/bin/pip install 'litellm[proxy]'`。
  **LiteLLM 只有一個消費者**：`agent()` 呼叫（`workflow_register` 不走 gateway）。要跳過這一步，設
  `gateway:"direct-fetch"` + `useLiteLLMProxy:false`（本機 Ollama 直連，完全不碰 LiteLLM）。
  留著預設值 `gateway:"sdk"` 卻沒裝 `litellm`：**服務在啟動階段就會直接拒絕啟動**，印出一行
  `fatal startup error: Error: litellm proxy failed to spawn: spawn litellm ENOENT` 後結束
  （不會半開著讓人以為成功）。`gateway:"direct-fetch"` + `useLiteLLMProxy:true` 則是正常啟動，
  只有實際用到代理的呼叫失敗成 `PROVIDER_UNREACHABLE`——兩種情況都見 §5 的對應處置。
  正常關機（`SIGTERM`）會連帶停掉這個子行程，不留孤兒；可在 `rwe.config.json` 用 `litellmPort`
  鍵讓每個實例指定不同 port（省略則綁一個 OS 分配的 ephemeral 空閒 port，天生不會多實例撞號）。
- **（選用，v25）dashboard 的流程圖渲染 —— headless Chrome**：dashboard 的工作流詳情頁顯示的是
  **伺服端畫出來的 SVG**（`GET /api/workflows/:name/diagram.svg`），渲染用 `@mermaid-js/mermaid-cli`
  + puppeteer 的 headless Chrome 子行程。兩者都宣告在 `package.json` 的 **`optionalDependencies`**：
  - 裝得起來就自動裝（`npm install` / `npm ci` 照舊，Chrome 由 puppeteer 的 postinstall 下載約 150MB）。
  - **裝不起來也不會讓安裝失敗**（optional 的語意），引擎照常啟動，dashboard 自動**降級成顯示
    Mermaid 原始碼**，並在頁面上標出原因（`RENDERER_MISSING`）。引擎核心完全不依賴它。
  - 機器上已經有 Chrome/Chromium 時，用 puppeteer 自己的原生環境變數指定，引擎直接繼承：
    ```bash
    PUPPETEER_SKIP_DOWNLOAD=1 npm install          # 安裝時不要再下載一份 Chrome
    export PUPPETEER_EXECUTABLE_PATH=/path/to/chrome   # 啟動 rwe 前 export，渲染子行程會繼承
    ```
    沒設定這個變數、puppeteer 也找不到自己那份 Chrome 時，渲染失敗會被歸類成
    `RENDER_FAILED`/`RENDERER_MISSING` 並降級，不會讓整頁空白。
  - **機器上沒有 Chrome 時，要裝的是「兩個」二進位檔，不是一個**（2026-09-06 實機踩過，
    兩次都以 `503 RENDER_FAILED` 收場才找出來）：
    ```bash
    npx puppeteer browsers install chrome                  # 完整版 Chrome
    npx puppeteer browsers install chrome-headless-shell   # ← mmdc 實際啟動的是這個
    ```
    **只裝 `chrome` 不夠。** `mermaid-cli` 走的是 `chrome-headless-shell` 這個獨立的 headless
    二進位檔；只裝完整版 Chrome 時 `node -e "require('puppeteer').launch(...)"` 會回報
    `launch OK`，而 `mmdc` 仍然失敗 —— 兩者用的不是同一個執行檔，所以**不能拿 puppeteer 能啟動
    當作 mmdc 能渲染的證據**。
  - **版本必須與 `node_modules/puppeteer` 對得上。** 快取裡有一份舊版（例如先前驗證留下的
    `linux-150.x`）而 puppeteer 要 `152.x` 時，錯誤是 `Could not find chrome (ver. 152...)`；
    上面兩條 `install` 指令會自動抓當前 puppeteer 要的版本，不要手動挑版本號。
  - **驗證方式（照這個順序，不要跳）**：
    ```bash
    # 1) 兩個二進位檔都在
    ls -d ~/.cache/puppeteer/chrome/*/ ~/.cache/puppeteer/chrome-headless-shell/*/

    # 2) 直接渲一張，看得到真正的錯誤（服務 log 會截斷）
    T=$(mktemp -d); cd "$T"
    printf 'graph TD\na(["x"])\n' > in.mmd
    echo '{"args":["--no-sandbox","--disable-setuid-sandbox","--proxy-server=127.0.0.1:9"]}' > p.json
    echo '{"htmlLabels":false}' > m.json
    node <repo>/node_modules/@mermaid-js/mermaid-cli/src/cli.js -i in.mmd -o out.svg -c m.json -p p.json
    # 預期：Generating single mermaid chart，且 out.svg 存在

    # 3) 經由引擎驗（服務啟動後；先註冊並發布一個帶圖的工作流）
    curl -s -o /tmp/d.svg -w '%{http_code} %{content_type} %{size_download}\n' \
      http://127.0.0.1:<port>/api/workflows/<name>/diagram.svg
    # 預期：200 image/svg+xml <數萬 bytes>；再打一次 X-Diagram-Cache 應為 hit
    ```
    第 2 步是關鍵：**服務 log 的 `diagram_render_failed.detail` 會截斷**，而 puppeteer 的錯誤
    原因寫在訊息開頭，被截掉之後只剩一串看不出所以然的堆疊。要診斷就手跑 mmdc。
  - **不裝也可以**：`@mermaid-js/mermaid-cli` 與 `puppeteer` 在 `optionalDependencies`，
    沒有它們引擎照常啟動與運作，dashboard 只是退回顯示 Mermaid 原始碼（`RENDERER_MISSING`）。
    容器／離線／低磁碟環境可以刻意不裝。
  - 渲染是**第一次瀏覽時才做並快取**（快取鍵 `(name, version)`），單次渲染硬逾時 20s、
    全引擎同時最多 2 個渲染子行程；超過上限的請求直接降級回原始碼，不排隊。
    這條路由**不需要認證**（dashboard 的瀏覽器沒有 token），所以這三道限制是它的防護，不是最佳化。
- 外部依賴：不需要資料庫伺服器（狀態存在本機檔案：SQLite + JSONL journal，路徑見 `workRoot`）。
- LLM 供應商（依你要用的模型別名擇一或多個）：對應的環境變數（`ANTHROPIC_API_KEY`／`OPENAI_API_KEY`／
  `GEMINI_API_KEY`／`OLLAMA_BASE_URL`／`OPENROUTER_API_KEY`／`CLAUDE_CODE_OAUTH_TOKEN`／`OPENAI_API_BASE`）
  每一個都只在 §1b 設定總表列出一次，請直接查表。

  **未設定的供應商不會擋住啟動** —— 對應別名的 `agent()` 呼叫只會在真正被呼叫時，走 D-G 電路斷路器
  邏輯解析成 `null`（run 繼續跑，不會掛住），已於 Gate 7.5 對真實不可達端點與缺金鑰兩種情境都實測確認
  （`gateway:"sdk"`/`"direct-fetch"` 兩條路徑皆適用）。

## 1b. 設定總表 Configuration Reference

> 這是**唯一**列出每個設定鍵/secret 名稱/port/flag 的地方——本文件其他章節只用名稱引用，不重複列值。
> 涵蓋三種載體：`rwe.config.json` 的鍵（不進版控，由 `.example` 複製而來，**本身不含機密**）、
> 環境變數（含 `RWE_SECRET_<NAME>` secret store）。金鑰/token 一律用環境變數，絕不寫進 JSON 設定檔。

| carrier | purpose | type/default | required | iter |
|---|---|---|---|---|
| `rwe.config.json` → `bind` | 監聽位址 | `string` / `'127.0.0.1'` | 否 | v1 |
| `rwe.config.json` → `port` | 監聽 port | `number` / `8787` | 否 | v1 |
| `rwe.config.json` → `workRoot` | 狀態/journal/run 工作目錄根，**必須在任何 `.git`/`CLAUDE.md` 祖先之外**（否則啟動時 `WORKROOT_INSIDE_PROJECT` fail-fast） | `string` / 系統暫存目錄自動建立 | 否 | v1 |
| `rwe.config.json` → `timeoutMs` | 單次 `agent()` LLM 呼叫的逾時斷路器（非整體 workflow 逾時） | `number` / `15000`（`gateway:"sdk"` 零設定也套用此保底值） | 否 | v1 |
| `rwe.config.json` → `retries` | `agent()` 呼叫失敗重試次數 | `number` / `1` | 否 | v1 |
| `rwe.config.json` → `gateway` | `"sdk"`（預設，真正的 `@anthropic-ai/claude-agent-sdk` headless session，有工具迴圈）或 `"direct-fetch"`（回退到直接對各供應商 `fetch()`，或搭配 `useLiteLLMProxy:true` 走 LiteLLM 代理；本來就不具備工具迴圈能力，適合純本機/內網不需要工具迴圈的部署） | `"sdk"｜"direct-fetch"` / `"sdk"` | 否 | v1 |
| `rwe.config.json` → `useLiteLLMProxy` | `direct-fetch` 路徑是否額外走 LiteLLM 代理（`false` 時 ollama 走原生直連 `localhost:11434`，完全不碰 LiteLLM，免依賴部署常用） | `boolean` / `true` | 否 | v1 |
| `rwe.config.json` → `agentDefinitionsDir` | `agentType` composition-root loader 讀取 `*.md` 定義的目錄（`name`/`model`/`tools` frontmatter + 內文即 systemPrompt）；省略時 agentType 註冊表為空 | `string` / — | 否 | v1 |
| `rwe.config.json` → `defaultAllowedTools` | `gateway:"sdk"` 路徑下，`agent()` 呼叫沒帶 `opts.allowedTools`（且 `agentType` 無 `tools:` frontmatter）時套用的預設工具清單；優先序：呼叫端 `opts.allowedTools` > `agentType` 的 `tools:` > 此鍵 > 內建預設 | `string[]` / `["Read","Write","Edit","Glob","Grep","Bash"]` | 否 | v3 |
| `rwe.config.json` → `aliases` | 模型別名 → `{provider,model}` 對照表；`provider` 僅 `"anthropic"｜"openai"｜"gemini"｜"ollama"`；省略時內建預設等同拿掉 `local` 那份（全指向 anthropic） | `object` / 見 `rwe.config.example.json` | 否 | v1 |
| `rwe.config.json` → `allowedHosts` | `bind:"0.0.0.0"` 時額外允許的 Host/Origin authority（LAN IP、代理主機名）清單，供 Host/Origin 白名單（§6）核對 | `string[]` / `[]` | 否（`0.0.0.0` bind 時建議設定） | v11 |
| `rwe.config.json` → `anthropicBaseUrl` | `anthropic` provider 直連（LiteLLM-bypassed）路徑打的真實 Anthropic API base | `string` / `'https://api.anthropic.com'` | 否 | v7 |
| `rwe.config.json` → `anthropicAuth` | Anthropic 直連認證模式：`"api-key"`（真實 `ANTHROPIC_API_KEY`）或 `"subscription"`（`claude setup-token` 產生的 `CLAUDE_CODE_OAUTH_TOKEN`）；認證素材本身一律來自 secret store／環境變數，絕不放進此檔 | `"api-key"｜"subscription"` / 依偵測到的 secret 自動判斷 | 否 | v7 |
| `rwe.config.json` → `litellmPort` | LiteLLM 代理子行程監聽 port | `number` / 省略則綁 OS 分配的 ephemeral 空閒 port | 否 | v1 |
| `rwe.config.json` → `schedulerDbPath` | 排程 SQLite 檔路徑 | `string` / `$workRoot/schedules.db` | 否 | v1 |
| `rwe.config.json` → `assetRoot` | `workspace_push` 的**工作流程範圍**資產樹根目錄，實際版面是 `<assetRoot>/<workflow>/<kind>/<name>`（`kind` 是 `skill`／`mcp`）。管理員推的全域資產不放這裡，固定在 `<workRoot>/_global_assets/<kind>/<name>`（刻意在被 GC 掃描的 `assets/` 樹之外） | `string` / `$workRoot/assets` | 否 | v24 |
| `rwe.config.json` → `maxWorkflowDepth` | 具名 `workflow()` 巢狀組合單一分支深度上限（頂層 run=0）；超過回可分支的 `NESTING_DEPTH_EXCEEDED`（不崩父 run）；≤0 或非整數在啟動時拒絕 | `number` / `4` | 否 | v8 |
| `rwe.config.json` → `maxWorkflowDescendants` | 巢狀 `workflow()` 呼叫總數上限（整棵 fan-out × depth 樹）；超過回 `DESCENDANT_CAP_EXCEEDED` | `number` / `256` | 否 | v8 |
| `rwe.config.json` → `maxWorkflowVersions` | 同一工作流程名稱累積保留的版本數上限；達上限時 `workflow_register` 回 `VERSION_CEILING_EXCEEDED`（需先 `workflow_deregister` 舊版本或調高此值） | `number` / 省略 = 不設上限 | 否 | v22 |
| `rwe.config.json` → `principals` | 角色對照表：鍵是 principal id（OAuth 下的使用者 email，或 `"*"` 代表所有已驗證但未列名者），值是 `{role:"admin"｜"author"｜"user"}`；角色字串打錯（例如 `"admn"`）**開機直接拒絕啟動**，絕不會靜默退回 `"user"`（ADR-028 fail-closed）；整個鍵省略時，`auth.enabled:true` 下每個已驗證呼叫者一律 `"user"`（同樣是 fail-closed，且開機那行 `auth:` log 會如實顯示） | `object` / 省略 | 否 | v24 |
| `rwe.config.json` → `mcpEgressAllowlist` | `workspace_push({kind:"mcp"})` 註冊 `http` transport 時的 https-only 白名單（URL 前綴比對，同 `seedRefAllowlist` 的 fail-closed 慣例）；省略/空陣列＝任何 `http` MCP 設定一律 `EGRESS_DENIED`（探測前就擋，探測次數為零） | `string[]` / `[]` | 否 | v24 |
| `rwe.config.json` → `seedRefAllowlist` | engine-pull `seedRef:{repoUrl,sha}` 的 egress 白名單（`https://` URL 前綴）；**fail-closed**：省略/空陣列 = 任何 seedRef 回 `SEEDREF_DISABLED`；不命中前綴（含 `169.254.169.254`/`localhost`/私有 IP/`file://`）→ `SEEDREF_EGRESS_DENIED`（SSRF 安全） | `string[]` / `[]` | 否 | v13 |
| `rwe.config.json` → `maxBlobBytes` | `POST /assets/blob/:sha`（streaming raw-body 上傳）最大 body bytes；超過 → HTTP 413 `BLOB_TOO_LARGE` | `number` / `268435456`（256 MiB，最小 1048576） | 否 | v10 |
| `rwe.config.json` → `maxConcurrentRuns` | 頂層 run 並行上限（run-admission counter）；達上限時 `start()` 在任何持久化動作之前以 `RUN_ADMISSION_LIMIT` 拒絕；巢狀 `workflow()` 不佔用槽位 | `number` / `64` | 否 | v8 |
| `rwe.config.json` → `workspaceTtlMs` | Workspace GC sweep 間隔（ms）：回收閒置舊 workspace 目錄（REQ-026），**同時決定 auth-table GC（`gcExpired()`）間隔**；`0`/省略 = workspace reclaim 關閉，auth 啟用但未設此鍵時 sweep 每小時跑一次 | `number` / `0`（停用） | 否 | v16 |
| `rwe.config.json` → `continuationDbPath` | on-completion chaining 續接的 SQLite 檔路徑；引擎會開這個檔，但 35 個工具裡沒有任何一個對應到它（沒有 `chain_*` 工具），設了不影響行為 | `string` / `$workRoot/continuations.db` | 否 | v24 |
| `rwe.config.json` → `webhookDbPath` | webhook 註冊表（`webhooks`+`webhook_deliveries`）SQLite 檔路徑；**secret 明文儲存**於此檔（HMAC 驗簽需要），存取權限即機密邊界；`webhook_list` 只回 sha256 前綴指紋 | `string` / `$workRoot/webhooks.db` | 否 | v8 |
| `rwe.config.json` → `casDir` | 內容定址 blob 儲存庫（CAS）目錄；`workspace_push({sha256,contentB64})` 以內容 sha256 為鍵（伺服器 byte-verify）。namespace 一律由呼叫者身份推導，不接受呼叫端指定 | `string` / `$workRoot/cas` | 否 | v10 |
| `rwe.config.json` → `updateFlagPath` | GitHub tag/release webhook 觸發自我更新的旗標檔路徑（mode 0600，原子寫入）；**必須在所有 `workRoot` 之外**（違反則 `UPDATE_FLAG_INSIDE_WORKROOT` 拒絕啟動）；省略時 `/github/webhook` 對已驗簽事件回 503 | `string` / — | 否 | v11 |
| `rwe.config.json` → `updateResultPath` | 特權 bash helper 寫入更新結果 JSON（`{tag,status,ts,detail?}`）的路徑；同樣必須在 `workRoot` 之外 | `string` / — | 否 | v11 |
| `rwe.config.json` → `selfUpdateDbPath` | 自更新 delivery 去重 + pending outcome 的 SQLite 路徑 | `string` / `$workRoot/self-update.db` | 否 | v11 |
| `rwe.config.json` → `maxTimeoutMs` | `timeoutMs` 的 engine 端 ceiling，**兩處都管**：送出時的 `overrides.timeoutMs`，以及註冊時腳本宣告的 `meta.params.agents.<label>.timeoutMs.default`。超過一律拒絕、不靜默改小。唯一不受此上限約束的是腳本內 `agent()` 的逐次 opts | `number` / `600000` | 否 | v21 |
| `rwe.config.json` → `maxAppendPromptBytes` | `overrides.appendPrompt` 的位元組上限；超過在送出時以 `PARAM_OUT_OF_RANGE` 拒絕（不截斷、原文不回顯於錯誤訊息） | `number` / `1024` | 否 | v21 |
| `rwe.config.json` → `maxEffort` | `overrides.effort`／`meta.params` 宣告的 `effort` 上限（`low\|medium\|high\|xhigh\|max` 五階） | `string` / `'high'` | 否 | v21 |
| `rwe.config.json` → `auth.enabled` | OAuth 2.0 身份認證 toggle；`false`（省略）= 開放行為（無 auth） | `boolean` / `false` | 否 | v15 |
| `rwe.config.json` → `auth.issuer` | 這台引擎當作 OAuth 授權伺服器時對外宣告的 base URL（寫進 AS metadata、`WWW-Authenticate` 與 client redirect 的 `iss`）；省略時自動用 `http://<bind>:<實際 port>`，公開部署（HTTPS tunnel）必須明寫成對外網址 | `string` / `http://<bind>:<port>` | 否（公開部署時建議設定） | v15 |
| `rwe.config.json` → `auth.googleClientId` | Google Cloud Console OAuth 2.0 client ID；用於 `/authorize` 重導向 + id_token aud 驗證 | `string` / — | 當 `auth.enabled:true` | v15 |
| `rwe.config.json` → `auth.googleClientSecret` | Google OAuth 2.0 client secret；用於 `/oauth/google/callback` code exchange | `string` / — | 當 `auth.enabled:true` | v15 |
| `rwe.config.json` → `auth.googleAuthorizeUrl` | Google authorization endpoint override（一般部署不需設定） | `string` / `'https://accounts.google.com/o/oauth2/v2/auth'` | 否 | v18 |
| `rwe.config.json` → `auth.googleTokenUrl` | Google token endpoint override | `string` / `'https://oauth2.googleapis.com/token'` | 否 | v18 |
| `rwe.config.json` → `auth.googleJwksUrl` | Google JWKS endpoint override | `string` / `'https://www.googleapis.com/oauth2/v3/certs'` | 否 | v18 |
| `rwe.config.json` → `auth.googleBase` | **deprecated** 向後相容 fallback；改用上面三個獨立 URL 欄位 | `string` / — | 否（deprecated） | v18 |
| env `RWE_CONFIG_PATH` | 要讀取的 JSON 設定檔路徑 | `string` / `./rwe.config.json`（不存在則略過） | 否 | v1 |
| env `RWE_BIND` | 覆蓋 `bind` | `string` / `127.0.0.1` | 否 | v1 |
| env `RWE_PORT` | 覆蓋 `port` | `number` / `8787` | 否 | v1 |
| env `RWE_WORK_ROOT` | 覆蓋 `workRoot` | `string` / 設定檔值或系統暫存目錄 | 否 | v1 |
| env `RWE_LITELLM_VENV` | 只有 `deploy.sh` 讀：LiteLLM Python venv 的路徑（步驟 3 檢查／建立 `<venv>/bin/litellm`，並把 `<venv>/bin` 加進服務的 `PATH`）；引擎本身不讀這個變數 | `string` / `$HOME/.rwe-litellm-venv` | 否 | v24 |
| env `RWE_SECRET_<NAME>` | 伺服器端 secret store；provisioned MCP config 裡的 `${secret:NAME}` handle 由此解析（大小寫敏感）；缺少則該次引用以 `SECRET_MISSING` 報錯，從不外洩值或靜默跳過；絕不放進 JSON 設定檔 | `string` / 無預設 | 依 MCP 引用 | v1 |
| env `RWE_SECRET_GITHUB_TOKEN` | `issue_report`／Issues 儀表板需要；GitHub PAT/fine-grained token，須有目標 repo `issues:write` 權限；缺少時 `issue_report` 回 `GITHUB_TOKEN_MISSING`，`GET /api/issues` 回 200 `{degraded}`（不 500） | `string` / 無預設 | 否（缺少則降級） | v1 |
| env `ANTHROPIC_API_KEY` | `provider:"anthropic"` 別名的 API key（範例設定檔的 `sonnet`/`haiku`/`opus`/`default` 都指向此）；`gateway:"sdk"` 路徑也可改由 `RWE_SECRET_ANTHROPIC_API_KEY` 提供 | `string` / 無預設 | 用到 anthropic 別名時 | v1 |
| env `RWE_SECRET_ANTHROPIC_API_KEY` | 同上，但走伺服器端 secret store（`gateway:"sdk"` 直連 Anthropic 時優先於 `ANTHROPIC_API_KEY`） | `string` / 無預設 | 否 | v7 |
| env `CLAUDE_CODE_OAUTH_TOKEN` | `provider:"anthropic"` **直連**的**訂閱制**認證（`anthropicAuth:"subscription"`），用 `claude setup-token`（Pro/Max 帳號）產生；設定時**不要**同時設 `ANTHROPIC_API_KEY` | `string` / 無預設 | 否 | v7 |
| env `RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN` | 同上，但走伺服器端 secret store（優先於 `CLAUDE_CODE_OAUTH_TOKEN`） | `string` / 無預設 | 否 | v7 |
| env `OPENAI_API_KEY` | `provider:"openai"` 別名的 API key；打自架 OpenAI 相容端點時可給任意非空字串 | `string` / 無預設 | 用到 openai 別名時 | v1 |
| env `OPENAI_API_BASE` | 由 LiteLLM 子行程讀取：讓所有 `provider:"openai"` 別名改打這個 base URL（vLLM／TGI／llama.cpp／LiteLLM 等 OpenAI 相容端點，見上方「情境配方」） | `string` / `https://api.openai.com/v1` | 否 | v7 |
| env `GEMINI_API_KEY` | `provider:"gemini"` 別名的 API key | `string` / 無預設 | 用到 gemini 別名時 | v1 |
| env `OLLAMA_BASE_URL` | `provider:"ollama"` 別名要打的 Ollama 位址（本機/內網模型，免金鑰；見 §6「本機小模型能力上限」） | `string` / `http://localhost:11434` | 否 | v1 |
| env `OPENROUTER_API_KEY` | `provider:"openrouter"` 別名與 `agent({model:"openrouter/<id>"})` passthrough 的 API key（`sk-or-…`）；LiteLLM 以原生 `openrouter/<model>` 路由自動讀取，一把 key 開放整個 OpenRouter 目錄（`models_list` 可查） | `string` / 無預設 | 用到 openrouter 時 | v9 |
| env `RWE_SECRET_GITHUB_WEBHOOK_SECRET` | 標籤觸發式自動更新的 GitHub webhook HMAC 共享密鑰；`POST /github/webhook` 以此對原始 body bytes 算 HMAC-SHA256 比對 `X-Hub-Signature-256`；缺少（且未設 `updateFlagPath`）則路由回 503 `UPDATE_WEBHOOK_UNCONFIGURED` | `string` / 無預設 | 否（缺少則自動更新停用） | v11 |

`auth.enabled:true` 時的部署前提：
1. `bind` 改成 `0.0.0.0`（或公開 IP），並在 `allowedHosts` 列出你的 LAN IP／主機名稱。
2. 引擎需有 HTTPS 公開 callback URL（`https://<your-host>/oauth/google/callback`），因為 Google 要求 callback URI 為 HTTPS（cloudflared tunnel 可提供）。在 Google Cloud Console 的「Authorized redirect URIs」填入此 callback URL。
3. D-BIND fail-closed（`/mcp`、`GET /api/workflows/:name/describe`、blob/manifest 上傳都走這一套）：
   `auth.enabled:true` 時，沒有有效 bearer 一律 401 + `WWW-Authenticate`，**唯一的豁免**是
   「來源是 loopback（127.0.0.1/::1）**而且** `bind` 不是 loopback」。所以：
   - `bind` 是 `0.0.0.0`／LAN IP → 本機（127.0.0.1）連進來免 bearer，區網來源要 bearer。
   - `bind` 是 `127.0.0.1`（預設）→ **沒有任何豁免**，連本機自己 curl 也要 bearer
     （這個 bind 根本不可能有非 loopback 來源，豁免對它沒有意義）。
   - 帶 tunnel／forwarded 標頭（`X-Forwarded-For` 等）的請求**永不豁免**，避免「把 cloudflared
     架在 loopback 上」變成繞過。

範例 `auth` 區塊（`rwe.config.json`）：
```json
"auth": {
  "enabled": true,
  "googleClientId": "123456789-abc.apps.googleusercontent.com",
  "googleClientSecret": "GOCSPX-…"
}
```

### 角色（`principals`）——啟用 auth 前一定要讀

每個工具都有一個**最低角色**要求。角色共三級（`admin` > `author` > `user`），由 §1b 的
`principals` 表決定：鍵是 principal id（OAuth 下的使用者 email），值是 `{role:"..."}`；
`"*"` 是萬用鍵，供「已驗證但沒被列名」的人使用。

| 角色 | 這個角色（含以上）才叫得動的工具 |
|---|---|
| `author` | `workflow_register`／`workflow_deregister`／`workflow_publish`／`workflow_source`、`schedule_create`／`schedule_list`／`schedule_delete`／`schedule_setEnabled`、`webhook_create`／`webhook_list`／`webhook_delete`、`workspace_push` 的資產模式（`{workflow,kind,name}`）、`workspace_list`／`workspace_delete` 的工作流程模式 |
| `admin` | `workspace_push`／`workspace_delete` 的 `scope:"global"`（全域資產）、以及 `workspace_push({kind:"mcp"})` 帶 `stdio` transport（`config.type:"stdio"`）的 MCP server——其他角色回 `FORBIDDEN_ROLE`，不探測、不啟動任何子行程 |
| `user` | 其餘全部：`workflow_describe`／`workflow_list`／`workflow_authoring_guide`、所有 `run_*`、`workspace_diff`／`workspace_pull`／`workspace_purge` 與 run 模式的 `workspace_list`／`workspace_delete`、所有 `issue_*`、`models_list`、`system_info` |

角色不足一律回 `FORBIDDEN_ROLE`。角色**之外**還有一層擁有權檢查（`NOT_WORKFLOW_OWNER`／
`NOT_RUN_OWNER`／`NOT_TRIGGER_OWNER`）：有 `author` 角色不代表能動別人的工作流程。

⚠ **啟用 auth 卻沒設定 `principals` 的話，沒有人能註冊任何東西。** 這是刻意的 fail-closed
（ADR-028）：`auth.enabled:true` 時每個已驗證但未列名的呼叫者一律解析成 `user`，而 `user` 沒有
`author`，於是 `workflow_register` 一律 `FORBIDDEN_ROLE`。要開放註冊，至少列一個人：

```json
"principals": {
  "you@example.com": { "role": "admin" },
  "teammate@example.com": { "role": "author" },
  "*": { "role": "user" }
}
```

角色字串打錯（例如 `"admn"`）會讓服務**開機直接拒絕啟動**，絕不靜默退回 `user`。
`auth.enabled:false`（預設）時整個授權層被短路，不套用任何角色檢查。

## 1c. 安全模型（Security Model）

> 本節記錄 `gateway:"sdk"` 路徑（`ClaudeAgentSdkGatewayClient`）的 agent 工具權限、供應商金鑰
> 存放、以及 run 工作目錄隔離這三件事**目前實際**如何運作。

**(a) 不用 `bypassPermissions`**：`options.permissionMode` 固定是 `'default'`（每一次工具呼叫
均受裁決）。headless 模式下不會卡在互動式權限提示——因為下面 (d) 的
`canUseTool`/`PreToolUse` 回呼一律會同步回傳一個明確決策（`allow` 或 `deny`），從不回傳
`null`/pending。

**(b) 預設工具面 = 受限的檔案+搜尋+shell 集**：
`gateway:"sdk"` 路徑下，一次 `agent()` 呼叫若沒有自帶 `opts.allowedTools`（且對應 `agentType`
定義也沒有 `tools:` frontmatter）、也沒有設定 `defaultAllowedTools`，套用的內建預設工具清單是
**`["Read","Write","Edit","Glob","Grep","Bash"]`**——與真實 dynamic-workflow agent 的工作工具面
對齊。**`Bash` 在預設集裡，但被 (d) 的工作目錄邊界封閉**（`cwd`=該次 run 工作目錄 + 每次呼叫
的 realpath 路徑檢查；一個試圖逃出工作目錄的 Bash 指令會被 `deny`）。
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

## 2. 完整部署步驟（超出一鍵路徑之外：常駐化 / 容器化 / 上線前煙霧測試）

> 基本開機序列已在 §0 一鍵部署 / 展開版 Quickstart 涵蓋。本節只講超出那條路徑之外的東西：
> 常駐服務安裝、容器化、上線前自我檢查。SQLite schema 由伺服器啟動時在 `$workRoot/store`
> 自動建立，無需另外做資料庫遷移/初始化。

**docker-compose**（不需要另外寫 Dockerfile；直接把 repo 掛進官方 Node 22 image，跑與手動部署
完全相同的 `npm ci && npm run start`）：
```bash
docker compose up                              # 預設 profile：只跑 server（映像內沒有 LiteLLM/Python；
                                                # 要免 LiteLLM 依賴，設定檔請照 §1a 設
                                                # gateway:"direct-fetch" + useLiteLLMProxy:false）
docker compose --profile litellm up server-litellm
                                                # 選用 profile：容器內額外安裝 Python 3.11 +
                                                # litellm[proxy]
```

**systemd（root）**（`deploy/rwe.service`，`Restart=on-failure` 自我修復）：
```bash
sudo cp deploy/rwe.service /etc/systemd/system/rwe.service
sudo systemctl daemon-reload
sudo systemctl enable --now rwe.service
```
`ExecStart` 用的是與手動啟動完全相同的 `npm run start`（此 repo 沒有另外維護一份編譯產物
`dist/main.js`，見該檔案內註解）。三個部署封裝產物：`docker-compose.yml`（上方）、
`deploy/rwe.service`（systemd unit，上方）、`scripts/smoke.sh`（非互動式煙霧測試，見下）。
**本機與遠端主機的部署步驟完全相同**——沒有「本機才有的捷徑」。

### 無 root 部署：systemd **user** service + 本地 Ollama

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

**常見的坑**：
1. **`ExecStart` 不要用 `npm`** —— 若 node 是用版本管理器裝的（例如在 `~/.local/node/bin/`），
   `/usr/local/bin/npm` 可能是失效 symlink，而 systemd 用最小環境看不到互動 shell 的 PATH →
   `status=203/EXEC`。範本改用 **node 絕對路徑直接跑 tsx**：
   `ExecStart=<node 絕對路徑> node_modules/tsx/dist/cli.mjs src/main.ts`，並在 unit 裡設
   `Environment=PATH=<node bin 目錄>:/usr/bin:/bin`。用 `node -e 'console.log(process.execPath)'`
   查你的 node 真實路徑。
2. **免依賴啟動要設 `useLiteLLMProxy:false`** —— 否則就會需要 `litellm` 執行檔：`gateway:"sdk"`
   在**開機時**就去 `spawn litellm`，沒裝的話服務會帶著
   `fatal startup error: ... spawn litellm ENOENT` 直接拒絕啟動；`useLiteLLMProxy:true` 則是
   啟動正常、但每次 `agent()` 都失敗成 `PROVIDER_UNREACHABLE`。設
   `gateway:"direct-fetch"` + `useLiteLLMProxy:false`，ollama 走原生直連 `localhost:11434`，
   完全不碰 LiteLLM。
3. **`timeoutMs` 是「單次 `agent()` LLM 呼叫」的斷路器，不是整體 workflow 逾時**（workflow 本身
   非同步、無總時長限制）。本地 7B 生成大回應會超過預設 15 秒 → 被切成 null；跑本地模型建議調高
   到 `300000`（5 分鐘）。

**上線前煙霧測試**（`scripts/smoke.sh`，非互動式、結束碼 0=成功）：
```bash
scripts/smoke.sh
```
用意是啟動伺服器 → 送出一個**不呼叫 `agent()`** 的範例工作流程 → 輪詢至完成 → 關閉伺服器；
不需要任何 LLM 供應商金鑰或 LiteLLM/Python，只驗證「送出 run → 查狀態 → 取結果」這條核心路徑
本身能不能跑完。

它走的就是現行的路徑：`workflow_register`（含 `mermaid`）→ `workflow_publish` → `run_start({name})` →
輪詢 `run_status` → `run_result`。預設用 port 8799（用 `RWE_PORT` 改）。實際跑過的輸出：

```
[smoke] starting server on port 8796...
[smoke] server ready
[smoke] registering sample workflow rwe-smoke-139722...
[smoke] publishing rwe-smoke-139722@v1 onto release...
[smoke] submitting sample run_start...
[smoke] runId=b7c3d1fc-3535-49f3-8ca2-d4ce2c9cf83c
[smoke] PASS: sample workflow completed with result=42
[smoke] shutting down server (pid 139727)...
```

### 無訪問控制時的已知風險（`auth.enabled:false`，D5/C4）

**`workspace_push` 會把任意內容真實寫入伺服器端磁碟**——工作流程範圍的資產落在
`<assetRoot>/<workflow>/<kind>/<name>/...`（`assetRoot` 預設 `$workRoot/assets`），管理員推的全域
資產落在 `<workRoot>/_global_assets/<kind>/<name>/...`。`auth.enabled:false`（預設）時無身份驗證，
連角色檢查都被短路——任何能連到 `/mcp` 這個 HTTP 端點的人都能呼叫 `workspace_push`。
**啟用 auth（見 §1b `auth` 區塊與「角色」小節）或透過 SSH 通道（例如
`ssh -L 8787:127.0.0.1:8787 user@host`）/VPN 存取這台伺服器，絕對不要把 `workspace_push` 所在的
port 直接暴露在公開網路上。**

> ⚠ **「寫入後會被執行」這個風險是真的成立的**：
> `gateway:"sdk"` 路徑上，一次 `agent()` 呼叫如果同時有 run workspace 和資產資訊，就會用
> `materializeAssets()` 把**該 agent label 在契約裡宣告的**（`meta.params.agents.<label>.skills`／
> `.mcp`）skill 展開進該次 run 的 workspace（`.claude/skills/<name>/`，以
> `settingSources:['project']` 載入），並改寫該 workspace 的 `.mcp.json` + 設定 `options.mcpServers`。
> 換句話說：**推送的 skill/MCP config 會真的被 agent 載入並執行**——沒被宣告的資產不會被展開，
> 但「推送」與「被宣告」都在同一個 `author` 手上。引擎自己的 `rwe-` 前綴是保留字
> （`RESERVED_PREFIX`），防止推送的資產冒充引擎內建的技能。`gateway:"direct-fetch"` 從不帶資產，
> 這條路徑不受影響。

## 3. 健康檢查（怎麼確認起來了）
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
判定標準：回傳 `200`，且 body 的 `result.tools` 陣列包含 35 個工具（`workflow_*` 7、`run_*` 8、
`workspace_*` 6、`schedule_*` 4、`webhook_*` 3、`issue_*` 5、`models_list`＋`system_info`）；
終端機/日誌會印出 `[remote-workflow-engine] ready`；`GET /api/status` 回 `{agentSemaphore,version}`。
完整真實層驗證證據（含逐 REQ 的真實指令與觀察輸出）見
`.sdlc/features/001-remote-workflow-engine/08-validation.md`。

## 4. 回滾
```bash
# 停掉目前的 process：
kill -TERM <pid>          # SIGTERM 優雅關閉（等 HTTP server 收乾連線，並連帶停掉內部管理的
                           # litellm 子行程，2 秒內從 ps aux 消失，不留孤兒）
# 若懷疑仍有非正常關機（kill -9）留下的孤兒，手動確認/清理：
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
| `pip install 'litellm[proxy]'` 失敗（`uvloop`/`orjson` 編譯錯誤） | 系統 Python 版本太新（如 3.13/3.14），沒有預編譯 wheel | 用 §1a 的 `uv python install 3.12` 取得一份獨立的 3.12，改用它裝 |
| `agent()` 一律回傳 `null`、`run_status.agents[].state === "failed"` | 該別名對應的 provider 沒有可用憑證/端點（伺服器不會掛住，只會讓該次呼叫失敗回 `null`） | 確認 `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`/`OLLAMA_BASE_URL` 已正確設定，且 `rwe.config.json` 的 `aliases` 有指到你要的 provider/model |
| `workflow_register` 回 `UNKNOWN_ALIAS` | 腳本 `meta.params.agents.<label>.model.default` 的別名沒在 `aliases` 設定檔裡 | 補上該別名，或改用已存在的別名——這是在**註冊當下**就報錯（`model` 不能寫在 `agent()` 呼叫裡，寫了是 `SCAN_VIOLATION`），不會跑到一半才失敗 |
| 任何工具呼叫回 JSON-RPC `-32601 Unknown tool` | 用的工具名不存在（例如 `workflow_run`／`workflow_status`／`asset_push`／`mcp_provision`／`chain_create`） | 用 `tools/list`（35 個）查現行名稱；權威清單是 `src/tool-specs.ts` |
| 開機 log 出現 `unrecognized config key(s) in rwe.config.json, ignored: …` | `rwe.config.json` 有引擎不認得的鍵（打錯字，或已不存在的鍵，例如 `graphAnalyzer`） | 把該鍵從設定檔移除；有效鍵只有 §1b 設定總表列出的那些 |
| `workflow_register` 回 `MERMAID_REQUIRED` 或 `DIAGRAM_MISMATCH` | 註冊必須附一張非空的 Mermaid 圖，而且圖裡的 stadium 節點 `id(["label"])` 要跟腳本的 `agent()` label 雙向完全對上 | 補上 `mermaid` 參數；節點少了就補、多了就刪。詳細語法見 `docs/AUTHORING.md`（或呼叫 `workflow_authoring_guide`）|
| `run_start` 回 `PARAM_UNKNOWN`，訊息說 overrides 只有 `agents` 一個鍵 | 用的是扁平的 `overrides:{effort:...}` | 改成逐 agent：`overrides:{agents:{'<label>':{effort:...}}}`；而且該鍵必須在 `meta.params.agents.<label>` 宣告過 |
| `run_start` 回 `CHANNEL_UNPUBLISHED`；或 `workflow_describe` 回 `runnable:false` | 剛註冊完還沒發布——註冊只建立版本，不會自動指向任何頻道 | `workflow_publish({name, version, channel:"release"})`（三個參數都必填，`version` 是註冊回傳的字串如 `"v1"`）|
| `workflow_describe` 回 `runnable:false` + `runnableReason:"LEGACY_REREGISTER"` | 這個版本沒有 `meta.params.agents` 契約（引擎不提供舊契約的解析階梯） | 照現行契約重新 `workflow_register` 一次（新版本），再 `workflow_publish` |
| 腳本內 `budget.spent()` 一直是 `0`、`budget.remaining()` 一直等於 `budget.total` | 該次執行可能尚未完成任何一次 `agent()` 呼叫 | 第一筆用量要等第一次 `agent()` 回應後才會同步 |
| **本機 7B 級 Ollama 模型不會真的觸發工具呼叫**：`agent()` 要求讀檔/寫檔，回傳的內容看起來像結果，但檔案沒真的被寫入/讀到的內容是編造的 | 已知的模型能力上限（非程式碼缺陷）：即使工具清單已縮減到最小，SDK 的工具迴圈對本機 7B 級模型仍不會真正被觸發，模型直接生成一段編造的「工具結果」文字（直接對 Ollama 原生 API 測試排除了模型本身不支援 tool-calling 的可能） | 目前沒有繞過方法；若工作流程依賴 agent 真的讀寫檔案，改用更大的本機模型（例如 32B 級）或已驗證憑證的付費供應商 |
| 續跑（`run_resume`）之後，原本被中止那次呼叫的紀錄一直卡在 `"state":"running"` | 已知的顯示瑕疵：中止的呼叫紀錄不會自己轉成終止狀態，續跑會多出一筆新紀錄 | 純顯示瑕疵，不影響最終 `run_result` 的正確性；可忽略舊的那筆紀錄 |
| 關掉伺服器後還有一個 `litellm --config ...` process 留著 | 正常 `SIGTERM`/`SIGINT` 關機會連帶砍掉內部管理的 `litellm` 子行程；殘留多半是非正常關機（如 `kill -9`）留下的 | 手動 `ps aux \| grep litellm` 找到後 `kill`；也可以用 `litellmPort` 鍵讓每個實例用不同 port，避開多實例誤連風險 |
| Node 啟動就報 SyntaxError / 找不到 `--experimental-transform-types` | Node 版本 < 22.6 | 升級 Node 到 22.6 以上（`node --version` 確認） |
| 服務啟動失敗，log 只有一行 `fatal startup error: Error: litellm proxy failed to spawn: spawn litellm ENOENT` | `gateway:"sdk"` 在**開機階段**就要起一個 `litellm` 代理子行程，而 `PATH` 上沒有 `litellm` 執行檔（常見於 systemd unit 的 `PATH` 沒帶到 venv） | 照 §1a 把 litellm venv 的 `bin/` 加進 `PATH`（systemd 要寫在 unit 的 `Environment=PATH=...`）再啟動；或改成 §1a 的 `gateway:"direct-fetch"` + `useLiteLLMProxy:false` 免 LiteLLM 組合 |
| 服務起得來，但每次 `agent()` 都是 `PROVIDER_UNREACHABLE` | `gateway:"direct-fetch"` + `useLiteLLMProxy:true`，但 `PATH` 上沒有 `litellm`：代理是用到才起，起不來就這一次呼叫失敗（服務本身不受影響、不會中止） | 同上：補 `PATH`，或設 `useLiteLLMProxy:false` 讓 ollama 走原生直連 |
| 手動用 `curl http://0.0.0.0:<port>/api/status` 檢查健康狀態，收到 `403 Forbidden`（不是逾時、不是連不上） | 伺服器的 Host-header 允許清單刻意不把 `0.0.0.0` 當成合法 Host（那是「監聽所有介面」的萬用位址，不是真實可連的目的地名稱）——`RWE_BIND=0.0.0.0` 只影響「監聽哪些介面」，不代表 `0.0.0.0` 本身能當 URL 用 | 改用 `127.0.0.1:<port>` 檢查（`deploy.sh` §0 本身在 `RWE_BIND=0.0.0.0` 時也是這樣做）；要從區網其他主機檢查，用該主機看到的 LAN IP（並確認已列在 §1b `allowedHosts`） |
| `auth.enabled:true` + `bind:"0.0.0.0"`，從**本機**呼叫 `/mcp` 做寫入（`workflow_register`／`workflow_publish`／`workflow_deregister`／`webhook_delete`…），明明帶了有效 bearer 卻回 `PRINCIPAL_REQUIRED`（或角色不足的 `FORBIDDEN_ROLE`） | 這個組合下本機來源走的是 D-BIND 豁免（§1b 部署前提第 3 點），伺服器直接放行、**根本不會去讀你帶的 bearer**，於是這次呼叫沒有身份可用，而寫入類操作在 `auth.enabled:true` 時不接受 `args.principal` 自稱 | 要用 bearer 身份做寫入，就從**非 loopback 來源**呼叫（例如從該主機的 LAN IP 打進去），或把 `bind` 設成 `127.0.0.1`（loopback bind 沒有豁免，bearer 一定會被讀取）；只讀不寫時維持現狀即可 |
| `RWE_BIND=<LAN IP>`（如 §2 systemd 範例的 `192.168.0.125`）部署後，手動用 `curl http://127.0.0.1:<port>/api/status` 檢查，收到 `Connection refused`（連不上，不是 403） | 服務只監聽 `$RWE_BIND` 指定的那個介面；綁定成具體 LAN IP 時，該主機的 `127.0.0.1` 迴環介面根本沒有服務在聽 | 改用 `$RWE_BIND` 本身（例如 `curl http://192.168.0.125:<port>/api/status`）；`deploy.sh` §0 的健康檢查已依 `RWE_BIND` 是否為 `0.0.0.0`/`::` 自動選擇正確目的地，不需要手動判斷 |

## 6. 維運注意事項 / 已知限制

**日誌與狀態位置**：日誌僅 stdout/stderr（`[remote-workflow-engine] ...` 前綴），交給你的
process manager（systemd/pm2/docker）收集；沒有另外寫檔案 log。狀態存在 `$workRoot/store`
（SQLite run 索引 + 具名工作流程註冊表）與 `$workRoot/workflows/<name>/runs/<runId>/`（每次
執行的工作目錄，含 `agent-*.jsonl` transcript 事件檔）。

**Composite 呼叫樹 / 儀表板 / 即時執行細節**：對 in-process（執行中或剛完成）的 composite run，
`run_status`／`GET /api/runs/:id` 回傳呼叫樹資料——每個 agent 記錄帶 `frame`（所在巢狀
frame，頂層 `""`）+ `startedAt`/`endedAt`，`workflowNodes:[{frame,name,parentFrame,depth}]`；
`phases[]` 每項帶 `ts`（進入時間，`running` 時最後一項即目前步驟）。`GET /dashboard` 列出已註冊
工作流程卡片（`GET /api/workflows`）與 run 卡片；點一張 run 卡片渲染巢狀 DAG（`GET
/api/runs/:id/dag`，3 秒輪詢自動更新，未支援 SSE）。**跨重啟**：run 結束時（`completed`/
`failed`/`stopped`）DAG 快照一次性寫入 `run_snapshots` side table，重啟後 `getRun` 讀回同一棵
巢狀樹（不攤平）；改動前留下、無快照的舊 run 仍以既有方式重建。**尚未支援**：parallel-group
標記（需 sandbox-IPC 改動）、樹的靜態預讀+快取。

**沒有跨觸發串接工具**：35 個工具裡沒有 `chain_*` 這類工具（呼叫會得到 `-32601`），也沒有替代工具。
`continuationDbPath` 設定鍵存在（見 §1b），但沒有任何可呼叫的功能對應到它。要串接多個工作流程，改在腳本裡用 `await workflow(name, args)`
巢狀呼叫（深度/總數由 `maxWorkflowDepth`／`maxWorkflowDescendants` 把關）。

**外部 ingress 安全：Host/Origin 白名單 + webhook 入口**（OIDC/OAuth 之外的過渡管控，永遠開啟、
不需設定）：
- HTTP handler 對每一條路由（`/mcp`、`/api/*`、`/dashboard`、`/hooks/*`）一致把關：外來 `Host`
  （DNS-rebinding）→ 403；帶有且非白名單的 `Origin`（瀏覽器 drive-by CSRF）→ 403；**缺少 `Origin`
  則放行**（fail-open，讓程式化 MCP client 不受影響）。白名單為 loopback + 設定的非 loopback
  `bind` 主機，做真正的 authority 比對（防前綴繞過）。
- `POST /hooks/:id`（webhook 入口，fail-closed）：驗證順序 id 存在且 enabled →
  `X-RWE-Signature: sha256=<hex>` HMAC-SHA256 常數時間比對（對原始 body bytes）→
  `X-RWE-Timestamp` ±300 秒內 → `X-RWE-Delivery` 去重（重放 → 200 不重跑）→ 啟動**預先綁定**的
  工作流程（名稱來自註冊，絕不取自 request body）。`webhook_create` 產生的 secret **只回傳一次**；
  `webhook_list` 只回 sha256 前綴指紋，永不回 secret 本身；註冊表持久化於 `webhookDbPath`。
- **`auth.enabled:false`（預設）且公開 `0.0.0.0` bind 時，任何能連到該 port 的人都能呼叫這些
  工具**——白名單只是無 auth 時的過渡管控；要多租戶存取管制請啟用 §1b 的 `auth` 區塊。

**當機可續跑（crash durability）**：引擎在開機恢復（`hydrateAll`）時把仍為 `running` 的 run
重新分類為 `interrupted`（可續跑、非終態，開機日誌印 `hydrateAll: … N re-classified
running→interrupted (resumable)`）；`run_resume({runId})` 即可續跑。已寫入日誌
（`journal.jsonl`）的 `agent()`／`workflow()` 呼叫從持久化日誌重播（不重打已結算的呼叫），只有
尚未完成的尾段真的重跑（與 suspend/resume 相同語意）。**已知注意事項**：當機瞬間正在飛行中（已
派發但尚未寫入日誌）的呼叫，續跑時會真的重跑（cache MISS，非靜默遺失）；若該次呼叫有非冪等副
作用可能重複，由工作流程作者負責冪等性。

**重用前先看用途（`workflow_describe`）**：`workflow_list` 每筆回傳 `{name, owner, versions,
channels, runnable}`（從不含腳本本文；`owner` 是註冊者的身分——啟用驗證時為登入的 email，
關閉驗證且未帶 `args.principal` 時該工作流程本來就沒有擁有者、該欄為 `null`；`user`
角色預設只列可執行的工作流程、`author`／`admin` 預設列全部，`onlyRunnable` 可明確指定）；腳本本文只有 `workflow_source({name, version?})` 這一個
出口（需 `author` 角色，非擁有者拿到 `scriptWithheld:true`）；
**`workflow_describe({name})` 是給「要不要用這個工作流程」的人看的單一說明面**
——用途、版本/頻道、階段、逐 agent 的可調參數契約、鎖定鍵、擁有者、回報問題方式、能不能跑
（`runnable`/`runnableReason`）以及作者附上的 **Mermaid 圖**（`mermaid`）。
`triggers` 是依 id 即時解析出來的快照（該版本自己的 `triggers[]` 欄位，加上排程／webhook 兩張表
回報為綁在這個名稱上的 id），每次呼叫都重新讀取；id 已被刪掉時該筆以
`status:"TRIGGER_NOT_FOUND"` 呈現。HTTP 版：
`GET /api/workflows/:name/describe`。任何 principal 都能呼叫（不看擁有者身份），回應**永遠不含
腳本本文**。**這條 HTTP 路由跟其他 `/api/*` 路由不同，不是無條件放行**：`auth.enabled:true`
時它套用跟 `/mcp` 完全一樣的 D-BIND 規則（見 §1b 最後的「`auth.enabled:true` 時的部署前提」
第 3 點），沒過就在讀取任何工作流程資料**之前**回 401 + `WWW-Authenticate`；`auth.enabled:false`
時維持開放。**擋下的時機很重要**：名稱存在與不存在都是同一個 401，未授權的呼叫端沒辦法靠
「回 404 還是回 200」去試探某個工作流程名稱存不存在。

結構圖由作者附上、引擎不畫圖：`workflow_register` 必須
帶一個非空的 **Mermaid** `mermaid` 字串（少了就 `MERMAID_REQUIRED`），圖裡的 stadium 節點
`id(["label"])` 要跟腳本的 `agent()` label 雙向完全對上（對不上就 `DIAGRAM_MISMATCH`）。
`workflow_describe` 的 `mermaid` 欄位設計上回傳這張圖的原文；沒有圖的版本回 `mermaid:null` +
`mermaidNote:"LEGACY_NO_DIAGRAM"`；`workflow_describe` 也接受 `version`／`channel` 指定要看哪個版本的圖。
儀表板顯示的是同一份。沒有重畫工具——要換圖就用新的 `mermaid` 重新註冊一個版本。
完整的圖語法（五種節點形狀、三種邊、`<br/>` 參數三元組、一邊一行、`subgraph`、迴圈邊必須帶標籤、
虛線＝跳過的路徑）見 `docs/AUTHORING.md`，或呼叫 `workflow_authoring_guide` 工具拿同一份文字；註冊時
圖或腳本被拒絕，錯誤都帶 `see:"workflow_authoring_guide"` 指回這份指南（認領觸發器的錯誤除外，見本節末）。

**註冊不呼叫任何模型**：`workflow_register` 只做本機靜態檢查，腳本本文不會送出這台機器。

**高效大型程式庫 seeding**：`/mcp` 請求體接受 `Content-Encoding: gzip|deflate`（雙重上限：壓縮
輸入 8 MiB + 解壓輸出 8×，防 gzip bomb）；超過上限回具型別 413
`{code:'BODY_TOO_LARGE',cap,phase,hint}`。內容定址 blob 儲存庫（CAS）：
`workspace_push({sha256,contentB64})` 伺服器 byte-verify、以計算出的 hash 存放（hash 對不上 →
`BLOB_HASH_MISMATCH`）；`workspace_diff({manifest})` 回傳此 namespace 尚須上傳的 blob；
`run_start` 的 `seedManifest`/`seedManifestRef` 從 CAS 組裝工作區，參照未上傳的 blob 在任何
持久化動作之前以 `MISSING_BLOBS` fail-fast。**namespace 一律由呼叫者身份推導**——`run_start` 沒有
`seedNamespace` 參數（封閉 schema，硬塞回 `INVALID_ARGUMENT`），HTTP 上傳端點不接受 `?namespace=`
（帶了回 400 `INVALID_BLOB_REQUEST`）。**尚未支援**：per-tenant quota +
immutable-pool GC。同樣受 Host/Origin 白名單過渡管控，非公開端點。

**本機小模型能力上限（非程式碼缺陷）**：`agent()` 工具迴圈（讀檔/寫檔）對本機 7B 級 Ollama 模型
不會真的執行——即使送給模型的工具清單已縮減到最小集合，模型仍只回傳編造的、看起來像工具呼叫結果
的文字，從未真正發出 `tool_use`。這是 REQ-003 核心驗收標準在小模型上的已知能力上限（已排除模型
本身不支援 tool-calling 的可能——直接對 Ollama 原生 API 測試正常），不是待修的程式碼缺陷。若部署
需要 agent 真的讀寫檔案，請改用較大的本機模型（例如 32B 級）或已驗證憑證的付費供應商。

**續跑後顯示瑕疵（非阻斷）**：被 `run_suspend`/`run_stop` 中止的那次 agent 呼叫，其紀錄
會永遠停在 `"state":"running"`，續跑後會多出一筆新紀錄；最終 `result` 本身正確，純屬輪詢畫面上的
顯示瑕疵。

**`gateway:"direct-fetch"`**：不需要真實 SDK CLI 子行程（不受上方小模型工具迴圈限制影響——本來就
不宣稱有工具迴圈能力）、不需要 `@anthropic-ai/claude-agent-sdk` 套件的部署環境相容性，適合只需要
純 `fetch()`-shaped provider 呼叫、不需要工具迴圈的本機/內網部署（`"sdk"` 仍是零設定的建議預設）。

**子行程環境變數白名單（安全性）**：`gateway:"sdk"` 路徑產生的 `claude` CLI 子行程，環境變數是
明確白名單（`PATH`/`HOME`/`SHELL`/`LANG`/`LC_ALL`/`TMPDIR`/`TERM` + 覆寫過的
`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`），不會原封不動傳入整個 `process.env`——避免主機上其他
機密環境變數（如其他 provider 的 API key、雲端憑證）意外流入子行程。

**未驗證的真實依賴**：付費供應商（Anthropic/OpenAI/Gemini）需要一組 sandbox/test key 才能驗證
「真正成功呼叫」的情境（含這些供應商上工具迴圈是否正常，目前只在本機 Ollama 上確認過小模型限制）。
`gateway:"sdk"`（預設）+ 本機 Ollama 的純文字問答成功案例已驗證；部署到正式環境前，建議至少用一組
sandbox/test key 針對付費供應商跑一次 `agent()` 成功案例。


**觸發器與資產的生命週期**：`schedule_create`／`webhook_create` 的 `workflow` 是選填——不帶就建立一個
未認領的觸發器並回 id，再由 `workflow_register({triggers:[id]})` 綁定到那個版本；建立時不查目錄，
檢查在觸發當下做：未認領／工作流程不存在／未發布／不在 release 版本裡，各自被拒絕並記在該列的
`lastRefusalReason`／`refusalCount`（`schedule_list`／`webhook_list` 可看）。一個觸發器同時只能被一個
工作流程認領（`TRIGGER_ALREADY_CLAIMED`）。`workflow_deregister` 會釋放它名下的每一個觸發器（版本宣告的
與建立時就綁定的都算），回傳 `releasedTriggers[]`，觸發器本身不刪；同時刪掉 `<assetRoot>/<name>/` 整棵
資產樹。`schedule_setEnabled`／`schedule_delete` 成功時回 `{}`，要確認結果請再呼叫 `schedule_list`。
全域資產在 `workspace_list` 上標 `builtin:true`、`scope:"global"`，只有 `admin` 能推與刪。

**目前已知、尚未修復的缺陷（操作時要知道的現況）**

1. **偶發的 `suspend` → `resume` → 立刻 `failed`，而且 agent 的工作在終態之後還在跑**：
   實測 run `3977b82d`——`run_start` → 1 秒後 `run_suspend`（`suspended`）→ `run_resume`（`running`）
   → 8 毫秒後變成 `failed`，`transitions` 裡沒有對應的 `failed` 列、任何介面都沒有錯誤原因；
   而被重放的 agent 又跑了約 36 秒才產出真實輸出——**工作在終態之後被孤兒化**。
   把 suspend 延到 +3 秒重做一次則完全正常，無法穩定重現、尚未歸因：
   [issue #53](https://github.com/HsuJavis/remote-workflow-engine/issues/53)。
   **對策：suspend/resume 之後用 `run_status` 確認狀態，發現無故 `failed` 時把 run id 貼進該 issue。**

## §6b 標籤觸發式自動更新

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


