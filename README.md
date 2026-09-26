# remote-workflow-engine

> 人類導向文件（繁體中文）。由 Gate 7.5 validator 依「實際把系統跑起來的步驟」撰寫——
> 下方 quickstart 就是驗證腳本：照著貼上執行若跑不起來，就是缺口。

## 這是什麼

一個可遠端操控的 **Claude 工作流程執行引擎**：把 Claude「Workflow 工具」風格的 `.js` 工作流程腳本
（用到 `phase()`、`log()`、`agent()`、`pipeline()`、`parallel()`、`budget`、具名 `workflow()` 等 API）
跑在一台伺服器上，透過 **MCP Streamable HTTP** 介面遠端送出、追蹤、暫停/續跑/停止，並
把每個 `agent()` 呼叫真正路由到你設定的 LLM 供應商（Anthropic / OpenRouter / 本機 Ollama）。

**目前功能**：

- **工作流程執行**：`run_start`（一律指名已註冊的工作流程 `{name}`，見下「版本與發布頻道」；
  含 inline seed + CAS seedManifest + `seedManifestRef` + 每個 agent 各自的 `overrides`）。省略
  `args`（排程/webhook 觸發天生就會省略）時，腳本讀到的是 `{}`，不是 `null`；腳本在
  `meta.params.args.<k>.default` 宣告的預設值會真的套用（materialize 進 `run_result.result`），
  不必自己寫 `args || {}` 防呆。
  **`run_start` 只回 `runId`，不回結果**——要拿結果得先 `run_status` 輪詢到終態，再 `run_result`；
  兩者在 **`status:'failed'`** 時都額外帶 `error:{code,message}`（腳本拋錯/逾時的實際原因，
  重啟引擎後仍答得出同一個原因，不必翻 sqlite）；`run_status`/`run_result`/`GET /api/runs/:id`
  三者若這次 run **呼叫過 `agent()` 且有任一個失敗**，也一起帶 `failedAgentCount`（失敗的 agent
  數，全部成功或尚未執行則省略此欄，不是填 `0`）——不必自己去讀 `agents[]` 逐筆檢查才能發現「這個
  run 裡面有東西垮了」。失敗的 run 也會在自己的 run 目錄留一行 `journal.jsonl` 記終態與原因，
  不是空目錄；儀表板的 run 詳情頁與清單列一樣會顯示這個失敗原因。
  另有 `run_suspend`/`run_resume`/`run_stop`、`run_agent_log`（依腳本宣告的 agent label 讀該次 harness
  逐字稿）、`run_list`（每筆可能帶 `costUSD`/`unpricedCalls`/`tokensTotal`/`agentCount` 四個選填欄位，
  若該 run 從未呼叫過 `agent()` 則四者一起省略，不是填 `0`），以及當機可續跑（重啟後
  `interrupted` → `run_resume`）
- **版本與發布頻道**：同一個工作流程名稱可以註冊多次——每次註冊都保留成一個新版本（`v1`、`v2`、…），
  既有版本不會被覆蓋。擁有者用 `workflow_publish({name,version,channel})` 把 `release`（穩定）或 `beta`
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
  `meta.params.knobs`、`meta.defaults`、以及 `workflow_register` 的 `defaults` 參數都會被拒絕（`DEFAULTS_RETIRED`），
  錯誤訊息會指出要改寫到 `meta.params.agents.<label>.<key>.default`。
- **已知工作流程探索**：`workflow_register`/`workflow_publish`/`workflow_list`/`workflow_deregister`/
  `workflow_authoring_guide`（引擎用自己的強制常數渲染的作者指南，也就是 `docs/AUTHORING.md`）。
  `workflow_list` 每筆是 `{name, owner, versions, channels, runnable}`；`owner` 就是註冊者的身分
  （啟用驗證時是登入的 email；在關閉驗證且未帶 `args.principal` 的部署上註冊的工作流程本來就沒有擁有者，該欄為 `null`）。`user` 角色預設只看得到可執行（已發布 `release`）的工作流程，`author`／`admin` 預設看全部；
  `onlyRunnable:true|false` 可明確指定。
  讀腳本本文的工具是 `workflow_source`（需要 `author` 角色；非擁有者拿到 `scriptWithheld:true` 的遮蔽投影），
  「這個工作流程在做什麼」則一律看 `workflow_describe`（見下）。
- **一份看得懂的說明（`workflow_describe`）**：任何人（不必是擁有者）都能用
  `workflow_describe({name})` 一次拿到「要不要用這個工作流程」需要知道的全部：
  用途、解析到的版本與是哪個頻道解析的、階段名稱、逐 agent 的可調參數契約（含型別/預設值/上限）、
  被鎖定的鍵名、所有版本與頻道指向、擁有者、怎麼回報問題、能不能跑（`runnable`/`runnableReason`），
  以及作者附上的 **Mermaid 結構圖**（`mermaid`）。回應裡**永遠沒有腳本本文**。
