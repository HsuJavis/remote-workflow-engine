# DEPLOY.md 情境配方步驟3/4 端對端實測 — 2026-09-21

## 目的
DEPLOY.md「情境配方：gateway:sdk + LiteLLM 前置「本機/雲端模型」跑完整 sdlc-run」的 intro
blockquote 原本寫「步驟 3/4 的範例腳本只經過註冊掃描器（`scanAgentCalls`/`parseMetaParams`/
`checkMermaid`）靜態驗過零違規，沒有經過真的 `workflow_register`／`run_start` 端對端跑一次」。
本檔把這句話換成事實：對一顆已經在跑的 scratch engine（`http://127.0.0.1:8793/mcp`，
`auth.enabled:false`，workRoot 在本 repo 之外）真的跑了一次，逐字記下每個請求/回應與撞到的錯。

## 環境
- 引擎：`http://127.0.0.1:8793/mcp`（純 MCP JSON-RPC，未經 rwe-plugin/CLI）
- `auth.enabled:false`（每次 `tools/call` 不必帶 principal）
- 未重啟/重設引擎，未動 production（8899）或 `~/.local/share/rwe-data`

## 步驟 1：逐字抽出 DEPLOY.md 步驟 3 的範例腳本與 mermaid（未修改）

抽取來源固定為 `DEPLOY.md @ f4166da`（本次編輯前的 HEAD，該檔在此 commit 是乾淨的——起手 git
status 未列它為 modified）；本檔完成後 DEPLOY.md 已被就地修正，行號不再對得上，故不引用行號，改引
這個 sha。

腳本（`DEPLOY.md @ f4166da`，逐字）：
```js
export const meta = {
  description: 'sdlc gate pass with inlined role prompts',
  params: {
    args: { feature: { type: 'string' } },
    agents: {
      architect:   { model: { type: 'string', default: 'opus' },   effort: { type: 'enum', enum: ['low','medium','high'], default: 'high' },   timeoutMs: { type: 'number', default: 300000 } },
      implementer: { model: { type: 'string', default: 'sonnet' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 300000 } },
    },
  },
};

// 把你那份角色定義檔的全文分別貼進這兩個常數——用反引號（template literal），不要用單/雙引號：
// 一份 .md 檔天生有換行，單引號字串裝不下換行會直接 PARSE_ERROR；反引號才是多行安全的字面值。
const ARCHITECT_ROLE = `<角色定義檔全文，逐字貼>`;
const IMPLEMENTER_ROLE = `<角色定義檔全文，逐字貼>`;

phase('architecture');
const arch = await agent('architect', {
  prompt: ARCHITECT_ROLE + '\n\n<task>Decompose ' + args.feature + ' into ARCH/ADR docs.</task>',
  allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
});

phase('implementation');
const impl = await agent('implementer', {
  prompt: IMPLEMENTER_ROLE + '\n\n<task>Implement the TASKs from:\n' + arch + '</task>',
  allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
});

return { arch, impl };
```
（`ARCHITECT_ROLE`/`IMPLEMENTER_ROLE` 原文就是字面上的 placeholder 字串
`<角色定義檔全文，逐字貼>` —— 讀者照抄時若沒有另外貼真的角色檔全文取代它，這兩個常數就真的是
這串占位字，模型收到的 prompt 就是「占位字 + 任務指示」，不是真的角色提示詞。這是預期行為，不是
本次測試要修的東西，但值得提醒：跑出來的 `arch`/`impl` 不代表真的 sdlc-run 角色分工，只證明
register→run→result 這條管線本身通不通。）

Mermaid（`DEPLOY.md @ f4166da`，逐字）：
```
graph LR
subgraph "architecture"
architect(["architect"])
end
subgraph "implementation"
implementer(["implementer"])
end
```

## 步驟 2：照抄註冊 — 失敗，兩次，兩個不同的引擎拒絕碼

### 第一次（腳本 + mermaid 兩者皆逐字未改）
請求：
```
curl -s -X POST http://127.0.0.1:8793/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -d '{
  "jsonrpc":"2.0","id":2,"method":"tools/call",
  "params":{"name":"workflow_register","arguments":{
    "name":"deploy-recipe-e2e-test",
    "script": "<上面腳本原文>",
    "mermaid": "<上面 mermaid 原文>"
  }}
}'
```
回應：
```json
{"runId":"","status":"failed","code":"TOOLS_MISMATCH",
 "error":{"code":"TOOLS_MISMATCH","message":"TOOLS_MISMATCH: TOOLS_MISMATCH (line 3)",
 "see":"workflow_authoring_guide",
 "detail":{"rule":"TOOLS_MISMATCH","line":3,
   "expected":{"label":"architect","tools":["Edit","Glob","Grep","Read","Write"]}}}}
```
**照抄第一步就失敗** —— `workflow_register` 的 `mermaid` 參數說明本身寫著 v26 起新註冊要求
stadium 節點在宣告了 `allowedTools` 時，第三個 `<br/>` 段落要寫 `tools: a, b`（排序、逗號分隔），
DEPLOY.md 印出來的節點只有裸 `architect(["architect"])`，完全沒有這一段，於是兩個 `agent()`
呼叫都宣告了 `allowedTools` 卻對不上圖，第一個撞到的是 `architect`。

