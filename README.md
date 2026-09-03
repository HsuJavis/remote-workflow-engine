# remote-workflow-engine

> 人類導向文件（繁體中文）。由 Gate 7.5 validator 依「實際把系統跑起來的步驟」撰寫——
> 下方 quickstart 就是驗證腳本：照著貼上執行若跑不起來，就是缺口。

## 這是什麼

一個可遠端操控的 **Claude 工作流程執行引擎**：把 Claude「Workflow 工具」產生的 `.js` 工作流程腳本
（用到 `phase()`、`log()`、`agent()`、`pipeline()`、`parallel()`、`budget`、具名 `workflow()` 等 API）
原封不動地跑在一台伺服器上，透過 **MCP Streamable HTTP** 介面遠端送出、追蹤、暫停/續跑/停止，並
把每個 `agent()` 呼叫真正路由到你設定的 LLM 供應商（Anthropic / OpenAI / Gemini / 本機 Ollama）。

**目前功能**：

- **工作流程執行**：`workflow_run`（一律指名已註冊的工作流程 `{name}`，見下「版本與發布頻道」；
  含 inline seed + CAS seedManifest + `seedManifestRef` + 可調參數 `overrides`）、`workflow_status`、
  `workflow_suspend`/`workflow_resume`/`workflow_stop`、當機可續跑（重啟後 `interrupted` → `workflow_resume`）
- **版本與發布頻道（v22）**：同一個工作流程名稱可以註冊多次——每次註冊都保留成一個新版本（`v1`、`v2`、…），
  舊版本不會被覆蓋。擁有者用 `workflow_publish({name,version,channel})` 把 `release`（穩定）或 `beta`
  （測試）頻道指到某個版本；`workflow_run({name})` 不指定版本時永遠跑 `release` 指到的版本（避免不小心
  跑到還在測試的草稿），`workflow_run({name,channel:'beta'})` 跑 beta，`workflow_run({name,version:'v3'})`
  可直接指定精確版本（優先權最高）。**已停止接受呼叫端直接夾帶腳本**：`workflow_run`/`workflow_resume`
  不再有 `script` 參數——必須先 `workflow_register` 註冊、再用 `workflow_run({name})` 執行（見下方使用範例）。
- **可調參數契約（tunable-parameter contract）**：工作流程腳本可在 `export const meta = { params: { knobs: {...}, args: {...} } }`
  宣告每個旋鈕的型別/預設值/允許範圍——`workflow_get`/`workflow_list` 不必讀腳本本文即可查出這份契約；
  呼叫端用 `workflow_run({overrides:{model?,effort?,timeoutMs?,appendPrompt?}})` 在契約範圍內覆寫、
  超出範圍即在送出當下被拒（`PARAM_OUT_OF_RANGE`/`PARAM_LOCKED`），從不留下半途而廢的 run；
  `prompt`/`tools`/`skills`/`mcp`/`workdir`/`cwd` 六個鍵永遠鎖定、呼叫端無法觸及。優先序：
  每次 `agent()` 呼叫自帶的選項 > 該次 run 的 `overrides` > 註冊時的 `defaults` > 引擎預設別名。
- **已知工作流程探索**：`workflow_register`/`workflow_publish`/`workflow_list`/`workflow_get`/
  `workflow_deregister`
- **一份看得懂的說明（`workflow_describe`）**：任何人（不必是擁有者）都能用
  `workflow_describe({name, version?, channel?})` 一次拿到「要不要用這個工作流程」需要知道的全部：
  用途、解析到的版本與是哪個頻道解析的、階段名稱、可調參數契約（含每個旋鈕的型別/預設值/上限）、
  被鎖定的鍵名、所有版本與頻道指向、擁有者、怎麼回報問題、目前綁了哪些觸發方式，以及一張
  **ASCII 結構圖**。回應裡**永遠沒有腳本本文**。