- **作者附上的結構圖（泳道圖契約）**：`workflow_register` 必須帶一個非空的 **Mermaid** `mermaid`
  字串（少了就 `MERMAID_REQUIRED`）。新註冊的版本要通過五條規則，每條各有自己的錯誤碼，
  訊息會指出第幾行、期望什麼，並附 `see: workflow_authoring_guide`：
  第一行必須是 `graph LR`／`flowchart LR`（`DIAGRAM_DIRECTION`）；
  每呼叫一次 `phase()` 就有一條同順序的 `subgraph` 泳道，agent 節點要在它被派發的那條泳道裡
  （`LANE_MISMATCH`）；每個 `agent()` 都要在某個 `phase()` 之後才派發（`AGENT_BEFORE_PHASE`）；
  節點第三段 `tools: …` 要等於該次呼叫的 `allowedTools`（`TOOLS_MISMATCH`）；
  邊要對得上腳本的先後順序（`EDGE_MISMATCH`）。stadium 節點 `id(["label"])` 與腳本 agent label 的
  **雙向完全對應**同樣照舊（對不上就 `DIAGRAM_MISMATCH`）。
  `workflow_describe` 的 `diagramContract` 欄位會顯示該版本是用哪一版契約收下的：
  `v2` 是套用上述規則收下的版本，`v1` 是更早註冊的版本——`v1` 不重驗、不刪、照原圖渲染。`workflow_describe` 會原文回傳這張圖（`mermaid` 欄位），也接受 `version`／`channel` 指定要看哪個版本。
  **註冊時引擎不產生圖**（圖由作者附上），註冊也不會把腳本本文送給任何模型。
  註冊之後,dashboard 會在**第一次瀏覽時於伺服端**把那張圖畫成 SVG 並快取
  （`GET /api/workflows/:name/diagram.svg`）——
  瀏覽器只收到圖片,作者的標籤文字不會進入任何人瀏覽器的 HTML 渲染器。
- **排程**：`schedule_create`/`schedule_list`/`schedule_delete`/`schedule_setEnabled`（cron/once/resident）。
  觸發器**先建立、再由工作流程認領**：`schedule_create`／`webhook_create` 都不需要 `workflow`，回一個 id，
  再交給 `workflow_register({triggers:[id]})` 綁定到某個版本（仍可在建立時直接帶 `workflow` 綁定）。
  沒被認領的觸發器到期時會被拒絕並把理由記在該列上（`lastRefusalReason`），不會靜默丟掉。
- **工作區與資產（`workspace_*`，六個工具）**：`workspace_push`（兩種模式：CAS blob `{sha256,contentB64}`，
  或工作流程名下的資產 `{workflow,kind:'skill'|'mcp',name,files?/config?}`；`scope:'global'` 的全域資產需
  `admin` 角色）、`workspace_diff`（比對 manifest 與自己的 blob 池，回還缺哪些）、
  `workspace_pull`（讀某個 run 工作區裡某個檔的位元組區間）、`workspace_list`（列某個 run 的工作區檔案，
  或某個工作流程名下某類資產）、`workspace_delete`、`workspace_purge`（刪掉已終止 run 的整個工作區）。
  hook 明確不支援：`kind:'hook'` 在 schema／模式判定就被擋掉，回 `INVALID_ARGUMENT`；
  seed 裡的 `.claude/hooks/…` 則是在路徑判定時就被剝掉、根本不寫進工作區。**MCP server 現在就是一種資產**：
  `workspace_push({workflow, kind:'mcp', name, config})`（secret handle `${secret:NAME}`；`stdio`
  transport 需 `admin`）。
- **Webhook**：`webhook_create`/`webhook_list`/`webhook_delete`（HMAC-SHA256 驗簽、deliveryId 去重）
- **高效 seeding**：`workspace_push`（CAS 模式）/`workspace_diff`（CAS sha256 去重）；`/mcp` 接受 `Content-Encoding: gzip|deflate`；
  `POST /assets/blob/:sha`（streaming raw-body 大檔案上傳，bypass 8MiB JSON-RPC cap）；
  `POST /assets/manifest`（manifest-as-CAS-blob，`seedManifestRef = sha256(bytes)`，可由用戶端自行推導）；
  engine-pull `seedRef:{repoUrl,sha}`（`HardenedSeedRefFetcher`，SSRF-safe egress allowlist，`seedRefAllowlist:[]` 省略則 `SEEDREF_DISABLED`）
- **問題回報**：`issue_report`（版本欄位自動填入，caller 可覆寫；`issue_list`/`issue_get`/`issue_get_comments`/`issue_comment_post`；必填欄位是 `title`/`reproSteps`/`analysis`）
- **用量與花費**：每個 `agent()` 呼叫結束都記四欄 token（`input`／`output`／`cacheRead`／`cacheWrite`）
  與依模型單價算出的 `costUSD`；查不到價格的呼叫記 `unpriced:true` 並計入 `run_result.meta.usage.unpricedCalls`
  （以 0 計費，不拒絕）。整個 run 的合計看 `run_status` / `run_result.meta.usage` / 儀表板。
  `run_start.budget` 是物件 `{usd?, tokens?}`：`usd` 是美金上限，`tokens` 是四欄合計上限，
  兩者可各自省略（省略＝不設限）。任一上限用完後**下一次**派發會被拒（該筆記
  `state:"refused"`、`reasonCode:"BUDGET_EXCEEDED"`）。腳本裡讀 `budget.spent()`（美金）、
  `budget.tokens()`（四欄＋`sum`）、`budget.limits`。
  本機 Ollama 模型價格是 0，所以純美金上限永遠停不住本機 run——要限制本機 run 請用 `tokens` 上限。
  同一個模型掛多個別名（例如 `haiku` 和 `claude-haiku-4-5` 都指向同一個模型）不影響計價：價格表
  以 `provider/model` 為鍵，有價格的那筆不會被沒有價格的蓋掉，`models_list` 也只會回一列（別名
  全部列在該列的 `aliases`），不會出現一列有價、一列 `price:"unknown"` 的重複列。
