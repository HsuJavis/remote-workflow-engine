# remote-workflow-engine

> 人類導向文件（繁體中文）。由 Gate 7.5 validator 依「實際把系統跑起來的步驟」撰寫——
> 下方 quickstart 就是驗證腳本：照著貼上執行若跑不起來，就是缺口。

## 這是什麼

一個可遠端操控的 **Claude 工作流程執行引擎**：把 Claude「Workflow 工具」產生的 `.js` 工作流程腳本
（用到 `phase()`、`log()`、`agent()`、`pipeline()`、`parallel()`、`budget`、具名 `workflow()` 等 API）
原封不動地跑在一台伺服器上，透過 **MCP Streamable HTTP** 介面遠端送出、追蹤、暫停/續跑/停止，並
把每個 `agent()` 呼叫真正路由到你設定的 LLM 供應商（Anthropic / OpenAI / Gemini / 本機 Ollama）。

**目前功能（v15，2026-08-18）**：

- **工作流程執行**：`workflow_run`（含 inline seed + CAS seedManifest + `seedManifestRef` + `scriptSha256`
  完整性守衛）、`workflow_status`、`workflow_suspend`/`workflow_resume`/`workflow_stop`、
  當機可續跑（重啟後 `interrupted` → `workflow_resume`）
- **已知工作流程探索**：`workflow_register`/`workflow_list`/`workflow_get`/`workflow_deregister`、
  預測靜態 DAG 骨架（`workflow_get.skeleton`）
- **串接**：`chain_create`/`chain_list`（完成即啟動下游 run，恰好一次）
- **排程**：`schedule_create`/`schedule_list`/`schedule_delete`/`schedule_setEnabled`（cron/once/resident）
  + `workflow_trigger`
- **資產同步**：`asset_push`/`asset_list`/`asset_delete`（skill/MCP config；hook 明確不支援，schema 自述 `HOOKS_UNSUPPORTED`）
- **MCP provisioning**：`mcp_provision`（伺服器端依名 MCP server 註冊，secret handle `${secret:NAME}`）
- **Webhook**：`webhook_create`/`webhook_list`/`webhook_delete`（HMAC-SHA256 驗簽、deliveryId 去重）
- **高效 seeding**：`blob_put`/`seed_plan`（CAS sha256 去重）；`/mcp` 接受 `Content-Encoding: gzip|deflate`；
  `POST /assets/blob/:sha`（streaming raw-body 大檔案上傳，bypass 8MiB JSON-RPC cap）；
  `POST /assets/manifest`（manifest-as-CAS-blob，`seedManifestRef = sha256(bytes)`，可由用戶端自行推導）；
  engine-pull `seedRef:{repoUrl,sha}`（`HardenedSeedRefFetcher`，SSRF-safe egress allowlist，`seedRefAllowlist:[]` 省略則 `SEEDREF_DISABLED`）
- **問題回報**：`issue_report`（版本欄位自動填入，caller 可覆寫；`issue_list`/`issue_get`/`issue_comments`/`issue_comment`）
- **系統監控**：`system_info`（CPU 負載 + 核心數 + 利用率 %、記憶體 total/used/free、磁碟、引擎行程 + 主機 Top-N 行程 + 系統行程統計，`GET /api/system`）
- **模型目錄**：`models_list`（跨供應商統一目錄，含 `capability`/`stability`/`costLevel 0–10`/`modalities`/`ref` 等豐富欄位，支援多維篩選，`GET /api/models`）
- **儀表板**：`GET /dashboard`（首頁：工作流程卡片按 RUNNING/REGISTERED/OTHER 分組，各附描述 + 小型骨架預覽 +
  可靠性指標；System 面板：即時主機資源；Models 面板：模型目錄）、`GET /dashboard/issues`（Issues 頁面：Open/Resolved 分組、點擊顯示 detail）、
  `GET /dashboard/<runId>`（run 詳情：DAG + 逐字稿）
- **可觀測性**：`GET /api/home`（首頁工作流程分組 JSON）、`GET /api/status`（agentSemaphore）、
  `GET /api/system`（主機 + 行程快照）、`GET /api/models`（統一模型目錄）、
  `GET /api/issues`、`GET /api/issues/:number`
- **OAuth 2.0 身份認證（v15，opt-in）**：引擎自身即授權伺服器，以 Google 為 IdP；MCP client
  走 authorization-code + PKCE + loopback-redirect 流程取得引擎 opaque bearer；D-BIND fail-closed（非
  loopback 來源若無有效 bearer → 401）；工作流程擁有權（`NOT_WORKFLOW_OWNER`）；per-run principal
  attribution；`workflow_register` 綁定 harness defaults（`HARNESS_DEFAULTS_INVALID`）。
  啟用方式：在 `rwe.config.json` 加入 `auth:{enabled:true,...}` 區塊（見 `rwe.config.example.json` / DEPLOY.md §1 設定總表）。

共 **37 個** MCP 工具。

## 前置需求

