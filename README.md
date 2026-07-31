# remote-workflow-engine

> 人類導向文件（繁體中文）。由 Gate 7.5 validator 依「實際把系統跑起來的步驟」撰寫——
> 下方 quickstart 就是驗證腳本：照著貼上執行若跑不起來，就是缺口。
>
> **v3 狀態（最新，2026-07-18，Gate 7.5 v3 ROUND 1 — GATE PASSED）：REQ-016..021（v3 切片）
> 皆已對真實系統驗證通過——MCP 依名 provisioning、伺服器端 secrets、hook 封鎖、SDK gateway
> 逾時保底、workRoot 隔離保護。生產引擎為 systemd user service，綁定 `0.0.0.0:8787`（ufw 白名單
> `192.168.0.0/24` + SSH），`gateway:"sdk"` + managed LiteLLM proxy + Ollama `qwen2.5:7b`。
> REQ-016（非 Anthropic 完整 harness）：SDK gateway 路徑真實端對端執行（provider=claude-agent-sdk，
> token 計費），D-F11 模型能力限制為已接受的環境缺口（qwen2.5:7b 不發出 native tool_use，非程式碼
> 問題）。REQ-020（逾時保底）：val-023 驗收測試 2/2 通過（8秒，真實 fault-injected 卡住 HTTP 伺服
> 器 + 真實 ClaudeAgentSdkGatewayClient）。REQ-021（workRoot 隔離）：throwaway instance 對 project
> 內部路徑啟動時 fail-fast 輸出 WORKROOT_INSIDE_PROJECT；對外部乾淨路徑啟動正常。完整證據見
> `.sdlc/features/001-remote-workflow-engine/08-validation.md`「v3 ROUND 1」章節（VAL-025..030）。
> 全部 v3 驗收測試 17/17 通過。v1/v2 REQs 沿用 ROUND 1..7 既有證據，本輪未重新測試。
>
> **本文件下方 v1 章節為第七輪 Gate 7.5（Gate 8 收尾修復的範圍化重新驗證）後改寫，原樣保留。**
>
> **第七輪（本輪）結果摘要**：任務是針對 Gate 8 review 修復（IMPL-051，D-G8-1~6）中前一輪標記
> 「程式碼/測試層級已修復，尚未經獨立真實 process 重新驗證」的 3 項核心項目逐一實測：
> - **零設定逾時保底（D-G8-4）——CONFIRMED**：完全不存在 `rwe.config.json` 的零設定啟動下，對一個
>   真實、永久不回應的網路端點送出真實 `agent()` 呼叫，5.2 秒內正確回傳 `result:null`、run 進入
>   `completed`，從未卡住；並直接對真實（未 mock）組合根程式碼確認 `timeoutMs` 保底值 `15000`
>   確實生效、對永久卡住的 session 真的在 15014 毫秒觸發逾時。
> - **`workflow_agent_log` 真實訊息事件（D-G8-2）——CONFIRMED**：真實本機 Ollama 的真實 `agent()`
>   呼叫，現在回傳真實 `"message"` 事件，不再只有最終 `"usage"` 摘要。
> - **`tools/list` 真實 schema（D-G8-3）——CONFIRMED**：真實 HTTP 呼叫確認全部 10 個工具都有真實
>   描述與真實 `inputSchema.properties`/`required`。
> - 其餘 3 項（巢狀 resume `callSeq` 命名空間 D-G8-1、子行程環境變數白名單 D-G8-5、並行預算保留
>   D-G8-6）依本輪任務範圍由自動化回歸測試涵蓋（皆綠燈）+ 原始碼確認掛載點，未本輪獨立重跑真實
>   process。完整證據見 `.sdlc/features/001-remote-workflow-engine/08-validation.md` 的
>   「ROUND 7」章節。
>
> **第六輪結果摘要（保留，仍然成立）**：任務是重新驗證第五輪找到的 3 個問題（`allowedTools`
> 沒有限制導致小型本機模型工具呼叫失敗、in-flight agent 狀態不可觀察、暫停後續跑重播快取 `null`
> 而非真的重新執行），並對**每一條 v1 REQ 驗收子句**取得新鮮的真實層證據。結果：
> - **2 項確認真的修好了（皆有全新真實 process + 真實 Ollama repro）**：`workflow_status` 現在能
>   即時看到 `"queued"`/`"running"` 的 agent；`workflow_suspend` 後 `workflow_resume`
>   若呼叫被中止，現在會真的重新執行（不再是重播 `null`）。
> - **1 項的程式碼修復已確認生效，但工具呼叫本身仍未成功——正式歸類為「本機小模型能力上限」，
>   不算程式碼缺陷、不會擋 gate**（詳見下方已知限制第 1 條與
>   `.sdlc/features/001-remote-workflow-engine/08-validation.md` VAL-003）：`agent()` 透過預設
>   `gateway:"sdk"` 路徑對接真實本機 `qwen2.5:7b` 模型時，即使已經把送給模型的工具清單縮減到只有
>   `Read`/`Write`/`Bash`（且移除了與本產品無關的外掛工具），模型仍然不會真的觸發工具呼叫，只會生出
>   一段看起來像工具結果的編造文字。這個環境沒有更大的本機模型可供測試；若你的部署需要 agent 真的
>   讀寫檔案，建議改用較大的本機模型（如 32B 級）或已驗證憑證的付費供應商。