- **系統監控**：`system_info`（CPU 負載 + 核心數 + 利用率 %、記憶體 total/used/free、磁碟、引擎行程 + 主機 Top-N 行程 + 系統行程統計，`GET /api/system`）
- **模型目錄**：`models_list`（跨供應商統一目錄，含 `capability`/`stability`/`costLevel 0–10`/`modalities`/`ref` 等豐富欄位，支援多維篩選，`GET /api/models`）。
  **每個模型只有一列**；該列的 `aliases` 列出這台部署所有指向它的別名（`ref` 是其中第一個，也就是可以直接丟給 `agent({model})` 的那個字串）。
- **模型探測（issue #73）**：`toolUseDeclared`/`effortDeclared` 只是目錄「宣稱」的能力；引擎另外會對**設定的別名**
  （每個不同的 provider/model 一次，不碰其他目錄列）實際打兩通小呼叫——一通純文字、一通只給 `Bash`、
  必須執行指令並回報一個猜不到的隨機值——走的是 agent 用的同一個 gateway。結果存進 `store/index.db`（重啟不丟），
  `models_list`／`GET /api/models` 每列多出 `toolUseVerified`/`proseVerified`（`true|false`，從沒探測過為 `null`）、
  `lastProbedAt`、`probeDetail`，以及 `stabilitySource`：`'probe'` 時文字失敗 → `stability:'unavailable'`、
  工具失敗 → `'degraded'`、兩通都過 → 保留規則層級；`'rule'` 表示沒探測過、沿用原規則。
  管理員可用 `models_probe`（admin 限定；可帶 `{alias}` 只測一個）立即探測；引擎本身依 `modelProbe.intervalMs`
  （預設每週）自動重測。`run_start` 若有帶工具的 agent 落在「最近一次探測沒用工具」的模型上，會照常啟動並在
  `result.warnings` 回 `MODEL_TOOL_USE_UNVERIFIED`（排程/webhook 啟動的 run 則寫進引擎日誌）。
