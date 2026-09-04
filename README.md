# remote-workflow-engine

> 人類導向文件（繁體中文）。由 Gate 7.5 validator 依「實際把系統跑起來的步驟」撰寫——
> 下方 quickstart 就是驗證腳本：照著貼上執行若跑不起來，就是缺口。

## 這是什麼

一個可遠端操控的 **Claude 工作流程執行引擎**：把 Claude「Workflow 工具」風格的 `.js` 工作流程腳本
（用到 `phase()`、`log()`、`agent()`、`pipeline()`、`parallel()`、`budget`、具名 `workflow()` 等 API）
跑在一台伺服器上，透過 **MCP Streamable HTTP** 介面遠端送出、追蹤、暫停/續跑/停止，並
把每個 `agent()` 呼叫真正路由到你設定的 LLM 供應商（Anthropic / OpenAI / Gemini / 本機 Ollama）。

**目前功能**：

- **工作流程執行**：`run_start`（一律指名已註冊的工作流程 `{name}`，見下「版本與發布頻道」；
  含 inline seed + CAS seedManifest + `seedManifestRef` + 每個 agent 各自的 `overrides`）。
  **`run_start` 只回 `runId`，不回結果**——要拿結果得先 `run_status` 輪詢到終態，再 `run_result`；
  另有 `run_suspend`/`run_resume`/`run_stop`、`run_agent_log`（依腳本宣告的 agent label 讀該次 harness
  逐字稿）、`run_list`，以及當機可續跑（重啟後 `interrupted` → `run_resume`）
- **版本與發布頻道**：同一個工作流程名稱可以註冊多次——每次註冊都保留成一個新版本（`v1`、`v2`、…），
  舊版本不會被覆蓋。擁有者用 `workflow_publish({name,version,channel})` 把 `release`（穩定）或 `beta`
  （測試）頻道指到某個版本（三個參數都是必填，`version` 是 `workflow_register` 回傳的**字串**如 `'v1'`）；
  `run_start({name})` 不指定版本時永遠跑 `release` 指到的版本（避免不小心
  跑到還在測試的草稿），`run_start({name,channel:'beta'})` 跑 beta，`run_start({name,version:'v3'})`
  可直接指定精確版本（優先權最高）。**呼叫端不能直接夾帶腳本**：`run_start`/`run_resume`
  沒有 `script` 參數——必須先 `workflow_register` 註冊、再用 `run_start({name})` 執行（見下方使用範例）。
- **可調參數契約（tunable-parameter contract）**：腳本裡每一個 `agent('<label>', {...})` 都必須在
  `export const meta = { params: { agents: { '<label>': {...} }, args: {...} } }` 宣告對應的契約——
  `model`/`effort`/`timeoutMs` 三個鍵都是必填、且各自要有 `.default`（沒有「每個 agent 的隱含引擎預設」）；
  `workflow_describe` 不必讀腳本本文即可查出這份契約。
  呼叫端用 `run_start({overrides:{agents:{'<label>':{model?,effort?,timeoutMs?,appendPrompt?}}}})`
  **逐 agent** 覆寫（沒有「整個工作流程一次覆寫」的欄位，扁平寫法回 `PARAM_UNKNOWN`），
  超出範圍即在送出當下被拒（`PARAM_OUT_OF_RANGE`/`PARAM_LOCKED`），從不留下半途而廢的 run；
  `prompt`/`tools`/`skills`/`mcp`/`workdir`/`cwd` 六個鍵永遠鎖定、呼叫端無法觸及。優先序只有兩層：
  該次 run 的 `overrides.agents.<label>.<key>` > 腳本自己宣告的 `.default`——在 `agent()` 呼叫裡直接寫
  `model`/`effort`/`timeoutMs` 會在註冊當下被拒（`SCAN_VIOLATION`）。
  `meta.params.knobs` 會被拒絕（`DEFAULTS_RETIRED`）；註冊時的 `defaults` 參數目前會被靜默忽略（已知缺陷，見「已知限制」）。