- **自動畫的結構圖**：註冊一個工作流程時，引擎會把腳本交給你設定的 LLM（`graphAnalyzer` 設定區塊）
  畫成一張只含結構的 ASCII 圖（階段、模型別名、分支、迴圈），存在該版本名下。**畫圖失敗不會影響註冊**
  ——`workflow_describe` 會誠實回 `diagram:null` + `diagramStatus:"unavailable"` + 一句原因，
  不會拿一張退化的假圖充數。擁有者可用 `workflow_regenerate_diagram({name,version})` 重畫。
  `graphAnalyzer.enabled:false` 可完全關閉（連腳本都不會送出）。
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
- **儀表板**：`GET /dashboard`（首頁：工作流程卡片按 RUNNING/REGISTERED/OTHER 分組，各附描述 +
  可靠性指標；點進工作流程可看它的 ASCII 結構圖，畫不出來時顯示原因；System 面板：即時主機資源；
  Models 面板：模型目錄）、`GET /dashboard/issues`（Issues 頁面：Open/Resolved 分組、點擊顯示 detail）、
  `GET /dashboard/<runId>`（run 詳情：DAG + 逐字稿）
- **可觀測性**：`GET /api/home`（首頁工作流程分組 JSON）、`GET /api/status`（agentSemaphore）、
  `GET /api/system`（主機 + 行程快照）、`GET /api/models`（統一模型目錄）、
  `GET /api/issues`、`GET /api/issues/:number`
- **OAuth 2.0 身份認證（v15+，opt-in）**：引擎自身即授權伺服器，以 Google 為 IdP；支援
  **RFC 7591 Dynamic Client Registration**（`POST /register`），讓 Claude Code 等 MCP 用戶端
  可零設定自行取得 `client_id`（v17，解決「Incompatible auth server: does not support dynamic client registration」）；
  MCP client 走 authorization-code + PKCE + loopback-redirect 流程取得引擎 opaque bearer；`/authorize`
  在寫入 state 前驗證 `redirect_uri` 必須為 loopback URI（RFC 8252），含 registration 時一致強制；
  **OAuth2 `state` round-trip（v19，RFC 6749 §4.1.2）**：客戶端 `state` 參數由 `/authorize` 擷取、
  持久化至 `oauth_state.client_state`，並於最終 client redirect 回傳 `&state=<clientState>&iss=<issuer>`
  （RFC 9207），解決「OAuth state mismatch - possible CSRF attack」連線失敗；
  **refresh tokens（v20，RFC 6749 §6 / OAuth 2.1 / MCP offline_access）**：AS metadata 廣告
  `scopes_supported:["openid","email","offline_access"]` + `grant_types_supported:["authorization_code","refresh_token"]`；
  `offline_access` 流程核發 `refresh_token`（~90 天 TTL、sha256-at-rest）；`grant_type=refresh_token`
  輪換 token（RFC 9700 rotation，單次使用）；用戶端不需重新走瀏覽器登入即可在 access_token 到期後續用。
  **callback success page（v20 UX）**：`/oauth/google/callback` 改為 200 HTML（含 `id="callback-url"` 可複製 URL
  + meta-refresh/JS 自動轉跳），無論有無 loopback listener 都可操作。
  D-BIND fail-closed（非 loopback 來源若無有效 bearer → 401）；過期 auth 表列由 GC sweep 自動清除
  （`workspaceTtlMs` 正確從 composeConfig 傳遞）；
  工作流程擁有權（`NOT_WORKFLOW_OWNER`）；per-run principal attribution；`workflow_register` 綁定
  harness defaults（`HARNESS_DEFAULTS_INVALID`）。
  啟用方式：在 `rwe.config.json` 加入 `auth:{enabled:true,...}` 區塊（見 `rwe.config.example.json` / DEPLOY.md §1b 設定總表）。

共 **40 個** MCP 工具。

## 前置需求