- **Node.js 22.6 以上**（`tsx` 與沙箱子行程均依賴 Node 22 原生 TypeScript 支援）
- npm（隨 Node 附帶）
- **Python 3.11 或 3.12**（`gateway:"sdk"` 路徑需要 `litellm[proxy]`；純工作流程邏輯不呼叫 `agent()`
  則可略過 Python/LiteLLM）
- 至少一個可用的 LLM 供應商（Anthropic / OpenAI / Gemini API key，或本機 Ollama）

## 快速開始 Quickstart

以下指令是 v15 validator 實際跑過、能把系統帶起來的步驟（本輪零文件缺口）。

```bash
# 1. 安裝 Node 依賴
npm install

# 2. 型別檢查（健檢，非啟動必需）
npm run typecheck

# 3. 準備 LiteLLM 子行程需要的 Python 3.12（一次性設定；agent() 會用到）
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv python install 3.12
uv venv --python 3.12 ~/.rwe-litellm-venv
uv pip install --python ~/.rwe-litellm-venv/bin/python "litellm[proxy]"
export PATH="$HOME/.rwe-litellm-venv/bin:$PATH"   # 每次啟動伺服器前都要在 PATH 上（見 DEPLOY.md）

# 4. 設定模型別名 / 供應商
cp rwe.config.example.json rwe.config.json
# 用編輯器打開 rwe.config.json，調整 aliases / bind / port / workRoot / gateway
# 預設 "gateway":"sdk"（@anthropic-ai/claude-agent-sdk headless session）
# workRoot 必須在任何 .git/CLAUDE.md 祖先之外（見 DEPLOY.md §0 步驟 4）

# API key 一律用環境變數，不放進設定檔
export ANTHROPIC_API_KEY=sk-ant-...     # 若要用 anthropic 別名
# export OPENAI_API_KEY=...            # 若要用 openai 別名
# export RWE_SECRET_GITHUB_TOKEN=...   # 若要用 issue_report/Issues 儀表板

# 5. 啟動
node node_modules/tsx/dist/cli.mjs src/main.ts
# 或用 npm：npm run start
# -> [remote-workflow-engine] listening on http://127.0.0.1:8787/mcp (workRoot=...)
# -> [remote-workflow-engine] ready

# ── 已部署為 systemd user service 時，重啟以套用程式碼更新：
# systemctl --user restart rwe.service
```

## 使用範例

```bash
# 跑一個簡單工作流程（立刻完成）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_run","arguments":{"script":"return {answer:42,tags:[\"a\",\"b\"]}"}}}'
# -> {"result":{"content":[{"type":"text","text":"{\"runId\":\"...\",\"status\":\"completed\",\"result\":{\"answer\":42,\"tags\":[\"a\",\"b\"]}}"}]}}

# 跑包含 agent() 的工作流程（需要 gateway:"sdk" + LiteLLM + 供應商 key）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_run","arguments":{"script":"return await agent(\"just reply PONG\")","agentModel":"local"}}}'
# 用回傳的 runId 輪詢狀態：
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"workflow_status","arguments":{"runId":"<上面的 runId>"}}}'
# -> status:"completed"  result:"PONG"  agents[0].provider/model/tokens

# 查詢 37 個 MCP 工具（含 schema）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# 查詢主機系統資源（CPU / 記憶體 / 磁碟 / 引擎行程 / Top-N 行程）
curl -s http://127.0.0.1:8787/api/system
# -> {cpu:{cores,loadAvg,utilizationPct}, memory:{totalBytes,...,usedPct}, disk:{path,...}, process:{self,topN,system}, sampledAt}

# 查詢統一模型目錄（含 capability / stability / costLevel 0–10）
curl -s http://127.0.0.1:8787/api/models
# -> [{provider,model,capability,stability,costLevel,modalities,ref,...},...]

# 透過 MCP 查詢模型目錄（支援多維篩選）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"models_list","arguments":{"location":"remote","toolUse":true,"maxPricePerM":1}}}'

# 儀表板（瀏覽器直接開）
open http://127.0.0.1:8787/dashboard           # run 清單 + DAG
open http://127.0.0.1:8787/dashboard/issues    # Issues 頁面（Open/Resolved 分組）

# Issues REST API
curl -s http://127.0.0.1:8787/api/issues            # {open:[...], resolved:[...]}
curl -s http://127.0.0.1:8787/api/issues/7          # full IssueView
curl -s http://127.0.0.1:8787/api/issues/999999     # 404 {error:string}

# 回報問題（GitHub issue，RWE_SECRET_GITHUB_TOKEN 必須設定）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"issue_report","arguments":{"title":"...", "reproSteps":"...", "version":"v1.4.0", "analysis":"...", "logs":"..."}}}'
# version 欄位選填：省略時引擎自動填入 pkg.version + git-describe
```