- **已知工作流程探索**：`workflow_register`/`workflow_publish`/`workflow_list`/`workflow_deregister`/
  `workflow_authoring_guide`（引擎用自己的強制常數渲染的作者指南，也就是 `docs/AUTHORING.md`）。
  讀腳本本文的工具是 `workflow_source`（需要 `author` 角色；非擁有者拿到 `scriptWithheld:true` 的遮蔽投影），
  「這個工作流程在做什麼」則一律看 `workflow_describe`（見下）。
- **一份看得懂的說明（`workflow_describe`）**：任何人（不必是擁有者）都能用
  `workflow_describe({name})` 一次拿到「要不要用這個工作流程」需要知道的全部：
  用途、解析到的版本與是哪個頻道解析的、階段名稱、逐 agent 的可調參數契約（含型別/預設值/上限）、
  被鎖定的鍵名、所有版本與頻道指向、擁有者、怎麼回報問題、能不能跑（`runnable`/`runnableReason`），
  以及作者附上的 **Mermaid 結構圖**（`mermaid`）。回應裡**永遠沒有腳本本文**。
- **作者附上的結構圖**：`workflow_register` 必須帶一個非空的 **Mermaid** `mermaid`
  字串（少了就 `MERMAID_REQUIRED`），而且圖裡的 stadium 節點 `id(["label"])` 要跟腳本的 agent label
  **雙向完全對應**（對不上就 `DIAGRAM_MISMATCH`）。`workflow_describe` 設計上原文回傳這張圖（目前有一個已知缺陷讓它回 `null`，見「已知限制」）。
  **引擎不自己畫圖**，註冊也不會把腳本本文送給任何模型。
- **排程**：`schedule_create`/`schedule_list`/`schedule_delete`/`schedule_setEnabled`（cron/once/resident）。
  觸發器**先建立、再由工作流程認領**：`schedule_create`／`webhook_create` 都不需要 `workflow`，回一個 id，
  再交給 `workflow_register({triggers:[id]})` 綁定到某個版本（仍可在建立時直接帶 `workflow` 綁定）。
  沒被認領的觸發器到期時會被拒絕並把理由記在該列上（`lastRefusalReason`），不會靜默丟掉。
- **工作區與資產（`workspace_*`，六個工具）**：`workspace_push`（兩種模式：CAS blob `{sha256,contentB64}`，
  或工作流程名下的資產 `{workflow,kind:'skill'|'mcp',name,files?/config?}`；`scope:'global'` 的全域資產需
  `admin` 角色）、`workspace_diff`（比對 manifest 與自己的 blob 池，回還缺哪些）、
  `workspace_pull`（讀某個 run 工作區裡某個檔的位元組區間）、`workspace_list`（列某個 run 的工作區檔案，
  或某個工作流程名下某類資產）、`workspace_delete`、`workspace_purge`（刪掉已終止 run 的整個工作區）。
  hook 明確不支援：`kind:'hook'` 在 schema／模式判定就被擋掉，回 `INVALID_ARGUMENT`（v24 起
  `HOOKS_UNSUPPORTED` 不再列在 `workspace_push` 的 `errors[]`，因為沒有任何路徑會回它）；
  seed 裡的 `.claude/hooks/…` 則是在路徑判定時就被剝掉、根本不寫進工作區。**MCP server 現在就是一種資產**：
  `workspace_push({workflow, kind:'mcp', name, config})`（secret handle `${secret:NAME}`；`stdio`
  transport 需 `admin`）。