- **儀表板**：`GET /dashboard` —— 深色系操作介面（畫面右上角三段式主題切換：跟隨系統／淺色／
  深色；語言可切中/英；還有一顆 accent 色調滑桿，可即時看到目前角度，喜歡什麼顏色自己調——三者的
  選擇都存在瀏覽器 `localStorage`，換裝置不會帶過去）。分頁列是可鍵盤操作的頁籤（目前分頁有底線
  標示）。頁尾顯示目前連到哪個 API 位址、以及最後更新時間。分四個分頁：
  - **工作流程**（首頁，品牌字樣「工作流引擎 / Workflow Engine」在導覽列上）：卡片依「執行中 /
    已註冊 / 其他」分三段，可搜尋、可依狀態篩選，每張卡片顯示「最後執行」時間、成功率、平均耗時、
    平均費用。點卡片進工作流程詳情頁（`/dashboard/workflow/<name>`）：版本標籤、觸發器列表、最近
    6 筆 run 的圓點按鈕、**泳道圖**（見下）、和完整的執行歷史表；點某個圓點或點歷史表的某一列，
    上方的泳道圖直接切換成那次 run，不會離開這一頁。**還沒執行過的 workflow** 一樣看得到圖，顯示的
    是根據腳本推算出來的「預測結構」（哪個 agent 在哪個 phase），不是真的跑過，即使開了登入驗證也
    一樣看得到（不會因為沒登入就變空白）。
  - **模型**：十二欄可排序表格（模型/供應商/別名/上下文/價格/工具/推理/模態/延遲/穩定性/基準/
    位置），點欄標題依該欄排序、再點一次切換升降冪；上方有搜尋框、供應商下拉、「全部/遠端/本機」
    分段篩選，計數會顯示「篩選後 / 全部」。這一版**延遲/基準**兩欄還沒有真正的資料來源，一律顯示
    `—`（不是 0、不是空白，是刻意標示「還沒有這項資料」）。點任一列，右側滑出 560px 面板看完整
    細節（能力、模態、上下文、價格、成本等級、延遲、穩定度、支援的工具/推理參數、benchmark 分數）。
  - **系統**：四張資源卡片（CPU % / 記憶體 % / 磁碟 % / 已儲存工作流數），卡片下方有進度長條；
    下面是處理程序表（PID/名稱/CPU%/記憶體，引擎自己的那一列會特別標示），再下面是引擎自身的
    運作時間/CPU/記憶體/執行緒/檔案描述子。**這四張卡片各自獨立**：如果只有某一部分資料暫時讀不到，
    只有那一張卡片會顯示「無法取樣 / Unavailable」，其他張照常顯示真實數字，不會整個分頁一起壞掉。
  - **問題**：GitHub issue 列表（Open / Resolved），沒設定 GitHub token 時顯示「GitHub not
    configured」而不是空白一片。

  **分頁沒人看的時候**：把瀏覽器分頁切到背景，儀表板會**停止**打 API（不會浪費資源在看不到的畫面
  上）；切回來的瞬間立刻補一次，之後恢復每 3 秒一次的節奏。

  **引擎連不上的時候**：畫面右上角的連線燈會從「連線中」變成「示範資料 / Demo data」，同時整頁
  上方會多一條橫幅明講「這是示範內容」——「示範資料」和「連線中」兩個字樣不會同時出現，不會誤以
  為是真資料。工作流程首頁、模型分頁、系統分頁的 CPU / 記憶體 / 磁碟三張卡片會用示範內容填滿畫面
  （方便看清楚少了什麼）。另外三處背後的 API 本來就沒有示範資料可以填——工作流程詳情頁、問題
  分頁、以及系統分頁的「已儲存工作流數」卡片——斷線後這三處會清空畫面，改顯示一句「此路由無示範
  資料：」後面接上對應的 API 路徑，不會停在斷線前的舊畫面充數，也不會假裝有資料。引擎恢復連線後，
  下一次自動更新就會自動切回真資料，不用重新整理頁面。

  **泳道圖**：每個 `phase()` 是一條直向泳道，agent 節點依派工順序排列、用曲線互相連接，顏色會隨
  狀態變化（執行中發光、完成、失敗轉紅、排隊中則是虛線框）；每個節點顯示狀態點 + 標籤、模型簡名 +
  努力程度、token 用量/費用/耗時。圖支援滑鼠滾輪縮放、按住拖曳平移，`Fit` 按鈕重置；分頁可見時每
  3 秒自動更新一次，已經做好的縮放/平移不會被重設。

  **agent 細節面板**：顯示這個 agent 的模型 / 努力程度 / 逾時 / token 用量（含快取讀寫）/ 費用，
  以及**這次呼叫實際送給模型的完整提示詞**（腳本自帶的 `prompt`，加上有覆寫時框住的
  `appendPrompt`）——伺服器端沒有另一層看不到的系統提示詞會被剔除，`harness.prompt` 就是原始
  字串本身（見下方「已知限制」之前的權限段落）。
  按 Esc 或點背景可以關閉面板。**不論是工作流程詳情頁的泳道圖，還是某次 run 的專屬網址
  `/dashboard/<runId>`，點任一個節點都會打開這個面板**；面板固定從節點所在那一側的對面滑入
  （點左半邊的節點，面板從右邊滑入；點右半邊的節點，面板從左邊滑入）。

  ```
  /dashboard  （深色殼：主題/語言/連線燈/品牌，四個分頁）
   ├─ 工作流程（首頁）──點卡片──▶ /dashboard/workflow/<name>
   │                                  （版本 / 觸發器 / 泳道圖 / 執行歷史表，都在同一頁）
   │                                             │ 點泳道圖上的 agent 節點
   │                                             ▼
   │                                  agent 細節面板（滑入，不含 system prompt）
   │
   │                                  （複製某次 run 的 ID 也能單獨開
   │                                   /dashboard/<runId>，同一張圖，點節點一樣會開面板）
   ├─ 模型（十二欄可排序表格，點列滑出細節）
   ├─ 系統（四張資源卡片 + 處理程序表 + 引擎自身資訊）
   └─ 問題（GitHub issue 列表）
  ```
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
  **refresh tokens（RFC 6749 §6 / OAuth 2.1）**：AS metadata 廣告
  `scopes_supported:["openid","email","offline_access"]` + `grant_types_supported:["authorization_code","refresh_token"]`，
  401 回應的 `WWW-Authenticate` 與 `.well-known/oauth-protected-resource`（PRM）也一併廣告這些 scope；
  **核發規則看的是 client 的 `grant_types`，不要求 `offline_access` scope**——凡是透過 RFC 7591 DCR
  （`POST /register`）取得、`grant_types` 含 `refresh_token` 的 client（新註冊的預設就含），`/token`
  一律核發 `refresh_token`（~90 天 TTL、sha256-at-rest），不論 `/authorize` 有沒有帶 `offline_access`
  scope；沒有 `client_id` 的非-DCR 呼叫、或 `grant_types` 本來就不含 `refresh_token` 的 client，仍然
  不核發；`grant_type=refresh_token` 輪換 token（RFC 9700 rotation，單次使用）；用戶端不需重新走瀏覽器
  登入即可在 access_token 到期後續用。**操作備忘**：這個修正上線前已核發的憑證沒有 `refresh_token`，
  到期後仍會要求使用者重新走一次瀏覽器登入——每個使用者只需要重新登入這一次，之後核發的憑證就會照
  新規則帶 `refresh_token`。
  **callback success page**：`/oauth/google/callback` 回 200 HTML（含 `id="callback-url"` 可複製 URL
  + meta-refresh/JS 自動轉跳），無論有無 loopback listener 都可操作。
  D-BIND fail-closed（非 loopback 來源若無有效 bearer → 401）；過期 auth 表列由 GC sweep 自動清除
  （`workspaceTtlMs` 正確從 composeConfig 傳遞）；
  工作流程擁有權（`NOT_WORKFLOW_OWNER`）；per-run principal attribution；
  角色（`principals`）：`workflow_register`/`workflow_deregister`/`workflow_publish`/`workflow_source`/
  `schedule_*`/`webhook_*` 需要 `author`，全域資產推送需要 `admin`（見 DEPLOY.md §1b「角色」）。
  啟用方式：在 `rwe.config.json` 加入 `auth:{enabled:true,...}` 區塊（見 `rwe.config.example.json` / DEPLOY.md §1b 設定總表）。