## 這是什麼
一個可遠端操控的 **Claude 工作流程執行引擎**：把 Claude「Workflow 工具」產生的 `.js` 工作流程腳本
（用到 `phase()`、`log()`、`agent()`、`pipeline()`、`parallel()`、`budget`、具名 `workflow()` 等 API）
原封不動地跑在一台伺服器上，透過 **MCP Streamable HTTP** 介面遠端送出、追蹤、暫停/續跑/停止，並
把每個 `agent()` 呼叫真正路由到你設定的 LLM 供應商（Anthropic / OpenAI / Gemini / 本機 Ollama）。

## 前置需求
- **Node.js 22.6 以上**（實測需求；`20+` 不準確——沙箱子行程與 `tsx` 都用到 Node 22 原生
  TypeScript type-stripping `--experimental-transform-types`）
- npm（隨 Node 附帶）
- **Python 3.11 或 3.12**（第二輪驗證發現）——伺服器內建的 `agent()` 路由預設會管理一個
  `litellm[proxy]` 子行程；本機系統若只有較新的 Python（例如 3.13/3.14），`pip install
  'litellm[proxy]'` 會因為 `uvloop`/`orjson`/`websockets` 沒有對應的預編譯 wheel 而失敗。**建議用
  `uv` 取得一個獨立的 3.12**（不需要 root/系統套件）：見下方 quickstart 第 3 步。
- 至少一個可用的 LLM 供應商，擇一：
  - Anthropic / OpenAI / Gemini 的 API key（正式或 sandbox/test key 皆可，經環境變數提供，**絕不寫入設定檔**）
  - 或本機 **Ollama**（`http://localhost:11434`，免金鑰；本次驗證即以 `qwen2.5:7b` 模型全程實測——
    但見下方已知限制第 1 條：這個模型透過本產品的 SDK gateway 目前**不會**真的執行工具呼叫，屬於
    已記錄的模型能力上限，非本產品的程式碼缺陷）
- 沒有 `agent()` 需求（純跑工作流程腳本邏輯、不呼叫 LLM）時，Python/LiteLLM 與 LLM 供應商皆可略過

## 快速開始 Quickstart
> 以下指令是 validator 實際跑過、能把系統帶起來的步驟（與
> `.sdlc/features/001-remote-workflow-engine/08-validation.md` 的 Boot 一致，本輪零文件缺口）。

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

# 4. 設定要用哪些模型別名 / 供應商 + 選擇 gateway 實作
cp rwe.config.example.json rwe.config.json
# 用編輯器打開 rwe.config.json，依需求調整 aliases / bind / port / workRoot / agentDefinitionsDir /
# defaultAllowedTools
# 範本預設 "gateway": "sdk"（真正的 @anthropic-ai/claude-agent-sdk headless session，
# aliases/timeoutMs/retries/agentDefinitionsDir/defaultAllowedTools 皆已對獨立真實 process 確認生效）；
# "direct-fetch" 仍保留為可選的退回路徑（LiteLLMGatewayClient 直連）

# API key 一律用環境變數，不放進設定檔：
export ANTHROPIC_API_KEY=sk-ant-...      # 若要用 anthropic 別名
# export OPENAI_API_KEY=...              # 若要用 openai 別名
# export GEMINI_API_KEY=...              # 若要用 gemini 別名
# export OLLAMA_BASE_URL=http://localhost:11434   # 若要用 ollama 別名（有預設值，通常不用設）

# 5（重要，啟動前）：確認沒有前一次殘留的孤兒 litellm process 占著 4000 port（見已知限制第 4 條）
ps aux | grep '[l]itellm --config' && echo "先清掉這些 process 再繼續！" \
  || echo "乾淨，可以啟動"