- **Node.js 22.6 以上**（`tsx` 與沙箱子行程均依賴 Node 22 原生 TypeScript 支援）
- npm（隨 Node 附帶）
- **Python 3.11 或 3.12**（`gateway:"sdk"`（預設）需要 `litellm[proxy]`）。
  **要略過 Python/LiteLLM，必須同時關掉兩條會用到它的路徑**：`agent()` 呼叫，以及註冊時自動畫圖的
  分析器。也就是在 `rwe.config.json` 設 `gateway:"direct-fetch"` + `useLiteLLMProxy:false`（本機
  Ollama 直連），或設 `graphAnalyzer.enabled:false` 並且不呼叫 `agent()`。只要留著預設值，
  `workflow_register` 就會經由分析器走到 gateway，需要 `litellm` 在 `PATH` 上。
- 至少一個可用的 LLM 供應商（Anthropic / OpenAI / Gemini API key，或本機 Ollama）

## 快速開始 Quickstart

**一個乾淨的 checkout，一條指令：**

```bash
./deploy.sh --background
```

這會安裝依賴、建立設定檔、啟動服務、跑健康檢查——全部自動完成。無法自動化的步驟（例如缺
`uv`）會停下來並印出明確的下一步指示。停止服務：`kill $(cat .rwe.pid)`。

需要客製設定（模型別名、供應商 key）或想逐步手動操作時，展開版步驟與完整設定鍵說明見
`DEPLOY.md` §0 / §1b。最少需要的環境變數：

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # 若要用 anthropic 別名（或 OPENAI_API_KEY / GEMINI_API_KEY / 本機 Ollama 免金鑰）
# export RWE_SECRET_GITHUB_TOKEN=...    # 若要用 issue_report/Issues 儀表板
./deploy.sh --background
```

## 使用範例

```bash
# 第一步：註冊一個工作流程（inline script 已停止接受，一律要先註冊、再指名執行）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_register","arguments":{"name":"greet","script":"return {answer:42,tags:[\"a\",\"b\"]}"}}}'
# -> {"result":{"content":[{"type":"text","text":"{\"status\":\"completed\",\"version\":1,\"result\":{\"name\":\"greet\",\"version\":\"v1\"}}"}]}}
# 每次 workflow_register 都是新版本（v1、v2、…），舊版本不會被覆蓋或刪除。

# 第二步：把該版本發布到 release 頻道（沒發布過的頻道跑不了，見下方 CHANNEL_UNPUBLISHED）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_publish","arguments":{"name":"greet","version":"v1","channel":"release"}}}'

# 第三步：指名執行（不帶 version/channel = 跑 release 指到的版本）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_run","arguments":{"name":"greet"}}}'
# -> {"result":{"content":[{"type":"text","text":"{\"runId\":\"...\",\"status\":\"completed\",\"result\":{\"answer\":42,\"tags\":[\"a\",\"b\"]}}"}]}}
# 也可以指名 {"channel":"beta"} 跑 beta 版本，或 {"version":"v1"} 跑指定版本（優先權最高）；
# 未發布過的頻道會被拒絕：{"error":{"code":"CHANNEL_UNPUBLISHED","message":"CHANNEL_UNPUBLISHED: beta (workflow 'greet')"}}

# 跑包含 agent() 的工作流程（需要 gateway:"sdk" + LiteLLM + 供應商 key）——一樣先註冊、發布、再指名執行
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_register","arguments":{"name":"ping","script":"return await agent(\"just reply PONG\")"}}}'
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_publish","arguments":{"name":"ping","version":"v1","channel":"release"}}}'
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_run","arguments":{"name":"ping"}}}'
# 用回傳的 runId 輪詢狀態：
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"workflow_status","arguments":{"runId":"<上面的 runId>"}}}'
# -> status:"completed"  result:"PONG"  agents[0].provider/model/tokens
# -> result.scriptVersion 永遠是這次 run 實際執行的版本，即使之後又註冊了新版本也不會變