共 **36 個** MCP 工具（權威清單見 `src/tool-specs.ts`）。

## 前置需求

- **Node.js 22.6 以上**（`tsx` 與沙箱子行程均依賴 Node 22 原生 TypeScript 支援）
- npm（隨 Node 附帶）
- **Python 3.11 或 3.12**（`gateway:"sdk"`（預設）需要 `litellm[proxy]`）。
  LiteLLM 只有**一個**消費者：`agent()` 呼叫（`workflow_register` 不走 gateway）。要略過 Python/LiteLLM，在 `rwe.config.json` 設 `gateway:"direct-fetch"` +
  `useLiteLLMProxy:false`（本機 Ollama 直連）。留著預設值 `gateway:"sdk"` 卻沒裝 `litellm`，
  服務會在**開機階段**就拒絕啟動（見「已知限制」）。
- 至少一個可用的 LLM 供應商（Anthropic / OpenRouter API key，或本機 Ollama）

## 快速開始 Quickstart

**一個乾淨的 checkout，一條指令：**

```bash
./deploy.sh --background
```

這會安裝依賴、建立設定檔、啟動服務、跑健康檢查——全部自動完成。無法自動化的步驟（例如缺
`uv`）會停下來並印出明確的下一步指示。停止服務：`kill $(cat .rwe.rwe.config.pid)`
（PID/log 檔名跟著設定檔走，預設設定檔是 `rwe.config.json`；細節見 DEPLOY.md §0）。

需要客製設定（模型別名、供應商 key）或想逐步手動操作時，展開版步驟與完整設定鍵說明見
`DEPLOY.md` §0 / §1b。最少需要的環境變數：

```bash
# anthropic 別名：兩種認證擇一 —— API key，或 Pro/Max 訂閱制的 OAuth token
export ANTHROPIC_API_KEY=sk-ant-...                  # 用 API key 時
# export RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN=...      # 用訂閱制時（rwe.config.json 的 anthropicAuth:"subscription"）
# export OPENROUTER_API_KEY=sk-or-...                # 用 openrouter 別名時；本機 Ollama 免金鑰
# export RWE_SECRET_GITHUB_TOKEN=...                 # 若要用 issue_report/Issues 儀表板
./deploy.sh --background
```

每個鍵的用途、預設值與是否必填，見 DEPLOY.md §1b 設定總表；金鑰放在一個只有自己讀得到的檔案
（例如 `~/.config/rwe.env`，權限 600），啟動前 `set -a; . ~/.config/rwe.env; set +a` 載入即可。

## 使用範例