# 6. 啟動
RWE_CONFIG_PATH=./rwe.config.json npm run start
# 沒有自訂設定檔也可以直接：npm run start（用內建預設值 + 預設 gateway="sdk"，
# 監聽 127.0.0.1:8787）
```

啟動後確認成功（healthcheck）：
```bash
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
預期：HTTP 200，`result.tools` 陣列包含 `workflow_run`、`workflow_status`、`workflow_result`、
`workflow_suspend`、`workflow_resume`、`workflow_stop`、`workflow_list`、`workflow_agent_log`、
`workflow_register`、`workflow_deregister`、`workflow_artifacts`、`workflow_artifact_get`、
`workspace_purge`、`schedule_create`、`schedule_list`、`schedule_delete`、`schedule_setEnabled`、
`workflow_trigger`、`asset_push`、`asset_list`、`asset_delete`、`mcp_provision`、`issue_report`、
`issue_get`、`issue_list`、`issue_comments`、`issue_comment` 共 **27** 個工具。
終端機也會印出：
```
[remote-workflow-engine] listening on http://127.0.0.1:8787/mcp (workRoot=...)
[remote-workflow-engine] ready
```

## 使用範例
> 對應各 REQ 的真實使用者操作（與 `.sdlc/features/001-remote-workflow-engine/08-validation.md` 的真實層驗證一致，皆為 validator 實際用真實 HTTP 客戶端對獨立啟動的伺服器跑過的指令）。

**範例 1：送出一段工作流程腳本並取回結果**
```bash
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_run","arguments":{"script":"return {answer:42, tags:[\"a\",\"b\"]};"}}}'
# -> {"result":{"content":[{"type":"text","text":"{\"runId\":\"<uuid>\",\"status\":\"running\",...}"}]}}

# 用回傳的 runId 輪詢狀態，completed/failed 後再取結果
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_result","arguments":{"runId":"<uuid>"}}}'
# -> result.result deep-equals 腳本 return 的值：{"answer":42,"tags":["a","b"]}
```

**範例 2：呼叫 agent()（需要已設定的模型別名 + 對應憑證/本機 Ollama）**
```bash
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_run","arguments":{"script":"return agent(\"Reply with only the word: PONG\", {model:\"local\"});"}}}'
# 輪詢 workflow_status 直到 completed，workflow_result.result 會是模型的真實回覆文字（例："PONG"），
# workflow_status.agents[0] 會顯示真正用到的 provider/model/tokens；輪詢過程中若還在跑，
# state 現在會正確顯示 "running"（第六輪 D-F12 修復，見下方確認修復第 1 項）
```
> **composite 呼叫樹（v8 Slice 2）**：對一個用 `workflow()` 組合其他工作流程的 run，`workflow_status`
> 會額外回傳 `workflowNodes: [{frame,name,parentFrame,depth}]`（每次巢狀 `workflow()` 一個節點）以及每個
> `agents[].frame`（所在巢狀 frame，頂層 `""`）——用戶端據此重建整棵呼叫樹並下鑽到每個節點的 log。
> **注意（第六輪 Gate 7.5 對獨立真實 process + 真實 Ollama 重新確認）**：純文字問答（不需要工具）
> 這樣的呼叫可正常運作、約 15-20 秒內完成，且進行中即可從 `workflow_status` 看到 `"running"`。
> **但如果你的 prompt 要求 agent 讀檔或寫檔（工具呼叫），目前對本機 7B 級 Ollama 模型完全不會真的
> 執行工具——模型只會生出一段看起來像工具結果的文字，內容是編造的**，即使伺服器已經把送給模型的
> 工具清單縮減到最小（`Read`/`Write`/`Bash`）。這是已記錄的模型能力上限，見下方已知限制第 1 條。

**範例 3：註冊具名工作流程並用名稱執行（重啟後仍可用，SQLite 持久化）**
```bash
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_register","arguments":{"name":"greet","script":"return \"hello \" + args.name;"}}}'

curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_run","arguments":{"name":"greet","args":{"name":"world"}}}}'
```

**範例 4：取回一次執行實際產生的檔案（`workflow_artifacts`）**
```bash
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_artifacts","arguments":{"runId":"<uuid>"}}}'
# -> result: ["output.txt", ...]（該次執行工作目錄下實際存在的檔名列表——但見已知限制第 1 條，
# 目前 agent() 自己的工具呼叫不會真的產生檔案；此工具本身對「直接寫進工作目錄的檔案」運作正常）
```