- **Webhook**：`webhook_create`/`webhook_list`/`webhook_delete`（HMAC-SHA256 驗簽、deliveryId 去重）
- **高效 seeding**：`workspace_push`（CAS 模式）/`workspace_diff`（CAS sha256 去重）；`/mcp` 接受 `Content-Encoding: gzip|deflate`；
  `POST /assets/blob/:sha`（streaming raw-body 大檔案上傳，bypass 8MiB JSON-RPC cap）；
  `POST /assets/manifest`（manifest-as-CAS-blob，`seedManifestRef = sha256(bytes)`，可由用戶端自行推導）；
  engine-pull `seedRef:{repoUrl,sha}`（`HardenedSeedRefFetcher`，SSRF-safe egress allowlist，`seedRefAllowlist:[]` 省略則 `SEEDREF_DISABLED`）
- **問題回報**：`issue_report`（版本欄位自動填入，caller 可覆寫；`issue_list`/`issue_get`/`issue_get_comments`/`issue_comment_post`；必填欄位是 `title`/`reproSteps`/`analysis`）
- **系統監控**：`system_info`（CPU 負載 + 核心數 + 利用率 %、記憶體 total/used/free、磁碟、引擎行程 + 主機 Top-N 行程 + 系統行程統計，`GET /api/system`）
- **模型目錄**：`models_list`（跨供應商統一目錄，含 `capability`/`stability`/`costLevel 0–10`/`modalities`/`ref` 等豐富欄位，支援多維篩選，`GET /api/models`）
- **儀表板**：`GET /dashboard`（首頁：工作流程卡片按 RUNNING/REGISTERED/OTHER 分組，各附描述 +
  可靠性指標；點進工作流程可看作者附上的 Mermaid 圖原文，沒有圖時顯示 `mermaidNote`；System 面板：即時主機資源；
  Models 面板：模型目錄）、`GET /dashboard/issues`（Issues 頁面：Open/Resolved 分組、點擊顯示 detail）、
  `GET /dashboard/<runId>`（run 詳情：DAG + 逐字稿）
- **可觀測性**：`GET /api/home`（首頁工作流程分組 JSON）、`GET /api/status`（agentSemaphore）、
  `GET /api/system`（主機 + 行程快照）、`GET /api/models`（統一模型目錄）、
  `GET /api/issues`、`GET /api/issues/:number`
- **OAuth 2.0 身份認證（opt-in）**：引擎自身即授權伺服器，以 Google 為 IdP；支援
  **RFC 7591 Dynamic Client Registration**（`POST /register`），讓 Claude Code 等 MCP 用戶端
  可零設定自行取得 `client_id`；
  MCP client 走 authorization-code + PKCE + loopback-redirect 流程取得引擎 opaque bearer；`/authorize`
  在寫入 state 前驗證 `redirect_uri` 必須為 loopback URI（RFC 8252），含 registration 時一致強制；
  **OAuth2 `state` round-trip（RFC 6749 §4.1.2）**：客戶端 `state` 參數由 `/authorize` 擷取、
  持久化至 `oauth_state.client_state`，並於最終 client redirect 回傳 `&state=<clientState>&iss=<issuer>`
  （RFC 9207）；
  **refresh tokens（RFC 6749 §6 / OAuth 2.1 / MCP offline_access）**：AS metadata 廣告
  `scopes_supported:["openid","email","offline_access"]` + `grant_types_supported:["authorization_code","refresh_token"]`；
  `offline_access` 流程核發 `refresh_token`（~90 天 TTL、sha256-at-rest）；`grant_type=refresh_token`
  輪換 token（RFC 9700 rotation，單次使用）；用戶端不需重新走瀏覽器登入即可在 access_token 到期後續用。
  **callback success page**：`/oauth/google/callback` 回 200 HTML（含 `id="callback-url"` 可複製 URL
  + meta-refresh/JS 自動轉跳），無論有無 loopback listener 都可操作。
  D-BIND fail-closed（非 loopback 來源若無有效 bearer → 401）；過期 auth 表列由 GC sweep 自動清除
  （`workspaceTtlMs` 正確從 composeConfig 傳遞）；
  工作流程擁有權（`NOT_WORKFLOW_OWNER`）；per-run principal attribution；
  角色（`principals`）：`workflow_register`/`workflow_deregister`/`workflow_publish`/`workflow_source`/
  `schedule_*`/`webhook_*` 需要 `author`，全域資產推送需要 `admin`（見 DEPLOY.md §1b「角色」）。
  啟用方式：在 `rwe.config.json` 加入 `auth:{enabled:true,...}` 區塊（見 `rwe.config.example.json` / DEPLOY.md §1b 設定總表）。

