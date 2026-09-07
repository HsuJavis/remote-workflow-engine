# v26 Gate 1 working notes — issue #64–#75 intake

- **日期:** 2026-09-08(triage 02:00–04:00 CST)
- **來源:** 2026-09-07 晚間擁有者從另一台電腦冷跑五個 workflow(gp-runner / explore-scout / plan-architect / fork-parallel / code-simplifier),agent 以 `issue_report` 回報 #64–#75 共 12 個 issue。
- **狀態:** 只記錄與釐清,**尚未開工**(擁有者 2026-09-08 指示:「你先記錄起來 全部釐清後再一次開工」)。
- **建議路線:** 一個 v26 iteration 走完整 Gate 1→8。理由:#68/#75 觸及 REQ-111(圖由作者提供)這條架構決策,不是 fix 模式能承載的;其餘 bug 以 REQ 併入同一輪。
- **每條 issue 的宣稱都已對原始碼或以實跑重現**,重現方式記在各條「證據」。程式碼一行未動;探測用的 workflow(`i66-probe`)與 run(0449d511、55b34b9a、b0be6f5f)已清除,擁有者的證據 run 未動。

## 擁有者裁決(2026-09-08,逐字要點)

| # | 裁決 |
|---|---|
| #64 | 照建議修 |
| #65 | key 已更新(rwe.env);引擎端接著修 |
| #66 | 先了解來龍去脈(`NON_ANTHROPIC_EXCLUDED_TOOLS` 是什麼;gpt41 不是接 OpenRouter 那是接哪) |
| #67 #68 #69 #70 | 都是圖的問題,要修 |
| #71 | 沙箱**不應該**禁用 `Date.now()`;要知道現在還禁了什麼;effort 對 OpenRouter 模型應該都要能用;provider 能不能用工具要能從 models_list 知道 |
| #72 | 修 |
| #73 | 之後補「每週去 OpenRouter 探測更新資訊」;現在不做 |
| #74 | token 要有 input / output / cache read / cache write 四欄,budget 才算得對 |
| #75 | 要修 |

## 逐條:問題 → 根因與證據 → 修法 → 紅測 → 待釐清

### #64 `seed:[{path, sha256}]` 靜默產生 0-byte 檔(HIGH)
- **問題:** `run_start` 的 `seed` 只帶 sha256 不帶內容時,不報錯,直接寫出空檔;五個 run 在空工作區上跑完。
- **根因:** `src/workspace-seed.ts:46` 寫檔用 `f.contentB64 ?? ''`;`src/tool-specs.ts:378` 的 schema 只有 `seed: {type:'array'}`,沒有元素形狀;`seed` 這條路從不查內容庫(那是 `seedManifest` 的工作)。
- **修法:** 元素缺 `contentB64`(非 string)→ `INVALID_SEED_SPEC`,訊息點名 path 並指向 `seedManifest`;tool-specs 補 `items` 形狀與描述(`seed` 帶內容、`seedManifest` 帶 sha256)。不讓 `seed` 也去查內容庫,避免兩個參數功能重疊。
- **紅測:** `run_start({seed:[{path:'a', sha256:'…'}]})` → 期望 INVALID_SEED_SPEC;現況 accepted。
- **注意:** 加 `additionalProperties:false` 到 items 之前,先確認 plugin client(push_workspace.py)不會多送欄位。

### #65 openrouter passthrough 掛 240 秒、0 token、無事件(MEDIUM)
- **問題:** 任何 `openrouter/<id>` agent 卡 running、0 token,`timeoutMs` 到期後再一輪,共 2× 才 failed;`run_agent_log.events` 為空。
- **根因(兩層):**
  1. 環境:`~/.config/rwe.env` 的 `OPENROUTER_API_KEY` 對 `GET /api/v1/auth/key` 回 **401 "User not found"**;另一把(原 `~/.OPENROUTER`)回 200。引擎與 litellm 只讀 env。VAL-166 當時是在專用 8793 引擎驗的,沒驗到正式服務。**擁有者已於 2026-09-08 更新 rwe.env(hash 72d7e59a…,已驗 200);正式服務(PID 1098425)仍持舊 key(hash d1c02a62…),要重啟才吃到。** `~/.OPENROUTER` 已不存在。
  2. 引擎:用 SDK 直接重現 —— Claude CLI 收到 401 會自己重試 **10 次**、退避 0.5s→1s→2s→4s→9s→20s…,期間發 `system/api_retry`(`error_status:401, error:'authentication_failed'`);`claude-agent-sdk-client.ts:656` 的 `_drain` 只處理 `result`,`api_retry` 被 `extractEvents` 丟掉 → 引擎只看到 timeout;`invoke():444` 的 retry loop 對**任何**非 ok 結果都重跑一次(含 terminal)→ 240s。litellm 子行程 `stdio:'ignore'`(litellm-proxy.ts:187),它的 stderr 也看不到。