# 註冊一個宣告可調參數契約的工作流程，並在執行時覆寫（v21）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_register","arguments":{"name":"greet2","script":"export const meta = { params: { knobs: { model: { type: \"enum\", enum: [\"local\"] } } } };\nreturn await agent(\"hi\");","defaults":{"model":"local"}}}}'
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_publish","arguments":{"name":"greet2","version":"v1","channel":"release"}}}'
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_run","arguments":{"name":"greet2","overrides":{"effort":"high","appendPrompt":"回覆請用中文"}}}}'
# -> effort 超出宣告範圍或 appendPrompt 過長會在送出當下被拒（PARAM_OUT_OF_RANGE），從不留下半途而廢的 run
# 用 workflow_get 查看契約（不必讀腳本本文）：
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_get","arguments":{"name":"greet2"}}}'
# -> params.knobs.model.enum = ["local"]
# 用非擁有者（或 auth 關閉時的匿名者）的身份呼叫 workflow_get，腳本本文會被遮蔽（v22）：
# -> {"scriptWithheld":true, ...其餘欄位（name/version/channels/owner/params/如何回報問題）照常回傳，就是沒有 script}
# workflow_list、/api/workflows*、GET /api/runs/:id/dag（跑過的 run 的即時 DAG 圖）、儀表板
# 同樣一致遮蔽，沒有後門端點能看到未授權的腳本本文。

# 看一個工作流程「在做什麼」——任何人都能問，回應永遠沒有腳本本文
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_describe","arguments":{"name":"greet"}}}'
# -> {name, version, resolvedBy, channels, versions, description, phases, params, lockedKeys,
#     owner, reportProblem, triggers, diagram, diagramStatus, diagramNote, diagramGeneratedAt, diagramStale}
# diagramStatus:"ready" 時 diagram 是一張 ASCII 結構圖；"pending" 表示還在畫；
# "unavailable" 表示畫不出來（diagramNote 會說原因，例如「The diagram generator timed out.」），
# 此時 diagram 是 null——不會給你一張退化的假圖。
# triggers 是「現在」綁在這個工作流程上的觸發方式（cron/webhook/chain），每次呼叫都重新讀取；
# 綁定變動後圖還沒重畫時，diagramStale 會是 true。
# 同樣的內容也有 HTTP 版：curl -s http://127.0.0.1:8787/api/workflows/greet/describe

# 擁有者重畫某個版本的圖（非擁有者會被拒：NOT_WORKFLOW_OWNER）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_regenerate_diagram","arguments":{"name":"greet","version":"v1"}}}'
# -> {"queued":true,"status":"pending"}（立刻回，不會等畫完）

# 查詢 40 個 MCP 工具（含 schema）
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
9. **Inline script 已關閉**：`workflow_run`/`workflow_resume` 不再接受呼叫端夾帶的 `script`；`tools/list` 的 schema 上根本沒有這個欄位，就算硬塞也在送出當下被拒（`INLINE_SCRIPT_CLOSED`）。腳本一律要先 `workflow_register`，靜態檢查（語法解析、模型別名、MCP 名稱是否已 provision）也移到註冊當下做，不會因為改用具名執行就少檢查。
10. **非擁有者遮蔽腳本本文（僅 `auth.enabled:true` 時生效）**：啟用 auth 後，`workflow_get`/`workflow_list`、`/api/workflows*`、儀表板對非擁有者一律回傳 `scriptWithheld:true`、不含腳本本文；擁有者仍可看到完整腳本。`auth.enabled:false`（單人本機部署的預設）沒有「非擁有者」這個概念——任何人都能看到完整腳本，不遮蔽。
11. **SSRF-safe seedRef**：`seedRef:{repoUrl,sha}` 由 `HardenedSeedRefFetcher` 拉取；URL 必須匹配 `seedRefAllowlist`，否則 `SEEDREF_EGRESS_DENIED`；省略 allowlist 則全部 `SEEDREF_DISABLED`（fail-closed）；hardened git subprocess，不轉 shell。