共 **35 個** MCP 工具（權威清單見 `src/tool-specs.ts`）。

## 前置需求

- **Node.js 22.6 以上**（`tsx` 與沙箱子行程均依賴 Node 22 原生 TypeScript 支援）
- npm（隨 Node 附帶）
- **Python 3.11 或 3.12**（`gateway:"sdk"`（預設）需要 `litellm[proxy]`）。
  LiteLLM 只有**一個**消費者：`agent()` 呼叫（`workflow_register` 不走 gateway）。要略過 Python/LiteLLM，在 `rwe.config.json` 設 `gateway:"direct-fetch"` +
  `useLiteLLMProxy:false`（本機 Ollama 直連）。留著預設值 `gateway:"sdk"` 卻沒裝 `litellm`，
  服務會在**開機階段**就拒絕啟動（見「已知限制」）。
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
# 第一步：註冊一個工作流程（一律要先註冊、再指名執行）
# mermaid 是必填：少了就 MERMAID_REQUIRED。這個腳本沒有 agent() 呼叫，
# 所以圖裡只要有一個矩形黑箱節點即可（stadium 節點才需要對上 agent label）。
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_register","arguments":{"name":"greet","script":"return {answer:42,tags:[\"a\",\"b\"]}","mermaid":"graph TD;\nout[\"return a fixed result\"]"}}}'
# -> {"result":{"content":[{"type":"text","text":"{\"status\":\"completed\",\"version\":1,\"result\":{\"name\":\"greet\",\"version\":\"v1\"}}"}]}}
# 每次 workflow_register 都是新版本（v1、v2、…），舊版本不會被覆蓋或刪除。

# 第二步：把該版本發布到 release 頻道（沒發布過的頻道跑不了，見下方 CHANNEL_UNPUBLISHED）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_publish","arguments":{"name":"greet","version":"v1","channel":"release"}}}'

# 第三步：指名執行（不帶 version/channel = 跑 release 指到的版本）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run_start","arguments":{"name":"greet"}}}'
# -> {"runId":"...","status":"<送出當下的狀態>","result":{"runId":"..."}}
# ⚠ run_start 只回 runId，不回結果。要拿結果：用這個 runId 輪詢 run_status 到終態，再 run_result。
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run_result","arguments":{"runId":"<上面的 runId>"}}}'
# -> result:{"answer":42,"tags":["a","b"]}（run 還沒到終態就回 RUN_NOT_TERMINAL）
# 也可以指名 {"channel":"beta"} 跑 beta 版本，或 {"version":"v1"} 跑指定版本（優先權最高）；
# 未發布過的頻道會被拒絕：{"error":{"code":"CHANNEL_UNPUBLISHED","message":"CHANNEL_UNPUBLISHED: beta (workflow 'greet')"}}

# 跑包含 agent() 的工作流程（需要 gateway:"sdk" + LiteLLM + 供應商 key）——一樣先註冊、發布、再指名執行
# agent() 第一個參數是「label」，prompt 走 options.prompt；每個 label 都要有
# meta.params.agents.<label> 契約（model/effort/timeoutMs，各自要有 .default），
# 而且 mermaid 的 stadium 節點要跟 label 一一對上。
# 腳本與圖寫成檔案、再組 JSON，比一長串跳脫好讀也好改：
cat > /tmp/ping.js <<'JS'
export const meta = {
  description: 'Reply with one word',
  params: { agents: { ping: {
    model: { type: 'string', default: 'default' },
    effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },
    timeoutMs: { type: 'number', default: 60000 },
  } } },
};
return await agent('ping', { prompt: 'Reply with only the word: PONG' });
JS
printf 'graph TD;\nping(["ping"])\n' > /tmp/ping.mmd
python3 - <<'PY' > /tmp/ping-register.json
import json
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
  "name":"workflow_register","arguments":{
    "name":"ping",
    "script":open('/tmp/ping.js').read(),
    "mermaid":open('/tmp/ping.mmd').read()}}}))