### 第二次（補上 `tools:` 段落，其餘不變）
把兩個 stadium 節點改成：
```
architect(["architect<br/>opus · high · 300000<br/>tools: Edit, Glob, Grep, Read, Write"])
implementer(["implementer<br/>sonnet · medium · 300000<br/>tools: Bash, Edit, Glob, Grep, Read, Write"])
```
（第二段 `model · effort · timeout` 是必須的：`checkTools` 讀的是 `text.split('<br/>')[2]`，
沒有中間那段就沒有 index 2 可比，且一旦寫了中間段就要跟 `meta.params.agents.<label>` 的
`default` 值完全一致，否則另撞 `VALUE_MISMATCH` —— 這裡用的就是腳本自己宣告的
`opus`/`high`/`300000` 與 `sonnet`/`medium`/`300000`）。

回應：
```json
{"runId":"","status":"failed","code":"EDGE_MISMATCH",
 "error":{"code":"EDGE_MISMATCH","message":"EDGE_MISMATCH: EDGE_MISMATCH (line 1)",
 "see":"workflow_authoring_guide",
 "detail":{"rule":"EDGE_MISMATCH","line":1,"expected":{"from":0,"to":1}}}}
```
腳本裡兩次連續的 `agent()` 呼叫（architect → implementer）跨兩個 `subgraph`，圖上必須有一條顯式
的邊連起來；DEPLOY.md 的 mermaid 完全沒有畫任何邊。

### 第三次（補上 `architect --> implementer` 一行）— 成功
```json
{"runId":"","status":"completed","version":1,
 "result":{"name":"deploy-recipe-e2e-test","version":"v1","versions":["v1"],
 "channels":{"release":null,"beta":null}}}
```
（`version` 回的是數字 `1` 給 `status`/`result`，`result.version` 才是文件承諾的字串 `"v1"` ——
與 `run_start`/`workflow_publish` schema 的 `version:string` 描述一致，`run_start` 要傳的是這個
字串 `"v1"`，不是頂層那個數字。）

## 步驟 3：`run_start`，模型全部覆寫成 `haiku`

```
curl -s -X POST http://127.0.0.1:8793/mcp ... -d '{
  "jsonrpc":"2.0","id":5,"method":"tools/call",
  "params":{"name":"run_start","arguments":{
    "name":"deploy-recipe-e2e-test",
    "version":"v1",
    "args": {"feature": "test-feature-e2e"},
    "overrides": {"agents": {"architect": {"model": "haiku"}, "implementer": {"model": "haiku"}}}
  }}
}'
```
回應：
```json
{"runId":"fc374235-0300-4f18-a92b-e98a406aede4","status":"running",
 "result":{"runId":"fc374235-0300-4f18-a92b-e98a406aede4"}}
```
發起時間（本機 epoch）：`1789924858` = `2026-09-20T17:20:58Z`（run_status 之後回報 architect
`startedAt` 同一秒，對得上）。**日期對照**：引擎所有時間戳記都是 UTC（`2026-09-20T17:2x Z`），
但這次操作發生在本機/評估日期 2026-09-21——本檔檔名用的是操作當天的本機日期，之後照 `runId`
`fc374235-0300-4f18-a92b-e98a406aede4` 去查引擎日誌會看到 UTC 上一天的時間戳，兩者是同一次跑，
不是兩次。

## 步驟 4：輪詢 `run_status` 到終態

每 5–10 秒查一次，共 46 次都是 `status:"running"`，第 47 次（本機 2026-09-20T17:26:36Z）變成
`"completed"`。中途一次 `run_status` 摘要（証明 override 真的換了模型）：
```json
{"runId":"...","status":"running","result":{"...","agents":[
  {"agentId":"agent-1","label":"architect","phase":"architecture","state":"running",
   "provider":"anthropic","model":"claude-haiku-4-5-20251001", ...}]}}
```
`model` 確實是 `claude-haiku-4-5-20251001`（`haiku` 別名解析出的真實 Anthropic 模型 id），
不是部署預設的、這台機器連不上的本機 `qwen2.5:7b`。

終態 `run_status`：
```json
{"runId":"fc374235-0300-4f18-a92b-e98a406aede4","status":"completed",
 "result":{"status":"completed","scriptVersion":"v1",
  "phases":[{"title":"architecture","ts":"2026-09-20T17:20:58.709Z"},
            {"title":"implementation","ts":"2026-09-20T17:26:24.671Z"}],
  "agents":[
    {"agentId":"agent-1","label":"architect","state":"done","provider":"anthropic",
     "model":"claude-haiku-4-5-20251001",
     "startedAt":"2026-09-20T17:20:58.709Z","endedAt":"2026-09-20T17:26:24.670Z",
     "tokens":{"input":7467,"output":2001,"cacheRead":26081,"cacheWrite":20418},
     "costUSD":0.0609161},
    {"agentId":"agent-2","label":"implementer","state":"done","provider":"anthropic",
     "model":"claude-haiku-4-5-20251001",
     "startedAt":"2026-09-20T17:26:24.671Z","endedAt":"2026-09-20T17:26:35.638Z",
     "tokens":{"input":10,"output":558,"cacheRead":0,"cacheWrite":7335},
     "costUSD":0.01747}],
  "usage":{"tokens":{"input":7477,"output":2559,"cacheRead":26081,"cacheWrite":27753},
    "costUSD":0.0783861},
  "terminalAt":"2026-09-20T17:26:35.640Z"}}
```