- **修法:** `_drain` 讀 `system/api_retry`:`error_status` 為 401/403(以及 404 model not found)→ 立刻 `{ok:false, reason:'terminal', detail:'<provider> <status> <error>'}` 並寫成 transcript 事件;429/5xx 維持讓 CLI 重試。retry loop 對標為 non-retryable 的 terminal 不重跑。
- **紅測:** 假 session 連發 `api_retry(401)` → 期望一次 attempt 內 terminal、events 含錯誤;現況要等到 timeout。
- **待釐清:** 是否現在就重啟服務載入新 key,或隨 v26 部署一起(見 Q6)。

### #66 「gpt41 從不呼叫工具、Read 被拿掉」(HIGH → 標題不成立,底下有真缺口)
- **來龍去脈(擁有者問的):**
  - `gpt41` 是 `rwe.config.json` `aliases` 裡的一列:`{provider:'openai', model:'gpt-4.1'}`。路徑是 **Claude CLI → LiteLLM(`rwe-proxy-gpt41` → `openai/gpt-4.1`)→ api.openai.com,用 rwe.env 的 `OPENAI_API_KEY`**。**不是 OpenRouter**。`rwe-proxy-` 前綴只是防 CLI 把裸名當 shorthand 改寫的遮罩(litellm-proxy.ts:50)。OpenRouter 只有 `openrouter/<id>` passthrough 這條路。LiteLLM 對 gpt-4.1 走 OpenAI **Responses API**(回應 id `resp_…`)。
  - `NON_ANTHROPIC_EXCLUDED_TOOLS = {'Read'}`(claude-agent-sdk-client.ts:193):對**所有非 Anthropic provider**(openai、openrouter、ollama —— 含 `default` alias 的 qwen2.5:7b)把 Read 從工具面剔除,並確保 Bash 在(`curateToolsForProvider`,:219-224)。來源是 commit **0f79f04(2026-07-12)**「per-provider tool curation (A)」:當時實測 gpt-4.1 的 Read 呼叫 ~2/3 失敗(`invalid pages parameter`,PDF 用的 `pages` 欄位),Bash 讀檔 3/3 成功。**這個決策與證據只存在 commit message,帳本裡沒有 DES/ADR/VAL** —— 本次補記於此。
  - **今天重測仍成立:** 直接對 LiteLLM 送 Read 工具定義 5 次,gpt-4.1 **5/5 把每個 optional 欄位都填滿**,送出 `{"file_path":…,"offset":0,"limit":1,"pages":""}`;`pages:""` 對非 PDF 就是 CLI 報的那個錯。所以剔除是對的。