```bash
# 第零步：MCP 握手（initialize）——冷客端第一眼就看到兩個關鍵事實：
# 每個工具回應都是「雙重 JSON 編碼」（content[0].text 是字串，要再 parse 一次才是真正的內容），
# 以及 workflow_authoring_guide 目前的概略大小（送出前先知道會拿到多大，不必自己撞到截斷才發現）。
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}'
# -> result.instructions: "Every tool result arrives as a JSON string inside content[0].text —
#     parse it again to reach the actual payload. workflow_authoring_guide is ~43KB."
# （位元組數是伺服器每次呼叫當下即時算出來的真實大小，不是寫死的常數，會隨 guide 內容變動）

# 第一步：註冊一個工作流程（一律要先註冊、再指名執行）
# mermaid 是必填：少了就 MERMAID_REQUIRED。圖的第一行必須是 graph LR（或 flowchart LR）。
# 這個腳本沒有 agent() 呼叫，所以圖裡只要有一個矩形黑箱節點即可
# （stadium 節點才需要對上 agent label，而且要放進 phase 的泳道裡）。
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_register","arguments":{"name":"greet","script":"return {answer:42,tags:[\"a\",\"b\"]}","mermaid":"graph LR;\nout[\"return a fixed result\"]"}}}'
# -> {"result":{"content":[{"type":"text","text":"{\"runId\":\"\",\"status\":\"completed\",\"version\":1,\"result\":{\"name\":\"greet\",\"version\":\"v1\",\"versions\":[\"v1\"],\"channels\":{\"release\":null,\"beta\":null}}}"}]}}
# 每次 workflow_register 都是新版本（v1、v2、…），既有版本不會被覆蓋或刪除；
# result.versions 是這個名稱目前所有版本、result.channels 是各頻道（release/beta）目前指到哪個版本
# （未發布過的頻道是 null）——第二次用同一個名稱註冊時，這兩個欄位就是「疊版本、不覆蓋」的直接證據。

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
# meta.params.agents.<label> 契約（model/effort/timeoutMs，各自要有 .default）。
# 圖的規則（四條，違反時錯誤訊息會指出第幾行與期望值）：
#   1. 第一行是 graph LR（或 flowchart LR）
#   2. 每呼叫一次 phase() 就要有一個同順序的 subgraph 泳道，agent 節點放在它被派發的那條泳道裡
#   3. 每個 agent() 一定要在某個 phase() 之後才派發（否則 AGENT_BEFORE_PHASE）
#   4. stadium 節點 id(["label"]) 要跟腳本的 agent label 一一對上
# timeoutMs 給大一點：本機 7B 模型走完整 harness（預設六個工具）在一般機器上要好幾分鐘，
# 給 60000 幾乎一定會 timeout（該次 agent 記 state:"failed"、tokens 全 0）。上限見 maxTimeoutMs。
# 腳本與圖寫成檔案、再組 JSON，比一長串跳脫好讀也好改：
cat > /tmp/ping.js <<'JS'
export const meta = {
  description: 'Reply with one word',
  params: { agents: { ping: {
    model: { type: 'string', default: 'default' },
    effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },
    timeoutMs: { type: 'number', default: 300000 },
  } } },
};
phase('ping');
return await agent('ping', { prompt: 'Reply with only the word: PONG' });
JS
cat > /tmp/ping.mmd <<'MMD'
graph LR
subgraph "ping"
ping(["ping"])
end
MMD
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
# 到終態後用 run_result 取結果（本機 7B 模型常常回一段「看起來像工具呼叫」的文字而不是乾淨的
# "PONG"，見「已知限制」；換成 anthropic/openrouter 別名就會是乾淨答案）；
# 想看該次 agent 的 harness 逐字稿：
#   run_agent_log({runId, label:"ping"})——label 就是腳本裡宣告的那個，不是引擎內部編號。

# 註冊一個宣告可調參數契約的工作流程，並在執行時逐 agent 覆寫
cat > /tmp/greet2.js <<'JS'
export const meta = {
  description: 'Greet the caller in one sentence',
  params: { agents: { greet: {
    model: { type: 'string', default: 'default' },
    effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },
    timeoutMs: { type: 'number', default: 300000 },
    appendPrompt: { type: 'string', default: '' },
  } } },
};
phase('greet');
return await agent('greet', { prompt: 'Say hello' });
JS
cat > /tmp/greet2.mmd <<'MMD'
graph LR
subgraph "greet"
greet(["greet"])
end
MMD
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
# mermaid 是註冊時作者附上的那張圖的原文；沒有圖的版本回 mermaid:null、mermaidNote:"LEGACY_NO_DIAGRAM"。
# 還沒發布過任何頻道的工作流程，describe({name}) 直接回 CHANNEL_UNPUBLISHED（要看草稿就帶 {"version":"v1"}）；
# runnable:false + runnableReason:"LEGACY_REREGISTER" 表示這個版本沒有 meta.params.agents 契約，要重新註冊才能跑。
# triggers 是「現在」綁在這個工作流程上的排程/webhook，每次呼叫都依 id 重新讀取
# （schedule 與 webhook 兩張表的即時快照）；已被刪掉的 id 會以 status:"TRIGGER_NOT_FOUND" 出現。
# 同樣的內容也有 HTTP 版：curl -s http://127.0.0.1:8787/api/workflows/greet/describe
# 「任何 principal 都能問」指的是授權層級（不看擁有者身份），不等於「不需要驗證」：
# auth.enabled:true 時，這條 HTTP 路由跟 /mcp 走同一套 D-BIND 規則（見 DEPLOY.md §1b），
# 沒過就回 401 + WWW-Authenticate——而且是在讀到任何工作流程資料「之前」就擋下，
# 所以未授權的呼叫端連「這個名稱存不存在」都問不出來（存在與不存在都是同一個 401）。

# 查詢 36 個 MCP 工具（含 schema）
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
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"models_list","arguments":{"location":"remote","toolUseDeclared":true,"maxPricePerM":1}}}'

# 儀表板（瀏覽器直接開；問題/模型/系統是同一頁裡的分頁，不是獨立網址）
open http://127.0.0.1:8787/dashboard                      # 工作流程首頁（含模型/系統/問題分頁）
open http://127.0.0.1:8787/dashboard/workflow/<name>       # 工作流程詳情：版本/觸發器/執行歷史
open http://127.0.0.1:8787/dashboard/<runId>               # 該次 run 的泳道圖

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
curl -s http://127.0.0.1:8787/api/runs           # 列出「最近 50 筆」run，不是全部（這支路由本身沒有
                                                  # 分頁參數，永遠只回最新 50 筆）。要看第 51 筆以後，
                                                  # 改用 MCP 的 run_list，帶明確的 limit（最高 500）：
                                                  # {"name":"run_list","arguments":{"limit":500}}
                                                  # 只加 workflow/status 篩選、不帶 limit 一樣停在 50 筆。
                                                  # 含即時狀態；每筆可能帶 costUSD/unpricedCalls/
                                                  # tokensTotal/agentCount，該 run 從未呼叫過 agent() 時四者一起省略，不是 0）
curl -s http://127.0.0.1:8787/api/runs/<runId>   # run 詳情（phase/agent tree）
curl -s http://127.0.0.1:8787/api/runs/<runId>/dag   # composite 呼叫樹（DAG，含 lanes/current）
curl -s http://127.0.0.1:8787/api/workflows          # 已註冊工作流程目錄
curl -s http://127.0.0.1:8787/api/workflows/<name>/describe   # phases[].agents：預測 lane 的 agent 標籤，不論 auth 開關一律回傳每個呼叫端；動態 lane 沒有靜態標籤時是 []；引擎無法推導這個版本的預測結構時該欄位整個不存在（不是 []）
curl -s http://127.0.0.1:8787/api/status             # agentSemaphore 即時狀態
curl -s http://127.0.0.1:8787/static/dashboard/dashboard.css   # 儀表板自身的靜態資源（JS/CSS/字型），無需 auth
```