**範例 5：暫停 / 續跑（第六輪確認：中止的呼叫現在真的會重新執行，不是重播 `null`）**
```bash
# 送出一個會呼叫 agent() 的長腳本，拿到 runId 後：
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_suspend","arguments":{"runId":"<uuid>"}}}'
# -> {"status":"suspended"}；底層真實 claude CLI 子行程會在數秒內被真的砍掉（非跑到自然完成）

curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_resume","arguments":{"runId":"<uuid>"}}}'
# -> {"status":"running"}，被中止的那次 agent() 呼叫會真的重新執行（第六輪 D-F13 修復前，
# 這裡會秒殺完成並回傳 null——現在會看到真實的推論時間與真實結果）
```

## 已知限制（v1，第七輪 Gate 7.5 對獨立真實 process 重新驗證的結果）
詳細證據（含確切檔名/行號、真實 `ps aux`/時間量測）見
`.sdlc/features/001-remote-workflow-engine/08-validation.md`（「ROUND 7」章節為本輪新增證據）。

**本輪（第七輪）確認：以下 3 項 Gate 8 收尾修復（D-G8-1~6）真的對獨立真實 process 生效**：
1. **零設定（無 `rwe.config.json`）啟動下，`timeoutMs` 保底值真的生效**——對一個真實、永久不回應
   的網路端點送出真實 `agent()` 呼叫，5.2 秒內正確回傳 `result:null`、run 進入 `completed`，從未
   卡住；直接對真實組合根程式碼確認零設定下 `timeoutMs` 解析為 `15000`，且對永久卡住的 session
   真的在 15014 毫秒觸發逾時。
2. **`workflow_agent_log` 現在回傳真實的訊息事件**——真實本機 Ollama 的真實 `agent()` 呼叫，
   逐字稿包含真實 `"message"` 事件，不再只有最終 `"usage"` 摘要。
3. **`tools/list` 現在回傳真實 schema**——真實 HTTP 呼叫確認全部 10 個工具都有真實描述與真實
   `inputSchema.properties`/`required`，MCP client 可據此正確組出呼叫參數。

其餘 3 項 Gate 8 修復（巢狀 resume `callSeq` 命名空間、子行程環境變數白名單、並行預算保留）依本輪
任務範圍由自動化回歸測試 + 原始碼掛載點確認涵蓋，未本輪獨立重跑真實 process（見
`08-validation.md` ROUND 7 章節的完整範圍說明）。

**第六輪確認：以下 2 項真的修好了（有全新真實 process + 真實 Ollama repro）**：
1. **`workflow_status.agents[].state` 現在會即時顯示 `"queued"`/`"running"`**——真實 3 個
   `agent()` 並行呼叫，於 `status:"running"` 期間輪詢，全部正確顯示 `"running"`（第五輪的
   `agents:[]` 空陣列問題已修復）。
2. **`workflow_suspend` 之後 `workflow_resume`，被中止的 `agent()` 呼叫現在真的會重新執行**——
   實測暫停一個約 57 秒的生成任務，續跑後花費 27 秒、產生 940 個真實輸出 token 的完整內容，而非
   秒殺回傳 `null`（第五輪的問題已修復）。同時也確認了 `workflow_stop` + 帶編輯過腳本的
   `workflow_resume`（快取前綴重播語意）：未變更的 `agent()` 呼叫從快取重播、變更過的那次真的
   重新執行並反映新的 prompt 內容——這是第一輪之後首次重新以真實 process 證實。

**本輪（第六輪）新分類：以下 1 項的程式碼修復已生效，但實測結果被正式歸類為「模型能力上限」，
不算程式碼缺陷、不會擋 gate**：
3. **`agent()` 的工具迴圈（讀檔/寫檔）對本機 7B 級 Ollama 模型完全不會真的執行**——伺服器已將
   送給模型的工具清單從「整個 Claude Code CLI 完整工具面」縮減到只有 `Read`/`Write`/`Bash`
   （`ps aux` 可見真實子行程的 `--allowedTools Read,Write,Bash --tools Read,Write,Bash` 旗標，
   單次呼叫的真實 token 用量也從約 4095 降到約 1550-2016，證實這個限制確實生效），但即使如此，
   模型仍然只回傳一段編造的、看起來像工具呼叫結果的文字，從未真正發出工具呼叫（直接對 SDK
   `query()` 探測確認 `num_turns:1`，從未出現任何 `tool_use` 訊息）。本環境沒有比 7B 更大的本機
   模型可供測試。**建議**：若你的工作流程需要 agent 真的讀寫檔案，改用較大的本機模型（例如
   32B 級、或以工具呼叫能力著稱的模型），或使用已驗證憑證的付費供應商（Anthropic/OpenAI/Gemini，
   本環境未驗證這些供應商的工具呼叫能力）。