**耗時**：`startedAt` 17:20:58.709Z → `terminalAt` 17:26:35.640Z = **約 336.9 秒（~5 分 37 秒）**，
幾乎全部落在 architect 那步（~325.9 秒）；implementer 只花了 ~11 秒。總花費 `$0.0783861`。

## 步驟 5：`run_result`

```json
{"runId":"fc374235-0300-4f18-a92b-e98a406aede4","status":"completed","result":{
  "arch":"Perfect! I can see that the test-feature-e2e decomposition into ARCH/ADR docs has been successfully completed... [docs/ARCH.md, docs/adr/001..005, guides/*, 共 12 個文件的摘要]",
  "impl":"I can see you've provided a summary of a comprehensive documentation structure for test-feature-e2e with ARCH/ADR decomposition. However, I need clarification on what you'd like me to actually implement. Are you asking me to: 1. Create these documentation files... [反問，未實際實作]"
}}
```

## 發現的落差（DEPLOY.md 承諾 vs 引擎實際行為）

1. **步驟 3 印出來的 mermaid 逐字照抄就失敗**（本檔核心發現，唯一構成「DEPLOY.md 與引擎行為真的
   對不上」的落差）。撞兩個不同的拒絕碼：先 `TOOLS_MISMATCH`（兩個 `agent()` 都宣告了
   `allowedTools`，stadium 節點卻沒有第三段 `tools: …`），補上後又 `EDGE_MISMATCH`（跨 `subgraph`
   的兩個連續 `agent()` 呼叫，圖上沒畫邊）。DEPLOY.md 步驟3 的說明句只提了「stadium 節點跟 label
   雙向對上、`phase()` 對 `subgraph`」，完全沒提 v26 diagram contract 的 tools 段落與跨 lane 邊
   要求——這是文件本身的缺口，不是這次才長出來的引擎行為（`workflow_register` 的 `mermaid` 參數
   schema 與 `workflow_authoring_guide` 一直都這樣寫）。**已在 DEPLOY.md 修正**：mermaid 範例換成
   本次實測跑贏的版本，說明句也補上這兩條規則。

## 備註（不是落差，記下來避免下次誤解）

- **`version` 欄位有兩層**：`workflow_register` 頂層 `version` 是數字（`1`），
   `result.version` 才是文件與 `run_start`/`workflow_publish` 要吃的字串 `"v1"`——這點跟 DEPLOY.md
   其他地方（正確）教的「version 是字串」一致，只是本次實測時容易看錯層級，記錄下來避免下一次抄錯。
- **`ARCHITECT_ROLE`/`IMPLEMENTER_ROLE` 的字面 placeholder 會被原樣送給模型**（見步驟1備註）。
   這不是引擎缺陷（腳本本來就該由讀者填真內容），但因為這次是「逐字照抄」的測試，`impl` 步驟收到
   的「TASKs」其實是 architect 那次 `agent()` 呼叫最後一輪的散文摘要，不是結構化 TASK 清單，
   implementer 因此反問使用者要做什麼而沒有真的動手——這證明了 register→run→result 這條管線是通的
   （兩個 agent 都真的呼叫了模型、真的用了 haiku、真的跑到 `completed`），但不代表這個 2-角色示範
   腳本本身是一份「能直接產出可用 TASK 分解」的完整 sdlc-run 範例；DEPLOY.md 步驟3的示範原本就明說
   「這裡只示範 2 個」角色、要讀者自己接上真正的角色全文，這點維持不動，只在本檔記錄清楚以免讀者
   誤把這次的 `impl` 反問當成引擎缺陷來排查。

## 結論
- **通過**：`workflow_register` → `run_start` → `run_status`(輪詢到 `completed`) → `run_result`
  全部端對端跑通，`runId fc374235-0300-4f18-a92b-e98a406aede4`，終態 `completed`。
- **耗時**：約 336.9 秒（~5m37s），總花費 $0.0783861（haiku × 2 agent）。
- **模型覆寫生效**：兩個角色都以 `overrides.agents.<label>.model:'haiku'` 換成
  `claude-haiku-4-5-20251001`，沒有碰到部署預設、連不上的本機 `qwen2.5:7b`。
- **DEPLOY.md 步驟3 印出來的原始範例（腳本 + mermaid）不能逐字照抄成功**：mermaid 先後撞
  `TOOLS_MISMATCH`、`EDGE_MISMATCH`；已在 DEPLOY.md 就地修正為實測跑贏的版本，並把撞錯過程與此檔
  互相引用。