```bash
# Webhook（HMAC-SHA256 驗簽，secret 只回一次）
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"webhook_create","arguments":{"workflow":"daily-report"}}}'
# -> {webhookId, secret (只出現一次), url}

# 排程：先建立觸發器拿到 id，再由 workflow_register({triggers:[id]}) 認領，最後 workflow_publish
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"schedule_create","arguments":{"kind":"cron","cron":"0 3 * * *","enabled":true}}}'
# -> {"id":"<triggerId>"}；把它交給註冊：workflow_register({name,script,mermaid,triggers:["<triggerId>"]})
# 沒有被任何版本認領的觸發器到期時會被拒絕，理由記在 schedule_list 那一列的 lastRefusalReason（UNCLAIMED）。
```

> 從舊版本一路升級上來的 `workRoot` **不需要任何手動步驟**：`schedules` 資料表在早期版本把
> `workflow` 欄位設成「不可為空」（那時觸發器一定綁著工作流程），引擎會在**下次啟動時自動重建**
> 這張表，把既有排程原封不動搬過去。細節見 DEPLOY.md §6。

## 安全模型

`gateway:"sdk"` 路徑的關鍵安全設定（均已對真實 process 驗證）：

1. **不用 `permissionMode:'bypassPermissions'`**：headless session 但每次工具呼叫均受裁決。
2. **預設工具面**：`Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash`；`WebFetch`/`WebSearch`/`Task`/`Agent`
   需明確 opt-in。`Read`/`Write`/`Edit`/`Glob`/`Grep` 限制在 run workspace 之內（見下一條）；
   `Bash` 是另一個獨立機制（開機探測到的 OS 層圍籠姿態，見 DEPLOY.md §1c(e)）——探測失敗的部署上
   `Bash` 是真的不受限的，所以引擎改以接納判定來擋：**遠端提交、遠端建立的觸發器、遠端註冊的版本，
   三者任一成立就拒絕**（`CONFINEMENT_UNAVAILABLE`）。第三項與呼叫者在哪裡無關，本機呼叫一樣被擋；
   只有「本機提交 + 本機註冊的版本」才會真的跑起來。判定式與復原見 DEPLOY.md §6。
3. **供應商 API key 只給 LiteLLM 子行程**：`claude` CLI 子行程環境變數白名單，從未看到真實 key。
4. **workRoot 隔離**：`Read`/`Write`/`Edit`/`Glob`/`Grep`/`NotebookEdit` 透過 `canUseTool` +
   `PreToolUse` 雙重 realpath 邊界封閉在 run workspace 之內（`Bash` 的圍籠見上一條）；`workRoot`
   若在 `.git`/`CLAUDE.md` 祖先之內 → 啟動時 `WORKROOT_INSIDE_PROJECT` fail-fast；同一顆檢查也在
   每次執行時重跑一次（run workspace 與 `workRoot` 之間多出 `.git`/`CLAUDE.md` → 執行期同錯誤碼拒絕）。