**確認真的修復（第五輪起，本輪重新驗證仍然成立）**：
4. `timeoutMs`/`retries`/`aliases` 對 `gateway:"sdk"` 真的生效（本輪專用測試設定
   `timeoutMs:1500,retries:0`，真實呼叫在 1.677 秒內正確中止）。
5. `workflow_suspend` 真的終止底層 `claude` CLI 子行程（本輪重新確認，約 2 秒內消失）。
6. `agentType` 在正式環境可用（已知型別正確解析，未知型別快速報錯）。
7. `budget.spent()`/`budget.remaining()` 即時反映真實用量；重啟後 per-agent 記錄/逐字稿仍正確；
   `bind:"0.0.0.0"` 可對外監聽（本輪首次重新以真實 process 驗證，`ss -tlnp` 確認）。

**這條 v1 已知限制已於 v2 修復（TASK-027，見下方「v2 新功能」與 DEPLOY.md §1b/§6 第 7/8 項）**：
8. ~~`litellm` 代理固定使用 4000 port，正常關機也不會停止它~~ **v2 起：正常 `SIGTERM` 關機現在會
   連帶砍掉這個子行程（本輪 Gate 7.5 v2 ROUND 2 config-sync check 已重新以真實 `SIGTERM` 確認，
   2 秒內兩個 process 都消失，無孤兒殘留），且可用新設定鍵 `litellmPort` 讓每個實例指定不同
   port，徹底避開誤連舊代理的風險。啟動前確認沒有孤兒 `litellm` process（quickstart 第 5 步）
   仍建議保留作為額外保險，但已不是唯一防線。

**新發現的小瑕疵（第六輪，非 REQ 阻斷，記在 v1.1 backlog）**：
9. 被 `workflow_suspend`/`workflow_stop` 中止的那次 agent 呼叫，其 `workflow_status.agents[]`
   紀錄會永遠停在 `"state":"running"`（不會自己轉成任何終止狀態），續跑後會多出一筆新紀錄。
   最終 `result` 本身是正確的，只是輪詢畫面上會多看到一筆「卡住」的舊紀錄，純屬顯示瑕疵。

**先前各輪確認修復、本輪重新驗證仍然成立**：`workflow_agent_log` 回傳真實逐字稿（含跨重啟）；
`workflow_artifacts` 可列出實際產生的檔案；具名工作流程的 `scriptVersion`/註冊清單（含跨重啟
持久化、含版本更新後舊 run 仍保留原版本號）都正確；`gateway:"sdk"` 正確把呼叫端指定的模型/別名
帶入 SDK session；供應商真實錯誤（`is_error:true`）正確解析成 `null`；2 層巢狀 `workflow()` 正確
被拒絕、1 層正確允許；未知模型別名在送出時就被拒絕（不會跑到一半才失敗）。
> **v8 Slice 1 更新（2026-07-30）**：上述「2 層巢狀 `workflow()` 被拒絕」已被 N 層 composition 取代
> ——具名 `workflow()` 現在可巢狀到設定的 `maxWorkflowDepth`（預設 4）層，讓一個已註冊的 composite
> 能當作另一個 composite 的節點。超過深度→`NESTING_DEPTH_EXCEEDED`、祖先環→`NESTING_CYCLE`、整棵樹
> 巢狀呼叫數超過 `maxWorkflowDescendants`（預設 256）→`DESCENDANT_CAP_EXCEEDED`（皆為可分支的
> envelope 錯誤，不崩父 run）；巢狀子工作流共用父 run 的同一份預算/journal。詳見 DEPLOY.md §1b。

## v8 新功能（Gate 7.5 v8 Slice 4 ROUND 1，2026-08-01 — GATE PASSED）

- **完成即串接（on-completion chaining，REQ-053）**：用 `chain_create({afterRunId, run:{workflow,
  args?}})` 註冊「當某個 run 完成時，自動啟動另一個 run」，恰好一次；目標 `failed`／`stopped` 則跳過。
  續接持久化（引擎自有 SQLite side table），跨重啟由 boot reconcile 補觸發，並帶 `rootRunId` 世系；
  用 `chain_list`（零參數）查每個續接的狀態與已啟動的 `spawnedRunId`。
- **並行 run 上限（run-admission，REQ-054）**：設定鍵 `maxConcurrentRuns`（預設 64）限制同時存活的
  頂層 run 數；超限的 `start()` 在做任何昂貴動作前即以 `RUN_ADMISSION_LIMIT` 拒絕（這是全域 agent
  semaphore 沒有涵蓋的 DoS 阻塞點）；巢狀 `workflow()` 不佔槽，run 進終態即釋放。