PY
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' -d @/tmp/ping-register.json
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_publish","arguments":{"name":"ping","version":"v1","channel":"release"}}}'
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run_start","arguments":{"name":"ping"}}}'
# 用回傳的 runId 輪詢狀態：
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run_status","arguments":{"runId":"<上面的 runId>"}}}'
# -> status:"completed"  agents[0].label/provider/model/tokens
# -> result.scriptVersion 永遠是這次 run 實際執行的版本，即使之後又註冊了新版本也不會變
# 到終態後用 run_result 取結果："PONG"；想看該次 agent 的 harness 逐字稿：
#   run_agent_log({runId, label:"ping"})——label 就是腳本裡宣告的那個，不是引擎內部編號。

# 註冊一個宣告可調參數契約的工作流程，並在執行時逐 agent 覆寫
cat > /tmp/greet2.js <<'JS'
export const meta = {
  description: 'Greet the caller in one sentence',
  params: { agents: { greet: {
    model: { type: 'string', default: 'default' },
    effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },
    timeoutMs: { type: 'number', default: 60000 },
    appendPrompt: { type: 'string', default: '' },
  } } },
};
return await agent('greet', { prompt: 'Say hello' });
JS
printf 'graph TD;\ngreet(["greet"])\n' > /tmp/greet2.mmd
python3 - <<'PY' > /tmp/greet2-register.json
import json
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
  "name":"workflow_register","arguments":{
    "name":"greet2",
    "script":open('/tmp/greet2.js').read(),
    "mermaid":open('/tmp/greet2.mmd').read()}}}))
PY
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' -d @/tmp/greet2-register.json
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_publish","arguments":{"name":"greet2","version":"v1","channel":"release"}}}'
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run_start","arguments":{"name":"greet2","overrides":{"agents":{"greet":{"effort":"high","appendPrompt":"回覆請用中文"}}}}}}'
# overrides 只有 agents 這一個頂層鍵，而且只能改「該 label 契約裡宣告過」的鍵：
#   扁平寫法 {"effort":"high"}              -> PARAM_UNKNOWN
#   沒宣告過的 label {"agents":{"nope":{}}} -> UNKNOWN_AGENT_LABEL
#   宣告範圍外的值 {"effort":"max"}          -> PARAM_OUT_OF_RANGE
#   鎖定鍵 {"prompt":"..."}                 -> PARAM_LOCKED
# 全部在送出當下就被拒，從不留下半途而廢的 run。
# 用 workflow_describe 查看契約（任何人都能問，回應永遠沒有腳本本文）：
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_describe","arguments":{"name":"greet2"}}}'
# -> params.agents.greet.effort.range = ["low","medium","high"]
# 要讀腳本本文用 workflow_source（需要 author 角色）。啟用 auth 後，非擁有者拿到的是遮蔽投影：
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_source","arguments":{"name":"greet2"}}}'
# -> 擁有者/admin：完整 script
# -> 非擁有者（auth.enabled:true 時才有這個概念）：{"scriptWithheld":true,
#    ...其餘欄位（name/version/channels/description/phases/owner/params/validation/
#    reportProblem）照常回傳，就是沒有 script}
# -> auth.enabled:false（單人本機部署的預設）沒有「非擁有者」，任何人都拿得到完整 script。
# workflow_describe、workflow_list、/api/workflows*、GET /api/runs/:id/dag、儀表板本來就不含腳本本文，
# 沒有後門端點能看到未授權的腳本本文。