- **標題為何不成立:** 用正式引擎跑 gpt41 + `allowedTools:['Bash']`(run b0be6f5f,已清)→ **真的呼叫 Bash** 並回傳真實 `ls -la`。回報者的 prompt 指名「用 Read 重讀」,模型手上沒有 Read,gpt-4.1 不會自己改走 Bash → 驗證者放棄、scout 捏造路徑。
- **真缺口:** 剔除對作者**完全靜默**(只有翻 harness 紀錄的 `tools` 才看得到),guide 沒寫,models_list 沒寫。
- **修法:** (a) harness 描述子加 `toolsExcluded:[{tool:'Read', reason}]`(同 `effortApplied`/`unresolvedMcp` 的「誠實紀錄」寫法);(b) guide 加一段「非 Anthropic 模型沒有 Read,prompt 請用 Bash 的 cat/sed/grep」;(c) models_list 每列加宣告欄位(見 #71/#73);(d) 把 0f79f04 的決策與今天的重測補成 DES/ADR。
- **紅測:** 非 Anthropic alias 的 harness 事件缺 `toolsExcluded`;guide 文字缺該段。
- **待釐清:** 要不要更進一步 —— 註冊/派發時對「非 Anthropic 模型 + prompt 或 allowedTools 指名 Read」發出警告或拒絕,或自動 appendPrompt 提示(Q4)。

### #67 check-mermaid 不比對邊(MEDIUM)
- **問題:** 邊畫錯、畫反、沒畫都能註冊;dashboard 照畫。
- **根因:** `src/check-mermaid.ts` 只做:語法、節點表、`&` 拒絕、未宣告 id、label 集合雙向比對、三元組、cycle 邊要標籤、subgraph 配對。從不讀 script 的呼叫順序。`authoring-guide.ts:446` 卻寫「checker 會逐邊比對」——第 22 個「描述與實物不符」。
- **修法:** 併入 #75 的 EDGE_MISMATCH(由 skeleton 推期望邊);guide 那句立即改實話。
- **紅測:** 註冊 `a-->c` 但 script 是 a→b→c → 期望 DIAGRAM_MISMATCH;現況通過。

### #68 dashboard 以 harness 資料畫圖(MEDIUM)
- **問題:** 只畫作者 mermaid;model/effort/timeout/工具面看不到;方向隨作者。
- **根因:** 功能缺口,非 bug。引擎已握有全部資料(`params.agents`、skeleton、每次 run 的解析結果)。
- **修法:** 見 #75 的方向裁決(Q1)。若走「引擎產圖」:server 端 pure function 產 `graph LR` 泳道圖,經 REQ-119 同一條渲染路由;作者圖降為次要面板。若走「作者畫、引擎嚴驗」:dashboard 另加 harness 表格(每 agent 一列)而不改主圖。

### #69 圖不隨視窗縮放(LOW)
- **問題:** 作者 SVG 被 `max-width:100%` 硬縮;run DAG 固定像素只能橫捲。
- **根因:** `dashboard-page.ts:117`(`#diagram-img{max-width:100%}`)、`:394-403`(`BOX` 固定像素、`width/height` 絕對值、無 `viewBox`)。
- **修法:** run DAG 改 `viewBox` + `width=100%` + `preserveAspectRatio`;作者 SVG 同樣包進可縮放容器;是否加 wheel-zoom/drag-pan 看 Q2。
- **紅測:** 產出的 SVG 缺 `viewBox`。

### #70 run DAG 全部 frame-grouped(HIGH)
- **問題:** 100% 的 run,每個 agent 一條「unmatched to the predicted layout: frame-grouped」,全擠 col 1。
- **根因:** `run-manager.ts:1065` `markQueued(agentId, label, key.opts.phase, framePath)` —— `opts.phase` 是 `agent()` 的選項,沒有任何 script 會設(`phase()` 是獨立函式,`onPhase` 只推到 `entry.phases`);`dashboard.ts:285-336` 用 `a.phase ?? ''` 對 skeleton,全部空字串 → 沒對到 → 退路欄。次要:`workflow-meta.ts:103` `STRING_ARG_RE` 只認字串常值,`phase('fork:'+tier)` 拿不到標題;三元運算式裡的 `agent()` 產兩個 slot。
- **修法:** (a) 派發時 `key.opts.phase ?? entry.phases.at(-1)?.title`(新 run 立即正確;nested frame 共用一條 phase 時間軸是已知近似);(b) `layoutGraph` 接收 `view.phases`(`server.ts:507` 目前只傳 skeleton+agents),缺 `phase` 時用「`startedAt` 之前最後一個 phase」推回 —— **現有 30 個 run 也修好**;(c) 動態標題改以 phase **順序**對位、三元/if 收成一個 slot 帶候選 label 集合 —— 與 #75 LANE_MISMATCH 共用同一套推導。
- **紅測:** `layoutGraph(skeleton, agents(無 phase、有 startedAt), {phases})` → 期望各就各位、warnings 空;現況全部 warning。

### #71 guide 五個缺口 + 沙箱禁用 + effort + 工具支援(MEDIUM,含 REQ 變更)
- **沙箱現況(擁有者問「還禁了什麼」):** vm context 只有 `agent / parallel / pipeline / phase / log / args / budget / workflow / Date(guarded) / Math(guarded)`(guards.ts:262-273)。**會丟 `DETERMINISM_GUARD` 的只有三個:`Date.now()`、無參數 `new Date()`、`Math.random()`**。其他人以為有的東西(`setTimeout`、`fetch`、`console`、`require`、`process`、`fs`)**根本不存在**,呼叫是 ReferenceError;`log()` 存在但是 no-op。有參數的 `new Date('2026-01-01')` 可以用。
- **為什麼當初禁:** REQ-001 的驗收條款(01-requirements.md:117)明文要求丟出;ARCH-003 / DES(04-design.md:247, 774)稱之為 **replay/resume 的 determinism hygiene**:resume 時 script 從頭重跑,`cachePlan.replay(callSeq, key)` 以「prompt+opts」當 key 回放已完成的 `agent()` 結果;prompt 裡若嵌了 `Date.now()`,重跑時 key 變了 → cache miss → 重派、重花錢。guards.ts:93-102 也自承這**不是安全邊界**(Function-constructor 可繞過),只是自傷。
- **擁有者裁決:不應禁用。** 這是 **REQ-001 驗收條款的修訂**,兩種形狀(Q3):
  - (A) 放行真實牆鐘:簡單;代價是 prompt 嵌了時間的 agent 在 resume 時會重派。
  - (B) **record-and-replay**:第一次執行記錄值到 journal(比照 `agent()` 結果的 callSeq),resume 時回放 —— 放行且 replay 不破。`Math.random()` 同理。
- **effort 對 OpenRouter(擁有者:應該都要能用):** 現況 `EFFORT_PROFILES` 只有 `anthropic`(client.ts:42);`thinkingFor`(sdk-client.ts:322)對所有非 Anthropic alias 強制 `{type:'disabled'}`。**私有 LiteLLM 實測(新 key):** Anthropic 格式的 `thinking:{type:'enabled', budget_tokens:1024}` 被 LiteLLM 翻成上游 **`reasoning_effort:'low'`**,OpenRouter 回 `reasoning_tokens:164`;而 `output_config.effort`(CLI 對 Anthropic 用的欄位)**不被翻譯**,原樣帶著、上游忽略。所以可行路徑是:effort → `thinking.budget_tokens`(low/medium/high 對 LiteLLM 的門檻)→ reasoning_effort。**限制:** 只對 OpenRouter `supported_parameters` 含 `reasoning` 的模型有效(gemini-3.8-flash、deepseek-v4-flash 有;gpt-4o-mini 沒有);`EffortProfile` 目前是「平面欄位+restPath」,裝不下物件值,要擴形;LiteLLM 的 medium/high 門檻與真 CLI 端到端要在 Gate 5/7.5 驗(本次探測繞過了 SDK)。
- **工具支援從 models_list 看得到(擁有者要求):** OpenRouter 每列的 `supported_parameters` 已含 `tools` / `reasoning`;alias 列引擎知道 provider。可加**宣告**欄位:`toolUseDeclared`、`readExcluded`(非 Anthropic 為 true)、`effortDeclared`。這是宣告不是探測(#73 的每週探測之後再做)。
- **guide 五段:** seed 三形狀 + `workspace_push`;沙箱「只有這些全域、這三個會丟」清單(依 Q3 結果改寫);args 合法型別 `string|number|enum`;每 alias 的 provider / 工具支援 / effort 是否生效表(與 alias 表同源產生);models_list 旗標是宣告非探測。

### #72 終態紀錄 provider 變 `claude-agent-sdk`、model 變 alias(MEDIUM)
- **問題:** running 時 `run_status.agents[]` 顯示 `openrouter`/`anthropic` 與真實 model id;done/failed 後變 `claude-agent-sdk` 與 alias;usage 事件又是第三種名字。
- **根因:** `agent-executor.ts:259-274` 在 done 用 `result.provider`(傳輸層)/`result.model`(alias)覆蓋 markHarness 寫的解析值;failed 也覆蓋 provider。
- **修法:** 終態保留 markHarness 的 resolved `provider/model`;新增 `transport:'claude-agent-sdk'`、`proxyModel:'rwe-proxy-…'` 欄位;usage 事件同樣帶 resolved 值。
- **紅測:** markHarness(openrouter, gemini) 後 markDone(result.provider='claude-agent-sdk') → 期望紀錄仍是 openrouter/gemini。

### #73 models_list 旗標非探測結果(MEDIUM)— **延後**
- **裁決:** 之後加「每週對 OpenRouter 探測並更新」;現在不做。v26 只做 #71 的宣告欄位改名/加註。
- **記錄:** 這與擁有者先前對 GitHub token「不做開機驗證」的裁決一致 —— 週期探測是排程工作,不是開機驗證。

### #74 token 統計少一到兩個量級(HIGH)
- **問題:** 用工具的 opus/sonnet 呼叫報 input 2–22;`budget.spent()` 形同虛設。
- **根因:** `claude-agent-sdk-client.ts:673` 只讀 `result.usage.input_tokens`。**實測 haiku 三回合:`input_tokens:18`、`cache_creation_input_tokens:20,762`、`cache_read_input_tokens:19,522`、`output_tokens:282`;引擎記 18,實際輸入約四萬。** SDK `result.modelUsage[model]` 另給 `inputTokens/outputTokens/cacheReadInputTokens/cacheCreationInputTokens/costUSD`。
- **裁決:** 四欄 `input / output / cacheRead / cacheWrite`。
- **修法:** `tokens` 型別擴成四欄(+ 可選 `costUSD`);gateway 從 `usage` 或 `modelUsage` 取四欄;`AgentRecord`、`run_status`/`run_result` outputSchema、usage 事件、dashboard 欄位、guide 的 budget 段同步;direct-fetch gateway(client.ts)各 provider 的 cache 欄位名不同(OpenRouter `prompt_tokens_details.cached_tokens` / `cache_write_tokens`),沒有的填 0。
- **待釐清(Q5):** `budget` 的單位 —— 四欄 1:1 相加,還是以 `costUSD`(cache read 只有 input 的 1/10 價)?兩者是不同的預算。
- **副作用:** budget 修正後,以前永遠停不下來的 run 可能開始被停;guide 要寫。
- **紅測:** 假 result 帶 cache 欄位 → 期望四欄齊全;現況只有 input/output。

### #75 泳道圖成為可機器檢查的契約(MEDIUM,含 REQ-111 方向)
- **問題:** 冷 client 只能靠讀 `check-mermaid.ts` 才畫得出「對的」圖;引擎除 label 集合與三元組外分不出對錯。
- **裁決:** 要修。**但提案的 `mermaid:"auto"` / 引擎產圖,與 v24 Round 記錄的擁有者決策「圖由作者提供、引擎雙向對 script」(REQ-111)方向相反** —— 需要 Q1 明確裁決。
- **修法(兩個方向擇一或並行):**
  - 方向甲「作者畫、引擎嚴驗」:guide 加「Canonical diagram」段(`graph LR`、每 phase 一個 `subgraph`、stadium 第三行 `tools:`);register 新增 `DIAGRAM_DIRECTION` / `LANE_MISMATCH` / `TOOLS_MISMATCH` / `EDGE_MISMATCH`(皆 `see: workflow_authoring_guide`),由 skeleton 推期望值;十個 guide 範例改 LR。
  - 方向乙「引擎產圖」:server 端由 skeleton + `params.agents` 產 canonical 圖;`mermaid` 變選填或只當註解;作者圖降為次要面板。
- **相依:** #67 / #68 / #70(c) 全部共用「skeleton → 期望泳道/邊」同一套推導,應設計成一個模組。
- **待釐清:** Q1、Q2(LR 是否強制、既有 TD 版本怎麼辦)。

## 待擁有者裁決的問題

- **Q1(#68/#75/#67,架構):** 圖的真相來源 —— 甲「作者畫、引擎用 skeleton 嚴驗到 lane/tools/edge」,或乙「引擎從 skeleton+params 產圖,作者圖選填」?這會修訂 REQ-111。
- **Q2(#75/#69):** `graph LR` 是否成為硬規則?只對新註冊生效還是既有版本也要(guide 十個範例與 v3 前的 workflow 全是 TD)?dashboard 要不要 zoom/pan。
- **Q3(#71,REQ-001 修訂):** `Date.now()` / `new Date()` / `Math.random()` 放行的形狀 —— (A) 真實牆鐘、接受 resume 重派;或 (B) record-and-replay,放行且 replay 不破。
- **Q4(#66):** 非 Anthropic 模型遇到指名 Read 的 prompt/allowedTools —— 只誠實記錄 + guide,還是註冊/派發時警告或拒絕,或自動補 appendPrompt 提示?
- **Q5(#74):** `budget` 的單位 —— 四欄 token 相加,或 `costUSD`?
- **Q6(#65):** 正式服務仍持舊 OpenRouter key,現在就重啟載入,或隨 v26 部署一起?

## 環境與帳本雜項
- `~/.OPENROUTER` 已不存在;唯一來源是 `~/.config/rwe.env`(新 key 已驗 200)。
- `state.yaml` 仍寫 `iteration: v24`(v25 的 REQ-119/120 直接寫進 01-requirements.md,沒有 bump);開 v26 時一併更正。
- 商標:本 triage 中「gpt-4.1 經 LiteLLM 填滿所有 optional 欄位」是 OpenAI Responses API 翻譯路徑的行為,與 OpenRouter 無關。

## 證據附錄(重現方式)
- **#64:** `workspace-seed.ts:46` 原文;run 9105d1e7 / beb5a37d 的 0-byte artifacts(回報者的 run,保留)。
- **#65 key:** `awk` 取 rwe.env 值 → `curl -H "Authorization: Bearer …" https://openrouter.ai/api/v1/auth/key` → 401(舊)/ 200(新);`/proc/<MainPID>/environ` 的值 hash 與 rwe.env 不同。
- **#65 CLI 行為:** repo 內臨時 `p401.mts`,SDK `query()` 指向正式 LiteLLM(127.0.0.1:45765)、model `openrouter/google/gemini-3.8-flash`,40 秒內觀察到 6 次 `system/api_retry` 401,無 `result`。
- **#66 傳輸:** 直接 POST 正式 LiteLLM `/v1/messages`,`rwe-proxy-gpt41` + 一個 Bash 工具定義 → `stop_reason:tool_use`;正式引擎 run b0be6f5f(gpt41 + `['Bash']`)→ tool_call/tool_result 各 1、真實輸出。
- **#66 Read:** 同上端點、Read 工具定義(含 `pages`)× 5 → 5/5 `"pages":""`。
- **#71 effort:** 私有 LiteLLM(port 45999、`--detailed_debug`、新 key)→ `thinking` 請求上游為 `'reasoning_effort': 'low'`、回應 `reasoning_tokens:164`;`output_config.effort` 請求上游無 reasoning 參數。OpenRouter `/models` 的 `supported_parameters` 見 #71 段。已停止私有 LiteLLM。
- **#74:** repo 內臨時 `pu.mts`,haiku + Bash 兩次;`result.usage` 與 `modelUsage` 數字如 #74 段。
- **#70 / #72 / #67 / #69:** 原始碼行號如各段;run 77f74018 的 `GET /api/runs/<id>` 無 `phase` 鍵(回報者證據)。

## 擁有者答覆(2026-09-08 04:xx,六題全部裁定)

| Q | 裁決 | 落點 |
|---|---|---|
| Q1 圖的真相來源 | **甲**:作者畫、引擎用 skeleton 嚴驗(lane / tools / edge) | REQ-128;REQ-111 維持 |
| Q2 LR 硬規則 | **是,但只對新註冊**(既有版本的圖不能被刪掉);**要支援 zoom** | REQ-128(grandfather)、REQ-129 |
| Q3 Date.now() | **維持現狀(禁用)**;但 schema/guide 要說清楚禁了哪些、用什麼取代 | REQ-130;REQ-001 不變。(擁有者原句「A先維持好了但schema 要說禁用那些以及可以用什麼方式取代」—— 讀為「先維持禁用」,若是要放行請更正) |
| Q4 Read 剔除 | **移除 `NON_ANTHROPIC_EXCLUDED_TOOLS` 與 gpt-4.1 相關程式碼,不支援就好**;anthropic / openrouter / ollama 三條路都要支援所有工具,**不要有類似的 patch** | REQ-123 |
| Q5 budget 單位 | **依各模型價格算花費**(models_list 有價格) | REQ-127 |
| Q6 重啟 | **現在重啟** —— 已於 04:0x 執行,新 key 已載入,`openrouter/google/gemini-3.8-flash` 經正式 LiteLLM 回 "Paris" | 完成 |
| 補充 #66 | **整條 `openai` provider 移除**(OpenRouter 上有 OpenAI 的模型);「請清乾淨一點」 | REQ-123 |

### 兩個要向擁有者標明的後果(照裁決執行,若不接受請在 Gate 2 暫停點更正)
1. **移除 `openai` 也移除了 DEPLOY.md §「自架 OpenAI 相容端點」那條路**(vLLM / TGI / llama.cpp server 經 `OPENAI_API_BASE`,DEPLOY.md:162-197、235-240、462-463、1016)。本機模型仍有 Ollama 這條;雲端 OpenAI 模型走 OpenRouter。
2. **`gemini` 直連 provider 一併移除**(只在 `gateway:"direct-fetch"` 舊路徑 `client.ts:220` 有分支;SDK 路徑從未特別處理)。理由:擁有者說的是「這三條路」;Gemini 模型走 OpenRouter。若要保留請說。

### 這輪不做、已記錄的延後項
- #73 每週對 OpenRouter 探測並更新 models_list 的 stability / 可用性(排程工作)。v26 只加**宣告**欄位。