## v3 新功能（Gate 7.5 v3 ROUND 1，2026-07-18 — GATE PASSED）

> REQ-016..021 全部對真實系統驗證通過。

- **MCP 依名 provisioning（REQ-017）**：管理員用 `mcp_provision` 工具把 MCP server config 存入
  伺服器端 registry（SQLite `mcp-registry.db`），workflow 腳本用 `agent(prompt, {mcp:["name"]})`
  引用名稱。只有被明確引用的 MCP 才會注入 SDK session（`strictMcpConfig` 不變），宿主環境的
  ambient MCP 永遠不繼承。未 provision 的名稱立即回傳 `MCP_NOT_PROVISIONED` 錯誤。
- **伺服器端 secrets（REQ-018）**：provisioned MCP config 裡的敏感欄位（如 token）用
  `${secret:NAME}` handle 存入 registry——registry 只存 handle，不存實際值。引擎從 `RWE_SECRET_<NAME>`
  環境變數在 invoke 時解析（不在 provision 時），缺少則 `SECRET_MISSING` 明確報錯，不外洩、不
  靜默失敗。secret 值絕不出現在任何 workspace 路徑下。
- **hook 明確不支援（REQ-019）**：任何 `asset_push` 帶 `kind:"hook"` 的請求一律拒絕
  （`HOOKS_UNSUPPORTED`，`stored:[]`），關閉 arbitrary-server-side-code 向量。
- **非 Anthropic 完整 harness（REQ-016）**：`gateway:"sdk"` 路徑支援非 Anthropic provider（Ollama/
  OpenAI/Gemini），thinking 對非 Anthropic alias 自動 disabled（D-F6），工具面縮減到 allowlist。
  本環境（qwen2.5:7b 7B 模型）的 native tool_use 為已接受的模型能力限制（D-F11）。
- **SDK gateway 逾時保底（REQ-020）**：`timeoutMs`/`retries` 對 SDK gateway 路徑生效；hung LLM
  call 在設定的上限內解析成 `null`，run 繼續（不卡住）。
- **workRoot 隔離保護（REQ-021）**：啟動時若 `workRoot`（或其任一祖先）是 Claude Code project
  （含 `.git`/`CLAUDE.md`），立即以 `WORKROOT_INSIDE_PROJECT` fail-fast 拒絕啟動。見 DEPLOY.md
  §0 第4步。

## v2 新功能（Gate 7.5 v2 ROUND 1 對獨立真實 process 驗證 + Gate 6 v2 validation-round fixes）
> **本輪結果摘要**：REQ-008（Dashboard）、REQ-010（Client Plugin）、REQ-011（部署封裝）、
> REQ-015（排程/一次性/常駐執行模式）皆已對真實獨立 process 驗證通過（`real:true` 綠燈）。
> **REQ-009（資產同步）先前發現的接線缺口已修復（D-V2V-1 route-back，2026-07-04）**：
> `asset_push`/`asset_list`/`asset_delete`/遞迴保護（D4）/MCP config 真實連線探測本來就真的可用；
> 現在**推送的 skill/hook/MCP server 設定會真的被接進下一次 `agent()` 呼叫**——`mcp-config` 資產
> 在每次呼叫前重新從磁碟讀取、填進 `options.mcpServers`（`strictMcpConfig:true` 不變）；
> `skill`/`hook` 資產被實體化進該次 run 自己工作目錄下的 `.claude/skills|hooks/<name>/`，該次
> 呼叫的 `options.cwd` 改指到那個 run 工作目錄、`options.settingSources` 變成 `['project']`（宿主
> 機層級的 `'user'`/`'local'` 來源仍然關閉，D-F11 隔離保證不變）。見
> `tests/integration/asset-mcp-config-wiring.test.ts`（IT-035）/
> `tests/integration/asset-skill-materialization-wiring.test.ts`（IT-036）。