5. **Host/Origin 白名單**：外來 Host → 403 防 DNS-rebinding；非白名單 Origin POST → 403 防 CSRF。
6. **Webhook HMAC**：常數時間比對 `X-Hub-Signature-256`；deliveryId 去重；±300s 時戳窗口。
7. **伺服器端 secret**：config 內 `${secret:NAME}` → 由 `RWE_SECRET_<NAME>` 解析；缺失 → `SECRET_MISSING`；字面值永不外洩。
8. **Redact-at-capture**：`SecretValueProvider.entries()` 拿到所有 provisioned secret 的明文；每次寫入逐字稿/快照/日誌/SDK-capture 前，均先呼叫 `redact({name,value}[])` 把值替換為 `‹secret:NAME›` marker（4 個 sink：appendTranscript/saveSnapshot/appendJournal（整個 JournalEntry 含 key.prompt）/SDK-capture；DES-088 invariant b：工作流程的最終回傳值（script `return` 的內容）維持原始值，不做 redact）。
9. **Inline script 已關閉**：`run_start`/`run_resume` 不接受呼叫端夾帶的 `script`；`run_start` 的 schema 是封閉的（`additionalProperties:false`），硬塞任何未宣告的欄位都在送出當下被拒（`INLINE_SCRIPT_CLOSED`／`INVALID_ARGUMENT`）。腳本一律要先 `workflow_register`，靜態檢查（語法解析、模型別名、MCP 名稱是否已推送、agent 契約、mermaid 對照）也全在註冊當下做，不會因為改用具名執行就少檢查。
10. **腳本本文只有一個出口，且對非擁有者遮蔽**：能回傳腳本本文的工具只有 `workflow_source`（需要 `author` 角色）。啟用 auth 後，它對非擁有者回傳 `scriptWithheld:true`、不含腳本本文；擁有者/admin 仍可看到完整腳本。`workflow_describe`／`workflow_list`／`/api/workflows*`／儀表板**在設計上就不含**腳本本文，不論身份。`auth.enabled:false`（單人本機部署的預設）沒有「非擁有者」這個概念——任何人都能透過 `workflow_source` 看到完整腳本。
11. **SSRF-safe seedRef**：`seedRef:{repoUrl,sha}` 由 `HardenedSeedRefFetcher` 拉取；URL 必須匹配 `seedRefAllowlist`，否則 `SEEDREF_EGRESS_DENIED`；省略 allowlist 則全部 `SEEDREF_DISABLED`（fail-closed）；hardened git subprocess，不轉 shell。
12. **角色（`principals`）fail-closed**：`rwe.config.json` 的 `principals` 角色字串打錯（不是 `admin`/`author`/`user`）→ 開機直接拒絕啟動，不會靜默退回 `user`；整個鍵省略時，`auth.enabled:true` 下每個已驗證呼叫者一律 `user`，且開機那行 `auth:` log 如實顯示（ADR-028）。`workspace_push({kind:"mcp"})` 的 `http` transport 同理受 `mcpEgressAllowlist` fail-closed：省略/不匹配 → `EGRESS_DENIED`，探測次數為零；`stdio` transport（`config.type:"stdio"`）與 `scope:'global'` 的推送都需要 `admin`，其他角色一律 `FORBIDDEN_ROLE`、不會探測也不會啟動任何子行程。
13. **`harness.prompt` 就是這次呼叫實際送出的原始字串，沒有隱藏的伺服器端系統提示詞**：`agent()` 沒有任何伺服器端可套用的 system prompt 層——`harness.prompt`＝腳本自帶的 `prompt`，有覆寫時再接上框住的 `appendPrompt`（`<user-instructions untrusted="true">…</user-instructions>`），沒有任何東西會在寫入逐字稿前被剔除。這一段線上回應（MCP `run_agent_log` 與 `GET /api/runs/:id/agents/:agentId` 皆同）任何人（含擁有者）都看得到完整內容，因為根本沒有需要遮蔽的東西。實測（本機模型 `qwen2.5:7b`，appendPrompt 覆寫 `"Also mention the word BANANA."`）：`harness.prompt` 回傳
   `"Say hello in one short sentence.\n\n<user-instructions untrusted=\"true\">\nAlso mention the word BANANA.\n</user-instructions>"`，`harness` 物件裡沒有 `systemPrompt` 這個鍵。作者若要為某個 agent 準備固定的系統提示詞，寫進腳本自己的 `prompt` 參數即可（見 `workflow_authoring_guide` 的「Prompt layering」一節）。

## 已知限制

- **斷線前沒點過的分頁，斷線後打不開**：模型/系統/問題分頁的程式碼是點了才載入；如果引擎斷線前
  完全沒點過某個分頁，斷線後第一次點它會因為載入不到程式檔而顯示「`<分頁名> unavailable`」，不是
  示範內容。斷線前點過的分頁不受影響。
- **本機 7B 小模型工具呼叫**：`qwen2.5:7b` 透過 SDK gateway 不會真的觸發 tool_use，只生成看起來像工具結果的文字。建議使用 32B 以上本機模型或付費供應商（Anthropic/OpenRouter）。
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

- **`effort` 對 OpenRouter 模型目前沒有作用**：引擎會把 `effort` 換算成 thinking 預算送進 CLI，
  但這個值到不了 OpenRouter——實測 `low` 與 `high` 送出的請求內容完全相同、也沒有 `reasoning_effort` 欄位
  （CLI 把預算收斂成 `thinking:{type:"adaptive"}`，LiteLLM 再對 openrouter 丟掉這個參數）。
  `run_agent_log` 的 `harness.effortApplied` 會如實回報 `{applied:false, reason:…}` 並寫明原因。
  Anthropic 別名的 `effort` 是有作用的（CLI 收到 `--effort <值>`）。
- **目前已知、尚未修復的缺陷**（詳細指令與輸出見 `DEPLOY.md` §6）：
  1. **偶發的 `suspend` → `resume` → `failed`，而且 agent 的工作在終態之後還在跑**
     （run `3977b82d`，無法穩定重現、尚未歸因；
     [issue #53](https://github.com/HsuJavis/remote-workflow-engine/issues/53)）。
     對策：suspend/resume 之後用 `run_status` 確認狀態，發現無故 `failed` 時把 run id 貼進該 issue。

## 更多

- 部署 / 維運：見 `DEPLOY.md`
- 設計與追溯：見 `.sdlc/`（工作區索引 `.sdlc/dashboard.html`；本功能 `.sdlc/features/001-remote-workflow-engine/dashboard.html`）
- 完整真實層驗證證據：`.sdlc/features/001-remote-workflow-engine/08-validation.md`