## 已知限制

- **本機 7B 小模型工具呼叫**：`qwen2.5:7b` 透過 SDK gateway 不會真的觸發 tool_use，只生成看起來像工具結果的文字。建議使用 32B 以上本機模型或付費供應商（Anthropic/OpenAI/Gemini）。
- **OAuth 2.0 auth 為 opt-in**：`auth.enabled:false`（預設／省略）= 無 auth 開放行為（任何連得到 `/mcp` 的人皆可呼叫）；啟用後需要 Google Cloud Console client_id/secret，且引擎需有 HTTPS 公開 callback URL（`/oauth/google/callback`，讓 Google 能回呼）。
- **docker/sudo 部署未驗證**：環境沒有 docker 也沒有 sudo，docker-compose 與 root systemd 路徑未跑過（僅語法驗證）；npm path 路徑 + systemd user service 已對真實 process 驗證。
- **`workflow_status.agents[]` 暫停後 state 不自動更新**：被 suspend/stop 的 agent 記錄永遠停在 `"running"`；續跑後會多出一筆新紀錄，純屬顯示瑕疵。
- **註冊會把腳本送給 LLM**：畫結構圖需要讀懂腳本，所以 `workflow_register` 會把**腳本本文**送到
  `graphAnalyzer.model` 指到的供應商。這是這個功能的本質，不是缺陷；不想送出就設
  `graphAnalyzer.enabled:false`（唯一且完整的開關）。
- **小模型畫不出合格的圖**：出廠預設畫圖 prompt 假設模型能「只輸出圖、不夾帶其他文字」。本機 7B 級
  模型（如 `qwen2.5:7b`）常會多寫字或用到規定外的符號，被把關擋下 → `diagramStatus:"unavailable"`。
  這是模型能力問題，處置方式是換 `graphAnalyzer.model` 或改寫 `graphAnalyzer.systemPrompt`
  （改設定即可，不必改程式、不必重新編譯）。
- **腳本沒有宣告步驟（`phase()`／`meta.phases`）就畫不出圖**：把關清單只收錄「腳本裡真的出現過的
  名字」——步驟標題、模型別名、觸發方式。一個完全沒宣告步驟的腳本，等於沒給模型任何可用的節點名稱，
  模型只好自己編，然後被擋下 → `diagramStatus:"unavailable"`、`diagramNote` 寫
  「produced content outside the allowed vocabulary」。**處置**：在腳本裡用 `phase('取資料')` 之類
  的呼叫（或 `export const meta = { phases: [...] }`）標出步驟，再 `workflow_regenerate_diagram`
  重畫。不論有沒有圖，`workflow_describe` 的 `triggers` 欄位永遠是即時正確值。
- **沒有 `litellm` 時的行為**（`PATH` 上找不到 `litellm` 執行檔）：
  - `gateway:"sdk"`（預設）：**服務會直接拒絕啟動**，並印出一行明確訊息
    `fatal startup error: Error: litellm proxy failed to spawn: spawn litellm ENOENT`。不會半開著。
  - `gateway:"direct-fetch"` + `useLiteLLMProxy:true`：服務正常啟動，只有真正要用到代理的呼叫
    （`agent()`、註冊時畫圖）會乾淨地失敗成 `PROVIDER_UNREACHABLE`，服務本身不受影響。

  兩種情況的處置都一樣：照「前置需求」把 venv 的 `bin/` 加進 `PATH`，或改用
  `gateway:"direct-fetch"` + `useLiteLLMProxy:false`（本機 Ollama 直連，完全不需要 litellm）。

## 更多

- 部署 / 維運：見 `DEPLOY.md`
- 設計與追溯：見 `.sdlc/`（工作區索引 `.sdlc/dashboard.html`；本功能 `.sdlc/features/001-remote-workflow-engine/dashboard.html`）
- 完整真實層驗證證據：`.sdlc/features/001-remote-workflow-engine/08-validation.md`