### Dashboard（REQ-008）—— 瀏覽器頁面 + 唯讀 JSON REST API
> **D-V2V-2 route-back（2026-07-04）**：新增 `GET /dashboard`，同一個 port、同一個 `http.Server`，
> 一個自成一體的靜態 HTML/JS 頁面——run 清單、點進去看 phase/agent tree（每個 agent 的
> state + token usage）、逐字稿檢視、`setInterval` 輪詢自動更新（不必手動重新整理）。
> `/dashboard/<runId>` 走同一個靜態頁面的 client-side 路由。頁面本身呼叫的是下面同一組唯讀
> `/api/runs*` JSON API（DES-018）——一份資料模型，兩種傳輸方式（瀏覽器頁面 + 給其他工具消費的
> JSON）。見 `tests/acceptance/val-018-dashboard-browser-ui.test.ts`（VAL-018）。
> **v8 Slice 3**：首頁現在同時列出已註冊工作流程卡片與 run 卡片；點一張 run 卡片會把它的 composite
> 呼叫樹渲染成巢狀 DAG（每個子工作流程為一個帶標題群組、agent 節點依 3 態上色並顯示 model，點擊下鑽
> transcript），資料來自新端點 `GET /api/workflows` 與 `GET /api/runs/:id/dag`（VAL-057/058）。
> **v8 Slice 2b**：run 詳情頁再加上 phase 時間軸（每個 `phase()` 帶進入時間 `ts`、`running` 時最後
> 一個標為目前步驟）與每個 agent 節點的耗時（`startedAt`/`endedAt` 導出 `durationMs`，顯示 `<n> ms`）（VAL-059/060）。
```bash
# 直接在瀏覽器打開（或用 curl 看原始 HTML）
open http://127.0.0.1:8787/dashboard        # macOS；Linux 可用 xdg-open，或直接貼網址到瀏覽器

# 底層唯讀 JSON API（dashboard 頁面自己的 JS 也是呼叫這幾支）：
# 列出所有 run（含即時狀態）
curl -s http://127.0.0.1:8787/api/runs

# 列出已註冊工作流程（v8 Slice 3，首頁卡片用）
curl -s http://127.0.0.1:8787/api/workflows

# 單一 run 的 composite 呼叫樹（DAG，v8 Slice 3；後端 buildDagModel 重建）
curl -s http://127.0.0.1:8787/api/runs/<runId>/dag

# 點進單一 run（phase/agent tree，重複呼叫即可看到即時更新，不需重新整理任何東西）
curl -s http://127.0.0.1:8787/api/runs/<runId>

# 看某個 agent 的逐字稿
curl -s http://127.0.0.1:8787/api/runs/<runId>/agents/<agentId>
```

### 排程 / 一次性 / 常駐觸發（REQ-015）
```bash
# 先註冊工作流程（排程/常駐目標必須是「已註冊」的工作流程，不能是臨時腳本）
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workflow_register","arguments":{"name":"daily-report","script":"return {ok:true, args};"}}}'

# cron 排程（每天 03:00 UTC；驗證時已用 "* * * * *" 對真實時鐘實測連續 2 次真實觸發）
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"schedule_create","arguments":{"kind":"cron","workflow":"daily-report","cron":"0 3 * * *","enabled":true}}}'

# 一次性排程（T 到達時觸發一次後自動停用；若要「改時間」，目前做法是刪除舊排程、
# 用新時間重新建立一筆——尚未提供專門的 schedule_update 工具，見已知限制）
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"schedule_create","arguments":{"kind":"once","workflow":"daily-report","at":"2026-08-01T00:00:00Z","enabled":true}}}'

# 常駐（resident）：使用者隨時可觸發；停用時觸發會被拒絕
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"schedule_create","arguments":{"kind":"resident","workflow":"daily-report","enabled":true}}}'
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"workflow_trigger","arguments":{"workflow":"daily-report","args":{}}}}'

# 查詢所有排程 / 刪除 / 啟停
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"schedule_list","arguments":{}}}'
```

### 資產同步：skill / hook / MCP config（REQ-009）
```bash
# 推送一個 skill（落地在伺服器端 workspace，且下一次 agent() 呼叫就會把它實體化進該次 run 的
# .claude/skills/ 並以 settingSources:['project'] 載入——D-V2V-1 route-back，見上方 v2 新功能一節）
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"asset_push","arguments":{"kind":"skill","name":"my-skill","files":[{"path":"SKILL.md","contentB64":"<base64>"}]}}}'

# 列出 / 刪除
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"asset_list","arguments":{}}}'
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"asset_delete","arguments":{"kind":"skill","name":"my-skill"}}}'

# 遞迴保護（D4）：推送本產品自己的 client plugin / guidance skill / 指向本伺服器的 mcp-config
# 一律會被排除，並在回應的 excluded[] 附上原因，不會靜默接受。
```