# 看一個工作流程「在做什麼」——任何 principal 都能問（不必是擁有者），回應永遠沒有腳本本文
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_describe","arguments":{"name":"greet"}}}'
# -> {name, version, resolvedBy, channels:{release,beta}, versions, description, phases,
#     params:{agents,args}, lockedKeys, owner, reportProblem, triggers,
#     mermaid, mermaidNote, runnable, runnableReason}
# mermaid 設計上是註冊時作者附上的那張圖的原文；沒有圖的版本回 mermaid:null、mermaidNote:"LEGACY_NO_DIAGRAM"
# （目前有一個已知缺陷讓每個工作流程都回 null，見「已知限制」）。
# 還沒發布過任何頻道的工作流程，describe({name}) 直接回 CHANNEL_UNPUBLISHED（要看草稿就帶 {"version":"v1"}）；
# runnable:false + runnableReason:"LEGACY_REREGISTER" 表示這個版本沒有 meta.params.agents 契約，要重新註冊才能跑。
# triggers 是「現在」綁在這個工作流程上的排程/webhook，每次呼叫都依 id 重新讀取
# （schedule 與 webhook 兩張表的即時快照）；已被刪掉的 id 會以 status:"TRIGGER_NOT_FOUND" 出現。
# 同樣的內容也有 HTTP 版：curl -s http://127.0.0.1:8787/api/workflows/greet/describe
# 「任何 principal 都能問」指的是授權層級（不看擁有者身份），不等於「不需要驗證」：
# auth.enabled:true 時，這條 HTTP 路由跟 /mcp 走同一套 D-BIND 規則（見 DEPLOY.md §1b），
# 沒過就回 401 + WWW-Authenticate——而且是在讀到任何工作流程資料「之前」就擋下，
# 所以未授權的呼叫端連「這個名稱存不存在」都問不出來（存在與不存在都是同一個 401）。

# 查詢 35 個 MCP 工具（含 schema）
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
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"webhook_create","arguments":{"workflow":"daily-report"}}}'
# -> {webhookId, secret (只出現一次), url}

# 排程（`workflow` 必填，而且要先 workflow_register + workflow_publish；建立當下就綁定該工作流程）
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
9. **Inline script 已關閉**：`run_start`/`run_resume` 不接受呼叫端夾帶的 `script`；`run_start` 的 schema 是封閉的（`additionalProperties:false`），硬塞任何未宣告的欄位都在送出當下被拒（`INLINE_SCRIPT_CLOSED`／`INVALID_ARGUMENT`）。腳本一律要先 `workflow_register`，靜態檢查（語法解析、模型別名、MCP 名稱是否已推送、agent 契約、mermaid 對照）也全在註冊當下做，不會因為改用具名執行就少檢查。
10. **腳本本文只有一個出口，且對非擁有者遮蔽**：能回傳腳本本文的工具只有 `workflow_source`（需要 `author` 角色）。啟用 auth 後，它對非擁有者回傳 `scriptWithheld:true`、不含腳本本文；擁有者/admin 仍可看到完整腳本。`workflow_describe`／`workflow_list`／`/api/workflows*`／儀表板**在設計上就不含**腳本本文，不論身份。`auth.enabled:false`（單人本機部署的預設）沒有「非擁有者」這個概念——任何人都能透過 `workflow_source` 看到完整腳本。
11. **SSRF-safe seedRef**：`seedRef:{repoUrl,sha}` 由 `HardenedSeedRefFetcher` 拉取；URL 必須匹配 `seedRefAllowlist`，否則 `SEEDREF_EGRESS_DENIED`；省略 allowlist 則全部 `SEEDREF_DISABLED`（fail-closed）；hardened git subprocess，不轉 shell。
12. **角色（`principals`）fail-closed**：`rwe.config.json` 的 `principals` 角色字串打錯（不是 `admin`/`author`/`user`）→ 開機直接拒絕啟動，不會靜默退回 `user`；整個鍵省略時，`auth.enabled:true` 下每個已驗證呼叫者一律 `user`，且開機那行 `auth:` log 如實顯示（ADR-028）。`workspace_push({kind:"mcp"})` 的 `http` transport 同理受 `mcpEgressAllowlist` fail-closed：省略/不匹配 → `EGRESS_DENIED`，探測次數為零；`stdio` transport 與 `scope:'global'` 的推送都需要 `admin`（`stdio` 的這道檢查目前可被繞過，見「已知限制」）。