```bash
# Dashboard JSON REST API
curl -s http://127.0.0.1:8787/api/home           # 首頁工作流程分組 {running,registered,other}
curl -s http://127.0.0.1:8787/api/runs           # 列出所有 run（含即時狀態）
curl -s http://127.0.0.1:8787/api/runs/<runId>   # run 詳情（phase/agent tree）
curl -s http://127.0.0.1:8787/api/runs/<runId>/dag   # composite 呼叫樹（DAG）
curl -s http://127.0.0.1:8787/api/workflows          # 已註冊工作流程目錄
curl -s http://127.0.0.1:8787/api/status             # agentSemaphore 即時狀態
```

```bash
# Webhook（HMAC-SHA256 驗簽，secret 只回一次）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"webhook_create","arguments":{"name":"my-hook","workflow":"daily-report"}}}'
# -> {webhookId, secret (只出現一次), url}

# 排程（須先 workflow_register）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"schedule_create","arguments":{"kind":"cron","workflow":"daily-report","cron":"0 3 * * *","enabled":true}}}'
```

## 安全模型

`gateway:"sdk"` 路徑的關鍵安全設定（均已對真實 process 驗證）：

1. **不用 `permissionMode:'bypassPermissions'`**：headless session 但每次工具呼叫均受裁決。
2. **預設工具面**：`Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash`（限制在 run workspace 之內）；
   `WebFetch`/`WebSearch`/`Task`/`Agent` 需明確 opt-in。
3. **供應商 API key 只給 LiteLLM 子行程**：`claude` CLI 子行程環境變數白名單，從未看到真實 key。
4. **workRoot 隔離**：run workspace 透過 `canUseTool` + `PreToolUse` 雙重 realpath 邊界封閉；
   `workRoot` 若在 `.git`/`CLAUDE.md` 祖先之內 → 啟動時 `WORKROOT_INSIDE_PROJECT` fail-fast。
5. **Host/Origin 白名單**：外來 Host → 403 防 DNS-rebinding；非白名單 Origin POST → 403 防 CSRF。
6. **Webhook HMAC**：常數時間比對 `X-Hub-Signature-256`；deliveryId 去重；±300s 時戳窗口。
7. **伺服器端 secret**：config 內 `${secret:NAME}` → 由 `RWE_SECRET_<NAME>` 解析；缺失 → `SECRET_MISSING`；字面值永不外洩。
8. **Redact-at-capture**：`SecretValueProvider.entries()` 拿到所有 provisioned secret 的明文；每次寫入逐字稿/快照/日誌/SDK-capture 前，均先呼叫 `redact({name,value}[])` 把值替換為 `‹secret:NAME›` marker（4 個 sink：appendTranscript/saveSnapshot/appendJournal（整個 JournalEntry 含 key.prompt）/SDK-capture；DES-088 invariant b：工作流程的最終回傳值（script `return` 的內容）維持原始值，不做 redact）。
9. **scriptSha256 完整性守衛**：`workflow_run` 可選填 `scriptSha256`（十六進位 sha256）；提供時引擎在 `createRun` 前用 `assertScriptIntegrity` 比對，雜湊不符 → `SCRIPT_SHA_MISMATCH`（403）；命名 workflow + sha 無意義 → `SCRIPT_SHA_WITHOUT_SCRIPT`（400）。
10. **SSRF-safe seedRef**：`seedRef:{repoUrl,sha}` 由 `HardenedSeedRefFetcher` 拉取；URL 必須匹配 `seedRefAllowlist`，否則 `SEEDREF_EGRESS_DENIED`；省略 allowlist 則全部 `SEEDREF_DISABLED`（fail-closed）；hardened git subprocess，不轉 shell。

## 已知限制

- **本機 7B 小模型工具呼叫**：`qwen2.5:7b` 透過 SDK gateway 不會真的觸發 tool_use，只生成看起來像工具結果的文字。建議使用 32B 以上本機模型或付費供應商（Anthropic/OpenAI/Gemini）。
- **OAuth 2.0 auth 為 opt-in**：`auth.enabled:false`（預設／省略）= 保持 v14 前無 auth 開放行為；啟用後需要 Google Cloud Console client_id/secret，且引擎需有 HTTPS 公開 callback URL（`/oauth/google/callback`，讓 Google 能回呼）。
- **docker/sudo 部署未驗證**：環境沒有 docker 也沒有 sudo，docker-compose 與 root systemd 路徑未跑過（僅語法驗證）；npm path 路徑 + systemd user service 已對真實 process 驗證。
- **`workflow_status.agents[]` 暫停後 state 不自動更新**：被 suspend/stop 的 agent 記錄永遠停在 `"running"`；續跑後會多出一筆新紀錄，純屬顯示瑕疵。

## 更多

- 部署 / 維運：見 `DEPLOY.md`
- 設計與追溯：見 `.sdlc/`（工作區索引 `.sdlc/dashboard.html`；本功能 `.sdlc/features/001-remote-workflow-engine/dashboard.html`）
- 完整真實層驗證證據：`.sdlc/features/001-remote-workflow-engine/08-validation.md`