### Claude Code Client Plugin（REQ-010）
```bash
# 把 plugin/ 目錄下的 .mcp.json 複製到你的 Claude Code 專案目錄，並把 url 換成你實際的伺服器位址
cp plugin/.mcp.json /path/to/your/claude-project/.mcp.json
cd /path/to/your/claude-project
claude mcp list     # 應會列出 remote-workflow-engine，狀態為「待批准」（Claude Code 的專案級信任機制）
claude              # 互動啟動並批准這個專案級 MCP server 後，即可在對話中使用
                     # remote-workflow-engine__workflow_run 等工具，guidance skill 會教 agent
                     # 何時該用遠端服務、何時該用內建的本機動態 Workflow 工具（兩者不衝突）
```

### 安全模型（v2 Gate 8 review 收尾修復，D-V2G8-1）
`gateway:"sdk"` 路徑（真正的 `@anthropic-ai/claude-agent-sdk` headless session）的三個關鍵行為，
**修復後的實際現況**（不是計畫）——完整說明見 `DEPLOY.md` §1c：
1. **不再用 `permissionMode:'bypassPermissions'`**：headless 但不再對每一次工具呼叫免裁決放行。
2. **預設工具面不含 `Bash`**：內建預設是 `["Read","Write"]`；要用 `Bash`，必須在 `agentType` 的
   `tools:`、呼叫端 `opts.allowedTools`、或 `defaultAllowedTools` 三者之一明確列出，是刻意的
   opt-in，不是預設能力。
3. **供應商 API 金鑰只給 LiteLLM 代理子行程，不給 agent CLI 子行程**：真實金鑰（如
   `ANTHROPIC_API_KEY`）透過環境變數交給伺服器內部管理的 LiteLLM 代理；被 spawn 出來實際跑 agent
   工具迴圈的 `claude` CLI 子行程只拿到一份白名單環境變數，從未看到真實金鑰。
4. **每次 run 的工作目錄互相隔離，讀寫被限制在自己的工作目錄子樹內**：透過 SDK 的
   `canUseTool` 回呼 + `PreToolUse` hook 雙重檢查一次工具呼叫自己帶的路徑參數，落在工作目錄以外
   一律拒絕（已用真實 SDK session 端對端驗證過）。**這不是作業系統層級的 sandbox/jail**，是應用層
   的權限裁決 + 路徑邊界檢查。

### 部署封裝（REQ-011）：docker-compose / systemd / 上線煙霧測試
見 `DEPLOY.md` §2b（本輪已對 `scripts/smoke.sh`、systemd unit 語法、docker-compose YAML 語法皆做
真實驗證；`docker compose up`/`sudo systemctl enable --now` 因本次驗證環境沒有 docker/sudo 而未能
實際執行，已在 `DEPLOY.md`/`08-validation.md` 誠實記錄為環境缺口，非靜默略過）。

## 已知限制（v2）
1. ~~REQ-009 核心承諾尚未打通~~ **已修復（D-V2V-1 route-back，2026-07-04）**：推送的 skill/hook/
   MCP config 現在會真的被接進下一次 `agent()` 呼叫，見上方「v2 新功能」一節。
2. `schedule_create`/`schedule_list`/`schedule_delete`/`schedule_setEnabled` 沒有 `schedule_
   update`：要改一次性排程的時間，目前做法是刪除舊的、用新時間建立新的一筆（結果正確，只是 API
   形狀稍嫌不便）。
3. ~~Dashboard（REQ-008）目前只有唯讀 JSON REST API，沒有附一個可以直接點開的 HTML 頁面~~
   **已修復（D-V2V-2 route-back，2026-07-04）**：新增 `GET /dashboard` 瀏覽器頁面，見上方
   「v2 新功能」一節。
4. v1 已知限制（本機小模型工具呼叫能力上限、litellm port 4000 碰撞風險等）詳見上方「v1，第七輪」
   一節，本輪未重新測試（依 v2 迭代範圍規則凍結不動）。
5. docker/systemd 部署封裝（REQ-011 §2b）僅做過語法/語意驗證（`docker compose config`、
   `systemd-analyze verify`）——本次實作環境沒有 docker、也沒有可互動的 sudo 權限，兩支產物從未
   在這個環境裡真正跑起來過（`npm` 路徑部署 + 煙霧測試 + 優雅關閉不留孤兒則已對真實獨立 process
   驗證過）。ORCH 已接受此環境缺口（D-V2V-3），非阻擋項；詳見 `DEPLOY.md` 開頭摘要，部署到
   docker/root 權限主機時請自行補驗這兩支產物。

## 更多
- 部署 / 維運：見 `DEPLOY.md`
- 設計與追溯：見 `.sdlc/`（工作區索引 `.sdlc/dashboard.html`；本功能 `.sdlc/features/001-remote-workflow-engine/dashboard.html`）
- 完整真實層驗證證據：`.sdlc/features/001-remote-workflow-engine/08-validation.md`