## 已知限制

- **本機 7B 小模型工具呼叫**：`qwen2.5:7b` 透過 SDK gateway 不會真的觸發 tool_use，只生成看起來像工具結果的文字。建議使用 32B 以上本機模型或付費供應商（Anthropic/OpenAI/Gemini）。
- **OAuth 2.0 auth 為 opt-in**：`auth.enabled:false`（預設／省略）= 無 auth 開放行為（任何連得到 `/mcp` 的人皆可呼叫）；啟用後需要 Google Cloud Console client_id/secret，且引擎需有 HTTPS 公開 callback URL（`/oauth/google/callback`，讓 Google 能回呼）。
- **docker/sudo 部署未驗證**：環境沒有 docker 也沒有 sudo，docker-compose 與 root systemd 路徑未跑過（僅語法驗證）；npm path 路徑 + systemd user service 已對真實 process 驗證。
- **`run_status.agents[]` 暫停後 state 不自動更新**：被 `run_suspend`/`run_stop` 中止的 agent 記錄永遠停在 `"running"`；續跑後會多出一筆新紀錄，純屬顯示瑕疵。
- **沒有 `litellm` 時的行為**（`PATH` 上找不到 `litellm` 執行檔）：
  - `gateway:"sdk"`（預設）：**服務會直接拒絕啟動**，並印出一行明確訊息
    `fatal startup error: Error: litellm proxy failed to spawn: spawn litellm ENOENT`。不會半開著。
  - `gateway:"direct-fetch"` + `useLiteLLMProxy:true`：服務正常啟動，只有真正要用到代理的呼叫
    （`agent()`——LiteLLM 唯一的消費者）會乾淨地失敗成 `PROVIDER_UNREACHABLE`，服務本身不受影響。

  兩種情況的處置都一樣：照「前置需求」把 venv 的 `bin/` 加進 `PATH`，或改用
  `gateway:"direct-fetch"` + `useLiteLLMProxy:false`（本機 Ollama 直連，完全不需要 litellm）。

- **目前已知、尚未修復的缺陷**（詳細指令與輸出見 `DEPLOY.md` §6）：
  只剩一條——**偶發的 `suspend` → `resume` → `failed`，而且 agent 的工作在終態之後還在跑**
  （run `3977b82d`，無法穩定重現、尚未歸因；
  [issue #53](https://github.com/HsuJavis/remote-workflow-engine/issues/53)）。
  v24 Gate 7.5 真跑挖出的另外十二條（圖讀不回來、觸發器只能建立時綁定又不被釋放、deregister 不刪資產目錄、
  `defaults` 被靜默忽略、stdio MCP 繞過 admin 閘門、錯誤碼漏出 JS class 名、錯誤訊息不指向
  `workflow_authoring_guide`、手冊教的圖語彙比引擎接受的少、別名沒出現在介面上……）
  **已於 2026-09-04 全部修復**，由 `tests/integration/` 下的 IT-125..IT-130 等項目釘住；
  它們的真實層（Gate 7.5）複驗尚未重跑，`08-validation.md` 裡對應的 VAL 列因此仍記為 `fail`。

## 更多

- 部署 / 維運：見 `DEPLOY.md`
- 設計與追溯：見 `.sdlc/`（工作區索引 `.sdlc/dashboard.html`；本功能 `.sdlc/features/001-remote-workflow-engine/dashboard.html`）
- 完整真實層驗證證據：`.sdlc/features/001-remote-workflow-engine/08-validation.md`
