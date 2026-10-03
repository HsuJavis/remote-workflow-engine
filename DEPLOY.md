# 部署 / 維運手冊 — remote-workflow-engine

> 人類導向文件（繁體中文）。本文件描述系統**目前**的部署方式與行為——不是變更歷程；每次迭代都會
> 整份改寫成當下事實。歷史紀錄只在 `.sdlc/` 追溯帳本內（`journal.md`、`08-validation.md`），不在
> 這份手冊裡。完整真實層驗證證據見
> `.sdlc/features/001-remote-workflow-engine/08-validation.md`。

這是一個可遠端操控的 **Claude 工作流程執行引擎**：一台常駐伺服器，透過 **MCP Streamable HTTP**
介面對外提供 **46 個工具**（`workflow_*` 7、`run_*` 8、`workspace_*` 7、`schedule_*` 4、`webhook_*` 3、
`issue_*` 5、`models_list`/`models_probe`/`system_info`、`principals_list`/`principal_set_role`/`principal_set_quota`、
`service_account_create`/`_list`/`_update`/`_rotate_secret`/`_revoke_secret`/`_delete`），並把每個 `agent()` 呼叫路由到你設定的 LLM 供應商
（Anthropic / OpenRouter / 本機 Ollama——只有這三條路，見下方 §0 附錄）。狀態全存在本機檔案
（SQLite + JSONL journal），
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
set -a; . ~/.config/rwe.env; set +a   # 供應商金鑰 / secret（沒有這個檔就跳過，見 §1b）
./deploy.sh --background
```

無法自動化的步驟（例如系統缺 `uv`）會讓腳本停下並印出明確的下一步指示，不會用猜的。冪等：已存在的
`rwe.config.json` 與 litellm venv 不會被覆蓋或重建，可重複執行。實際跑過的輸出：

```
== 步驟 1/5：安裝 Node 依賴 (npm install) ==
== 步驟 2/5：確認設定檔 (rwe.config.json) ==
已從 rwe.config.example.json 建立 rwe.config.json — 請視需要編輯 workRoot。
首次部署且未指定 RWE_WORK_ROOT：改用非 root 可寫的預設路徑 ~/.local/share/remote-workflow-engine
（如需自訂，設定環境變數 RWE_WORK_ROOT 或編輯 rwe.config.json 的 workRoot 後重跑）。
== 步驟 3/5：確認 LiteLLM Python venv (gateway:"sdk" 需要) ==
litellm 已存在於 ~/.rwe-litellm-venv/bin/litellm，略過建立。
== 步驟 4/5：啟動服務 (RWE_BIND=127.0.0.1 RWE_PORT=8787) ==
啟動中，PID=xxxxx，log 在 .rwe.rwe.config.log
== 步驟 5/5：健康檢查 (等待 /api/status 回應) ==
健康檢查通過：
{"agentSemaphore":{"total":32,"inUse":0,"queued":0},"version":"0.1.0 (...)"}
部署完成。服務位址：http://127.0.0.1:8787/mcp
背景模式：服務持續在背景執行（PID=xxxxx）。停止：kill $(cat .rwe.rwe.config.pid)
```

同一台機器要跑第二個實例（例如驗證用），用 `RWE_BIND` / `RWE_PORT` / `RWE_CONFIG_PATH` 覆蓋即可，
腳本本身不變（三個鍵的說明見 §1b）：

```bash
RWE_CONFIG_PATH=/path/to/another/rwe.config.json RWE_BIND=127.0.0.1 RWE_PORT=8792 ./deploy.sh --background
```

設了 `RWE_CONFIG_PATH`，步驟 2 就完全針對那一份檔案：檢查、（不存在時）從
`rwe.config.example.json` 建立、並在訊息裡印出它的完整路徑；repo 根目錄的 `rwe.config.json`
不會被檢查、建立或提及。路徑所在的目錄要先存在，否則腳本會在步驟 2 停下來。

**PID／log 檔名跟著 `RWE_CONFIG_PATH` 走**：`deploy.sh` 把兩者命名為
`<設定檔目錄>/.rwe.<設定檔 basename，不含 .json>.{pid,log}`——例如 `rwe.config.json` 對應
`.rwe.rwe.config.pid`／`.rwe.rwe.config.log`，`scratch.config.json` 對應
`.rwe.scratch.config.pid`／`.rwe.scratch.config.log`。兩個實例的設定檔通常就在同一目錄下（預設
`RWE_CONFIG_PATH` 就是 `$(pwd)/rwe.config.json`），basename 不同就不會互相覆蓋。停止對應實例：
`kill $(cat .rwe.<instance>.pid)`（`<instance>` 就是那份設定檔的 basename）。**加上
`--dry-run` 會直接印出這兩個路徑並結束、不裝依賴也不啟動任何東西**——需要先知道路徑時用
`RWE_CONFIG_PATH=... ./deploy.sh --dry-run`。

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
   本機檔案：SQLite + JSONL journal             Anthropic / OpenRouter
   （$workRoot/store、run 工作目錄、           / 本機 Ollama
     資產樹、每個版本的 mermaid 圖）
```
（`workflow_register` 不經過 gateway：結構圖由作者自己附上 `mermaid`，**註冊時**引擎不畫圖
（畫圖發生在第一次瀏覽 dashboard 時,見 §1a 的伺服端渲染）；
LiteLLM 只服務 `agent()` 這一個消費者。）

停止服務：`kill $(cat .rwe.<instance>.pid)`（`<instance>` 是該實例設定檔的 basename）。不加
`--background` 則前景執行、Ctrl-C 停止。

⚠️ **log 是這個部署現存唯一的稽核紀錄，且帶 PII**：`catalog.register`/`catalog.publish`/
`catalog.deregister`/`run.terminal` 事件都寫進 `.rwe.<instance>.log`（REQ-212 之後這份 log 會出現
呼叫者的 email/identity），檔案權限 0600，重啟只會 append 不會截斷。**引擎本身不做 log
rotation**——這份 log 會無界成長，想要輪替就把你自己的 `logrotate`／supervisor 指向它。

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
# 模型不必在設定檔裡設定——每個腳本自己在 meta.params.agents.<label>.model.default 宣告
# 完整的 <provider>/<model-id> ref（見§情境配方 0）

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
# 預期：tools: 38

# 主機系統資源快照（第一次呼叫 utilizationPct=null；第二次有值）
curl -s http://localhost:8787/api/system | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print('cpu cores:', d['cpu']['cores'], '/ mem usedPct:', round(d['memory']['usedPct'],1))"
# 預期：cpu cores: N / mem usedPct: X.X

# 統一模型目錄
curl -s http://localhost:8787/api/models | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print('models:', len(d), '/ first:', d[0]['provider']+'/'+d[0]['model'])"
# 預期：models: N / first: ollama/...（或 anthropic/...，依這台部署接的供應商）
```

## 情境配方：gateway:sdk + LiteLLM 前置「本機/雲端模型」跑完整 sdlc-run

> 目標：讓 `agent()` 呼叫走**完整 Claude harness**（工具迴圈 + MCP），模型可以是本機 Ollama 或雲端
> OpenRouter，能跑真正的 iso-agile-sdlc `sdlc-run`（每個 gate 換一顆角色/一顆模型）。步驟 0/1/2/5
> 都經本機端對端實測，步驟 3/4（把角色提示詞內文貼進腳本 `prompt` 參數）也一樣：下面印出來的
> 範例腳本與 mermaid 是照著抄就能通過 `workflow_register`、`run_start` 跑到 `completed` 的版本。
> 兩個角色請用 `run_start` 的 `overrides:{agents:{architect:{model:'ollama/<模型tag>'},implementer:{model:'ollama/<模型tag>'}}}`
> 指定模型（2026-09-26 起沒有別名層，一律寫完整 `<provider>/<model-id>` ref）——沒跑 Ollama
> 的機器上，若腳本或 override 指到的是 `ollama/...` 這樣的 ref，那次 run 會整輪逾時（見步驟 0
> 「模型能力提醒」）。
>
> **改這張圖的時候有兩條規則會咬人**：stadium 節點只要對應的 `agent()` 宣告了 `allowedTools`，
> 節點就必須帶第三段 `tools: …`（否則 `TOOLS_MISMATCH`）；分屬不同 `subgraph` 的兩個 agent 之間
> 必須有一條顯式的邊（否則 `EDGE_MISMATCH`）。完整規則見 `workflow_authoring_guide`。
>
> **伺服器端沒有可設定的系統提示詞層**：傳 `agentType` 給 `agent()` 在**註冊時**被
> `SCAN_VIOLATION`（detail 帶 `violation:'AGENT_OPT_RETIRED'`）拒絕、在**dispatch 時**被
> `PARAM_UNKNOWN`（同樣帶 `violation:'AGENT_OPT_RETIRED'`）拒絕；`agentDefinitionsDir` 寫在
> `rwe.config.json` 裡仍會被接受，但開機只印一行點名的警告、完全不生效。
>
> 要讓不同 gate 帶不同的角色提示詞，把那段文字寫進**腳本自己那次 `agent()` 呼叫的
> `prompt` 參數最前面**——見 `workflow_authoring_guide` 的「Prompt layering」一節，第3步有完整示範。
>
> ⚠️ **角色提示詞不是伺服器端的秘密，這是必須知道的事實，不是可以忽略的細節**：`agent()` 送給模型
> 的字串是「原樣」記錄的——`run_agent_log` 回的 `harness.prompt` 就是「送給模型的逐字字串：腳本自己
> 的 prompt，接著任何 appendPrompt override」，沒有另一段欄位替你藏起來。也就是說：**角色提示詞會
> 跟著這個腳本每一個註冊版本一起，被任何讀得到這次 run 的 agent log 的人看到**（同一 principal，
> 或有 cross-read 權限的 admin）。不要把你不想曝光的內容寫進角色提示詞。（單一例外：非常長的
> 提示詞，持久化的 `harness.prompt` 會截到 4KB，頭 2048 字元 + 尾 2048 字元，中段省略；但實際送給
> 模型的呼叫本身不受這個截斷影響，只有記錄下來給你事後看的那份被截。）
>
> ### 0) 模型從哪裡來：本機用 Ollama，雲端用 OpenRouter
> `provider` 只認 `anthropic`、`openrouter`、`ollama` 三種；腳本 `meta.params.agents.<label>.model`
> 的 `.default`／`.enum` 只要出現第四種、或不是完整 `<provider>/<model-id>` 形狀的裸名稱，
> `workflow_register` **當場拒絕註冊**（`UNKNOWN_MODEL`，見 §5「開機被拒」旁的註冊期拒絕）。要接
> 自己的模型，兩條路都是一等公民：
> - **本機／自架模型 → Ollama**：把模型放在一個 Ollama（或 Ollama API 相容）伺服器後面，
>   腳本寫 `model.default:"ollama/<模型tag>"` + `OLLAMA_BASE_URL` 指過去（見下方§1、§2）。
> - **雲端模型 → OpenRouter**：腳本寫 `model.default:"openrouter/<id>"` + `OPENROUTER_API_KEY`，
>   單一 key 開放整個 OpenRouter 目錄（`models_list` 可查）。
>
> ### 1) 設定檔（`rwe.config.json`）
> ```json
> {
>   "bind": "127.0.0.1", "port": 8787,
>   "workRoot": "/var/lib/remote-workflow-engine",   ⟵ 必須在任何 .git/CLAUDE.md 祖先之外（見 §1b workRoot 行）
>   "timeoutMs": 300000, "gateway": "sdk",
>   "defaultAllowedTools": ["Read","Write","Edit","Glob","Grep","Bash"]
> }
> ```
> **2026-09-26 起沒有 `aliases` 設定鍵**——每個模型直接用它自己唯一的 `<provider>/<model-id>` 全稱
> 位址，寫在腳本自己的 `meta.params.agents.<label>.model.default`／`.enum` 裡（不是設定檔）；
> `model` 就是**你 Ollama `/api/tags` 或 OpenRouter `/api/v1/models` 看到的那些 id**，前面加上
> `ollama/` 或 `openrouter/` 前綴。`models_list` 會列出這台部署能連到的每個模型，`ref` 欄就是可以
> 直接複製貼上的完整字串。
> **模型能力提醒**：需要「決策 + 工具呼叫」的任務**別用太小的模型**（7B 級的原生 tool-use 不穩）；
> 這類任務請挑你環境裡最能穩定做 native tool-use 的那顆（實測 OpenRouter 上的旗艦模型可、本機
> qwen2.5:7b 不行）。
>
> ### 2) 憑證環境變數
> ```bash
> export OLLAMA_BASE_URL="http://<你的 Ollama 伺服器host>:11434"   # ← 讓所有 ollama/... 的 model ref 導向它（本機用預設值可省略）
> export OPENROUTER_API_KEY="<你的 OpenRouter key，sk-or-...>"       # ← 用到 openrouter/... 的 model ref 才需要
> ```
> LiteLLM 子行程以 `{...process.env}` 繼承這兩個變數。
> ⚠️ **key 檔格式坑**：若你的 key 存成 `OPENROUTER_API_KEY=sk-...` 這種**整行**檔，別直接
> `$(cat 檔)`（會把 `OPENROUTER_API_KEY=` 也當成 key 值 → 401）。要萃取值：
> `export OPENROUTER_API_KEY="$(grep -oE 'sk-or-[A-Za-z0-9_-]+' 你的keyfile | head -1)"`。
> ⚠️ **PATH**：`gateway:sdk` 開機會 `spawn('litellm')`，systemd/啟動 unit 的 `PATH` 必須含 litellm
> venv 的 `bin/`（見 §1a 前置條件），否則 `ENOENT`。
>
> ### 3) 幫每個 sdlc gate 帶上它自己的角色提示詞
> 要讓 `sdlc-run` 的不同 gate 用不同角色，把該角色的完整提示詞內文（來源看你裝的是哪個版本的
> iso-agile-sdlc plugin：可能是 `agents/sdlc-<role>.md`，也可能是別的檔名/角色切法——**不要把任何
> 特定檔名寫死當事實**，用你自己那份裝好的 plugin 現有的檔案為準），**貼進腳本裡「那個 gate 對應的
> 那次 `agent()` 呼叫」的 `prompt` 參數最前面**，接上這次真正要做的任務指示。每個角色是一個獨立的
> `meta.params.agents.<label>` 宣告（各自的 `model`/`effort`/`timeoutMs` 對應第1步準備好的完整
> model ref），角色文字是腳本裡的一段字面字串，不是伺服器端檔案查找鍵。示意（完整幾個角色同理，
> 這裡只示範 2 個；下面印的 `ollama/qwen2.5:7b`／`ollama/qwen2.5vl:7b` 是本機一個典型 Ollama
> 安裝會有的兩個 tag，照抄就能通過註冊——想改用 OpenRouter 雲端模型，換成你自己帳號下
> 真正的 `openrouter/<id>`（`models_list({provider:"openrouter"})` 查得到的那個，不是隨手編的
> 名字，未上市的 id 會被 `UNKNOWN_MODEL` 拒絕）：
> ```js
> export const meta = {
>   description: 'sdlc gate pass with inlined role prompts',
>   phases: [{ title: 'architecture' }, { title: 'implementation' }],
>   params: {
>     args: { feature: { type: 'string' } },
>     agents: {
>       architect:   { model: { type: 'string', default: 'ollama/qwen2.5:7b' },   effort: { type: 'enum', enum: ['low','medium','high'], default: 'high' },   timeoutMs: { type: 'number', default: 300000 } },
>       implementer: { model: { type: 'string', default: 'ollama/qwen2.5vl:7b' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 300000 } },
>     },
>   },
> };
>
> // 把你那份角色定義檔的全文分別貼進這兩個常數——用反引號（template literal），不要用單/雙引號：
> // 一份 .md 檔天生有換行，單引號字串裝不下換行會直接 PARSE_ERROR；反引號才是多行安全的字面值。
> const ARCHITECT_ROLE = `<角色定義檔全文，逐字貼>`;
> const IMPLEMENTER_ROLE = `<角色定義檔全文，逐字貼>`;
>
> phase('architecture');
> const arch = await agent('architect', {
>   prompt: ARCHITECT_ROLE + '\n\n<task>Decompose ' + args.feature + ' into ARCH/ADR docs.</task>',
>   allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
> });
>
> phase('implementation');
> const impl = await agent('implementer', {
>   prompt: IMPLEMENTER_ROLE + '\n\n<task>Implement the TASKs from:\n' + arch + '</task>',
>   allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
> });
>
> return { arch, impl };
> ```
> 對應的 mermaid（`workflow_register` 要求 stadium 節點跟 `agent()` label 雙向對上、每個 `phase()`
> 對一個 `subgraph`，見 `docs/AUTHORING.md`）——**實測跑贏的版本**，比裸的 `label` 節點多兩件事：
> 每個 stadium 節點帶上 `<br/>model · effort · timeout<br/>tools: …`（因為兩個 `agent()` 呼叫都宣告
> 了 `allowedTools`，第三段 `tools:` 是必填，缺了就是 `EDGE_MISMATCH` 之前先撞的
> `TOOLS_MISMATCH`；值照抄 `meta.params.agents.<label>` 的 `default`，`tools:` 後面照抄該次呼叫的
> `allowedTools`，逗號分隔、按字母排序），以及兩個 `subgraph` 之間一條顯式的
> `architect --> implementer` 邊（跨 lane 的兩個連續 `agent()` 呼叫，圖上不畫邊就是
> `EDGE_MISMATCH`）：
> ```
> graph LR
> subgraph "architecture"
> architect(["architect<br/>ollama/qwen2.5:7b · high · 300000<br/>tools: Edit, Glob, Grep, Read, Write"])
> end
> subgraph "implementation"
> implementer(["implementer<br/>ollama/qwen2.5vl:7b · medium · 300000<br/>tools: Bash, Edit, Glob, Grep, Read, Write"])
> end
> architect --> implementer
> ```
> `prompt` 的值不必是單一字串字面值——如上例用 `+` 串接常數與 `args`/前一步結果都是合法寫法（`agent()`
> 的限制只在於**呼叫本身的 options 物件**要寫成字面量 `{ … }`，不能是變數或 spread；物件裡每個鍵的
> 值可以是任何表達式）。`allowedTools` 才是唯一在註冊時會被解析成字面陣列的鍵。
>
> ⚠️ **貼進去的角色全文本身不能撞到掃描器的關鍵字——這是實測撞到過的真坑，不是假設**：
> `workflow_register` 的掃描器（`scanAgentCalls`）是對**整份腳本原始碼**跑正則
> `/(?<!\.)\bagent\s*\(/g`，不分辨這段文字是不是在字串字面值裡面；同一份腳本裡另外幾個關鍵字
> （`phase(`、`workflow(`、`parallel(`）跟 `Date.now()`/`Math.random()`/`new Date()`（沒帶參數的）
> 也是同樣對原始碼逐字掃描。實測：把 iso-agile-sdlc plugin 舊版（1.25.0）`sdlc-verifier.md` 正文裡
> 本來就有的一句「...sdlc-verifier agent (mode A)...」貼進 `ARCHITECT_ROLE` 常數（哪怕正確包在合法
> 字串字面值裡），`scanAgentCalls` 就會在那一行多抓出一次不完整的 `agent(` 呼叫，整個腳本被
> `AGENT_LABEL_REQUIRED` 拒絕註冊——即使腳本語法完全正確。貼之前先對你要貼的那份角色全文跑一次
> `grep -nE '\bagent\s*\(|\bphase\s*\(|\bworkflow\s*\(|\bparallel\s*\(|Date\.now\(\)|Math\.random\(\)|new Date\(\)'`，
> 撞到的詞改寫掉（例如把「agent (mode A)」改成「agent role (mode A)」或拿掉那個空格）再貼。
>
> ### 4) 實際跑起來（透過 rwe-plugin 或直接 `run_start`）
> `run_start` 的 input schema 沒有 `agentPrefix` 這個鍵（見 `src/tool-specs.ts`）；新腳本不需要、
> 也不該宣告 `meta.params.args.agentPrefix`。跑法就是一般的 `workflow_register` → `workflow_publish`
> → `run_start({name, version 或省略吃 release, args, budget, seed/seedManifest})`：
> ```json
> { "feature":"NNN-slug", "sdlcDir":".sdlc/features/NNN-slug", "skillDir":"_skillref",
>   "mode":"new", "safetyClass":"QM", "tier":"lean" }
> ```
> （這是 iso-agile-sdlc plugin 那支**完整 sdlc-run 腳本**會用的 `args` 形狀，不是第3步那個
> 2-角色示範腳本的——示範腳本只宣告了 `args.feature` 一個鍵。`args` 的實際鍵一律由你註冊的那支
> 腳本自己的 `meta.params.args` 決定，這裡兩個例子分屬不同腳本，不要混著抄。）
> - **seed**：把 skill 目錄（放 `_skillref/`，**不要**放 `.claude/skills/` 以免被 CLI 當 project skill 載入）
>   + `.sdlc/features/NNN/{01-requirements.md,state.yaml}` + `.sdlc/trace(.py)` 一起用 `run_start` 的
>   `seed:[{path,contentB64}]` 帶上（Gate 1 需求要先在本地備好，state.yaml 的 `gates.requirements.passed=true`）。
> - **git baseline 自動**：引擎會在 seed 落地後自動 `git init`+baseline commit（REQ-027），precheck 的
>   `git rev-parse --is-inside-work-tree` 會通過——**你不用手動 seed `.git`**（materializeSeed 本來就會擋）。
> - **沒有 model shorthand 這回事**：2026-09-26 起模型一律是完整 `<provider>/<model-id>` ref（不是
>   `haiku`/`sonnet`/`opus` 這種裸名稱），CLI 沒有東西可以「展開」——一個裸名稱在**註冊當下**就被
>   `UNKNOWN_MODEL` 拒絕，不會留到 dispatch 階段才發現。
> - **budget**：sdlc 全流程**吃 input token 很兇**（每個 agent 重讀 seed/docs，實作階段還會裝 venv 撐大
>   context）。`budget` 是物件（裸數字回 `INVALID_ARGUMENT`）：設 `budget:{tokens:<數量>}` 當硬上限；
>   實測一次 lean 全流程到 Gate 6 約 ~3M token。**撞上限這件事本身沒有「調高後原地續跑」這個按鈕**——
>   引擎的 budget 是「拒絕再派工」訊號：那次 `agent()` 呼叫被拒 `BUDGET_EXCEEDED`，腳本沒接住的話整個
>   run 就以這個代碼結束（`run_status.agents` 裡那次呼叫會是 `state:'refused'`,
>   `reasonCode:'BUDGET_EXCEEDED'`）。要接著做，是拿已完成 phase 的產物（`run_result`/已落地的
>   workspace 檔案）當下一次 `run_start` 的 `seed`，用更高的 `budget.tokens` 開一個新 run 續做剩下的
>   gate——不是同一個 run 續命（`run_resume({runId})` 只用在 `run_suspend` 過的 run，跟 budget 用盡
>   無關）。
> - **拉回產物**：完成後用 plugin 的 `pull_workspace`（引擎側是 `workspace_list` 遞迴列檔 +
>   `workspace_pull` 分塊取回）把
>   `src/`、`tests/`、`.sdlc/*.md` 拉回本地；`.git/` 與 venv 不會列進 artifact（引擎已排除 `.git/`）。
>
> ### 5) 驗證這條路通了（花錢前先確認）
> ```bash
> # A. 我方 LiteLLM 真的把 ollama/<model>（或 openrouter/<model>）導到你的端點：
> LPORT=$(pgrep -af '[l]itellm --config' | grep -oE 'port [0-9]+' | awk '{print $2}')
> curl -s -X POST http://127.0.0.1:$LPORT/v1/messages -H 'content-type: application/json' \
>   -H 'x-api-key: dummy' -H 'anthropic-version: 2023-06-01' \
>   -d '{"model":"ollama/qwen2.5:7b","max_tokens":10,"messages":[{"role":"user","content":"ping"}]}'
> #   → 回 anthropic 格式 message + usage>0 ⇒ 端點通；回 401/No deployments ⇒ 檢查 OLLAMA_BASE_URL / OPENROUTER_API_KEY。
> # B. 一個極小 agent 端對端：先 workflow_register（腳本 `phase('probe'); return await agent('probe',{prompt:'say ROUTED'})`
> #    ＋ 契約 meta.params.agents.probe ＋ meta.phases:[{title:'probe'}] ＋ mermaid `graph LR\nsubgraph "probe"\nprobe(["probe"])\nend`）
> #    → workflow_publish → run_start
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
- **`bubblewrap`（`bwrap`）與 `socat`**：真正的 Claude CLI sandbox 硬性需要這兩個執行檔，缺一個
  Bash 圍籠就直接量成 `unconfined`（見 §1c(e)，遠端送出的 run 會被拒絕）——`sudo apt install
  bubblewrap socat` 裝好即可；**Ubuntu/AppArmor 主機另有一個常見的巢狀 namespace 限制**會讓兩者
  都裝了、探測仍失敗，完整原因/取捨/復原步驟見 §1c(e)，這裡不重複。
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
- **（選用）dashboard 的流程圖渲染 —— headless Chrome**：dashboard 的工作流詳情頁顯示的是
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
  - **版本必須與 `node_modules/puppeteer` 對得上。** 快取裡若有版本不符的 Chrome（例如另一次安裝留下的
    `linux-150.x`）而 puppeteer 要 `152.x` 時，錯誤是 `Could not find chrome (ver. 152...)`；
    上面兩條 `install` 指令會自動抓當前 puppeteer 要的版本，不要手動挑版本號。
  - **驗證方式（照這個順序，不要跳）**：
    ```bash
    # 1) 兩個二進位檔都在
    ls -d ~/.cache/puppeteer/chrome/*/ ~/.cache/puppeteer/chrome-headless-shell/*/

    # 2) 直接渲一張，看得到真正的錯誤（服務 log 會截斷）
    T=$(mktemp -d); cd "$T"
    printf 'graph LR\na(["x"])\n' > in.mmd
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
  - **磁碟需求:實測 651MB,不是 150MB。** puppeteer 25.x 會抓**兩個**瀏覽器
    (`chrome` 與 `chrome-headless-shell`,同版本),乾淨快取實測解壓後共 **651MB**。
    小磁碟的 VPS 要先確認空間,這是「能不能跑」的差別。
  - **最小化伺服器／精簡容器要先裝共享函式庫。** `chrome-headless-shell` 依賴 **46 個**共享物件,
    含 `libnss3`、`libatk-bridge-2.0`、`libgbm`、`libasound2`、`libxkbcommon`、`libdrm`、`libcups`。
    桌面版發行版通常都有;精簡映像檔沒有,Chrome 會直接死掉而你只會看到不透明的 `RENDER_FAILED`。
    先查:`ldd ~/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell | grep 'not found'`
    ——**沒有輸出才算過**。
  - **這條路由的完整介面**(§1b 沒有它的列,補在這裡):
    | | |
    |---|---|
    | `GET /api/workflows/<name>/diagram.svg` | 預設版本(release) |
    | `?version=v2` | 指定版本 |
    | `200` | `image/svg+xml`,回應含 `X-Diagram-Cache: hit｜miss`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:` |
    | `404` | 該名稱／版本沒有圖(`LEGACY_NO_DIAGRAM`)或工作流不存在 |
    | `503` | `{"code":"DIAGRAM_RENDER_UNAVAILABLE","reason":"RENDER_FAILED｜RENDERER_MISSING"}` — 渲染器不可用,dashboard 會自動退回顯示原始碼 |
    **快取是行程內的**:重啟引擎後同一個 `(name, version)` 會再 `miss` 一次。
  - **不裝也可以**：`@mermaid-js/mermaid-cli` 與 `puppeteer` 在 `optionalDependencies`，
    沒有它們引擎照常啟動與運作，dashboard 只是退回顯示 Mermaid 原始碼（`RENDERER_MISSING`）。
    容器／離線／低磁碟環境可以刻意不裝。
  - 渲染是**第一次瀏覽時才做並快取**（快取鍵 `(name, version)`），單次渲染硬逾時 20s、
    全引擎同時最多 2 個渲染子行程；超過上限的請求直接降級回原始碼，不排隊。
    `auth.enabled:false` 時這條路由**不需要認證**，所以這三道限制是它的防護，不是最佳化
    （`auth.enabled:true` 時它跟其他 `/api/*` 一樣要登入，見 §1b「Dashboard 登入」）。
- 外部依賴：不需要資料庫伺服器（狀態存在本機檔案：SQLite + JSONL journal，路徑見 `workRoot`）。
- LLM 供應商（依你腳本裡的 model ref 用到哪個 provider 擇一或多個）：對應的環境變數（`ANTHROPIC_API_KEY`／
  `OLLAMA_BASE_URL`／`OPENROUTER_API_KEY`／`CLAUDE_CODE_OAUTH_TOKEN`）
  每一個都只在 §1b 設定總表列出一次，請直接查表。

  **未設定的供應商不會擋住啟動** —— 指到該 provider 的 `agent()` 呼叫只會在真正被呼叫時，走 D-G 電路斷路器
  邏輯解析成 `null`（run 繼續跑，不會掛住），真實不可達端點與缺金鑰兩種情境都是這個行為
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
| `rwe.config.json` → `gateway` | `"sdk"`（預設，真正的 `@anthropic-ai/claude-agent-sdk` headless session，有工具迴圈）、`"direct-fetch"`（回退到直接對各供應商 `fetch()`，或搭配 `useLiteLLMProxy:true` 走 LiteLLM 代理；本來就不具備工具迴圈能力，適合純本機/內網不需要工具迴圈的部署），或 `"pi"`（pi harness，v1 起新增——見下方「§1b2 pi harness（替代 gateway）」一節；**production 仍停在 `"sdk"`**） | `"sdk"｜"direct-fetch"｜"pi"` / `"sdk"` | 否 | v1 / pi-v1 |
| `rwe.config.json` → `useLiteLLMProxy` | `direct-fetch` 路徑是否額外走 LiteLLM 代理（`false` 時 ollama 走原生直連 `localhost:11434`，完全不碰 LiteLLM，免依賴部署常用） | `boolean` / `true` | 否 | v1 |
| `rwe.config.json` → `defaultAllowedTools` | `gateway:"sdk"` 路徑下，`agent()` 呼叫沒帶 `opts.allowedTools` 時套用的預設工具清單；只有兩層優先序：呼叫端 `opts.allowedTools` > 此鍵（省略此鍵才落到內建預設） | `string[]` / `["Read","Write","Edit","Glob","Grep","Bash"]` | 否 | v34 |
| `rwe.config.json` → `allowedHosts` | `bind:"0.0.0.0"` 時額外允許的 Host/Origin authority（LAN IP、代理主機名）清單，供 Host/Origin 白名單（§6）核對 | `string[]` / `[]` | 否（`0.0.0.0` bind 時建議設定） | v11 |
| `rwe.config.json` → `anthropicBaseUrl` | `anthropic` provider 直連（LiteLLM-bypassed）路徑打的真實 Anthropic API base | `string` / `'https://api.anthropic.com'` | 否 | v7 |
| `rwe.config.json` → `anthropicAuth` | Anthropic 直連認證模式：`"api-key"`（真實 `ANTHROPIC_API_KEY`）或 `"subscription"`（`claude setup-token` 產生的 `CLAUDE_CODE_OAUTH_TOKEN`）；認證素材本身一律來自 secret store／環境變數，絕不放進此檔 | `"api-key"｜"subscription"` / 依偵測到的 secret 自動判斷 | 否 | v7 |
| `rwe.config.json` → `litellmPort` | LiteLLM 代理子行程監聽 port | `number` / 省略則綁 OS 分配的 ephemeral 空閒 port | 否 | v1 |
| `rwe.config.json` → `schedulerDbPath` | 排程 SQLite 檔路徑 | `string` / `$workRoot/schedules.db` | 否 | v1 |
| `rwe.config.json` → `assetRoot` | `workspace_push` 的**工作流程範圍**資產樹根目錄，實際版面是 `<assetRoot>/<workflow>/<kind>/<name>`（`kind` 是 `skill`／`mcp`）。管理員推的全域資產不放這裡，固定在 `<workRoot>/_global_assets/<kind>/<name>`（刻意在被 GC 掃描的 `assets/` 樹之外） | `string` / `$workRoot/assets` | 否 | v24 |
| `rwe.config.json` → `maxWorkflowDepth` | 具名 `workflow()` 巢狀組合單一分支深度上限（頂層 run=0）；超過回可分支的 `NESTING_DEPTH_EXCEEDED`（不崩父 run）；≤0 或非整數在啟動時拒絕 | `number` / `4` | 否 | v8 |
| `rwe.config.json` → `maxWorkflowDescendants` | 巢狀 `workflow()` 呼叫總數上限（整棵 fan-out × depth 樹）；超過回 `DESCENDANT_CAP_EXCEEDED` | `number` / `256` | 否 | v8 |
| `rwe.config.json` → `maxWorkflowVersions` | 同一工作流程名稱累積保留的版本數上限；達上限時 `workflow_register` 回 `VERSION_CEILING_EXCEEDED`（需先 `workflow_deregister` 舊版本或調高此值） | `number` / 省略 = 不設上限 | 否 | v22 |
| `rwe.config.json` → `principals` | 角色對照表：鍵是 principal id（OAuth 下的使用者 email，或 `"*"` 代表所有已驗證但未列名者），值是 `{role:"admin"｜"author"｜"user"｜"none"}`；角色字串打錯（例如 `"admn"`）**開機直接拒絕啟動**（ADR-028 fail-closed）；未列名（也沒有 `"*"`）的已驗證呼叫者是 `"none"`＝**待核准**，每個工具與 dashboard 資料都回 `ACCOUNT_PENDING_APPROVAL`，直到 admin 授予角色（2026-09-30 起；之前是 `"user"`）；開機那行 `auth:` log 的 `defaultRole=` 會如實顯示 | `object` / 省略 | 否 | v24 |
| `rwe.config.json` → `proxyManager` / `issueReporter` / `mcpProbe` / `modelCatalog` / `modelCatalogFetchers` / `systemInfo` | **程式注入用的替身接點，JSON 設定檔設不了**（值是函式/物件）。列在這裡只是為了說明：把它們寫進 `rwe.config.json` 不會被當成「不認得的鍵」警告，但也不會有任何效果 | 物件/函式 / — | 否 | v26 |
| `rwe.config.json` → `mcpEgressAllowlist` | `workspace_push({kind:"mcp"})` 註冊 `http` transport 時的 https-only 白名單（URL 前綴比對，同 `seedRefAllowlist` 的 fail-closed 慣例）；省略/空陣列＝任何 `http` MCP 設定一律 `EGRESS_DENIED`（探測前就擋，探測次數為零）。2026-09-30 業主裁決：這份生效清單經 `system_info` 回應的 `policy.mcpEgressAllowlist` 對外可見（任何已驗證呼叫者，同一份值，不重讀設定） | `string[]` / `[]` | 否 | v24 |
| `rwe.config.json` → `sandbox.allowHostPaths` | 營運者授予的共用主機路徑清單——agent 的 Bash 除了自己的 run workspace，還可以讀寫這些路徑（REQ-218）。每一筆在開機時驗證：必須是絕對路徑（不展開 `~`）、必須存在於磁碟上（**開機前要先 `mkdir`**，否則以 `UNRESOLVABLE` 拒絕啟動）、不可在 `workRoot` 內也不可包住 `workRoot`、不可等於或包住 `rwe.config.json`/`auth-tokens.db`、不可等於或包住引擎的家目錄（issue #101，否則等於把整個家目錄的讀取封鎖還回去）、不可含萬用字元；任何一筆不合規就**整個拒絕開機**，訊息逐筆列出。省略 = `[]`，最嚴格姿態。**此鍵只申報授權清單，不決定 Bash 是否真的受限——那是量測出來的**（見下一列） | `string[]` / `[]` | 是 | v37 |
| `rwe.config.json` → `sandbox.allowReadPaths` | issue #101：agent Bash 的讀取是**預設拒絕**（整個家目錄 + 整個 `workRoot`，見 §1c (f)），這個清單是營運者額外**唯讀**重新開放的路徑——給裝在家目錄底下、引擎自動推導沒涵蓋到的工具鏈用（例如 `~/.cargo/bin` 加 `~/.rustup`）。引擎自己 `PATH` 上位於家目錄內的目錄、以及它自己 node 的安裝前綴（`~/.local/node` 這種 `<prefix>/bin/node`）**會自動重新開放，不用列**。驗證規則與 `sandbox.allowHostPaths` 相同（絕對路徑、開機時必須存在、不在也不包住 `workRoot`、不等於也不包住受保護檔案或家目錄本身、無萬用字元），任一筆不合規**整個拒絕開機**；設了這個鍵就必須明確設定 `workRoot`。永遠不可寫。省略 = `[]` | `string[]` / `[]` | 否 | #101 |
| （量測值，非設定鍵）Bash 圍籠姿態 | 開機時先確認 `bwrap`（bubblewrap）與 `socat` 都在 PATH 上（真正的 Claude CLI sandbox 硬性需要兩者，缺一個直接判 `unconfined`，`reason` 指名缺哪個；`sudo apt install bubblewrap socat` 補齊即可），兩者都在才對主機跑一次巢狀 `bwrap --unshare-user` 探測（REQ-218，ADR-083 業主裁決 posture C）：探測通過 → `confined`，這台部署上每個 agent() 呼叫都真的請求 OS 沙箱；探測失敗（常見於 AppArmor `bwrap-userns-restrict` 政策擋住巢狀 namespace——修法見下方「探測失敗時怎麼修」）→ `unconfined`，**本機（loopback）送出、且跑的是本機註冊版本的 run 仍會照跑、不受任何 Bash 圍籠**，但**遠端送出的 `run_start`/`run_resume`——在 ajv 參數驗證、authz、以及工作流程/版本是否存在都先過了之後才被拒絕**（issue #93：這道拒絕以前排在最前面，連參數錯誤或工作流程不存在都先回 `CONFINEMENT_UNAVAILABLE`，2026-09-26 已改成排在最後，讓遠端呼叫端至少能看到自己請求本身的錯誤），而且**不論從哪裡送出，只要這次要跑的版本是遠端註冊的、或觸發器是遠端建立的，同樣被拒**（`CONFINEMENT_UNAVAILABLE`，判定式見 §6）。姿態印在開機那行 log 與每次 `agent.confinement` 事件的 `posture` 欄位，無法用設定檔調高或調低——這是量測，不是宣告。**探測失敗時怎麼修（Ubuntu/AppArmor 主機）**：多半是 `bwrap-userns-restrict` AppArmor 設定檔擋住第二層（巢狀）unprivileged user namespace——設定 `kernel.apparmor_restrict_unprivileged_userns=0`（寫進 `/etc/sysctl.d/60-rwe-userns.conf` 再 `sysctl --system`）**並且**停用該設定檔（`ln -s /etc/apparmor.d/bwrap-userns-restrict /etc/apparmor.d/disable/ && apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict`），然後重開引擎；這是**整台主機**層級的放寬（任何非特權行程之後都能建立巢狀 user namespace），只在這台主機上每個會用到本引擎的人都已經是作業系統層信任對象時才這樣做——不是共用/多租戶主機。要復原：移除該 sysctl 覆寫，並重新啟用設定檔（刪掉 `disable/` 下的符號連結，再跑一次 `apparmor_parser`） | — | — | v37 / issue #93 |
| `rwe.config.json` → `seedRefAllowlist` | engine-pull `seedRef:{repoUrl,sha}` 的 egress 白名單（`https://` URL 前綴）；**fail-closed**：省略/空陣列 = 任何 seedRef 回 `SEEDREF_DISABLED`；不命中前綴（含 `169.254.169.254`/`localhost`/私有 IP/`file://`）→ `SEEDREF_EGRESS_DENIED`（SSRF 安全） | `string[]` / `[]` | 否 | v13 |
| `rwe.config.json` → `maxBlobBytes` | `POST /assets/blob/:sha`（streaming raw-body 上傳）最大 body bytes；超過 → HTTP 413 `BLOB_TOO_LARGE` | `number` / `268435456`（256 MiB，最小 1048576） | 否 | v10 |
| `rwe.config.json` → `casQuota` | 每個角色可上傳到 CAS 的總量上限（2026-10-02 業主裁決）：`{user, author, admin}`，每個值可以是 bytes 整數、`"5GiB"`/`"500MB"` 這種字串（KiB/MiB/GiB/TiB 二進位、KB/MB/GB/TB 十進位）或 `"unlimited"`/`null`；只寫一部分其餘用預設；格式錯誤（不認得的角色、看不懂的大小）**開機直接拒絕**。用量＝該帳號 namespace 內每個 blob 的大小總和（與其他帳號共用的 blob 對每個帳號都全額計算）；`POST /assets/blob`、`POST /assets/manifest`、`workspace_push` blob 模式、engine 代抓的 `seedRef` 都計入，超過時在**寫入之前**拒絕：HTTP 507 / `QUOTA_EXCEEDED {usedBytes, limitBytes, requestedBytes, hint}`（先看 Content-Length，串流中途再擋謊報大小的客戶端，並發上傳不會合計超額）。個別帳號可由 admin 用 `principal_set_quota` 或 dashboard 管理頁覆寫（存在 `auth-tokens.db`，即時生效、有稽核紀錄）；待核准（`none`）帳號一律 0；auth 停用或 loopback 救援路徑的 `local` namespace 不設上限。用量可在 `principals_list`、`workspace_diff`、`GET /api/me` 看到；清理用 `workspace_prune_blobs`（預設 dry-run；只刪沒有任何已註冊版本 `seedManifestRef` 需要、且 `olderThanDays`（預設 30）天內沒用過的 blob；檔案只在沒有任何 namespace 還參照時才真的從磁碟刪除） | `object` / `{user:"1GiB", author:"5GiB", admin:"unlimited"}` | 否 | 2026-10-02 |
| `rwe.config.json` → `diskFloor` | 磁碟水位下限（2026-10-02 業主裁決）：`workRoot`（以及另設的 `casDir`）所在檔案系統的可用空間低於 `max(percent% × 檔案系統大小, bytes)` 時，**所有上傳**與**所有新 run 的准入**（`run_start`、`run_resume`、排程/webhook 觸發、巢狀 `workflow()`）一律拒絕 `DISK_LOW {freeBytes, floorBytes}`——是暫時性的（上傳回 HTTP 503；webhook 回 503 並釋放 delivery id，可用同一個 id 重送；排程把 `DISK_LOW` 記進 `lastError`——但若該排程是 `kind:'once'`，這次失敗的觸發就**永久消耗掉它**（`enabled:false`，業主裁決 2026-10-02：`once` 不補跑；要重試就 `schedule_create` 一個新的），`schedule_list` 的 `lastError.message`／`lastRefusalMessage` 對這種已消耗的 `once` 列會額外附一句講明這點，**不會**只留目錄裡那句泛用的「retry later」——那句話對一個已經不會再觸發的列是誤導；`cron` 列的訊息不變）；已在跑的 run 不受影響。巢狀 `workflow()` 被 `DISK_LOW` 拒絕時**不會**計入該 run 的 `maxWorkflowDescendants` 名額（2026-10-02 修正：之前會計入，讓低磁碟期間重試的呼叫白白燒掉名額）。`{percent, bytes}`：`percent` 0..100、`bytes` 可用大小字串；兩者都設 0 = 停用；格式錯誤開機拒絕。`statfs` 結果快取 5 秒；**若設定的每一個路徑（`workRoot`／`casDir`）當下 `statfs` 全部失敗**（例如該磁區未掛載），為了可用性採**失效開放**（視同沒有超過水位，不擋任何上傳/准入）而非失效關閉，只在第一次發生時記一行 `disk_floor_fail_open` 警告（不會每次 `status()` 重複印）——這是刻意的可用性/安全取捨，不是臨時缺陷 | `object` / `{percent:5, bytes:"5GiB"}` | 否 | 2026-10-02 |
| `rwe.config.json` → `runConcurrency` | **單一 run 內同時在飛的 `agent()` 上限** —— 一個 `parallel()` 實際跑多寬。達上限的呼叫在 `acquireSlot()` **排隊**（不拒絕、不丟棄），所以更寬的 fan-out 只是比較慢。另有一層跨所有 run 的主機層上限（agent 號誌），由 `agentSlots` 設定 | `number` / `24` | 否 | v25 |
| `rwe.config.json` → `agentSlots` | **跨所有 run 的主機層 agent 號誌上限** —— 同一時間允許幾個 agent 子行程存在；達上限的呼叫排隊等槽位。可在 `/api/status` 的 `agentSemaphore.total` 直接看到生效值（設 `"agentSlots": 7` 就會讀到 7）。與 `runConcurrency`（單一 run 內）是兩層不同的上限 | `number` / `32` | 否 | v26 |
| `rwe.config.json` → `maxConcurrentRuns` | 頂層 run 並行上限（run-admission counter）；達上限時 `start()` 在任何持久化動作之前以 `RUN_ADMISSION_LIMIT` 拒絕；巢狀 `workflow()` 不佔用槽位 | `number` / `64` | 否 | v8 |
| `rwe.config.json` → `modelProbe` | 週期性模型探測（issue #73）：對每個已註冊 workflow 版本宣告過的相異 provider/model 打一通純文字＋一通只給 `Read`（issue #93 item 4 之前是 `Bash`+`cat`，現在是叫模型用 `Read` 工具讀一個 nonce 檔）的呼叫，結果供 `models_list` 的 `toolUseVerified`/`proseVerified`/`stabilitySource`，並在 `run_start` 對「帶工具卻落在探測沒用工具的模型」的 agent 發非致命警告。`{enabled, intervalMs, timeoutMs}`：`intervalMs` 為整數且 ≥ 60000、`timeoutMs` 為 1..600000 的整數、不認得的鍵——任一不符即開機拒絕。成本約每模型每週兩通極小呼叫；不在開機時探測，第一次檢查在 min(intervalMs, 1h) 後。`enabled:false` 只關週期探測，admin 的 `models_probe` 仍可用 | `object` / `{enabled:true, intervalMs:604800000, timeoutMs:60000}` | 否 | #73 |
| `rwe.config.json` → `workspaceTtlMs` | Workspace GC sweep 間隔（ms）：回收閒置舊 workspace 目錄（REQ-026），**同時決定 auth-table GC（`gcExpired()`）間隔**；`0`/省略 = workspace reclaim 關閉，auth 啟用但未設此鍵時 sweep 每小時跑一次 | `number` / `0`（停用） | 否 | v16 |
| `rwe.config.json` → `continuationDbPath` | on-completion chaining 續接的 SQLite 檔路徑；引擎會開這個檔，但 40 個工具裡沒有任何一個對應到它（沒有 `chain_*` 工具），設了不影響行為 | `string` / `$workRoot/continuations.db` | 否 | v24 |
| `rwe.config.json` → `webhookDbPath` | webhook 註冊表（`webhooks`+`webhook_deliveries`）SQLite 檔路徑；**secret 明文儲存**於此檔（HMAC 驗簽需要），存取權限即機密邊界；`webhook_list` 只回 sha256 前綴指紋 | `string` / `$workRoot/webhooks.db` | 否 | v8 |
| `rwe.config.json` → `publicBaseUrl` | `webhook_create` 回傳的 `url` 用哪個 base URL 組出來（issue #97）——省略時退回這個 process 自己的 bind 位址／request `Host` 表頭，對走 cloudflared/nginx 反向代理進來的遠端呼叫端會是不可達的 `http://localhost:8899` 這類值。優先序：明白設定的 `publicBaseUrl` 一律最優先；沒設但 `auth.enabled:true` 時退回 `auth.issuer`（該值已經是這個部署對外宣告的身分，同一顆 base URL 沒有理由分開設定兩次）；兩者都沒有才退回舊行為。**任何有反向代理/隧道（cloudflared 等）在前面的部署都應該明白設這個鍵**，否則 webhook 送達方永遠拿不到能打的網址——見 §6 外部 ingress 安全一節。**開機時不驗證這個值的形狀**（不是合法 URL 也照樣接受、原樣拼進 `url`）——跟 `auth.issuer` 現有的寬鬆程度一致，但這裡沒有 `enabled` 開關保護，打錯就是每一次 `webhook_create` 都回一個打不通的網址，直到手動修正設定檔為止 | `string` / — | 有反向代理/隧道時建議設定 | #97 |
| `rwe.config.json` → `casDir` | 內容定址 blob 儲存庫（CAS）目錄；`workspace_push({sha256,contentB64})` 以內容 sha256 為鍵（伺服器 byte-verify）。namespace 一律由呼叫者身份推導，不接受呼叫端指定。每個 namespace 的用量受 `casQuota` 限制，清理見 `workspace_prune_blobs`；若放在與 `workRoot` 不同的檔案系統，`diskFloor` 兩邊都量、取較差者 | `string` / `$workRoot/cas` | 否 | v10 |
| `rwe.config.json` → `updateFlagPath` | GitHub tag/release webhook 觸發自我更新的旗標檔路徑（mode 0600，原子寫入）；**必須在所有 `workRoot` 之外**（違反則 `UPDATE_FLAG_INSIDE_WORKROOT` 拒絕啟動）；省略時 `/github/webhook` 對已驗簽事件回 503 | `string` / — | 否 | v11 |
| `rwe.config.json` → `updateResultPath` | 特權 bash helper 寫入更新結果 JSON（`{tag,status,ts,detail?,configCheck?}`，`configCheck` 是 `'passed'\|'skipped'\|'failed'`）的路徑；同樣必須在 `workRoot` 之外 | `string` / — | 否 | v11 |
| `rwe.config.json` → `selfUpdateDbPath` | 自更新 delivery 去重 + pending outcome 的 SQLite 路徑 | `string` / `$workRoot/self-update.db` | 否 | v11 |
| `rwe.config.json` → `maxTimeoutMs` | `timeoutMs` 的 engine 端 ceiling，**兩處都管**：送出時的 `overrides.timeoutMs`，以及註冊時腳本宣告的 `meta.params.agents.<label>.timeoutMs.default`。超過一律拒絕、不靜默改小。唯一不受此上限約束的是腳本內 `agent()` 的逐次 opts | `number` / `600000` | 否 | v21 |
| `rwe.config.json` → `maxAppendPromptBytes` | `overrides.appendPrompt` 的位元組上限；超過在送出時以 `PARAM_OUT_OF_RANGE` 拒絕（不截斷、原文不回顯於錯誤訊息） | `number` / `1024` | 否 | v21 |
| `rwe.config.json` → `maxEffort` | `overrides.effort`／`meta.params` 宣告的 `effort` 上限（`low\|medium\|high\|xhigh\|max` 五階） | `string` / `'high'` | 否 | v21 |
| `rwe.config.json` → `auth.enabled` | OAuth 2.0 身份認證 toggle；`false`（省略）= 開放行為（無 auth） | `boolean` / `false` | 否 | v15 |
| `rwe.config.json` → `auth.issuer` | 這台引擎當作 OAuth 授權伺服器時對外宣告的 base URL（寫進 AS metadata、`WWW-Authenticate` 與 client redirect 的 `iss`）；省略時自動用 `http://<bind>:<實際 port>`，公開部署（HTTPS tunnel）必須明寫成對外網址 | `string` / `http://<bind>:<port>` | 否（公開部署時建議設定） | v15 |
| `rwe.config.json` → `auth.googleClientId` | Google Cloud Console OAuth 2.0 client ID；用於 `/authorize` 重導向 + id_token aud 驗證。可寫明碼，或 `${secret:NAME}`（同下一列） | `string` / — | 當 `auth.enabled:true` | v15 |
| `rwe.config.json` → `auth.googleClientSecret` | Google OAuth 2.0 client secret；用於 `/oauth/google/callback` code exchange。**建議寫成 `${secret:GOOGLE_CLIENT_SECRET}`**，值放在環境變數 `RWE_SECRET_GOOGLE_CLIENT_SECRET`（例如 `~/.config/rwe.env`）——開機（與 `npm run check-config`）時解析，找不到就**拒絕開機**並指名缺的變數（不印值、不把字面 handle 送給 Google）；明碼值仍可用（向後相容） | `string` / — | 當 `auth.enabled:true` | v15 |
| `rwe.config.json` → `auth.googleAuthorizeUrl` | Google authorization endpoint override（一般部署不需設定） | `string` / `'https://accounts.google.com/o/oauth2/v2/auth'` | 否 | v18 |
| `rwe.config.json` → `auth.googleTokenUrl` | Google token endpoint override | `string` / `'https://oauth2.googleapis.com/token'` | 否 | v18 |
| `rwe.config.json` → `auth.googleJwksUrl` | Google JWKS endpoint override | `string` / `'https://www.googleapis.com/oauth2/v3/certs'` | 否 | v18 |
| `rwe.config.json` → `auth.googleBase` | **deprecated** 向後相容 fallback；改用上面三個獨立 URL 欄位 | `string` / — | 否（deprecated） | v18 |
| env `RWE_CONFIG_PATH` | 要讀取的 JSON 設定檔路徑 | `string` / `./rwe.config.json`（不存在則略過） | 否 | v1 |
| env `RWE_BIND` | 覆蓋 `bind` | `string` / `127.0.0.1` | 否 | v1 |
| env `RWE_PORT` | 覆蓋 `port` | `number` / `8787` | 否 | v1 |
| env `RWE_WORK_ROOT` | 覆蓋 `workRoot` | `string` / 設定檔值或系統暫存目錄 | 否 | v1 |
| env `RWE_LITELLM_VENV` | 只有 `deploy.sh` 讀：LiteLLM Python venv 的路徑（步驟 3 檢查／建立 `<venv>/bin/litellm`，並把 `<venv>/bin` 加進服務的 `PATH`）；引擎本身不讀這個變數 | `string` / `$HOME/.rwe-litellm-venv` | 否 | v24 |
| env `RWE_SECRET_<NAME>` | 伺服器端 secret store；provisioned MCP config 與 `auth.googleClientId`／`auth.googleClientSecret` 裡的 `${secret:NAME}` handle 由此解析（大小寫敏感）；缺少則該次引用以 `SECRET_MISSING` 報錯，從不外洩值或靜默跳過；絕不放進 JSON 設定檔 | `string` / 無預設 | 依 MCP 引用 | v1 |
| env `RWE_SECRET_GITHUB_TOKEN` | `issue_report`／Issues 儀表板需要；GitHub PAT/fine-grained token，須有目標 repo `issues:write` 權限；缺少時 `issue_report` 回 `GITHUB_TOKEN_MISSING`，`GET /api/issues` 回 200 `{degraded}`（不 500） | `string` / 無預設 | 否（缺少則降級） | v1 |
| env `ANTHROPIC_API_KEY` | 每個 `anthropic/<model-id>` ref 用的 API key；`gateway:"sdk"` 路徑也可改由 `RWE_SECRET_ANTHROPIC_API_KEY` 提供 | `string` / 無預設 | 用到 anthropic model ref 時 | v1 |
| env `RWE_SECRET_ANTHROPIC_API_KEY` | 同上，但走伺服器端 secret store（`gateway:"sdk"` 直連 Anthropic 時優先於 `ANTHROPIC_API_KEY`） | `string` / 無預設 | 否 | v7 |
| env `CLAUDE_CODE_OAUTH_TOKEN` | `provider:"anthropic"` **直連**的**訂閱制**認證（`anthropicAuth:"subscription"`），用 `claude setup-token`（Pro/Max 帳號）產生；設定時**不要**同時設 `ANTHROPIC_API_KEY` | `string` / 無預設 | 否 | v7 |
| env `RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN` | 同上，但走伺服器端 secret store（優先於 `CLAUDE_CODE_OAUTH_TOKEN`） | `string` / 無預設 | 否 | v7 |
| env `OLLAMA_BASE_URL` | 每個 `ollama/<model-tag>` ref 要打的 Ollama 位址（本機/內網/自架模型，免金鑰；見 §6「本機小模型能力上限」與§情境配方 0） | `string` / `http://localhost:11434` | 否 | v1 |
| env `OPENROUTER_API_KEY` | 每個 `openrouter/<id>` ref 的 API key（`sk-or-…`）；LiteLLM 以原生 `openrouter/<model>` 路由自動讀取，一把 key 開放整個 OpenRouter 目錄（`models_list` 可查） | `string` / 無預設 | 用到 openrouter model ref 時 | v9 |
| env `RWE_SECRET_GITHUB_WEBHOOK_SECRET` | 標籤觸發式自動更新的 GitHub webhook HMAC 共享密鑰；`POST /github/webhook` 以此對原始 body bytes 算 HMAC-SHA256 比對 `X-Hub-Signature-256`；缺少（且未設 `updateFlagPath`）則路由回 503 `UPDATE_WEBHOOK_UNCONFIGURED` | `string` / 無預設 | 否（缺少則自動更新停用） | v11 |

`auth.enabled:true` 時的部署前提：
1. `bind` 改成 `0.0.0.0`（或公開 IP），並在 `allowedHosts` 列出你的 LAN IP／主機名稱。
2. 引擎需有 HTTPS 公開 callback URL（`https://<your-host>/oauth/google/callback`），因為 Google 要求 callback URI 為 HTTPS（cloudflared tunnel 可提供）。在 Google Cloud Console 的「Authorized redirect URIs」填入此 callback URL。
3. D-BIND fail-closed（`/mcp`、dashboard 的 `/dashboard*` 與 `/api/*`、blob/manifest 上傳都走這一套）：
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
  "googleClientSecret": "${secret:GOOGLE_CLIENT_SECRET}"
}
```
（`~/.config/rwe.env` 裡對應一行 `RWE_SECRET_GOOGLE_CLIENT_SECRET=GOCSPX-…`；明碼寫在 JSON 裡也能跑，但
設定檔就變成機密。）注意：`RWE_SECRET_*` 是同一個 secret store，任何 workflow 的 MCP 設定也能以
`${secret:GOOGLE_CLIENT_SECRET}` 引用它——跟 `RWE_SECRET_GITHUB_TOKEN` 等既有值是同一個信任前提
（能註冊 workflow／推 MCP 資產的人就能用 store 裡的任何名字）。

## §1b2 pi harness（替代 `gateway`）

一個與 `"sdk"` 平行的第三種 `gateway` 選項：`@earendil-works/pi-coding-agent`（pinned `1.0.0`），
一支開源的 coding-agent harness，取代 `@anthropic-ai/claude-agent-sdk` 當作 `agent()` 的執行引擎。
**預設與 production 都還是 `"sdk"`**；這是給想要換引擎、或想避開 Anthropic 認證途徑的部署的選項。

**怎麼切換**：`rwe.config.json` 設 `"gateway": "pi"`，重開引擎（或 `rwe-update.sh` 這種會重啟的流程）。
不需要額外的 `"pi"` 設定區塊——沒有per-agent/per-run 開關，整個引擎只有一種 harness 生效。

**支援的 provider（只有兩個，故意的）**：`openrouter/*` 與 `ollama/*`。**完全不碰 Anthropic**——
沒有 `ANTHROPIC_API_KEY`，也不接受 `CLAUDE_CODE_OAUTH_TOKEN`（owner 2026-10-03 決定：spike 發現透過
第三方 harness 用 Claude 訂閱 token 會被算成「extra usage」計費，不是正常的訂閱額度）。任何
`anthropic/*` model ref——不管是 `workflow_register` 時的預設值、`run_start`/`run_resume` 的
override，還是巢狀 `workflow()` 解析出來的——一律在准入時以 `PROVIDER_UNSUPPORTED_BY_HARNESS` 拒絕，
提示改用 `openrouter/anthropic/...`（透過 OpenRouter 轉送 Claude 模型）或 `ollama/*`。`models_list`、
`GET /api/models`、dashboard 的模型清單、`system_info` 都只會列出 openrouter／ollama，不會出現任何
anthropic 列——換句話說，這個部署的使用者根本看不到 anthropic 模型存在。`OPENROUTER_API_KEY` 來源
與其他地方相同（`RWE_SECRET_OPENROUTER_API_KEY` 或裸 `OPENROUTER_API_KEY`），只會被注入 pi 子行程的
記憶體（`setRuntimeApiKey`）——不進 bash 環境、不落地到任何檔案。`OLLAMA_BASE_URL` 意義不變。

**不經過 LiteLLM**：pi 原生支援 OpenRouter 與 Ollama，`gateway:"pi"` 下**不會**啟動 LiteLLM 代理子行程
（`config.proxyManager` 維持未設定）。

**主機依賴（host dependencies）**：
- `bwrap`（bubblewrap）與 `socat`——跟 `gateway:"sdk"` 的 Bash 圍籠要求相同。
- **額外多一個**：一支真正的 `rg`（ripgrep）**執行檔**在 PATH 上——srt（`@anthropic-ai/sandbox-runtime`，
  pi 用來做 Bash 圍籠的函式庫）啟動時會硬性檢查這個，缺了就整個拒絕初始化。**這台主機如果裝了
  Claude CLI，`rg` 常常只是一個呼叫 CLI multicall 執行檔的 shell function，不是真正的執行檔**——這個
  情況引擎自己會處理：pi 路徑的圍籠探測與每次 Bash 呼叫都會自動指向本引擎已經安裝的
  `@anthropic-ai/claude-agent-sdk-<platform>` 套件自帶的那支 `claude` 執行檔（用 `argv0:'rg'` 的方式
  冒充 ripgrep）——不需要額外裝系統套件。只有在這個套件完全沒裝（平台不支援）時才會真的缺 `rg`，
  此時圍籠探測量到 `unconfined` 並說明原因。
- **（review B4）第二個、獨立的 `rg` 需求——pi 自己的 `Grep` 工具**：上面那支是 srt 圍籠包裝層自己的
  依賴檢查（`SandboxManager.initialize({ripgrep})`），跟 pi 內建 `Grep` **工具本體**（`tools-manager.js`
  的 `ensureTool('rg')`）是兩條完全不同的程式路徑——後者**只檢查自己的 bin 目錄**
  （`getAgentDir()/bin`，由 `PI_CODING_AGENT_DIR` 決定）優先於 PATH，而且這個常數在這支模組**第一次
  被載入時**就凍結，子行程啟動後再改 `process.env` 完全無效。引擎的修法：子行程的 spawn-time
  `env`（而非子行程自己執行中再設）就帶上 `PI_CODING_AGENT_DIR` 指向每次 dispatch 專屬的 agentDir，
  並在那個 agentDir 的 `bin/rg` 寫入一支 wrapper script（`exec -a rg <本引擎已裝的 claude 執行檔>`，
  跟上面 srt 那支用同一顆冒充二進位檔，只是放的位置不同）——這樣 `Grep` 工具在圍籠內外都能真的找到
  `rg` 並正常運作，已用真實 Bash 圍籠驗證（workspace 內可查、workspace 外被拒、符號連結指到 workspace
  外的目錄不會被搜尋）。
- **已知的部署陷阱（這次迭代真的踩到過）**：如果引擎自己的 `node_modules` 剛好裝在**家目錄底下**
  （issue #101 的整個家目錄預設拒讀政策範圍內——開發用的 clone 常常是這樣），`@anthropic-ai/
  sandbox-runtime` 自帶的 `vendor/seccomp/<arch>/apply-seccomp` 執行檔會因為整個家目錄被拒讀而在
  bwrap 沙箱**內部**看不到，Bash 呼叫會卡住直到逾時（`reason:"timeout"`，無任何輸出）。引擎已經修好
  這個：圍籠設定永遠會把 `@anthropic-ai/sandbox-runtime` 自己的安裝目錄加進 Bash 的 `allowRead`，
  與營運者的 `sandbox.allowReadPaths` 無關——**不需要營運者動作**，列在這裡是為了讓看到 Bash 逾時
  又查不出原因的人知道這個歷史。

**已知的網路姿態落差（尚未解決，記在這裡供日後追蹤）**：pi 路徑的 Bash 網路政策是「全部允許」
（透過一個永遠回答「允許」的 ask-callback 達成，因為 srt 的網路欄位是必填，留空等於全部拒絕）——
對外部網域（`curl https://example.com` 這類）這次迭代已經用真實主機驗證過確實可行。但 srt 只要
設定了網路欄位，**所有**流量就會走它自己的 MITM 代理，這代表從圍籠內的 Bash 連 `localhost`／
`127.0.0.1`（例如同主機上的另一個服務）會連不到——這跟今天 `gateway:"sdk"` 的 Bash（完全不設網路
欄位、因此保留主機原生網路含 loopback）不一樣，是一個真實的行為落差，不是臆測。如果有 workflow
的 Bash 需要連本機服務，目前只能先切回 `gateway:"sdk"`；真正的網路白名單（而非全部允許）留給後續
迭代。

**已知的限制（review R2-2 裁決，刻意不修）：`gateway:"pi"` 下 unconfined posture 的 Bash，一個自己呼叫
`setsid` 逃出 process group 的背景行程不會在 dispatch 正常結束時被清掉**。pi 子行程把 unconfined Bash
用 `detached:true` 啟動，所以 Bash 自己的 pid 同時就是它的 process group id——`nohup cmd &`（非互動式
`bash -c` 沒有 job control，背景工作沿用 Bash 自己的 group）清得到，`setsid cmd &`（明確建立新
session+group）清不到，因為 kill 整個 group 的訊號本質上就打不到另一個 group。這是 unconfined 這個
posture 本身「只給本機 run」政策下可接受的已知落差，不是漏修；confined posture 完全沒有這個問題
（bwrap 的 `--unshare-pid --die-with-parent` 在整個 pid namespace 隨 bwrap 結束一起收掉，不管行程在
哪個 process group）。真機驗證：`nohup sleep & setsid sleep &` 這組指令下，unconfined 量到 nohup 的
那支消失、setsid 的那支仍在跑；confined 量到兩支都消失。

**MCP（`agent(..., {mcp:[...]})`）**：已接上。解析走跟 `gateway:"sdk"` **同一份**共用解析器
（`${secret:NAME}`/`${run:dir}`/`${run:id}` 代換——兩個 gateway 不會分岔），每個宣告的 server 從 pi
子行程內一個 inline extension 用 `pi.registerMcpServer(name, {...cfg, exposure:'direct'})` 註冊
（故意不用檔案式 `mcp.json`——pi 1.0.0 的 `createMcpExtension()` 預設設定載入器會忽略自訂
`agentDir`，改讀全域 `~/.pi/agent/mcp.json` 並把該目錄建出來，是真的會發生的副作用，已用
`loadConfig` 覆寫完全避開）。pi 本身沒有連線狀態查詢 API，turn-1 可用性是用
`session.getActiveToolNames()` 輪詢每個宣告 server 的 `mcp__<name>__` 前綴工具（最多等 10 秒，跟
pi `direct` exposure 自己的 `startupWaitMs` 預設一致）算出來，映射到跟 `gateway:"sdk"` **同一個**
`summarizeMcpInit()`——未連上的 server 一樣回報 `agent.mcp_not_connected` 事件與
`MCP_SERVER_NOT_CONNECTED` warning。一個解析不出來的 MCP 名字進 `materialized.missing`、**run 照跑**
（業主 19.5.3 裁決，跟 sdk gateway 一致，不是拒絕）。stdio MCP 子行程**不在** Bash 圍籠內（跟
`gateway:"sdk"` 現狀一致）。

**回收（2026-10-03 真機驗證抓到的真實漏洞，已修）**：正常完成時可靠回收（`npx`/`npm exec` 自己的子行程
在 stdin 被關閉後會自然退出）。但**中途 abort 時原本會漏行程**：實測確認 `npm exec`（`npx` 背後呼叫
的指令）一啟動就對自己呼叫 `setpgid`/`setsid`、變成自己的 process group leader（`ps -eo
pid,pgid,sid` 現場量到：npm exec 的 pgid 等於它自己的 pid，不是 pi 子行程的）——既有的
group-kill（`killGroup(-childPid)`，#129 語意）因此**完全碰不到**它與它自己的子行程，只對沒有
`setsid` 逃逸的一般子行程有效。修法：在送出任何 kill 訊號**之前**，先用 `/proc/<pid>/task/<pid>/
children`（Linux-only，跟本檔其他假設一致）遞迴列出 pi 子行程當下的完整子孫行程清單，再對清單裡
每一個 pid 直接送 `SIGKILL`——不管它在哪個 process group 都打得到，與既有的 group-kill 並存（group-kill
仍是沒有逃逸的子行程的正確、足夠機制）。真機驗證：模擬 `setsid` 逃逸情境的單元測試
（`tests/unit/pi-gateway-escaped-descendant-sweep.test.ts`）先紅後綠；對真正的
`npx -y @modelcontextprotocol/server-everything` 在 mcp_init 剛連上就 abort（最容易漏行程的早期中止
情境）重跑 4 次，`pgrep` 均確認無殘留。
`workspace_push({kind:"mcp"})` 帶 `stdio` transport 的 admin-only 限制不變（見下方角色表）。

**Skills（`agent(..., {skills:[...]})`）**：已接上。`materializeAssets`（跟 `gateway:"sdk"` 同一份函式）
把宣告的技能複製進 `<ws>/.claude/skills/<name>/`，路徑清單以 pi 的 `additionalSkillPaths` 傳給一個
`DefaultResourceLoader`（`noContextFiles`/`noExtensions`/`noSkills`/`noPromptTemplates`/`noThemes`
全部 `true`——「不discovery、全權交給引擎」的精神不變，`extensionFactories`/`additionalSkillPaths`
是文件明載的兩個例外，不受那些旗標影響）。**skill-only agent 的決定**：讀過 pi 自己的
`system-prompt.js`原始碼確認，系統提示詞裡的技能清單只在工具集含 `read` **或** `bash` 其中之一時
才會出現（`skillFileReadTool = ["read","bash"].find(tool => selectedTools.includes(tool))`——按
「名字」比對這個會話實際選用的工具清單，不是跟 pi 內建工具物件做 identity 比對，所以我們自訂、同名的
`read`/`bash` 工具一樣算數）；沒有獨立的 `Skill` 工具。所以宣告了技能但 `allowedTools` 裡**兩者都沒有**
的呼叫一律在派工前就以 `SKILL_REQUIRES_READ_TOOL` 拒絕——清楚失敗，不是靜默材料化一個模型永遠不知道
存在的技能。曾考慮「自動補一個只能讀技能目錄的 jailed read」，v1 判定為多一種、containment
語意跟全引擎唯一一個 `read` 工具不同的第二份定義，不值得為 v1 多開這個介面，故不採用。`exec:true`
（`workspace_push`/`seedManifest` 的技能檔案旗標）在這裡**純粹是檔案權限**（0o755 vs 0o644）——pi
沒有 inline shell（`!cmd`）技能語法，所以 sdk gateway 的 `disableSkillShellExecution` 在 pi 這邊沒有
對應物可設，不是忘記接。

**`effort`/OpenRouter `reasoning.effort` 的請求形狀驗證**：已用錄製式 fake server 驗證。
`system_info`（MCP 工具與 `GET /api/system`）的 `harness` 欄位即時反映
這台部署實際在跑哪一種 harness——`{name:"pi", version, providers, unsupportedTools, effort,
usage}`——不要用這份文件推測，直接查 `system_info`。

**回滾**：把 `rwe.config.json` 的 `"gateway"` 改回 `"sdk"`（或整個刪掉這個鍵，預設就是 `"sdk"`），
重開引擎即可——沒有資料遷移、沒有殘留狀態（pi 的 `agentDir`/session 都是每次 dispatch 用過即丟的
記憶體內物件，從不寫進 `workRoot`）。

**圍籠 Bash 的 TMPDIR（R3-1 修好、R4-2 修正）**：srt（圍籠函式庫）把確認過的 confined Bash 呼叫的
`TMPDIR` 設成 `CLAUDE_CODE_TMPDIR || CLAUDE_TMPDIR || '/tmp/claude'`——這個引擎現在每次派工都把
`CLAUDE_CODE_TMPDIR` 指到一個引擎自己驗證過、該次派工專屬的目錄（`<workRoot>/pi-tmp/d-<id>`，跟
`agentDir` 同一套驗證邏輯），所以 `mktemp` 之類的工具永遠不會碰到主機共用的那個路徑。主機上真的存在
的 `/tmp/claude`（任何本機使用者都能 `mkdir /tmp/claude` 建出來，或是另一支 Claude CLI 沙箱留下的）
**無法**被這個引擎能設定的任何 srt 政策組合「藏起來」讓圍籠內看不到內容——`denyRead` 單獨設是
no-op（srt 自己的寫入路徑還原邏輯會把真正的主機目錄重新綁回去），`denyRead`+`denyWrite` 一起設也一樣
（寫入正確擋下，但讀取仍然看得到真正內容）。引擎因此**只設 `denyWrite:['/tmp/claude']`**：confined
Bash 讀得到 `/tmp/claude`（跟主機上其他任何 `/tmp` 路徑一樣的暴露程度，不是新洞），但寫不進去——
即使攻擊者在兩次 Bash 呼叫之間（check 之後、真正呼叫之前）才建出 `/tmp/claude` 也一樣擋得住，已用
兩個並發 dispatch 互相搶的方式在真機驗證過。R4 另外驗證過一件事：confined Bash **自己完全建不出**
`/tmp/claude`——主機真正的 `/tmp` 在圍籠內是唯讀 bind mount，`mkdir`/`ln -s`/`touch` 在 `/tmp` 下
一律回報「Read-only file system」，主機上什麼都不會留下。R3 原本在 `/tmp/claude` 存在時直接拒絕整個
dispatch（`HOST_SHARED_TMPDIR_UNSAFE`）——R4 業主裁決**撤掉這個拒絕**：上面這些事實證明它買不到額外
的安全性，代價卻是真的——任何一個本機使用者只要 `mkdir /tmp/claude` 就能讓整台主機的 confined pi
Bash 全部拒絕派工（引擎刻意不會去刪它不確定擁有權的主機路徑，所以只能等 operator 自己動手清掉）。
現在的行為：`/tmp/claude` 存在時 dispatch 照常進行，只會送出一個 `agent.host_shared_tmpdir_present`
事件（`{runId, agentId, attempt, path}`）讓 operator 知道，不擋、不碰主機上的任何東西。

**npm audit（pi 相依套件新增的部分）**：新增這三個相依套件（`@earendil-works/pi-coding-agent`、
`@earendil-works/pi-ai`、`@anthropic-ai/sandbox-runtime`）引入兩個新發現，已處理：
- `brace-expansion`（`pi-coding-agent → minimatch → brace-expansion`，三個 DoS regex CVE）——**已修**，
  非破壞性：`package.json` 的 `overrides` 把這條鏈結精準釘到 `5.0.12`（修好的版本），**沒有**動
  `pi-coding-agent`/`minimatch` 本身的版本範圍，只覆寫這一條巢狀路徑。驗證：`npm ls brace-expansion`
  顯示 `5.0.12 overridden`；`rm -rf node_modules && npm ci` 後仍然是 `5.0.12`（自我更新流程跑的就是
  `npm ci`，確認會吃到這個 override，不是只在手動 `npm install` 下才生效）。
- `node-forge`（`@anthropic-ai/sandbox-runtime` 依賴的 RSA PKCS#1 簽章驗證問題）——**刻意不修**：
  npm 自己建議的修法是把 srt 降到 `0.0.50`（npm 自己標成「breaking」），比我們釘死的 `0.0.78` 舊很
  多個版本，會賭上這整個 pi harness 唯一的圍籠機制；`--force` 不是這裡的選項。需要上游 srt 自己發一個
  修好 node-forge 又維持 API 相容的版本——記在這裡等後續追蹤，不是遺漏。
- `npm audit` 其餘的 `vitest`/`vite`/`vite-node`/`esbuild` 鏈結是既有的 dev-only 相依問題（與這次新增
  的 pi 相依套件無關，待辦的 vitest 1.6→5 升級在別的追蹤項目裡），這裡不重複處理。

**lockfile 的非 linux-x64 平台項目（review L11/R2 跨輪追蹤）**：上面的 `rm -f package-lock.json &&
npm install` 全量重算（為了讓 brace-expansion override 真的生效——見上方）有個副作用：`npm` 把
`@anthropic-ai/claude-agent-sdk-*` 這組 optional 平台二進位套件的 8 個變體砍到只剩 `linux-x64`／
`linux-x64-musl`（這台開發機自己的平台），其餘 6 個（`darwin-arm64`/`darwin-x64`/`linux-arm64`/
`linux-arm64-musl`/`win32-arm64`/`win32-x64`）連同另一批 esbuild/rollup 的跨平台項目一起消失——這些
項目本該在 lockfile 裡全列著（讓非本機平台的 `npm ci` 也能解析出自己要裝的那個），即使實際只有「跟
本機平台相符」的那個會真的落地到 `node_modules`。已修：手動從 regression 前的 lockfile 把那 6 個
`claude-agent-sdk-*` 變體原樣補回去（版本、`resolved`、`integrity` 皆未變動，且已逐一對 npm registry
核對那個版本仍然存在）——純附加的 diff，沒動到任何既有行。esbuild/rollup 那批（review L11 估計約 80
項）因為是遞移相依（非這次新增的直接依賴），暫未逐一補回，留待下次真的需要跨平台 `npm ci` 時再處理，
不在這次 pi harness 的影響半徑內。

**第二輪嘗試（review round 2 裁決：「從 master 的 lockfile 當底，試一次」）**：`git show
origin/master:package-lock.json` 當起點、`npm install --package-lock-only` 疊上這個分支新增的 pi 相
依套件——這個組合完整保留了全部 ~86 個跨平台項目（claude-agent-sdk 全 8 個 + esbuild/rollup 那批都
在），達成了「cheap 保留跨平台項目」這個目標本身。但代價是 brace-expansion override **沒有**生效：
`--package-lock-only`（試了兩次，含單獨對 `@earendil-works/pi-coding-agent` 子樹重跑一次）都回報
「up to date」，解出的仍是舊版 `5.0.9`。接著試了 `rm -rf node_modules && npm install`（從這個以
master 為底、已含 pi 相依的 lockfile 出發，而非從零)：這次 `npm ls` 顯示 `overridden: true`，但版本
**仍然**是 `5.0.9`——override 旗標亮著卻沒套用正確版本，像是 npm 自己的一個不一致（可能跟上一輪遺留
的 npm 快取有關），值得記錄但超出「試一次」的預算。結論：**保留**本節上方、已驗證正確（brace-
expansion 確實是 `5.0.12`）、6 個 `claude-agent-sdk-*` 變體手動補回的既有版本，**不採用**這次 master
為底的版本——寧可少補 80 個 dev 期間遲早要處理的跨平台項目，也不要賠上一個已經修好的 CVE。

### 角色（`principals`）——啟用 auth 前一定要讀

每個工具都有一個**最低角色**要求。工具角色共三級（`admin` > `author` > `user`），另有 `none`
（已登入、**待核准**，任何工具都回 `ACCOUNT_PENDING_APPROVAL`），由 §1b 的
`principals` 表決定：鍵是 principal id（OAuth 下的使用者 email），值是 `{role:"..."}`；
`"*"` 是萬用鍵，供「已驗證但沒被列名」的人使用。

| 角色 | 這個角色（含以上）才叫得動的工具 |
|---|---|
| `author` | `workflow_register`／`workflow_deregister`／`workflow_publish`／`workflow_source`、`schedule_create`／`schedule_list`／`schedule_delete`／`schedule_setEnabled`、`webhook_create`／`webhook_list`／`webhook_delete`、`workspace_push` 的資產模式（`{workflow,kind,name}`）、`workspace_list`／`workspace_delete` 的工作流程模式 |
| `admin` | `principals_list`／`principal_set_role`（查看／執行期變更角色，見下方「執行期角色管理」）、dashboard 的「管理」分頁、`models_probe`（立即探測設定的模型）、`workspace_push`／`workspace_delete` 的 `scope:"global"`（全域資產）、以及 `workspace_push({kind:"mcp"})` 帶 `stdio` transport（`config.type:"stdio"`）的 MCP server——其他角色回 `FORBIDDEN_ROLE`，不探測、不啟動任何子行程 |
| `user` | 其餘全部：`workflow_describe`／`workflow_list`／`workflow_authoring_guide`、所有 `run_*`、`workspace_diff`／`workspace_pull`／`workspace_purge` 與 run 模式的 `workspace_list`／`workspace_delete`、所有 `issue_*`、`models_list`、`system_info` |

角色不足一律回 `FORBIDDEN_ROLE`。角色**之外**還有一層擁有權檢查（`NOT_WORKFLOW_OWNER`／
`NOT_RUN_OWNER`／`NOT_TRIGGER_OWNER`）：有 `author` 角色不代表能動別人的工作流程。

⚠ **啟用 auth 卻沒設定 `principals` 的話，沒有人能用任何東西。** 這是刻意的 fail-closed
（2026-09-30 owner decision，取代 ADR-028 的 `user` 預設）：`auth.enabled:true` 時每個已驗證但未列名
（也沒有 `"*"`）的呼叫者一律解析成 `none`＝**待核准**——可以完成登入、MCP 可以連上（`initialize`、
`tools/list` 正常，`initialize` 的說明會寫明待核准），但**每個工具**與 dashboard 的每條資料路由都回
`ACCOUNT_PENDING_APPROVAL`（dashboard 顯示「等待管理員核准」頁，含 email 與登出；只有
`GET /api/me` 回自己的 `{id, role:"none", pending:true}`）。admin 在 `principals_list`／管理分頁看到他
（`role:"none"`），一鍵授予 `user`／`author`／`admin`，下一個請求就生效；`principal_set_role({id, role:"none"})`
收回權限。**對外開放 dashboard 前務必確認沒有 `"*": {"role":"user"}`**（那等於任何 Google 帳號都能跑已發布的
工作流程）。至少列一個 admin：

```json
"principals": {
  "you@example.com": { "role": "admin" },
  "teammate@example.com": { "role": "author" },
  "viewer@example.com": { "role": "user" }
}
```

角色字串打錯（例如 `"admn"`）會讓服務**開機直接拒絕啟動**，絕不靜默退回任何預設角色。
`auth.enabled:false`（預設）時整個授權層被短路，不套用任何角色檢查。

### 執行期角色管理（2026-09-30 起）——設定檔是「初始值 + 鎖定的管理員」

角色現在可以**不重啟**就改：admin 用 MCP 工具 `principal_set_role({id, role})`（`role:null` 移除覆寫）
或 dashboard 的「管理」分頁（同一個後端）。變更在該使用者的**下一個請求**就生效。

- **優先序**（每個請求都重新判斷）：設定檔 `principals` 裡的 `admin`（**鎖定**，執行期改不動）
  ＞ 執行期覆寫（存在 auth DB）＞ 設定檔 `principals[id]` ＞ 設定檔 `"*"` ＞ `none`（待核准）。
- **防鎖死**：對設定檔 admin 改角色一律 `ROLE_LOCKED`；會讓「已知使用者裡一個 admin 都不剩」的
  降級一律 `LAST_ADMIN`。所以**至少在設定檔放一個 admin**——那是 dashboard/工具之外唯一的救援路徑
  （loopback 豁免的本機呼叫**進不了**管理分頁，見下方 D-BIND 說明）。
- **已知使用者**（`principals_list` 與管理分頁列出的名單）＝設定檔 `principals` ∪ 執行期覆寫 ∪
  任何曾經登入過的人（MCP bearer／refresh token、dashboard session），附 `lastSeenAt`；
  `source` 欄說明角色來源：`config-locked`／`db`／`config`／`default`（`"*"` 或預設 `none`）。
- **稽核**：覆寫列記 `updatedBy`／`updatedAt`，服務 log 每次變更印一行
  `{"event":"principal_role_changed","id":…,"previous":…,"role":…,"by":…}`。
- 儲存位置：`<workRoot>/auth-tokens.db` 的 `principal_roles`、`principals_seen` 兩張表（`auth.enabled`
  關閉時也會建立；那時角色會存，但不生效）。要整批回到設定檔的值：admin 逐一 `principal_set_role({id, role:null})`。

### Dashboard 登入（Google）與每位使用者的資料範圍

`auth.enabled:true` 時 dashboard 也可以放在公開網址上：

- **登入**：未登入瀏覽 `/dashboard*` 會被導到 `/dashboard/login`，再轉到 Google（**同一個 OAuth client、
  同一個 callback URI `https://<your-host>/oauth/google/callback`**——Google Cloud Console 不必加新的
  redirect URI）。驗證 id_token（`email_verified` 等，跟 MCP 流程完全一樣）後發一個瀏覽器 session：
  cookie `rwe_session`（HttpOnly、SameSite=Lax、`auth.issuer` 是 https 時加 Secure），7 天、使用中會自動
  延長；DB 只存 sha256。登入後回到原本那頁（`next` 只接受 `/dashboard` 底下、純可列印 ASCII 的同源相對路徑，沒有 open
  redirect）。登入的 `state` 綁在發起登入的瀏覽器上（10 分鐘的 `rwe_login` cookie，callback 時比對，擋 login CSRF）；
  匿名的 `/dashboard/login` 每個來源（隧道後以 `CF-Connecting-IP` 計）每分鐘約 30 次、全域同時最多 1000 個未完成登入，超過回 429。這個流程**不建立** DCR client、**不發** bearer token；MCP 的 `/authorize`／`/token`／refresh
  流程完全不變。右上角顯示 email、角色與「登出」。
- **門**：`/dashboard*` 與 `/api/*` 都要 session cookie 或 bearer（跟 `/mcp` 同一個解析器）；沒有就
  頁面 302 到登入、API 回 401。**例外**：`/api/version`、`/api/status`（健康檢查用，`deploy.sh`／
  `deploy/migrate-to-service-user.sh` 從本機打；不含任何使用者資料）與 `/static/dashboard/*`（純前端資產）
  維持公開。`/api/status` 只有**本機 loopback 直連**（無隧道標頭）或**已登入的 admin** 拿得到完整內容
  （`lastUpdate`＝自我更新結果含 log 摘錄 `detail`、`interruptedRuns`）；其他人（含經隧道的匿名請求、
  非 admin）只拿到存活資訊 `{agentSemaphore, version}`。dashboard 頁尾的更新狀態對非 admin 也不含 `detail`。
- **D-BIND 本機救援路徑**跟 `/mcp` 一致：`bind` 不是 loopback 時，沒有 tunnel 標頭的 loopback 來源
  免登入，但身分是「無人」（`loopback-exempt`）——只看得到系統／模型／issues／工作流程（非擁有者視角），
  任何 run 頁面與管理分頁回 `PRINCIPAL_REQUIRED`。`bind:127.0.0.1` 時沒有豁免，本機也要登入（或帶 bearer）。
- **每位使用者看到的資料＝對應 MCP 工具會給他的**（同一個授權判斷，不可能不一致）：run 列表／首頁卡片／
  成功率等統計只算自己的 run（admin 看全部）；run 詳情、DAG、agent log 只有擁有者或 admin（否則 403
  `NOT_RUN_OWNER`，admin 讀別人的 agent log 會跟 MCP 一樣記稽核）；工作流程對非擁有者只露 release 版
  （beta／草稿版本不列、describe/diagram 回 404）；系統、模型、issues 任何有角色（`user` 以上）的登入者可看（`none` 待核准者什麼都看不到）。
- **CSRF**：會改東西的 dashboard 請求（登出、改角色）必須同源——`Origin` 的 host 等於請求的 `Host`
  或引擎自己的公開網址（`publicBaseUrl`／`auth.issuer`，所以隧道改寫 `Host` 也沒關係），或帶
  `X-Requested-With`；否則 403。引擎自己的公開網址（`publicBaseUrl`／`auth.issuer` 的 host）
  **自動**加進 Host/Origin 白名單，不必再重複寫進 `allowedHosts`。
- **公開網址要多開的隧道路徑**（cloudflared ingress，對公開 hostname）：`^/dashboard`、`^/api/`、
  `^/static/dashboard/`（原本只開 `/mcp`、OAuth 路由時，dashboard 在公開網址上會是 404）。

### 服務帳號（Service accounts）——給程式/CI 用的非互動式存取

2026-10-03 起（`auth.enabled:true` 時）：CI job、bot、另一個服務這類「背後沒有人即時登入」的呼叫端，
不該走 Google OAuth 互動流程，而是用**服務帳號**——`client_id` 固定是 `sa:<name>`，`<name>` 要符合
`[a-z0-9][a-z0-9-]{1,40}`（2–41 字，與 email 帳號的命名空間天生不重疊：email 的 local-part 不能含
`:`）。角色只能是 `author`／`user`（絕不會是 `admin`），可選一個 `workflows` 白名單把它能碰的工作流程名
鎖死（省略/空陣列＝除了角色本身的限制外沒有額外限制）。管理走 6 個 admin-only 工具
（`service_account_create`/`_list`/`_update`/`_rotate_secret`/`_revoke_secret`/`_delete`，見
`workflow_authoring_guide`／`tools/list` 的完整欄位說明）或 dashboard 管理頁的「Service accounts」
分頁——後端是同一套，dashboard 不會准許工具會拒絕的事。**停用／過期的帳號對已經發出去的 bearer 立即
生效**（下一次請求就擋，不必等 token 自然過期）；dashboard 登入本身仍然只給真人（服務帳號的 bearer
打 `/dashboard*`／`/api/*` 一律當作沒有登入）。

**1. 換 token**（RFC 6749 §4.4 `client_credentials`，client secret 只在建立/輪替時顯示一次，之後
只存 sha256）：

```bash
# HTTP Basic（client_secret_basic，client_id/secret 先各自 percent-encode 再接 ":" base64）
curl -s https://<host>/token \
  -u 'sa%3Aci-bot:rwe_sa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' \
  -d grant_type=client_credentials | jq .

# 或表單（client_secret_post）——兩種引擎都接受
curl -s https://<host>/token \
  -d grant_type=client_credentials \
  -d client_id=sa:ci-bot \
  -d client_secret=rwe_sa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx | jq .
# => {"access_token":"...","token_type":"Bearer","expires_in":3600}  （沒有 refresh_token——到期重換即可）
```

帳號不存在、密碼錯、或帳號停用/過期，三種情況**回一模一樣的 `401 {"error":"invalid_client"}`**（不
洩漏是哪一種），`expires_in` 預設 3600 秒（`auth.serviceAccountTokenTtlMs` 可調）。拿到的 `access_token`
就是一般的引擎 bearer，直接當 `Authorization: Bearer <token>` 打 `/mcp`。

**2. 接 Claude Code（`claude -p` 非互動）**——用 `headersHelper`：一支小腳本，每次被呼叫時做上面的
token 交換（有快取就在接近到期前才真的換新的），**把 header 印成一個 JSON 物件（不是純文字的
`Header: value` 那種格式）**到 stdout，這點已經對照過 bundled CLI 本體字串核實過（`headersHelper`
的輸出要被 `JSON.parse`，不是 `authorization`/HTTP 那種純文字行；印錯格式 CLI 會回報
`"... did not return a valid value"`/`"must return a JSON object with string key-value pairs"`）：

```bash
#!/usr/bin/env bash
# rwe-token.sh — headersHelper for the rwe MCP server. Caches the token in a
# 0600 file under $HOME (NEVER inside the repo), re-exchanges near expiry.
set -euo pipefail
CACHE="$HOME/.cache/rwe-sa-token.json"
CLIENT_ID="sa:ci-bot"
CLIENT_SECRET="rwe_sa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TOKEN_URL="https://<host>/token"

# 送審修正 L1：$HOME/.cache 在一台乾淨主機上不一定存在——沒有這行，set -e 下腳本在第一次
# 寫快取檔時就整個 exit 1、連一行輸出都沒有，headersHelper 收到空字串直接判定失敗。
mkdir -p "$(dirname "$CACHE")"

now=$(date +%s)
if [ -f "$CACHE" ]; then
  exp=$(jq -r '.exp // 0' "$CACHE")
  if [ "$exp" -gt $((now + 60)) ]; then
    tok=$(jq -r '.access_token' "$CACHE")
    printf '{"Authorization":"Bearer %s"}\n' "$tok"
    exit 0
  fi
fi
resp=$(curl -sf "$TOKEN_URL" -d grant_type=client_credentials \
  -d client_id="$CLIENT_ID" -d client_secret="$CLIENT_SECRET")
tok=$(printf '%s' "$resp" | jq -r '.access_token')
ttl=$(printf '%s' "$resp" | jq -r '.expires_in // 3600')
umask 077
printf '%s' "$resp" | jq --argjson exp "$((now + ttl))" '. + {exp:$exp}' > "$CACHE"
printf '{"Authorization":"Bearer %s"}\n' "$tok"
```

```bash
chmod +x rwe-token.sh
claude mcp add-json rwe '{"type":"http","url":"https://<host>/mcp","headersHelper":"/path/to/rwe-token.sh"}'
# 或不碰 ~/.claude.json，用一份獨立 MCP config 檔跑單次呼叫：
claude -p "list the rwe tools" --mcp-config rwe-mcp.json --strict-mcp-config
```

**3. secret 只顯示一次、輪替、最小權限**：`service_account_create`／`service_account_rotate_secret`
回傳的 `clientSecret` **只有那一次 API 回應裡看得到**——沒存到就只能重新輪替一次拿新的，引擎本身只存
sha256，連 admin 都讀不回來。單一帳號最多同時 2 把有效 secret（給輪替一個重疊期）：想換 secret 時先
`service_account_rotate_secret` 拿新的、把呼叫端換過去，確認沒問題後再 `service_account_revoke_secret`
把舊的那把收掉；馬上要整支帳號停用則用 `service_account_update({disabled:true})`（對已發出的 bearer
立即生效）或直接 `service_account_delete`（連同已發出的 bearer 一起撤銷，此帳號註冊過的 workflow／
啟動過的 run 不會被刪除或轉讓，仍標示為這個已刪除的 `sa:<name>` 擁有，只有 admin 看得到/碰得到；
**`name` 從此永久退役**——`sa:<name>` 同時是 catalog／run／webhook／schedule／CAS 命名空間的擁有權
字串本身，所以 `service_account_create` 用同一個名字一律拒絕 `SERVICE_ACCOUNT_NAME_RETIRED`，不會有
「重建同名帳號、意外繼承舊帳號資源」這種事；要接手就換一個新名字）。
**最小權限**：建立時就給 `workflows` 白名單，只開這個服務真的需要跑的工作流程名——`role:'user'`
還是能跑名單外的別人工作流程？不行，白名單疊加在角色權限之上，兩者都要過。巢狀 `workflow()`
呼叫（一個已註冊腳本內部再叫另一個工作流程）也會檢查同一份白名單——不會因為外層被允許就連帶放行
任何巢狀目標。縮小白名單或停用帳號後：已經在跑的 run 不會被中途中止，但**之後的每一個新動作都會重新
檢查**——它的下一次巢狀 `workflow()` 呼叫、`run_resume`（暫停或中斷的 run 要續跑時，帳號必須仍有效、
且這個 run 的工作流程仍在白名單內，否則 `SERVICE_ACCOUNT_DISABLED`／`WORKFLOW_NOT_ALLOWED`）、以及
這個帳號建立的 webhook／排程觸發（觸發當下檢查，拒絕會被記錄；同一個 delivery id 重送會得到同樣的 409）。
停用或刪除帳號時，它的 cron 排程仍保持啟用、每次觸發都被拒並留下紀錄——要安靜下來請一併停用或刪除那些觸發器。

## 1c. 安全模型（Security Model）

> 本節記錄 `gateway:"sdk"` 路徑（`ClaudeAgentSdkGatewayClient`）的 agent 工具權限、供應商金鑰
> 存放、以及 run 工作目錄隔離這三件事**目前實際**如何運作。

**(a) 不用 `bypassPermissions`**：`options.permissionMode` 固定是 `'default'`（每一次工具呼叫
均受裁決）。headless 模式下不會卡在互動式權限提示——因為下面 (d) 的
`canUseTool`/`PreToolUse` 回呼一律會同步回傳一個明確決策（`allow` 或 `deny`），從不回傳
`null`/pending。

**(b) 預設工具面 = 受限的檔案+搜尋+shell 集**：
`gateway:"sdk"` 路徑下，工具面只有兩層**可設定**的優先序：一次 `agent()` 呼叫自帶的 `opts.allowedTools`，
否則落到部署設定的 `defaultAllowedTools`（省略時的內建預設是
**`["Read","Write","Edit","Glob","Grep","Bash"]`**——與真實 dynamic-workflow agent 的工作工具面
對齊）。**`Bash` 在預設集裡，但 (d) 的工作目錄邊界檢查對它不成立**：
`Read`/`Write`/`Edit`/`Glob`/`Grep`/`NotebookEdit` 這幾個工具呼叫自己會帶一個路徑參數，(d) 檢查
的就是那個參數；`Bash` 的呼叫只帶一整串 shell 指令字串，沒有任何一個欄位是「這次要碰的路徑」，
所以 (d) 的兩層機制對 `Bash` 一律放行——這不是漏接，是這個檢查本身量不到 shell 指令要碰什麼路徑。
`Bash` 真正的圍籠是另一個獨立機制：OS 層級的 `Options.sandbox`（詳見下面 (e)），只在開機探測量到
「可用」時才會對這次 `agent()` 真的生效；量不到時 `Bash` 在**本機**送出的 run 上是真的不受限的
（ADR-083 業主已接受的代價），但**遠端**送出的 `run_start`/`run_resume` 會在門口被整個拒絕——見
§1b 設定總表「Bash 圍籠姿態」那一列。
**仍不在預設、需明確 opt-in 的**：`WebFetch`/`WebSearch`（對外網連線，破壞工作目錄封閉性）與
`Task`/`Agent`（在 agent 內再生子 agent，繞過引擎自己的 orchestration+DOS 追蹤模型）——這些工具
只能靠呼叫端 `opts.allowedTools` 明確啟用，預設集不含它們。

**(c) 供應商 API 金鑰的存放位置**：真實的供應商金鑰（`ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`/...）
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

**這一層（(d) 的 canUseTool/PreToolUse）不是作業系統層級的 sandbox/jail**（沒有 container/
namespace/chroot 隔離)——它是應用層的權限裁決 + 路徑邊界檢查，只防得住「agent 被 prompt 誘導、
透過 SDK 自己文件化的工具參數去讀寫工作目錄以外的路徑」這一類攻擊路徑，對 `Bash` 完全不生效
（見上面 (b)）；也防不住一個真的被入侵、能直接呼叫任意系統呼叫繞過 SDK 本身的惡意子行程。

**(e) `Bash` 專屬的圍籠是量出來的，不是宣告的**（REQ-218，ADR-083 業主裁決 posture C）：開機時
先確認 `bwrap`（bubblewrap）與 `socat` 兩個執行檔都在 `PATH` 上（真正的 Claude CLI sandbox 這兩個
都硬性需要——`strings` 過裝好的 `@anthropic-ai/claude-agent-sdk-linux-x64` 二進位確認過，缺任一個
CLI 自己就會回「sandbox is enabled but dependencies are missing: ... not installed」），任一缺席
就直接判 `unconfined`（`reason` 會指名缺哪一個），**連巢狀探測都不會跑**；兩者都在才對本機跑一次
巢狀 `bwrap --unshare-user` 探測——探測通過，這台部署上每個 `agent()` 呼叫都會真的
帶 `options.sandbox` 請求 OS 層 namespace 隔離（`src/gateway/bash-confinement.ts`）；探測失敗
（常見於 AppArmor `bwrap-userns-restrict` 政策擋住巢狀 user namespace——修法見下段），
`Bash` 就**完全不圍籠**，於是引擎改以「這次啟動該不該被接納」來擋——**被拒絕的是三種情形的聯集**：
(1) **遠端送出**的 `run_start`/`run_resume`——**issue #93（2026-09-26）之前，這道拒絕排在 ajv 參數
驗證、authz、工作流程/版本是否存在**之前**，所以遠端呼叫端連自己打錯參數或指到不存在的工作流程
都只看得到 `CONFINEMENT_UNAVAILABLE`；現在改成排在這些檢查**之後**、任何持久化動作（建立 run、
工作目錄、materialize seed）之前——參數錯誤先回 `INVALID_ARGUMENT`，工作流程/版本不存在先回
`WORKFLOW_NOT_FOUND`/`VERSION_NOT_FOUND`，只有一次「原本會被接受」的送出才回
`CONFINEMENT_UNAVAILABLE`**；(2) 觸發器是**遠端建立**的（webhook 送達、排程觸發）；
(3) 這次要跑的**版本是遠端註冊**的——**這一項與呼叫者在哪裡無關，本機呼叫一樣被擋**。
三者皆非時（本機送出、本機建立的觸發器、本機註冊的版本）才照跑，且是真的不受任何 `Bash` 圍籠。
判定式、查法與復原步驟見 §6（`CONFINEMENT_UNAVAILABLE`）。姿態量測結果印在開機 log
的 `Bash confinement: CONFINED`/`UNCONFINED` 那一行（該行同時附上下段的操作員修法），也隨每次
`agent()` 呼叫寫進 `agent.confinement` 事件的 `posture`/`enabled` 欄位；無法用設定檔調高或調低
（只有 §1b `sandbox.allowHostPaths`（讀寫）與 `sandbox.allowReadPaths`（唯讀）能在「圍籠生效」的前提下額外開放特定主機路徑）。

**(f) 圍籠生效時，`Bash` 的「讀取」是預設拒絕的**（issue #101）：寫入一向只允許自己的 run 工作目錄
（加上 `sandbox.allowHostPaths`），但在 issue #101 之前，**讀取**只擋了 `workRoot` 底下幾個引擎狀態
檔名，其他整個主機檔案系統都是唯讀可見——agent 的 `Bash` 讀得到**別人 run 的工作目錄**
（`<workRoot>/workflows/<wf>/runs/<runId>/`）與家目錄裡的憑證（`~/.claude/.credentials.json`、
`~/.claude.json`、`~/.config/rwe.env`、各種 `~/.*_API_KEY`），而 run 的結果就是一條外洩管道。現在
`denyRead` 是**引擎自己的整個家目錄**（= CLI 子行程的 `HOME`）+ **整個 `workRoot`**（不論在不在
家目錄內）+ 受保護檔案（`rwe.config.json`、`auth-tokens.db`、`casDir`/`assetRoot`/各 DB 的實際路徑）；
`allowRead` 再把以下幾項從被拒絕的樹裡重新開放：這次呼叫自己的工作目錄、營運者的
`sandbox.allowHostPaths`、以及家目錄內的工具鏈——引擎自己 `PATH` 上落在家目錄內的每一個目錄，
加上引擎 node 的安裝前綴（`<prefix>/bin/node` ⇒ `<prefix>`，因為 `npm`/`npx` 是指進
`<prefix>/lib/node_modules` 的 symlink）；永遠不會是家目錄本身或共用的 `~/.local`；不存在或違反
授權規則的候選會被**靜默略過**（營運者沒要求它），其餘靠 `sandbox.allowReadPaths` 補。機制是 CLI
自己的 sandbox：每個 `denyRead` 目錄掛一個空 `tmpfs`，再把允許的路徑 bind 回去——已在一台圍籠生效
的主機上實測（bwrap + socat，CLI 2.1.283，量測紀錄見 `docs/evidence/issue-101-read-confinement.md`，
自動化驗收是 `tests/acceptance/val-101-bash-read-confinement.test.ts`）。所以在 agent 眼中：
`ls ~` 或 `ls <workRoot>` 會成功，但只看到通往自己工作目錄/工具鏈的空骨架目錄，看不到其他 run，
也讀不到任何憑證。`/usr`、`/etc`、`/tmp` 等家目錄以外的系統路徑仍是唯讀可見（`git`、`python3`
這類系統工具照常可用）。**行為變化**：`~/.gitconfig` 也讀不到了（agent 要 `git commit` 需在工作目錄內
自行設定身份，例如 `git -c user.name=… -c user.email=… commit`）；CLI 每次在 Bash 前 `source` 的
shell snapshot（在 `~/.claude/shell-snapshots/`）改為靜默失敗（該步驟本來就是 `|| true`，指令照跑）。
**CLI 暫存目錄是每次派工各自一份**（issue #101 殘留項，量測紀錄見 `docs/evidence/issue-101-cli-scratch.md`）：
CLI 一定會把它的 per-uid 暫存目錄（`<暫存根>/claude-<uid>/`，內含每個 session 的 `tasks/`）在
`denyRead` **之後**以可寫方式 bind 回 sandbox，所以預設下同一個 uid 的所有 run 共用
`/tmp/claude-<uid>/`。現在圍籠生效、且 `workRoot` 已知時，引擎每次派工（每次 attempt）都在
`<workRoot>/cli-tmp/` 底下建一個新的 0700 目錄，把 CLI 子行程的 `TMPDIR` 與 `CLAUDE_CODE_TMPDIR`
**兩個都**指向它（只設後者不夠：路徑超過 44 bytes 時 CLI 會退回 `$TMPDIR/claude-<uid>` 再 bind 一次），
並把主機共用的 `/tmp/claude-<uid>`（引擎自己 tmpdir 底下那個）加進 `denyRead`。這個目錄在 `workRoot`
的 `denyRead` 範圍內，別的派工看不到；呼叫結束就刪掉，引擎開機時（`createServer()` 之前）也會整個清掉
`<workRoot>/cli-tmp/`，處理被強制終止的行程留下的殘留。在 agent 眼中：`ls /tmp/claude-<uid>` 是空的，寫
進去的東西只會落在 sandbox 內的 tmpfs、不會到主機上；自己的 `$TMPDIR`/`$CLAUDE_CODE_TMPDIR` 照常可寫
（`bash:'readonly'` 時也一樣）。**失敗時拒絕，不會退回共用目錄**：`workRoot` 超過 56 bytes（CLI 的
sandbox socket 直接放在 `$TMPDIR`，路徑必須塞得進 107 bytes 的 unix socket 上限）會回
`CLI_SCRATCH_PATH_TOO_LONG`（這種 `workRoot` 在圍籠生效、用 sdk gateway 時**開機就會被拒絕**，訊息同一個碼，修法是換較短的 `workRoot` 路徑），建不出目錄會回 `CLI_SCRATCH_UNAVAILABLE`，兩者都在任何 session 開始前拒絕。
沒有新的設定鍵。**仍未關閉**（CLI/sandbox-runtime 以 `os.homedir()` 寫死，`CLAUDE_CONFIG_DIR` 也移不掉，
量測過）：引擎 HOME 底下的 `~/.claude/debug/` 與 `~/.npm/_logs/` 只要**存在**，就會以可寫方式 bind 進每個
sandbox，可以被當成 run 之間的傳遞通道，也讀得到裡面已有的內容（不含憑證；與操作員共用 uid 時，
`~/.claude/debug/` 裡是操作員互動式 Claude Code 的 debug log）。引擎自己的 CLI 不會建立
`~/.claude/debug/`（只有 `DEBUG_CLAUDE_AGENT_SDK`/`--debug` 才寫，子行程環境變數是白名單、不會帶到）。所以
讓引擎以專用的系統使用者身分執行後，**刪掉該使用者的這兩個目錄**，就不會再被 bind。

**開機 log 印 `UNCONFINED (socat not found on PATH ...)` 或 `(bwrap not found on PATH ...)`，怎麼
修**：先裝缺的那個執行檔——`sudo apt install bubblewrap socat`（兩個都裝最省事，之後不用再回來查
是哪一個）——裝完重開引擎即可，不需要動 AppArmor/sysctl（那是下一段、探測本身失敗的另一種原因）。

**探測為什麼會失敗、怎麼修（Ubuntu/AppArmor 主機，issue #93 實測驗證過）**：探測本身是巢狀的
`bwrap --unshare-user`（外層再包一層一樣的 `bwrap`），多半敗在 AppArmor 的
`bwrap-userns-restrict` 設定檔擋住第二層（巢狀）unprivileged user namespace——修法是兩步都要做：
(1) `kernel.apparmor_restrict_unprivileged_userns=0`（寫一個
`/etc/sysctl.d/60-rwe-userns.conf`，內容 `kernel.apparmor_restrict_unprivileged_userns=0`，再跑
`sysctl --system` 套用）；(2) 停用該 AppArmor 設定檔本身
（`ln -s /etc/apparmor.d/bwrap-userns-restrict /etc/apparmor.d/disable/ && apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict`）；
兩步都做完後重開引擎，開機 log 應改印 `Bash confinement: CONFINED`。**安全權衡**：這是整台主機層
級的放寬——任何非特權行程從此都能建立巢狀 user namespace，AppArmor 那份設定檔原本就是為了擋住
這個原語；只在這台主機上每一個會用到本引擎的人都已經是作業系統層信任對象時才這樣做，共用／多租戶
主機不要套用。**復原**：移除該 sysctl 覆寫檔並重新套用，同時重新啟用設定檔
（刪掉 `/etc/apparmor.d/disable/bwrap-userns-restrict` 符號連結，再跑一次
`apparmor_parser /etc/apparmor.d/bwrap-userns-restrict`）。

**(g) `workspace_push({kind:"mcp"})` 的信任邊界（issue #105 q1）**：上面 (a)-(f) 全部是**已 dispatch
的 agent** 受的限制；`workspace_push` 推 MCP server 這件事本身完全在這層之外，發生在**引擎自己的
process**，不受 (e)/(f) 的 Bash 圍籠或工作目錄邊界約束。兩種可接受的 transport（`stdio` 的
`command` 必須**恰好等於** `"npx"`，換成別的執行檔路徑或 `node -e ...` 都不算受支援的 transport）：
`{"type":"http","url":"https://..."}` 與 `{"type":"stdio","command":"npx","args":[...]}`——其他形狀
在探測前就拒絕，但不是獨立的頂層拒絕碼：包在 `MCP_PROBE_FAILED` 的 `detail.code` 裡回
`UNSUPPORTED_TRANSPORT`。**推送時的探測（probe）只跑一次，就在引擎自己的
process 裡**：`http` 送一個短 timeout 的 HTTP HEAD；`stdio` 直接在引擎主機上 spawn 那個指令一次來確認
能啟動——因為只接受 `command:"npx"`，套件下載是真的、當場發生，落進**引擎使用者自己的** `~/.npm`
cache，用的是那個使用者當下的網路權限，跟被 dispatch 的 agent 受限的 sandbox 網路完全是兩回事。
**為什麼 `stdio` 只有 `admin` 能推**（見 §1b 角色表）：`stdio` MCP server 之後不是跑在任何 agent 的
Bash 圍籠裡——它是引擎自己的一個普通子行程，擁有引擎使用者完整的檔案系統與網路存取（理論上讀得到
引擎自己的機密與資料，跟引擎 process 本身同一個信任層級，不是被 dispatch 的 agent 那個層級）；而且
完全不受 `mcpEgressAllowlist` 管（那份清單只檢查 config 的 `url` 欄位，`stdio` config 根本沒有這個
欄位）。推一顆 `stdio` server 等於直接交出主機層級的信任，所以 `author` 以下一律 `FORBIDDEN_ROLE`，
連探測都不會跑——這是刻意設計，不是待補的洞。`type:"http"` 之所以 `author` 也推得動，是因為它真的
被 `mcpEgressAllowlist`（§1b 那一列）擋著：省略/空陣列 = 每一個 `http` MCP config 一律
`EGRESS_DENIED`，營運者才是唯一能放寬這道閘的人。config 裡任何位置（不限層數）都可以放
`${secret:NAME}` 佔位，解析對象是引擎自己環境變數裡的 `RWE_SECRET_<NAME>`（見上面那一列）——
**解析時機是 dispatch，不是 push**：解析失敗不是 `workspace_push` 的拒絕碼，而是那次
`agent()` 呼叫自己的失敗——detail 帶著 `SECRET_MISSING`（缺的 handle）或
`SECRET_HANDLE_INVALID`（語法錯的 handle），全有全無，絕不半套代換。完整角色 × 資產種類/範圍/
transport 矩陣、config 形狀範例與其餘細節見 `workflow_authoring_guide`（或 `docs/AUTHORING.md`）
的「Provisioning skills and MCP servers」一節——本段只記信任邊界的「為什麼」，機制細節不在此重複
一份會漂移的第二份。

**(h) `stdio` MCP server 自己的狀態是 host 全域共用的（issue #126）**：(g) 講的是 server「碰得到」
什麼（跟引擎 process 同信任層級）；這裡講的是它「留下」什麼。`stdio` server 是引擎 host 上的一個
普通子行程，不是每個 run 各自一份全新實例——所以它在**自己 process 之外**留下的任何狀態（引擎
使用者 HOME 底下的檔案、它自己的 `npx` package cache、寫死在它預設值裡的絕對路徑）是**所有宣告
同一個 server 名字的每一個 run、每一個 principal 共用的同一份** store。`@modelcontextprotocol/
server-memory` 就是現成例子：預設把資料寫進自己 npx package 目錄底下的一個 JSONL 檔——兩個不相干
的 run，各自以為自己在操作「自己的」knowledge graph，實際上讀寫的是同一個檔案。run 的 sandbox
（workspace、`/tmp`、materialize 出來的 skill）本身每個 run 都確實各自分開；這是唯一一個不是的
管道，因為 server 本身就跑在那層 sandbox 之外（見 (g)）。

**修法**：在 `workspace_push({kind:"mcp"})` 的 `config.env`/`config.args` 裡用
`${run:dir}`（引擎在這個 run 第一次用到時才建立的 0700 私有目錄，路徑是
`<workRoot>/workflows/<name>/mcp-state/<runId>/<serverName>/`——刻意放在**可被
`workspace_pull`/`workspace_list` 讀到的 run workspace 之外**，因為那條路徑面向呼叫者，而這個目錄
是引擎自己管的狀態）與/或 `${run:id}`（這個 run 的 id，純字串）。兩者都在 **dispatch 時**解析（跟
`${secret:NAME}` 同一個時機，也跟它一樣原樣存在 catalog 裡），同一個 run 底下先後呼叫的
`agent()` 共用同一份 `${run:dir}`，不同 run（即使同一個 workflow、同一個 principal）永遠拿到不同
目錄，run 的 workspace 被 GC 回收時這個目錄也跟著清掉（沿用既有的 workspace 保留/GC 設定，見下方
`workspaceTtlMs`，不是另一條定時器）。範例——把上面 server-memory 的例子改成逐 run 各自一份：

```json
{
  "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"],
  "env": { "MEMORY_FILE_PATH": "${run:dir}/memory.jsonl" }
}
```

`config` 裡出現除了 `dir`/`id` 以外的 `${run:xxx}` 名字，`workspace_push` 當場用
`UNKNOWN_RUN_PLACEHOLDER` 拒絕（探測都不會跑）——打錯字當下就知道，不必等到 run 第一次 dispatch
才看到語焉不詳的啟動失敗。本身不留狀態的 server（每個請求/回應處理完就沒事了，多數 server 是這種
形狀）兩個占位符都不需要；拿不準的話，優先選不留狀態的 server，真的要留狀態就把它指到
`${run:dir}`。

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

> `deploy/rwe.service` 是 **system-mode**（root、`/opt` 安裝路徑）的替代方案。這台專案自己的
> production 主機實際跑的是下一節的 **user-mode** `deploy/rwe.user.service` +
> `rwe.service.d/override.conf`；§6b 的自我更新單元（`rwe-update.service`／`rwe-update.path`）
> 也只有 user-mode 範本——沒有對應的 system-mode 更新單元，走 root 部署路線的人要自己另外接自我更新。

### 無 root 部署：systemd **user** service

> 沒有 sudo/root 時的正解——用 systemd 的 **user instance**（`systemctl --user`），unit 放
> `~/.config/systemd/user/`，完全不需要 root。有 sudo 的主機建議把這套 user unit 放在一個專用的系統帳號底下、
> 而不是你自己的登入帳號（理由與分階段腳本見 §6c）。附檔 `deploy/rwe.user.service` 是這個版本的範本，
> 逐行對照這台專案 production 主機目前實際在跑的 user unit（2026-09-27 收斂）——換機時真正
> 因主機而異的只剩下方表格列出的幾個值。範本預設把 LiteLLM venv 的 bin/ 放進 `PATH`
> （`gateway:"sdk"` 才用得到）；只想跑本地 Ollama、零依賴的部署可以不裝這個 venv，PATH 裡多出的
> 那個目錄不存在時直接被跳過，不影響啟動。

```bash
# 1. 安裝 unit（install -D 會自動建目錄/設權限，不要手打 heredoc——長行/縮排容易被貼壞）。
#    override.conf drop-in是選用的——不裝就沿用範本內建的 RWE_PORT=8787；下面步驟 3 的驗證指令
#    跟著你有沒有裝這個 drop-in 換 port。
install -D -m 644 deploy/rwe.user.service ~/.config/systemd/user/rwe.service
# install -D -m 644 deploy/rwe.service.d/override.conf ~/.config/systemd/user/rwe.service.d/override.conf
systemctl --user cat rwe.service                 # 確認套用後的完整 unit、有 ExecStart 才繼續

# 2. 啟用 + 啟動 + 讓它在登出後仍續存
systemctl --user daemon-reload
systemctl --user enable --now rwe.service
loginctl enable-linger "$USER"                   # 登出/重開機後 user service 仍運行

# 3. 驗證（看到 active + dashboard=200 即成功；port 沒裝 override.conf 就是範本預設 8787，
#    裝了就跟著 drop-in 裡的值，例如下面表格的 8899）
systemctl --user is-active rwe.service
curl -s -o /dev/null -w "dashboard=%{http_code}\n" http://127.0.0.1:8787/dashboard
```

**環境變數蓋過設定檔**：`RWE_BIND`／`RWE_PORT` 一旦被 unit 的 `Environment=`（或其 drop-in）設定，
就會蓋過 `rwe.config.json` 裡的 `bind`／`port`（`src/main.ts`：`process.env['RWE_BIND'] ??
fileConfig.bind`，`RWE_PORT` 同理）——下面設定檔範例裡的 `bind`／`port` 只在**沒有**任何
`Environment=RWE_BIND`／`RWE_PORT` 蓋過去時才生效，改 unit（或它的 drop-in）比改設定檔優先生效。

**範本裡跟主機/這次部署有關、通常要改的值**：

| 值 | 範本預設 | 說明 |
|----|---------|------|
| `WorkingDirectory`／`ExecStart`／`RWE_CONFIG_PATH` 裡的 repo 路徑 | `%h/Documents/remote-workflow` | `%h` 是 systemd specifier，會展開成執行這個 user instance 的家目錄；clone 不在這個慣例路徑下要手動改這三處 |
| `deploy/rwe.service.d/override.conf`（選用 drop-in）的 `RWE_PORT` | `8899` | 這是本專案 production 主機實際用的值，只有裝了這個 drop-in 才生效；不裝就沿用 unit 本體的 `RWE_PORT=8787`。要換 port 就編輯這個 drop-in 檔，不要動 `rwe.user.service` 本體 |
| `rwe.user.service` 本體的 `RWE_BIND` | `0.0.0.0` | 跟 production 一致——會把這個 port 暴露在區網（見§6b 步驟二／§7 第 8 點的白名單隧道說明，隧道本身有另一層路徑白名單擋住 dashboard/`/api/*`）。只在本機測試、不打算讓區網連進來的部署把這一行改成 `127.0.0.1`（改 `rwe.config.json` 的 `bind` 沒用，見上方「環境變數蓋過設定檔」） |

若要跑純本地 Ollama、零 API 金鑰、零 LiteLLM/Python 依賴的最小情境：**不要**安裝
`override.conf` drop-in，並把複製出來的 `rwe.service` 裡的 `RWE_BIND` 改成 `127.0.0.1`（理由同上表），
這樣 unit 本體的 `RWE_PORT=8787`／`RWE_BIND=127.0.0.1` 會跟下面**搭配的 `rwe.config.json`** 一致：
```json
{
  "bind": "127.0.0.1", "port": 8787, "workRoot": "./data",
  "timeoutMs": 300000, "gateway": "direct-fetch", "useLiteLLMProxy": false
}
```
模型不寫在設定檔——腳本自己的 `meta.params.agents.<label>.model.default` 寫
`"ollama/qwen2.5:7b"`（或你 Ollama 伺服器上真正有的其他 tag）。

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
[smoke] registering sample workflow smoke-139722...
[smoke] publishing smoke-139722@v1 onto release...
[smoke] submitting sample run_start...
[smoke] runId=b7c3d1fc-3535-49f3-8ca2-d4ce2c9cf83c
[smoke] PASS: sample workflow completed with result=42
[smoke] shutting down server (pid 139727)...
```

### git pre-push 保護（推 master 前跑 typecheck + 完整測試）

> 這是**開發端**（在哪裡 `git push` 這台機器）的保護，跟上面的執行期部署無關；換新主機時若也會
> 在那台機器上開發／推送，記得裝這一段——見 §7 換機檢查清單。

這個免費私有 repo 開不了 GitHub branch protection / rulesets（兩者都回 403「Upgrade to Pro or
make public」），所以用一個本機 `pre-push` hook 頂替：**推到 `refs/heads/master` 前**先跑
`npm run typecheck` + `npm test`，任一紅就擋下這次推送（`git push --no-verify` 可緊急略過）；
推 feature branch/tag 不受影響。hook 本體版控在 `deploy/git-hooks/pre-push`（`.git/hooks/`
本身**不進版控**，只複製/連結不會自動同步，換主機或換 clone 都要重新接一次）：

```bash
git config core.hooksPath deploy/git-hooks     # 這台 clone 的每一次 push 都套用
# 或者，若不想覆蓋 core.hooksPath（例如已用它掛別的 hook）：
ln -s ../../deploy/git-hooks/pre-push .git/hooks/pre-push
```

**`core.hooksPath` 是這份 clone 共用的 repo-local 設定，不是逐 worktree 各自一份**——它寫進
`$GIT_COMMON_DIR/config`（一般就是主 checkout 的 `.git/config`），同一個 clone 底下**所有**
linked worktree 共用同一份，**不必**在每個 worktree 裡重跑一次；要各自跑一次的是**不同的
clone**（例如另一台機器上重新 `git clone` 出來的那份）。**真正逐 worktree 而異的是這個相對路徑
`deploy/git-hooks` 怎麼展開**：git 是相對於「推送當下那個 worktree 的工作目錄」去找
`deploy/git-hooks/pre-push` 的——如果你在某個 worktree 上簽出的是還沒有這個檔案的舊 commit，
git 會找不到它，**而且不會報錯，就是悄悄不跑這個 hook**。想確認某個 worktree 到底會不會跑到
這個 hook：在那個 worktree 目錄下跑 `git rev-parse --git-path hooks`，看印出來的路徑底下真的有
沒有 `pre-push`；不放心就把 `core.hooksPath` 設成絕對路徑，不用相對路徑猜。**設定前**先看一眼
`ls .git/hooks/`：`core.hooksPath` 會**整個取代**原本的 `.git/hooks/` 目錄查找路徑（含任何你
原本手動放的其他 hook），不是疊加。用 symlink 那個做法（`ln -s ... .git/hooks/pre-push`）**只能
在主 checkout 裡做**——linked worktree 自己的 `.git` 是一個指向共用目錄的檔案，底下沒有
`hooks/` 這個目錄可以放 symlink。

**2026-09-26 事故（就是這個 hook 現有註解裡記的那件事）**：從一個 linked worktree 推送時，
git 會把 `GIT_DIR`（絕對路徑）匯出進 hook 的環境；hook 跑的測試套件會在暫存目錄裡 `git init`/
`commit`/`tag`，繼承到這個 `GIT_DIR` 之後全部寫進了**正式部署那份 checkout**——把它的
`core.bare` 改成 `true`、留下假的 `v1.x` tag、在被推送的分支上多出測試用的 commit。這正是
hook 一開頭就 `unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE ...` 那一段要防的事，換主機/換 clone
重新接線時不要把這幾行刪掉。

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
> `settingSources:['project']` 載入），MCP 設定只經由 `options.mcpServers`（`strictMcpConfig`）交給 CLI——
> 引擎不會把解析後的 MCP 設定（含已代換的 `${secret:}` 值）寫進 workspace；workspace 裡任何 `.mcp.json`
> 都會在派發前被清除（issue #128）。
> 換句話說：**推送的 skill/MCP config 會真的被 agent 載入並執行**——沒被宣告的資產不會被展開，
> 但「推送」與「被宣告」都在同一個 `author` 手上。引擎自己的 `rwe-` 前綴是保留字
> （`RESERVED_PREFIX`），防止推送的資產冒充引擎內建的技能。`gateway:"direct-fetch"` 從不帶資產，
> 這條路徑不受影響。

**`GET /api/system`（Dashboard 的儀表板端點，不需要認證）一次回傳最多 20 筆主機 process 列，
`bind:"0.0.0.0"` 時任何能連到這台主機的人都看得到——每筆只有 `comm`（process 名稱）這一個欄位，
絕不含 argv、cwd、環境變數或 uid，但仍是主機上跑了哪些程式的資訊揭露。跟前一段的 `workspace_push`
風險一樣的緩解方式：啟用 auth，或把這個 port 限制在 SSH 通道／VPN／loopback 內，不要直接暴露在
公開網路上。

## 3. 健康檢查（怎麼確認起來了）
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
判定標準：回傳 `200`，且 body 的 `result.tools` 陣列包含 40 個工具（`workflow_*` 7、`run_*` 8、
`workspace_*` 7、`schedule_*` 4、`webhook_*` 3、`issue_*` 5、`models_list`＋`models_probe`＋`system_info`、
`principals_list`＋`principal_set_role`＋`principal_set_quota`）；
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
| `agent()` 一律回傳 `null`、`run_status.agents[].state === "failed"` | 該 model ref 對應的 provider 沒有可用憑證/端點（伺服器不會掛住，只會讓該次呼叫失敗回 `null`）——一個**依序** `await agent(...)` 呼叫失敗或逾時一律回傳 `null`，不拋例外，是刻意設計，不是漏接；`run_status`/`run_result`/`GET /api/runs/:id` 會同時多一個 `failedAgentCount` 欄位，不必自己去掃 `agents[]` 才發現「這次 run 裡有東西失敗了」 | 確認 `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`/`OLLAMA_BASE_URL` 已正確設定，且腳本 `meta.params.agents.<label>.model.default` 寫的完整 ref 指到你要的 provider/model；腳本自己要對 `await agent(...)` 的回傳值判斷 `null` 再往下用，避免把 `null` 字串化接進下一段 prompt |
| 宣告的 `timeoutMs` 跟實際等到失敗的時間對不上（例如宣告 60000ms、實測快兩倍才失敗） | `timeoutMs` 界定的是**單次嘗試**、不是整個呼叫；部署的 `retries`（`rwe.config.json`，預設 1）會讓實際最壞等待時間變成 `timeoutMs × (1 + retries)` | 呼叫 `workflow_describe` 直接讀 `params.agents.<label>.timeoutMs.attempts`/`.worstCaseMs`（伺服器已經照這條公式算好，不必自己乘） |
| `workflow_register` 回 `UNKNOWN_MODEL` | 腳本 `meta.params.agents.<label>.model.default`／`.enum` 不是合法的完整 `<provider>/<model-id>` ref（裸名稱、認不得的 provider 前綴），或 openrouter/ollama 的 id 在該供應商的現行目錄裡真的找不到 | 改成完整 ref（用 `models_list` 查、複製它的 `ref` 欄位貼上）——這是在**註冊當下**就報錯（`model` 不能寫在 `agent()` 呼叫裡，寫了是 `SCAN_VIOLATION`），不會跑到一半才失敗 |
| 任何工具呼叫回 JSON-RPC `-32601 Unknown tool` | 用的工具名不存在（例如 `workflow_run`／`workflow_status`／`asset_push`／`mcp_provision`／`chain_create`） | 用 `tools/list`（38 個）查現行名稱；權威清單是 `src/tool-specs.ts` |
| 開機 log 出現 `unrecognized config key(s) in rwe.config.json, ignored: …` | `rwe.config.json` 有引擎不認得的鍵（打錯字，或已不存在的鍵，例如 `graphAnalyzer`、`aliases`——2026-09-26 起別名機制整個移除） | 把該鍵從設定檔移除；有效鍵只有 §1b 設定總表列出的那些。**`aliases` 這個鍵不會擋住開機**（自我更新重啟舊設定檔時仍要能正常啟動），但已完全不生效——把每個模型改寫進腳本自己的 `meta.params.agents.<label>.model.default`（完整 `<provider>/<model-id>` ref） |
| `workflow_register` 回 `MERMAID_REQUIRED` 或 `DIAGRAM_MISMATCH` | 註冊必須附一張非空的 Mermaid 圖，而且圖裡的 stadium 節點 `id(["label"])` 要跟腳本的 `agent()` label 雙向完全對上 | 補上 `mermaid` 參數；節點少了就補、多了就刪。詳細語法見 `docs/AUTHORING.md`（或呼叫 `workflow_authoring_guide`）|
| `run_start` 回 `PARAM_UNKNOWN`，訊息說 overrides 只有 `agents` 一個鍵 | 用的是扁平的 `overrides:{effort:...}` | 改成逐 agent：`overrides:{agents:{'<label>':{effort:...}}}`；而且該鍵必須在 `meta.params.agents.<label>` 宣告過 |
| `run_start` 回 `CHANNEL_UNPUBLISHED`；或 `workflow_describe` 回 `runnable:false` | 剛註冊完還沒發布——註冊只建立版本，不會自動指向任何頻道 | `workflow_publish({name, version, channel:"release"})`（三個參數都必填，`version` 是註冊回傳的字串如 `"v1"`）|
| `workflow_describe` 回 `runnable:false` + `runnableReason:"LEGACY_REREGISTER"` | 這個版本沒有 `meta.params.agents` 契約（引擎不提供舊契約的解析階梯） | 照現行契約重新 `workflow_register` 一次（新版本），再 `workflow_publish` |
| 腳本內 `budget.spent()` 一直是 `0`、`budget.remaining()` 一直等於 `budget.total` | 該次執行可能尚未完成任何一次 `agent()` 呼叫 | 第一筆用量要等第一次 `agent()` 回應後才會同步 |
| 想知道一個 `status:"failed"` 的 run 為什麼失敗，不想自己翻 sqlite | `run_status`/`run_result`/`run_list`/`GET /api/runs/:id` 在失敗時都帶 `error:{code,message}`（腳本拋錯的原因，或 `SCRIPT_ERROR`/逾時等系統判定），且這個欄位持久化在 `runs` 表自己的 `error` 欄，**重啟引擎後仍讀得到同一個原因**；run 自己的工作目錄下 `journal.jsonl` 也會有一行 `{"type":"error",...}` | 直接呼叫上述任一工具，或看儀表板該 run 的「失敗原因」欄；不需要額外設定 |
| **本機 7B 級 Ollama 模型不會真的觸發工具呼叫**：`agent()` 要求讀檔/寫檔，回傳的內容看起來像結果，但檔案沒真的被寫入/讀到的內容是編造的 | 已知的模型能力上限（非程式碼缺陷）：即使工具清單已縮減到最小，SDK 的工具迴圈對本機 7B 級模型仍不會真正被觸發，模型直接生成一段編造的「工具結果」文字（直接對 Ollama 原生 API 測試排除了模型本身不支援 tool-calling 的可能） | 目前沒有繞過方法；若工作流程依賴 agent 真的讀寫檔案，改用更大的本機模型（例如 32B 級）或已驗證憑證的付費供應商 |
| 續跑（`run_resume`）之後，原本被中止那次呼叫的紀錄一直卡在 `"state":"running"` | 已知的顯示瑕疵：中止的呼叫紀錄不會自己轉成終止狀態，續跑會多出一筆新紀錄 | 純顯示瑕疵，不影響最終 `run_result` 的正確性；可忽略舊的那筆紀錄 |
| 關掉伺服器後還有一個 `litellm --config ...` process 留著 | 正常 `SIGTERM`/`SIGINT` 關機會連帶砍掉內部管理的 `litellm` 子行程；殘留多半是非正常關機（如 `kill -9`）留下的 | 手動 `ps aux \| grep litellm` 找到後 `kill`；也可以用 `litellmPort` 鍵讓每個實例用不同 port，避開多實例誤連風險 |
| Node 啟動就報 SyntaxError / 找不到 `--experimental-transform-types` | Node 版本 < 22.6 | 升級 Node 到 22.6 以上（`node --version` 確認） |
| 服務啟動失敗，log 只有一行 `fatal startup error: Error: litellm proxy failed to spawn: spawn litellm ENOENT` | `gateway:"sdk"` 在**開機階段**就要起一個 `litellm` 代理子行程，而 `PATH` 上沒有 `litellm` 執行檔（常見於 systemd unit 的 `PATH` 沒帶到 venv） | 照 §1a 把 litellm venv 的 `bin/` 加進 `PATH`（systemd 要寫在 unit 的 `Environment=PATH=...`）再啟動；或改成 §1a 的 `gateway:"direct-fetch"` + `useLiteLLMProxy:false` 免 LiteLLM 組合 |
| 服務起得來，但每次 `agent()` 都是 `PROVIDER_UNREACHABLE` | `gateway:"direct-fetch"` + `useLiteLLMProxy:true`，但 `PATH` 上沒有 `litellm`：代理是用到才起，起不來就這一次呼叫失敗（服務本身不受影響、不會中止） | 同上：補 `PATH`，或設 `useLiteLLMProxy:false` 讓 ollama 走原生直連 |
| 手動用 `curl http://0.0.0.0:<port>/api/status` 檢查健康狀態，收到 `403 Forbidden`（不是逾時、不是連不上） | 伺服器的 Host-header 允許清單刻意不把 `0.0.0.0` 當成合法 Host（那是「監聽所有介面」的萬用位址，不是真實可連的目的地名稱）——`RWE_BIND=0.0.0.0` 只影響「監聽哪些介面」，不代表 `0.0.0.0` 本身能當 URL 用 | 改用 `127.0.0.1:<port>` 檢查（`deploy.sh` §0 本身在 `RWE_BIND=0.0.0.0` 時也是這樣做）；要從區網其他主機檢查，用該主機看到的 LAN IP（並確認已列在 §1b `allowedHosts`） |
| `auth.enabled:true` + `bind:"0.0.0.0"`，從**本機**呼叫 `/mcp` 做寫入（`workflow_register`／`workflow_publish`／`workflow_deregister`／`webhook_delete`…），明明帶了有效 bearer 卻回 `PRINCIPAL_REQUIRED`（或角色不足的 `FORBIDDEN_ROLE`） | 這個組合下本機來源走的是 D-BIND 豁免（§1b 部署前提第 3 點），伺服器直接放行、**根本不會去讀你帶的 bearer**，於是這次呼叫沒有身份可用，而寫入類操作在 `auth.enabled:true` 時不接受 `args.principal` 自稱 | 要用 bearer 身份做寫入，就從**非 loopback 來源**呼叫（例如從該主機的 LAN IP 打進去），或把 `bind` 設成 `127.0.0.1`（loopback bind 沒有豁免，bearer 一定會被讀取）；只讀不寫時維持現狀即可 |
| `RWE_BIND=<LAN IP>`（如 §2 systemd 範例的 `192.168.0.125`）部署後，手動用 `curl http://127.0.0.1:<port>/api/status` 檢查，收到 `Connection refused`（連不上，不是 403） | 服務只監聽 `$RWE_BIND` 指定的那個介面；綁定成具體 LAN IP 時，該主機的 `127.0.0.1` 迴環介面根本沒有服務在聽 | 改用 `$RWE_BIND` 本身（例如 `curl http://192.168.0.125:<port>/api/status`）；`deploy.sh` §0 的健康檢查已依 `RWE_BIND` 是否為 `0.0.0.0`/`::` 自動選擇正確目的地，不需要手動判斷 |
| `run_start`/`run_resume` 回 `CONFINEMENT_UNAVAILABLE` | 這台部署開機探測量到 `Bash` 圍籠不可用（見 §1c(e)），且**下列兩件事至少成立一件**：(a) 這次呼叫被判定是「遠端提交」——判斷依據是 socket 的 peer 位址不是 loopback，**或**請求帶了任一 tunnel/forwarded 類 header（`X-Forwarded-For`/`X-Real-IP`/`Forwarded`/`CF-Connecting-IP`，即使 peer 本身是 loopback 也一樣，防止 cloudflared 之類的 tunnel 讓遠端流量偽裝成本機）；(b) **這次要跑的版本是遠端註冊的**（`workflow_describe` 的 `registeredRemote`）——**這一項與呼叫者在哪裡無關,本機呼叫一樣被擋**,因為擋的是腳本的來源,不是連線的來源。錯誤訊息會指名是哪一版。這是刻意設計，不是誤判。（issue #93：這個碼只在送出本身「若非圍籠問題就會被接受」時才出現——工作流程不存在先回 `WORKFLOW_NOT_FOUND`，參數不合法先回 `INVALID_ARGUMENT`，兩者都排在這個碼之前） | (a) 本機（loopback、不帶上述任何 header）呼叫仍會照跑；(b) 在這台主機上重新註冊一次再 publish（§6 的兩個呼叫），或讓這台主機的巢狀 `bwrap --unshare-user` 探測通過——先確認 `bwrap`/`socat` 都已安裝（`sudo apt install bubblewrap socat`，開機 log 的 `reason` 會指名缺哪個），再看是否還需要 AppArmor/sysctl 那一步（完整修法見 §1c(e)），開機 log 會印 `Bash confinement: CONFINED` |
| `POST /hooks/:id` 回 403、body 帶 `CONFINEMENT_UNAVAILABLE`；或 `schedule_list` 某筆的 `lastError.code` 是 `CONFINEMENT_UNAVAILABLE` | 這不是只有 `run_start`/`run_resume` 才會回的碼——同一道圍籠不可用判定也擋 webhook 送達與排程觸發，判斷依據**不是**這次送達/觸發本身的來源，而是 §6 那個聯集：**這個 webhook/schedule 建立時寫下的 `createdRemote`**，**或這次要跑的版本註冊時寫下的 `registeredRemote`**，任一為真就擋。兩個欄位都是建立/註冊當下寫一次、之後不可改寫 | 先分清楚是哪一半：`webhook_list`/`schedule_list` 看 `createdRemote`，`workflow_describe({name})` 看 `registeredRemote`。**版本那一半**——在這台主機上重新 `workflow_register`（把原本的觸發器 id 原樣列進 `triggers[]`）再 `workflow_publish`，webhook 的 id 與 secret 不變（§6 有完整指令）。**觸發器那一半**——沒有改回本機的路徑，只能刪除重建（webhook 連帶換 id 與 secret，排程只換 id），或讓這台主機的巢狀 `bwrap --unshare-user` 探測通過 |
| `run_result`/`run_status` 的某個 agent `detail` 顯示 `WORKROOT_INSIDE_PROJECT: ... is outside workRoot or carries a project marker between the run workspace and workRoot` | 這是**執行期**的同一個檢查，跟 §1b `workRoot` 那一列的**開機期**檢查是同一顆函式（`findProjectMarkerAboveWorkspace`）——多半是 `workRoot` 底下的 `workflows/<name>/` 這一層目錄意外多出一個 `.git`/`CLAUDE.md`（例如手動在 `workRoot` 內跑過 `git init`） | 找到並移除該路徑下多出來的 `.git`/`CLAUDE.md`；引擎自己在**每個 run 自己的工作目錄根**寫的 `.git`（`initGitBaseline`）不受影響，只有「工作目錄與 `workRoot` 之間的祖先層」才會被擋 |

## 6. 維運注意事項 / 已知限制

**目前已知、會影響操作判斷的限制**（每一條都在真機上實測過）：

- **`effort` 對 OpenRouter 模型沒有作用。** 引擎會把 `effort` 換算成 thinking 預算交給 CLI，但這個值
  到不了 OpenRouter：實測攔下真正送出的請求，`low` 與 `high` 兩次的內容完全相同、也沒有
  `reasoning_effort` 欄位（CLI 把預算收斂成 `thinking:{type:"adaptive"}`，LiteLLM 再對 openrouter
  丟掉這個參數）。`run_agent_log` 的 `harness.effortApplied` **會如實回報 `{applied:false, reason:…}`
  並說明原因**。Anthropic 模型的 `effort` 有作用（spawn 出來的 CLI argv 上看得到 `--effort <值>`）。

- **舊部署（升級上來的 workRoot）：`schedules` 資料表會在下次啟動時自動重建，你不必做任何事。**
  `schedules` 在早期版本把 `workflow` 欄位設成「不可為空」（那時觸發器一定綁著工作流程）；自從
  觸發器改成「先建立、再由工作流程認領」之後，`schedule_create` 會寫入 `workflow = NULL`，於是
  升級上來的資料庫會回 `NOT NULL constraint failed: schedules.workflow`，而全新的 workRoot 正常。
  SQLite 不能事後改欄位的可空性，所以引擎改用官方的「重建資料表」做法：**啟動時**檢查
  `PRAGMA table_info(schedules)`，只有在 `workflow` 還是 NOT NULL 時，才在**一個交易裡**建新表、
  逐列複製、drop、rename。**你要做的事：沒有**——升級後正常啟動即可，不需要停機以外的動作、不需要
  跑任何搬移指令、也不需要換 workRoot。**資料**：既有排程（含 `claimedBy`／`createdBy`／
  `refusalCount`／`lastError` 等欄位）與 `run_origins` 全部原封不動搬過去。**中途斷電**：交易沒
  commit，舊表完好，下次啟動再重建一次即可（重建有冪等保護，已經正確的資料庫完全不會被碰）。
  `webhooks` 資料表有同樣的自動重建。

- **圍籠不可用時擋誰：兩個欄位，各寫一次、之後不可變，取聯集。** 這台部署量到 `unconfined`（§1c(e)）時，一次啟動被拒絕的條件是：

  ```
  拒絕 ⟺ 姿態 unconfined ∧ ( 觸發器.createdRemote ∨ 這次要跑的版本.registeredRemote )
                             └ 誰掛上觸發器 ┘        └ 誰註冊了這版腳本 ┘
                             webhook_create /         workflow_register
                             schedule_create 當下      當下寫一次
                             寫一次
  ```

  兩個欄位**都沒有任何程式路徑會事後改寫**（`release()` 只清綁定欄位；版本列本身不可變）。`run_start`／`run_resume`、webhook 送達、排程觸發，以及**執行中的腳本用 `workflow()` 巢狀呼叫子工作流程**，四條路徑讀的是同一個判定。

  **怎麼查目前狀態**：觸發器那一半用 `webhook_list`／`schedule_list` 看每筆的 `createdRemote`；腳本那一半用 `workflow_describe({name})` 看回傳的 `registeredRemote`。**還沒 publish 的版本要帶 `version`**——`workflow_describe({name})` 不帶 `version` 時，對一個尚未發布到任何頻道的版本會回 `CHANNEL_UNPUBLISHED`，不會退回最新註冊的版本；復原流程裡想先確認「哪一版被標記」，寫成 `workflow_describe({name, version:'vN'})`。

  **升級後的既有資料**：兩個欄位都是 `DEFAULT 0`，所以**升級前就存在的每一筆觸發器與每一個既有版本，一律讀成「本機」**——即使它其實是從別的機器建立或註冊的。這是刻意的：升級不會讓這台主機上任何既有工作流程突然停擺。控制從**下一次遠端 `workflow_register`** 開始逐版生效。

  **被擋住之後怎麼復原——兩個呼叫，webhook 的 id 與 secret 全程不變**：

  ```
  在這台主機上執行（從別台機器連進來依定義就算遠端，做這件事沒有用）：
    1. workflow_register({ name, script, mermaid, triggers: [ ...原本那些觸發器 id... ] })
       → 產生新版本，registeredRemote 為本機
       ※ triggers 必須把原本的 id 原樣列回去。漏掉的話該觸發器改由 NOT_IN_RELEASE 被擋，
         症狀不同但一樣不會跑。
    2. workflow_publish({ name, version: '<上一步回傳的版本>', channel: 'release' })
       → 下一次觸發解析到這個乾淨版本
  ```

  **不需要**刪除重建 webhook 或排程，**不需要**換 secret，外部呼叫端不必重新接線。若被擋的原因是觸發器那一半（`createdRemote:true`，亦即這個 webhook／schedule 本身是從遠端建立的），那就沒有「改回本機」的路徑——那筆只能刪除重建（webhook 連帶換 id 與 secret，排程只換 id），或讓這台主機的巢狀 `bwrap --unshare-user` 探測通過。

  **pre-v24「建立時就綁定工作流程」的舊觸發器**（v24 以前 `schedule_create`／`webhook_create` 可以直接帶 `workflow` 參數；這個口子對新呼叫已關閉，帶 `workflow` 一律 `INVALID_ARGUMENT`）**不需要任何額外處置**：它們的 `createdRemote` 多半停在 `0`，但腳本那一半的判定對**每一次**啟動都成立，不管觸發器當初是怎麼綁上去的，所以遠端註冊的腳本照樣擋得下來。


**日誌與狀態位置**：日誌僅 stdout/stderr（`[remote-workflow-engine] ...` 前綴），交給你的
process manager（systemd/pm2/docker）收集；沒有另外寫檔案 log。狀態存在 `$workRoot/store`
（SQLite run 索引 + 具名工作流程註冊表）與 `$workRoot/workflows/<name>/runs/<runId>/`（每次
執行的工作目錄，含 `agent-*.jsonl` transcript 事件檔）。

**Composite 呼叫樹 / 儀表板 / 即時執行細節**：對 in-process（執行中或剛完成）的 composite run，
`run_status`／`GET /api/runs/:id` 回傳呼叫樹資料——每個 agent 記錄帶 `frame`（所在巢狀
frame，頂層 `""`）+ `startedAt`/`endedAt`，`workflowNodes:[{frame,name,parentFrame,depth}]`；
`phases[]` 每項帶 `ts`（進入時間，`running` 時最後一項即目前步驟）。`GET /dashboard` 列出已註冊
工作流程卡片（`GET /api/workflows`）；點卡片進工作流程詳情頁，點某次 run 則畫出泳道圖（底層資料
仍是巢狀 DAG，`GET /api/runs/:id/dag`，含 `lanes`；3 秒輪詢自動更新，未支援 SSE）。
**跨重啟**：run 結束時（`completed`/
`failed`/`stopped`）DAG 快照一次性寫入 `run_snapshots` side table，重啟後 `getRun` 讀回同一棵
巢狀樹（不攤平）；改動前留下、無快照的舊 run 仍以既有方式重建。**尚未支援**：parallel-group
標記（需 sandbox-IPC 改動）、樹的靜態預讀+快取。

**沒有跨觸發串接工具**：40 個工具裡沒有 `chain_*` 這類工具（呼叫會得到 `-32601`），也沒有替代工具。
`continuationDbPath` 設定鍵存在（見 §1b），但沒有任何可呼叫的功能對應到它。要串接多個工作流程，改在腳本裡用 `await workflow(name, args)`
巢狀呼叫（深度/總數由 `maxWorkflowDepth`／`maxWorkflowDescendants` 把關）。

**外部 ingress 安全：Host/Origin 白名單 + webhook 入口**（OIDC/OAuth 之外的過渡管控，永遠開啟、
不需設定）：
- HTTP handler 對每一條路由（`/mcp`、`/api/*`、`/dashboard`、`/hooks/*`）一致把關：外來 `Host`
  （DNS-rebinding）→ 403；帶有且非白名單的 `Origin`（瀏覽器 drive-by CSRF）→ 403；**缺少 `Origin`
  則放行**（fail-open，讓程式化 MCP client 不受影響）——但 dashboard 會改東西的請求（登出、改角色）
  另外**要求**同源 `Origin` 或 `X-Requested-With`。白名單為 loopback + 設定的非 loopback
  `bind` 主機 + `allowedHosts` + 引擎自己的公開網址（`publicBaseUrl`／`auth.issuer`），做真正的
  authority 比對（防前綴繞過）。
- `POST /hooks/:id`（webhook 入口，fail-closed）：驗證順序 id 存在且 enabled →
  `X-RWE-Signature: sha256=<hex>` HMAC-SHA256 常數時間比對（對原始 body bytes）→
  `X-RWE-Timestamp` ±300 秒內 → `X-RWE-Delivery` 去重 → 啟動**預先綁定**的
  工作流程（名稱來自註冊，絕不取自 request body）。`webhook_create` 產生的 secret **只回傳一次**；
  `webhook_list` 只回 sha256 前綴指紋，永不回 secret 本身；註冊表持久化於 `webhookDbPath`。
  **去重重放答的是「原始結果」，不是固定 200**（issue #88 修正）：首次被接受（202+runId）的
  delivery 重放 → 200 `{replayed:true, runId}`；首次被永久拒絕（403 CONFINEMENT_UNAVAILABLE）
  的重放 → 同一個 403，不會變成 2xx；首次是暫時性失敗（503 併發上限／500）則**不佔用**
  deliveryId —— 重試會真的重跑一次，不是回放快取的失敗；併發重複送達（同一 deliveryId 還在
  處理中）得到 503，絕不是 2xx，確保被接受的 delivery 仍是精確一次。UNCLAIMED／
  CLAIMED_WORKFLOW_MISSING／CHANNEL_UNPUBLISHED／NOT_IN_RELEASE 這四種 409 從未佔用
  deliveryId（不變），照樣可在條件修好後重試觸發。**升級前寫入的舊列（legacy row）**：這個
  版本上線之前就已經記錄、資料表尚未存過結果三欄（`httpStatus`/`code`/`runId`）的 delivery，
  重放一律回 200 `{replayed:true}`，即使那次原本其實是被拒絕的——舊資料沒有 outcome 可比對，
  這是遷移後的必然行為，不是把當初的拒絕事後改判為成功。**已記錄的 403 永久生效**：一旦某個
  deliveryId 已經寫下 403 CONFINEMENT_UNAVAILABLE，即使之後造成拒絕的原因修好了（這台主機的
  圍籠探測轉為 confined，或這次要跑的版本改在本機重新註冊），同一個 deliveryId 重放仍然回
  403——admission 只在首次送達時判定一次，之後一律回放已記錄的結果、不重新判定，這是刻意設計
  （見上一段「回放答的是原始結果」）。寄送端要讓已經修好的原因真的生效，必須用一個新的
  deliveryId 重送（等同 redeliver），沿用舊的 deliveryId 永遠只會拿到那次已經定案的 403。
- **`auth.enabled:false`（預設）且公開 `0.0.0.0` bind 時，任何能連到該 port 的人都能呼叫這些
  工具**——白名單只是無 auth 時的過渡管控；要多租戶存取管制請啟用 §1b 的 `auth` 區塊。
- **`webhook_create` 回傳的 `url` 是這個 process 自己的 bind 位址／request `Host` 表頭組出來
  的**（issue #97）：部署在 cloudflared/nginx 之類反向代理或隧道後面時，這個值對外可能是不可達
  的 `http://localhost:8899/hooks/<id>` 這類網址——遠端寄送端打這個 URL 只會拿到代理層的
  404/連線失敗，永遠到不了引擎。修法：在 `rwe.config.json` 明白設定 `publicBaseUrl`（見
  §1b），設了以後 `webhook_create` 回傳的 `url` 一律以它為 base；沒設但 `auth.enabled:true`
  時自動退回 `auth.issuer`（同一顆對外身分沒有理由分開宣告兩次）；兩者都沒設才退回舊行為的
  bind/request 推導值。**只影響 `webhook_create` 的 `url`**——OAuth AS metadata（`.well-known/*`）
  本來就讀 `auth.issuer`，不受這個鍵影響；dashboard 連結一律是相對路徑（瀏覽器本身打的是使用者
  已經連上的那個 host），同樣不受影響。

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

結構圖由作者附上、**註冊時**引擎不畫圖(渲染發生在第一次瀏覽,見 §1a):`workflow_register` 必須
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

**未驗證的真實依賴**：付費供應商（Anthropic/OpenRouter）需要一組 sandbox/test key 才能驗證
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
                                          服務繼續在上一個版本上執行
```

### 步驟一：GitHub Webhook 設定

在 GitHub repo 的 **Settings → Webhooks → Add webhook** 頁面：

| 欄位 | 值 |
|------|----|
| **Payload URL** | `https://your-domain/github/webhook`（見步驟二反向代理） |
| **Content type** | **`application/json`**（⚠ HIGH：必須選此項——form-encoded body 雖然 HMAC 驗過，但 JSON parse 會失敗導致 tag 無法提取，等同靜默 no-op；絕對不要用預設的 `application/x-www-form-urlencoded`） |
| **Secret** | 隨機高熵字串（建議 32+ bytes hex），記下來（稍後設入環境變數） |
| **Which events would you like to trigger this webhook?** | 選 **Let me select individual events**，**只勾 Releases**（`release` 事件）。引擎確實也認得 `create`/`push` 兩種事件（tag 建立/推送），但自我更新現在刻意綁在 **`release` 事件的 `action:"published"`**（且非 prerelease）——這是為了讓流程嚴格照順序走：**tag 推送 → Release CI 重跑 typecheck+完整測試 → 綠燈才發布 Release → Release published 才觸發自我更新**，`create`/`push` 是 tag 一推上去就送達，會搶在 CI 跑完之前武裝自我更新，讓建置/測試還沒過的版本就被部署。不要多勾 **Branch or tag creation**／**Pushes**（舊設計留下的事件，見 `src/self-update-webhook.ts` 的 `extractTag()` 註解） |
| **Active** | ✓ |

### 步驟二：反向代理（只轉發 webhook 路由）

引擎實際綁定哪個介面由 unit 的 `RWE_BIND` 決定（見 §2「無 root 部署」的範本表格）：`127.0.0.1`
（loopback）時所有外部流量都要靠這裡的反向代理轉入；`0.0.0.0`（`deploy/rwe.user.service` 範本現在
的預設值，跟這台專案 production 主機一致）時區網可以直接連到，**但仍然只有反向代理/隧道白名單
轉發的路徑才應該視為對外開放**——`0.0.0.0` 不代表不需要下面這層轉發規則，只是同網段的人不必經過
它就摸得到整個 `/mcp`／dashboard／`/api/*`，這正是要盡量收斂到 `127.0.0.1`（或至少防火牆擋掉區網）
的理由。下面這個 nginx 範例只轉發 `POST /github/webhook`——這一節單純為了自我更新的 webhook，其餘
路由不透過它對外；production 實際用的是 cloudflared 隧道，白名單轉發的路徑不只 webhook 一條，完整
清單見 §7 第 8 點：

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

> **旗標檔本身的路徑被 shipped 的 `deploy/rwe-update.path` 寫死，不能任意搬動。** 該 unit 用
> `PathExists=%h/rwe-update.flag` / `PathChanged=%h/rwe-update.flag`（`%h` 是 systemd
> specifier，展開成這個使用者的家目錄）——`.path` unit 沒有 `Environment=`/`EnvironmentFile=`
> 可以替換任意路徑，所以旗標檔**只能**放在 `$HOME/rwe-update.flag`；除非你自己改
> `~/.config/systemd/user/rwe-update.path` 裡的這兩行，`rwe.config.json` 的 `updateFlagPath`
> 就必須跟這裡完全一致，否則引擎寫了旗標、`.path` unit 卻永遠看不到，自我更新形同沒接上。
> 結果檔／鎖檔沒有這個限制，建議放進一個引擎使用者可讀寫、其餘人不可讀的目錄（`0700`，且
> **不在任何 `workRoot` 下**，否則啟動時報 `UPDATE_FLAG_INSIDE_WORKROOT`）：

```bash
mkdir -p ~/.local/share/rwe-update
chmod 0700 ~/.local/share/rwe-update
```

### 步驟四：設定環境變數與 rwe.config.json

在 `~/.config/rwe.env`（已被 systemd unit 的 `EnvironmentFile=` 讀入）加入：

```bash
RWE_SECRET_GITHUB_WEBHOOK_SECRET=<你在 GitHub 設的 Secret>
```

在 `rwe.config.json` 加入（旗標路徑固定是 `$HOME/rwe-update.flag`，理由見上方步驟三；結果檔可以放進步驟三建立的目錄）：

```json
{
  "updateFlagPath":   "/home/<user>/rwe-update.flag",
  "updateResultPath": "/home/<user>/.local/share/rwe-update/result.json"
}
```

（`selfUpdateDbPath` 省略即用預設 `$workRoot/self-update.db`。）

> **重啟前的設定檢查。** 若 `rwe-update.sh` 執行時的環境變數帶了
> `RWE_CONFIG_PATH`（指向這台機器實際要用的 `rwe.config.json`——範本 `deploy/rwe-update.service`
> 已經內建一行 `Environment=RWE_CONFIG_PATH=%h/Documents/remote-workflow/rwe.config.json`，
> `%h` 會展開成這個 user instance 的家目錄，跟 `RWE_UPDATE_FLAG` 等變數同一個機制，clone
> 不在這個慣例路徑下要改成實際路徑），
> `deploy/rwe-update.sh` 會在 `npm test` 綠燈之後、真正 `systemctl restart` 之前，額外跑一次
> `npm run check-config`——用**同一條** `composeConfig()` 翻譯路徑驗證設定值（例如 `principals` 裡
> 是否有無效的 role 值），但完全不 spawn litellm、不綁 port。驗證失敗會跟建置/測試失敗一樣安全
> 失敗（退回前一個 SHA，不重啟），並把 `configCheck:"failed"` 寫進結果檔；沒設 `RWE_CONFIG_PATH` 則記
> `configCheck:"skipped"`（不是靜默略過——面板上看得到）。也可以手動跑一次同一個檢查：
> `RWE_CONFIG_PATH=<path> npm run check-config`（離線用，不用真的觸發更新）。

### 步驟五：安裝特權更新 systemd 單元

> 特權 helper（`deploy/rwe-update.sh`）負責 git checkout + build + restart，須以有 `systemctl restart rwe` 權限的使用者執行。對 systemd user service 部署，`rwe-update.service` 作為 user service 即可（user service 可 `systemctl --user restart` 自己的服務）。

> **`deploy/rwe-update.path`／`deploy/rwe-update.service` 兩份範本現在都是 user-service 形狀**
> （`Environment=` 直接內建六個值，沒有 `EnvironmentFile=`／`/opt`／`/etc/rwe/` 這些 root 安裝路徑
> 才用得到的東西；`%h` 是 systemd 自己的 specifier，會展開成這個 user instance 的家目錄）——只要
> clone 在 `%h/Documents/remote-workflow` 這個慣例路徑下，複製過去就能直接跑，不必再手動編輯：

```bash
install -D -m 644 deploy/rwe-update.path ~/.config/systemd/user/rwe-update.path
install -D -m 644 deploy/rwe-update.service ~/.config/systemd/user/rwe-update.service
install -D -m 755 deploy/systemctl-user ~/.local/share/rwe-update/systemctl-user   # SYSTEMCTL= 指到這裡
mkdir -p ~/.local/share/rwe-update && chmod 0700 ~/.local/share/rwe-update         # 若步驟三還沒建過

systemctl --user daemon-reload
systemctl --user enable rwe-update.path  # 讓 .path 在登入後自動監看
```

**clone 不在 `%h/Documents/remote-workflow` 這個慣例路徑下**，或要部署自己的 fork，才需要手動改
複製出來的 `~/.config/systemd/user/rwe-update.service`（不要動 repo 裡的範本）：
- `WorkingDirectory=`／`ExecStart=`／`RWE_CONFIG_PATH=` 裡的 repo 路徑——改成實際 clone 位置
- `RWE_OFFICIAL_REMOTE=`——部署自己的 fork 才需要換成該 fork 的遠端 URL
- `PATH=`——範本預設 `%h/.local/bin:...`；node/npm 若只裝在別的目錄（例如版本管理器的
  `~/.local/node/bin`，見 `deploy/rwe.user.service`）要把該目錄一併加進來，否則
  `npm ci && npm run build` 找不到 npm
- `RWE_UPDATE_FLAG=` 必須跟 `rwe.config.json` 的 `updateFlagPath` 完全一致（見上方步驟三）
- 選用：省略 `RWE_CONFIG_PATH=` 這一行則 configCheck 記 `skipped`（見上方「重啟前的設定檢查」）
- `RWE_CONFIG_ENV_FILE=`（範本預設 `%h/.config/rwe.env`）：`rwe.config.json` 用了 `${secret:NAME}`
  時，check-config 需要那些值——helper 只把這個檔裡 `RWE_SECRET_*` 開頭的行、只在 check-config 那一步
  匯出（`npm ci`／`npm test` 看不到）。沒有這一行（舊的已安裝單元）又用了 handle，每次更新都會在
  check-config 安全失敗、記 `configCheck:"failed"`

`deploy/rwe-update.path` 使用 `PathExists=` + `PathChanged=`（**不**用 `PathModified=`，避免
只修改 metadata 的 rename 不觸發）監看旗標檔出現。`deploy/rwe-update.service` 為 `Type=oneshot`。

### 可觀測性

```bash
# 觀察最後一次更新的結果
curl -s http://localhost:8787/api/status | jq .lastUpdate
# 範例輸出（已 apply）：
# { "tag": "v1.5.0", "status": "applied", "ts": "2026-08-09T12:34:56Z", "configCheck": "passed" }
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

## §6c 以獨立系統使用者執行（建議）

> 一句話：引擎不要跟你自己的登入帳號共用同一個 uid。§2「無 root 部署」與 §6b 的 user-mode
> 範本可以直接跑在任何帳號底下——這一節是把它們搬到一個**專用、無登入、無 sudo 的系統使用者**
> （以下用 `rwe`，家目錄 `/home/rwe`）底下，並附一支分階段腳本
> `deploy/migrate-to-service-user.sh` 把「正在操作員帳號底下跑的 production」原地搬過去。
> 全新主機也適用：跳過第五階段（沒有舊資料要搬）即可。

### 為什麼

- **CLI 一定會把引擎 HOME 底下的 `~/.claude/debug/`、`~/.npm/_logs/` 以可寫方式 bind 進每個 agent
  sandbox**（只要它們存在；CLI/sandbox-runtime 寫死 `os.homedir()`，設定蓋不掉，見 §1c(f)）。CLI 的
  暫存目錄已經改成每次派工各一份、主機共用的 `/tmp/claude-<uid>` 也已 `denyRead`，但這兩處還在：引擎
  跟操作員同 uid 時，`~/.claude/debug/` 就是**操作員自己互動式 Claude Code 的 debug log**。換成獨立
  帳號後，這兩個目錄屬於 `rwe`、裡面沒有操作員的東西；腳本再把它們刪掉（`phase6`），並讓 `rwe` 的
  npm log 改寫到 `~/.cache/npm-logs`（`phase2` 寫 `~/.npmrc` 的 `logs-dir`），就連 run 之間的傳遞
  通道也一併關掉。
- **同 uid = 最後一道牆不存在。** 主機一旦量到 `Bash confinement: UNCONFINED`（AppArmor 擋住
  userns，見 §1c(e)），或 confinement 規則有任何遺漏，agent 能讀到的就是操作員讀得到的一切：
  `~/.config/rwe.env`、`~/.cloudflared/` 隧道憑證、SSH 金鑰、其他專案的原始碼。換成獨立 uid 後，
  這些檔案由 kernel 的檔案權限（`/home/<operator>` 為 750、`/tmp/claude-<uid>` 為 700）擋住，
  跟 sandbox 有沒有生效無關。
- 副作用是好的：引擎的 git checkout、workRoot、LiteLLM venv、自我更新全部變成 `rwe` 的私有物，
  操作員日常的 `git`/`npm`/Claude Code 工作不會再跟 production 的檔案混在一起。

### 前提與這支腳本做的假設

- 以**操作員帳號**執行（不是 root；腳本自己會在需要的步驟呼叫 `sudo`，service user 擁有的東西
  一律經 `sudo -u rwe -H` 建立）。操作員需要 sudo 權限；`rwe` 本身**沒有**。
- 舊部署是 §2/§6b 的 user-mode 形狀：`~/.config/systemd/user/rwe.service`（含
  `rwe.service.d/override.conf`）、`rwe-update.path`／`rwe-update.service`、`~/.config/rwe.env`、
  checkout 停在某個 release tag 上。
- 操作員家目錄必須是 `750`（或更嚴）：Ubuntu 21.04 起的新帳號預設如此，較舊的安裝常是 `755`——
  先 `stat -c %a ~`，不是的話 `chmod 750 ~`，否則 `rwe` 讀得到它，`phase7` 的隔離檢查會照設計失敗。
- `phase7` 要求 `Bash confinement: CONFINED`，這取決於主機本身能不能讓非特權使用者建立 user
  namespace（AppArmor 設定是全主機的，跟帳號無關）；量到 `UNCONFINED` 時先照 §1c(e) 處理。
- 主機專屬值全部是環境變數、預設值從舊部署推導，另一台伺服器照需要覆寫即可（完整清單見腳本開頭）：

| 變數 | 預設 | 說明 |
|------|------|------|
| `RWE_USER`／`RWE_HOME` | `rwe`／`/home/rwe` | 服務帳號與其家目錄 |
| `RWE_CHECKOUT` | `$RWE_HOME/remote-workflow` | 服務帳號的 git checkout（單元範本的 `%h/Documents/remote-workflow` 會被改寫成這裡） |
| `RWE_WORKROOT` | `$RWE_HOME/.local/share/rwe-data` | 新 workRoot（圍籠生效＋sdk gateway 時長度不可超過 56 bytes，否則開機回 `CLI_SCRATCH_PATH_TOO_LONG`，見 §1c(f)） |
| `OP_CHECKOUT` | `$HOME/Documents/remote-workflow` | 舊部署的 checkout（讀它的 `rwe.config.json`、`git describe --tags`、`origin` URL） |
| `OP_ENV`／`OP_NODE_DIR`／`OP_UV` | `~/.config/rwe.env`／`~/.local/node`／`command -v uv` | 要複製過去的 secrets 檔、node 安裝、uv 執行檔 |
| `RWE_PORT_VALUE` | 讀舊的 `override.conf`，沒有就 `8787` | 新單元的 `RWE_PORT`；保持不變，隧道／反向代理就不用改 |
| `REPO_SSH` | 由 `origin` 的 `https://github.com/<owner>/<repo>.git` 推導成 `git@github.com:<owner>/<repo>.git` | 服務帳號 clone／自我更新用的 SSH remote |
| `DEPLOY_TAG` | `git -C $OP_CHECKOUT describe --tags --exact-match` | 服務帳號要 checkout 的 tag（舊 checkout 不在 tag 上時必須手動給） |

### 用法

```bash
deploy/migrate-to-service-user.sh --dry-run <phase>   # 印出每一條指令，不執行、不需要 sudo
deploy/migrate-to-service-user.sh <phase>             # 真的執行；每條指令執行前都先印出（+ ...）
```

每個階段都可以重跑（已完成的步驟會被偵測並略過）。**先把每個階段都 `--dry-run` 一次**，確認推導
出來的路徑、tag、remote、port 都對，再依序真正執行：

| 階段 | 做什麼 | 停機？ |
|------|--------|--------|
| `phase1` | `useradd --system --user-group --create-home --home-dir /home/rwe --shell /usr/sbin/nologin rwe`（不加入 sudo／操作員群組，腳本會檢查）、`chmod 750 /home/rwe`、`loginctl enable-linger rwe`，並等 `user@<uid>.service` 起來 | 否 |
| `phase2` | 工具鏈：把操作員的 `~/.local/node` 整份 `cp -a` 過去（官方 tarball 可搬移，版本保證一致，不需要下載；複製後比對 `node -v`）、`~/.local/bin/{node,npm,npx}` symlink、`~/.npmrc` 的 `logs-dir=~/.cache/npm-logs`（npm log 不落在會被 bind 進 sandbox 的 `~/.npm/_logs`）、複製 `uv` 單一執行檔，再以 `rwe` 身分 `uv python install 3.12` + `uv venv` + `uv pip install "litellm[proxy]==<舊 venv 的同一版>"`（**不複製**舊 venv：它的 `pyvenv.cfg` 指向操作員家目錄裡的直譯器，`rwe` 讀不到）。需要對外網路 | 否 |
| `phase3` | 產生 `rwe` 的 ed25519 deploy key（`/home/rwe/.ssh/id_ed25519`，600），印出**公鑰**後停下來——見下方「GitHub deploy key」 | 否 |
| `phase3b` | 釘住 github.com 的 host key（`ssh-keyscan` 的指紋必須同時等於 `https://api.github.com/meta` 公布的值與腳本內建的值，否則中止）、確認 deploy key 讀得到 repo、以 SSH clone 到 `$RWE_CHECKOUT`、checkout 舊部署正在跑的同一個 tag（比對 commit）、`npm ci` | 否 |
| `phase4` | 設定與 secrets：`rwe.env` 逐位元組複製到 `/home/rwe/.config/rwe.env`（600，從不印出內容，只列鍵名）；把舊 `rwe.config.json` 複製成 `$RWE_CHECKOUT/rwe.config.json`（600、owner `rwe`），改寫 `workRoot`／`updateFlagPath`／`updateResultPath` 三個路徑（其他值若仍指向舊家目錄會列出鍵名警告），並把 `auth.googleClientSecret` 換成 `${secret:GOOGLE_CLIENT_SECRET}`、值寫進 `rwe.env` 的 `RWE_SECRET_GOOGLE_CLIENT_SECRET`（新輪替的值或原本的明碼值，見下方）；最後以 `rwe` 身分、帶著 `rwe.env` 的 `RWE_SECRET_*` 跑 `npm run check-config`——handle 解不開就在停機前失敗 | 否 |
| `phase5` | **停機開始**：停掉操作員的 `rwe.service`／`rwe-update.path`（等進行中的自我更新跑完）、`cp -a` 整棵 workRoot 到 `$RWE_WORKROOT`、`chown -R rwe:rwe`、`chmod 700`。**原始資料原封不動**（rollback 用）。目的地已存在就拒絕（避免蓋掉 `rwe` 已寫入的新資料），`--force` 會先把它改名成 `.bak-<時間戳>` | **是** |
| `phase6` | 刪掉 `rwe` 的 `~/.npm/_logs`、`~/.claude/debug`（見「為什麼」），安裝 `rwe` 的 systemd user 單元（`rwe.user.service`→`rwe.service`、`override.conf`、`rwe-update.service`、`rwe-update.path`，repo 路徑與 `RWE_OFFICIAL_REMOTE` 會被改寫）、`systemctl-user` wrapper 與 0700 的 `~/.local/share/rwe-update/`（順便帶過舊的 `result.json`）、確認 port 已空出、`daemon-reload` + `enable --now`；接著 `disable`（**不刪除**）操作員的單元，等 `/api/version` 回應。**停機到此結束** | 結束 |
| `phase7` | 驗證（見下方），任何一項失敗就以非零結束並提示 rollback | 否 |
| `rollback` | 停用 `rwe` 的單元、重新 `enable --now` 操作員的單元 | 短暫 |

停機時間 ≈ `phase5` 的複製時間 + 引擎開機時間（這台主機 workRoot 約 60 MB，秒級）。`phase1`～`phase4`
可以提前一天做完，只有 `phase5`→`phase6` 需要排維護窗口。

### GitHub deploy key（`phase3` 與 `phase3b` 之間，手動）

repo 是 private 時 `rwe` 需要自己的讀取憑證——**不要**把操作員的 SSH key 或 token 給它。

1. `phase3` 印出的那一行 `ssh-ed25519 AAAA… rwe@<host> …` 是公鑰，可以安全貼出。
2. GitHub → repo **Settings → Deploy keys → Add deploy key**：Title 填 `rwe@<host>`，Key 貼上。
3. **不要勾「Allow write access」**——引擎只會 `ls-remote`／`fetch` tag。
4. 執行 `phase3b`。

`rwe-update.sh` 本身不需要修改：它只是把 `RWE_OFFICIAL_REMOTE` 原樣交給 `git ls-remote --tags`
與 `git fetch --tags`，scp 形式的 `git@github.com:<owner>/<repo>.git` 一樣可用（`phase6` 把單元裡
的這一行改寫成 SSH 形式；`tests/integration/rwe-update-ssh-remote.test.ts` 釘住這個行為）。注意
helper 會吞掉 `ls-remote` 的 stderr：**自我更新之後若一直記 exit 20（tag 解析失敗），第一個要查的
就是 SSH**——`sudo -u rwe -H ssh -T git@github.com`（應回 `successfully authenticated`）、
`/home/rwe/.ssh/known_hosts` 是否還有 github.com、deploy key 是否被刪。

### Secret 輪替

- **`rwe.env`** 整份搬過去，值不經過終端機。搬完順便刪掉不用的殘留鍵（見 §7 第 4 點）。
  若懷疑舊 uid 底下的 agent 讀過這些值（同 uid 期間 agent 在 UNCONFINED 主機上跑過），趁搬家
  逐一到各供應商輪替，改完 `sudo -u rwe -H sh -c 'umask 077; cat > ~/.config/rwe.env'`
  重新寫入後 `rwectl restart rwe.service`。
- **Google OAuth client secret（`auth.googleClientSecret`）不再明碼留在設定檔**：`phase4` 一律把它
  改成 `${secret:GOOGLE_CLIENT_SECRET}`（名稱可用 `GOOGLE_SECRET_NAME` 改），值放進 `rwe` 的
  `rwe.env`（`RWE_SECRET_GOOGLE_CLIENT_SECRET=…`，600）。引擎開機時解析，找不到就拒絕開機並指名缺的
  變數（見 §1b）。`phase4` 會問一次新值：
  - **要輪替**：先到 Google Cloud Console → Credentials → 該 OAuth client → **Add secret**（同一個
    client 可同時有兩個有效 secret），在提示下貼上（`read -s`，不顯示；只經 stdin 寫進檔案，不進
    argv／環境變數／暫存檔）→ `phase7` 全綠、實際走一次 OAuth 登入之後，回 Console **停用舊 secret**。
  - **不輪替**：直接按 Enter，原本設定檔裡的明碼值會被搬進 `rwe.env`（同樣不經過終端機）。
  這需要 `rwe` checkout 的那個 tag 已包含 auth handle 解析——舊版引擎會把字面 handle 送給 Google，
  所以 `phase4` 先檢查，不支援就中止並請你以較新的 `DEPLOY_TAG` 重跑 `phase3b`。自我更新的
  check-config 透過 `rwe-update.service` 的 `RWE_CONFIG_ENV_FILE`（`phase6` 裝的範本已帶）拿到這個值。

### 驗證（`phase7`）

- 引擎行程（`MainPID`）的擁有者是 `rwe`。
- 開機 log 有 `Bash confinement: CONFINED` 與 `listening on http://…:<RWE_PORT>/mcp`。
- `curl http://127.0.0.1:<RWE_PORT>/api/version` 帶著 `(<DEPLOY_TAG>)`。
- 以 `rwe` 身分在它的 checkout 跑 `scripts/smoke.sh`（port `SMOKE_PORT`，預設 8799）→ PASS。
- `auth.issuer` 有設時：`POST <issuer>/mcp`（不帶 token）→ `401` 且 `WWW-Authenticate` 帶 `scope=`。
- `rwe` **讀不到** 操作員家目錄、操作員的 `rwe.env`／`rwe.config.json`、`/tmp/claude-<操作員 uid>`。
- `rwe` 以 SSH `git ls-remote` 讀得到部署中的 tag（自我更新的前提）、`rwe-update.path` 是 active。
- 操作員的 `rwe.service` 已 disabled；`rwe` 的 `~/.npm/_logs`、`~/.claude/debug` 不存在。

之後照 §7 第 13 點最後一項，打一個測試 tag 走完一次完整自我更新鏈（`rwectl update-result` 應記
`"status":"applied"`）——第一次在 `rwe` 底下跑的 `npm test` 就是在這時候，出問題會 safe-fail、
服務留在原版本。

### Rollback

`deploy/migrate-to-service-user.sh rollback`：停用 `rwe` 的單元、重新啟用操作員的單元，引擎回到
`phase5` 當下的舊 workRoot。**`rwe` 在切換後寫入的資料**（新 run、新註冊的 workflow）留在
`/home/rwe/.local/share/rwe-data`，不會自動合併回去。兩邊都不刪任何東西：確定不回頭後，再自行刪除
操作員那份舊 workRoot、舊 `rwe.env`、舊 checkout（它們仍含 secrets）。

### Day-2：`deploy/rwectl`

`rwe` 沒有登入 session，`systemctl --user` 要指到它的 runtime dir 與 bus。`deploy/rwectl` 包好了
（以操作員身分執行，內部用 sudo）：

```bash
deploy/rwectl status                    # = sudo -u rwe XDG_RUNTIME_DIR=/run/user/<uid> … systemctl --user status rwe.service
deploy/rwectl restart                   # restart/status/stop/start/is-active/enable/disable 沒帶 unit 時預設 rwe.service
deploy/rwectl restart rwe.service       # 其餘 systemctl 動詞（或帶了 unit）都直接轉交
deploy/rwectl cat rwe.service           # 套用後的完整 unit（含 drop-in）
deploy/rwectl logs -f                   # rwe.service 的 journal（額外參數交給 journalctl）
deploy/rwectl logs-update -n 50         # 自我更新（rwe-update.service）的 journal
deploy/rwectl update-result             # 最後一次自我更新的 result.json
```

改設定：`sudo -u rwe -H "${EDITOR:-nano}" /home/rwe/remote-workflow/rwe.config.json`（或
`sudoedit`），改完 `deploy/rwectl restart rwe.service`。以 `rwe` 身分跑一次性指令一律用
`sudo -u rwe -H <cmd>`（它的 shell 是 nologin，`sudo -iu rwe` 進不去是刻意的）。

### 實際搬遷紀錄與注意事項

2026-09-29 這台主機照上面的階段表把 production 搬到獨立系統使用者（`rwe`，uid 997）底下：
`phase1`～`phase7` 全部做完，自我更新在 `rwe` 底下端對端驗證過兩次（v0.28.2、v0.28.3）。以下是
實際搬遷過程中踩到、值得留給下一次（換一台主機、或另一個人重做）的東西；跟上面規格性的階段表不
重複，只記「當時發生了什麼、怎麼查、怎麼修」。

**a. 測試套件必須能在不同 uid 底下跑**——`phase7` 之後的第一次自我更新，`deploy/rwe-update.sh`
在 apply 前用 `npm test` 當作 gate，而這是**第一次**以 `rwe`（而非平常互動式操作的 uid）身分跑
這個套件。跑出來 92 個測試以 `SQLITE_READONLY_DIRECTORY` 失敗：根因是不少測試（或它們間接命中
的 src 預設值，例如 `RunManager` 的 `workRoot` fallback）用 `join(os.tmpdir(), '<固定字面量>')`
拼路徑，這個固定名字的目錄/檔案一旦被某個 uid 先建立、換另一個 uid 再跑就撞權限——不是邏輯
bug，是共用 `/tmp` 的撞名。v0.28.2 用「每個 worker 一份私有 `TMPDIR`」修掉
（`tests/setup/tmp-root.ts`，vitest `setupFiles` 全域跑一次，把 `os.tmpdir()` 重新指向
`mkdtempSync` 出來的私有根目錄，並轉發同樣的環境變數給子行程）。**當時失敗是安全的失敗**：
`rwe-update.sh` 的 gate 擋下，服務留在舊版本，沒有半啟動或部分套用——這正是設計要的行為，不是
需要恐慌的事，只是需要修好 gate 本身才能讓自我更新真的往前走。下次在新主機第一次以服務帳號跑
`npm test` 之前，先確認 checkout 的 tag ≥ v0.28.2。

**b. 搬遷前後都要找殘留的舊行程**——換帳號不會自動殺掉操作員帳號底下還在跑的舊 engine／LiteLLM
子行程（例如搬遷途中重跑過 `deploy.sh` 測試、或之前手動啟動過一次忘記關）。這些舊行程的環境變數
裡仍帶著操作員的 secrets，而且如果是 v0.28.1 之前的 LiteLLM（見下一點）還可能把代理曝露在區網。
搬遷前後都跑一次：

```bash
ps -eo user,pid,lstart,args | grep -E 'src/main.ts|litellm' | grep -v grep
```

看到操作員 uid 底下的舊行程就 `kill` 掉；`phase5` 停機那一步只停 systemd 管理的 unit，管不到手動
啟動、脫離 unit 的行程。

**c. LiteLLM proxy 的 bind——v0.28.1 之前的版本檢查**：`v0.28.1` 之前，`LiteLLMProxyManager`
起 `litellm --config <cfg> --port <port>` 沒帶 `--host`，LiteLLM 自己的 CLI 在這個情況下預設綁
`0.0.0.0`，而且產生的設定檔沒有 master key——等於區網任何人都能打這個 proxy、借用裡面所有供應商
的 key，完全不需要驗證。`v0.28.1` 修成固定帶 `--host 127.0.0.1`（`litellm-proxy-hardening.test.ts`
釘住 spawn 參數、`litellm-proxy-host-binding-real.test.ts` 是真行程的驗證）。搬遷或升級後怎麼查：

```bash
ss -ltn | grep <litellmPort>            # 應該只看到 127.0.0.1:<port>，不是 0.0.0.0:<port>
curl -m 3 http://<這台的LAN IP>:<litellmPort>/health/liveliness   # 應該連不上（timeout/refused）
```

只要 checkout 的 tag ≥ v0.28.1 就沒有這個問題；這裡留著是因為搬遷當下的舊 checkout 版本不一定
比 v0.28.1 新，值得在搬遷時順手確認一次。

**d. Google OAuth client secret 輪替——這次實際走過的坑**：Google 的 client secret 是 35 個字元、
固定以 `GOCSPX-` 開頭。貼上前先檢查長度／字首（`printf '%s' "$secret" | wc -c` 應為 35，
`case $secret in GOCSPX-*) ;; *) echo "wrong prefix";; esac`）——這次有一次貼上時不小心貼了兩遍，
貼出 66 個字元，若沒先做這個檢查會直接寫進 `rwe.env` 再花時間查「secret 為什麼被拒」。另一個
容易錯的地方是 Google Cloud Console 的 **Credentials 頁可能列著不只一個 OAuth client**：新
secret 要加在 client ID 前綴（`....apps.googleusercontent.com` 前面那串數字）跟
`auth.googleClientId`、redirect URI（`<issuer>/oauth/google/callback`）都吻合的那一個，不是
清單裡隨便一個「看起來像」的 client——加錯 client，Google 回的是 `invalid_client`，症狀跟真的
打錯 secret 一模一樣，光看回應分不出來，要回 Console 核對 client ID。新 secret 加進 Google 後
**不會立刻生效**，實測要等一段時間（分鐘到數小時不等）才會被接受。

驗證一個新 secret 有沒有被 Google 接受，不需要真的跑一次瀏覽器登入：直接打 Google 的 token
endpoint、code 故意給假的——`invalid_grant`（code 有問題）代表 **secret 被接受**；
`invalid_client`（secret／client 有問題）代表 **secret 被拒**。安全指令（以 `rwe` 身分、
secret 只經由 stdin 給 curl 的 `client_secret@-`，never 出現在 argv 或終端輸出）：

```bash
sudo -u rwe -H sh -c '
  set -a; . "$HOME/.config/rwe.env"; set +a   # 帶進 RWE_SECRET_GOOGLE_CLIENT_SECRET
  # auth.googleClientId 通常是明碼字串；若也被换成 ${secret:NAME} handle，改讀對應的
  # RWE_SECRET_<NAME>（跟 googleClientSecret 用的是同一套解析，見 src/main.ts resolveAuthSecrets）
  client_id=$(python3 -c "import json;print(json.load(open(\"$HOME/remote-workflow/rwe.config.json\"))[\"auth\"][\"googleClientId\"])")
  printf %s "$RWE_SECRET_GOOGLE_CLIENT_SECRET" | curl -s -X POST https://oauth2.googleapis.com/token \
    --data-urlencode "client_id=$client_id" \
    --data-urlencode "code=bogus-code-never-issued" \
    --data-urlencode "redirect_uri=<issuer>/oauth/google/callback" \
    --data-urlencode "grant_type=authorization_code" \
    --data-urlencode "client_secret@-"
'
# 期望：{"error":"invalid_grant", ...}   → secret 被接受（code 本來就是假的，被拒是預期）
#       {"error":"invalid_client", ...}  → secret／client 被拒，回 Console 核對
```

引擎只在**啟動時**讀一次 `rwe.env`，改完 secret 一定要 `rwectl restart rwe.service` 才生效——
單改設定檔或 `rwe.env` 不會讓正在跑的行程重新讀取。`v0.28.3` 起，callback 本身也會記
`[auth.google_token] {status, error}`（`src/auth/auth-service.ts`），不用等到下次自我更新
的 gate，真的用瀏覽器登入一次失敗時就能直接 `deploy/rwectl logs -n 50` 看到是 Google 拒絕
（`google_rejected` / `invalid_client`）還是別的原因（`network_error`／`no_id_token`）。
輪替時**先**在 Google Console 把新 secret 加上去、驗證通過、**用瀏覽器真的登入成功一次**，
才停用舊 secret——舊 secret 停用前，兩把 key 應該同時有效，切換視窗才不會中斷別人正在用的登入。

**e. `sudo` 必須是操作員在真的終端機打，不能自動化跑**——這支腳本要求互動式 `sudo`（密碼或
NOPASSWD 規則），在沒有 TTY 的自動化環境（例如這次是透過一個沒有終端機的 agent 執行環境）裡
`sudo -n` 會直接因為 "interactive authentication is required" 失敗。這次每個 phase 都是操作員
自己手動在真終端機貼指令跑的，不是腳本自動串接。建議每個 phase 的輸出都 `tee` 進一份 log
（例如 `deploy/migrate-to-service-user.sh phase5 2>&1 | tee -a ~/migrate-phase5.log`），停機
窗口短，事後回頭查「當時到底印了什麼」比重跑一次（尤其是 `phase5` 這種會動資料的階段）安全。

**f. 搬完之後，操作員原本的 checkout 只是一份開發用副本**——`phase6` 之後自我更新只會動
`rwe` 的 `$RWE_CHECKOUT`，操作員帳號底下原本的 `~/Documents/remote-workflow`（連同它的
`rwe.env`、`rwe.config.json`）不會再被自我更新碰、也不會再啟動任何服務，但檔案本身、裡面的
secrets 都還在，不會自動清掉（保留給 rollback 用）。確認不會回頭（真的走過至少一次成功的自我
更新、`phase7` 全綠一段時間）之後，記得刪掉：操作員舊的 workRoot、舊 `rwe.env`、舊 checkout
的 `rwe.config.json`——它們仍是明碼 secrets，留著就是攻擊面。

**g. `rwectl` 實際用法**（都以操作員身分執行，內部自己 `sudo`）：

```bash
deploy/rwectl restart                   # = restart rwe.service（沒給 unit 時的預設，見上面的修正）
deploy/rwectl status                    # = status rwe.service
deploy/rwectl logs -f                   # 追 rwe.service 的 journal
deploy/rwectl logs-update -n 50         # 看最近一次自我更新的 journal
deploy/rwectl update-result             # 最近一次自我更新的 result.json（"status":"applied"/"failed"）
```

### 跟 §7「整套移植到新主機」的關係

§7 是**換機器**（同一個帳號模型搬到另一台）；這一節是**同一台機器換帳號**。兩者可以組合：在新
主機上先照 §7 準備前置需求（第 1、5、6、8 點），再用這支腳本的 `phase1`～`phase4`、`phase6`、
`phase7` 直接把部署建在 `rwe` 底下，workRoot 則照 §7 第 11 點從舊主機搬到 `RWE_WORKROOT`
（`chown -R rwe:rwe`）取代 `phase5`。§7 第 3 點提到的「repo 路徑／`RWE_OFFICIAL_REMOTE`／`PATH`
要手動改」在 `phase6` 都由腳本改寫；第 10 點的 `enable-linger` 由 `phase1` 對 `rwe` 執行。

**資料可搬移性（已實測）**：把一份 production workRoot 複製到不同的絕對路徑、並以 bwrap 把原路徑
遮成空目錄後開機，`run_list`（109 筆）、`run_status`／`run_result`／`run_agent_log`、舊 run 的
`workspace_list`／`workspace_pull`、`workflow_list`／`workflow_source`、以 CAS seed 的 run 開工作區、
skill 資產的供應檢查、`schedule_*`／`webhook_*` 的建立與列出全部正常；版本高水位也延續。SQLite 與
檔案裡出現的舊絕對路徑全部是歷史內容（agent 對話紀錄、run 結果文字、run 工作區裡 agent 自己寫的
檔案、兩個測試用 workflow 的腳本字串），引擎不會拿它們來定位任何東西——所以 `phase5` 不需要做
路徑改寫。

## 7. 整套移植到新主機（Host Migration Checklist）

> 目的：把「目前這台主機上實際在跑的完整部署」原樣搬到另一台機器——不是重新照 §0/§2 從零架設
> 一個乾淨範例，是把**這台主機的實際客製**（進階 `gateway:"sdk"` + auth + LiteLLM + 自我更新 +
> 對外隧道）連同資料一起搬過去。以下每一步都連結到上面已有的章節，不重複寫一次；只補「換機時
> 才會踩到」的細節與（用 `<占位字元>` 表示的）主機專屬值要換掉的地方。**沒有任何一步需要真的
> 貼出這台主機的 token/secret 值**——照名稱/位置操作即可，值本身留在原本的檔案裡跟著複製過去。
> 同一台主機上只是把引擎從操作員帳號搬到專用系統帳號，見 §6c（分階段腳本）；兩者怎麼組合也寫在那裡。

1. **新主機作業系統前置需求**——見 §1a：Node.js 22.6+、npm、（`gateway:"sdk"` 才需要的）
   Python 3.11/3.12、以及 `bwrap`/`socat`（`sudo apt install bubblewrap socat`）。**這台主機
   目前實際量到的姿態、以及一個尚未閉環的狀態要先看清楚，不要假設它是 `CONFINED`**：
   `journalctl --user -u rwe.service` 裡最後一次開機記的是 `Bash confinement: UNCONFINED`
   （`bwrap: No permissions to create a new namespace`）；這台主機**已經**做了 §1c(e) 的兩步
   AppArmor 放寬（`/etc/sysctl.d/60-rwe-userns.conf` 設了
   `kernel.apparmor_restrict_unprivileged_userns=0`，`bwrap-userns-restrict` 設定檔也已停用），
   但那兩步是**在最後一次 `rwe.service` 重啟之後**才做的——服務還沒重開過，所以現在這個量測結果
   反映的是放寬**之前**的狀態，放寬到底有沒有生效**沒有被驗證過**。換機前先在原主機上
   `systemctl --user restart rwe.service` 一次、看新的開機 log 是不是真的變成 `CONFINED`，
   再決定新主機要不要照著複製同一套 AppArmor 放寬；本文件不替你做這次重啟（這是操作正式服務的
   動作，超出這份 checklist 讀取範圍）。不管最終量到哪一種姿態：`unconfined` 時本機送出的 run
   仍照跑，但**遠端**（webhook／排程／別台機器送出的 `run_start`）會被拒，換機後這個行為只要
   跟換機前一致，就不算回歸——先確認換機前的實際姿態，才知道要在新主機上重現哪一種。

2. **裝好版控的 git pre-push 保護**——見上面「git pre-push 保護」小節：`git config core.hooksPath
   deploy/git-hooks`（或 symlink）。這是 clone 出來就該做的第一件事，不是部署完才補。

3. **Clone repo，確認 repo 範本跟這台主機的即時單元還一不一致**——2026-09-27 起
   `deploy/rwe.user.service`／`deploy/rwe.service.d/override.conf`／`deploy/rwe-update.service`／
   `deploy/rwe-update.path`／`deploy/systemctl-user` 已經直接照這台主機當時實際跑的 user unit
   收斂（PATH 含 LiteLLM venv、`RWE_BIND=0.0.0.0`、`rwe-update.service` 是 inline-`Environment=`
   的 user-service 形狀、都用 `%h`），搬機時多半不必再逐行比對落差，但仍先讀一次舊主機
   `~/.config/systemd/user/` 底下的檔案（唯讀，不要動它們）確認沒有本 checklist 之後又長出的手動
   客製，剩下真正要核對的：
   - **repo 路徑**：範本假設 clone 在 `%h/Documents/remote-workflow`（`WorkingDirectory=`／
     `ExecStart=`／`RWE_CONFIG_PATH=`）——新主機的 clone 位置不同就要手動改這幾行。
   - **port**：`deploy/rwe.service.d/override.conf` 範本裡的 `RWE_PORT=8899` 是**這台主機自己的
     值**，`systemctl --user cat rwe.service` 能看到套用後的完整 unit；新主機若用不同的對外 port，
     改這個 drop-in 檔（不要動 `deploy/rwe.user.service` 本體），**且要跟第 8 點的反向代理/隧道
     設定的 port 對得上**——兩邊不一致的典型症狀是隧道連得上但 502／connection refused。
   - **`RWE_OFFICIAL_REMOTE`**：`deploy/rwe-update.service` 範本裡釘死的是這個專案的官方 remote
     （`https://github.com/HsuJavis/remote-workflow-engine.git`）；新主機若部署的是自己的 fork，
     要把這一行換成該 fork 的遠端 URL，否則 helper 會拒絕解析任何 tag。
   - **`PATH=`（`rwe-update.service`）**：範本是 `%h/.local/bin:...`，這台主機的 npm 剛好落在
     這裡；新主機若 node/npm 只裝在別的目錄（例如版本管理器的 `~/.local/node/bin`，見
     `deploy/rwe.user.service`），要把那個目錄一併加進來，否則 `npm ci && npm run build`
     找不到 npm。
   - **`~/.local/share/rwe-update/`（`RWE_UPDATE_RESULT`／`RWE_UPDATE_LOCK` 指到的那個 0700
     目錄，第 3 點步驟三已建過）這台主機上實際有的檔案**：`result.json`（最後一次更新結果，見
     §6b「可觀測性」）、`update.lock`（flock 用的空檔）、`systemctl-user`（現在就是
     `deploy/systemctl-user`，見 §6b 步驟五，新主機用 `install -D -m 755` 裝過去即可，不必手打）、
     以及一份 `.webhook-secret`（0600，**操作員自己留的一份 GitHub webhook secret 備份，不是引擎
     會去讀的檔案**——引擎驗 HMAC 讀的是 `RWE_SECRET_GITHUB_WEBHOOK_SECRET` 這個環境變數，第 4
     點已經搬過去，這份檔案單純是操作員自己方便查而已，要不要一起搬純看個人習慣）。**這個目錄
     底下若有任何 `rwe.config.json.bak-*`／`backup-*` 之類的備份檔，一律當成跟正式
     `rwe.config.json` 一樣機密處理**（見下方第 7 點：這台主機的 `rwe.config.json` 目前明碼含
     Google OAuth client secret，備份檔自然也含），不要圖方便丟進任何非 600 權限的位置或連同其他
     非機密檔案一起打包外流。

4. **`rwe.env`（`~/.config/rwe.env`，權限 600）——只搬「鍵名」對得上的那些，值本身直接複製檔案**：
   這台主機目前有 `RWE_SECRET_GITHUB_TOKEN`（`issue_report`/Issues 儀表板用）、
   `OPENROUTER_API_KEY`（openrouter 供應商）、`RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN`
   （anthropic 訂閱制 OAuth，見 §1b／README「前置需求」——這台主機沒有另外設 API-key 那個環境變數，
   用的是訂閱制）、`RWE_SECRET_GITHUB_WEBHOOK_SECRET`（GitHub webhook HMAC，見 §6b 步驟一/四）。
   另外還有兩個**跟本功能無關的殘留鍵**，新主機可以整行不搬：`RWE_SECRET_DEMO_TOKEN`／
   `RWE_SECRET_VAL092_SECRET`（驗證腳本/測試 fixture 用的假密鑰，不是任何真實供應商）、以及一個
   `OPENAI_` 開頭的殘留鍵（v26 供應商整併前的舊實驗留下，引擎現在完全不讀這個鍵，見上面「已知
   限制」/`no-retired-surface` 那批 grep 守衛）。搬過去最省事的做法是**整份檔案複製**（保留
   600 權限），再回頭刪掉不需要的兩三行，而不是逐鍵手打。

5. **LiteLLM venv（`gateway:"sdk"` 才需要）**——見 §1a「Python 3.11 或 3.12」那一點：這台主機用的
   是 `~/.rwe-litellm-venv`，Python 3.12。新主機沿用同一個慣例的話，上面第 3 點裡 `rwe.service`
   的 `PATH=` 才不用改路徑，只需要照抄。

6. **Ollama 模型（若腳本用到本機模型）**——這台主機目前拉的 tag：`qwen2.5:7b`、`qwen2.5vl:7b`、
   `bge-m3:latest`；新主機要跑哪些腳本，就對照該腳本 `meta.params.agents.<label>.model.default`
   實際寫的 `ollama/<tag>`，`ollama pull <tag>` 補齊——不必整批照抄，帶不到的腳本本來就該先確認
   有沒有真的被排進要跑的工作流程。

7. **`rwe.config.json`——複製後逐一核對，不要整份檔案原樣照搬**：目前只有這些頂層鍵在用
   （`aliases` 已於 2026-09-26 移除，不會出現，見 §5 疑難排解）：`bind`／`port`／`allowedHosts`／
   `workRoot`／`timeoutMs`／`retries`／`gateway`／`defaultAllowedTools`／`anthropicAuth`／
   `updateFlagPath`／`updateResultPath`／`auth`／`principals`（每個鍵的意義查 §1b 設定總表）。
   換機要特別處理的三個地方：
   - **`allowedHosts`／`auth.issuer`／隧道 hostname 是否換掉是同一個決定**：不換公開網域名的話
     （只換運算主機、DNS/隧道還是指到同一個名字），這三者原封不動搬過去即可，GitHub webhook 也
     不用重新設定。**若連公開網域名都換了**：`auth.issuer` 要改成新網域，Google Cloud Console
     那個 OAuth 用戶端的**已授權重新導向 URI**（`https://<新網域>/oauth/google/callback`）要
     一起加，舊網域簽發的既有 refresh token（存在 `workRoot/auth-tokens.db`）在新 issuer 下會
     失效，使用者要重新走一次 OAuth 授權——這不是 bug，是 OAuth issuer 綁定 audience 的必然結果。
   - **`auth.googleClientSecret`（與可選的 `googleClientId`）寫成 `${secret:NAME}`**，值放在
     `rwe.env` 的 `RWE_SECRET_NAME`（見 §1b），`rwe.config.json` 就不含機密、搬機時不必當機密檔處理。
     舊主機若還是明碼：搬之前先改成 handle（或用 §6c 的 `phase4`，它會自動搬值、可順便輪替）；新主機的
     `rwe-update.service` 要帶 `RWE_CONFIG_ENV_FILE`（範本已有），否則自我更新的 check-config 解不開。
   - **`principals`**：目前是「特定信箱 → 角色」的對照表；换機不换使用者的話原樣搬，換一批
     使用者要照 §1b「角色」小節重新分配，打錯角色字串（不是 `admin`/`author`/`user`）會直接讓
     開機失敗，不是靜默退回。

8. **對外隧道／反向代理**——這台主機用的是使用者層級的 `cloudflared` unit
   （`~/.config/systemd/user/cloudflared-ssh.service`；名字是舊的，實際上跑的是
   `cloudflared tunnel --config ~/.cloudflared/config.yml run`，這一份 `config.yml` 底下同時放了
   SSH、另一個服務、跟這個引擎的 ingress 規則——不是三個各自獨立的 tunnel，是同一個 tunnel 的
   一份設定檔），ingress 規則是**逐路徑**白名單（只轉發 `/github/webhook`、`/.well-known/`、`/authorize`、
   `/oauth/`、`/token`、`/register`、`/mcp`、`/assets/(blob|manifest)` 到本機的 `RWE_PORT`；
   dashboard 與 `/api/*` **刻意不對外**，只留本機/內網存取），每條規則都把 `httpHostHeader`
   釘死成 `localhost:<RWE_PORT>`——這是配合 §6 的 Host 白名單防護（伺服器只認得到白名單裡的
   Host，隧道若不覆寫 Host header 會被引擎自己的 403 擋下）。換機時：隧道設定檔本身含憑證與
   隧道 id，不搬過去唸出來，照 cloudflared 官方文件替新機器重新建一個隧道／或把既有隧道的執行
   行程換到新主機上；不管哪種做法，**ingress 規則裡的 port 必須跟第 3 點 `rwe.service` 目前的
   `RWE_PORT` override 一致**，兩者其一忘了同步是最常見的「隧道通、502/連不上」成因。若走的是
   §6b 建議的 nginx 反向代理而非 cloudflared，同一條「只轉發 webhook／OAuth／`/mcp`／assets 路由，
   其餘不轉」的原則照套即可。

9. **GitHub repo webhook（自我更新用）**——見 §6b 步驟一：事件**只勾 Releases**（`release` 事件、
   `action:"published"`，理由見步驟一的說明；不要多勾 create/push），content type 是
   `application/json`，secret 對應 `RWE_SECRET_GITHUB_WEBHOOK_SECRET`（第 4 點已經搬過去）。
   **只換運算主機、Payload URL 網域不變的話，這個 webhook 完全不用動**——它打的是公開網域，不是
   實體主機。

10. **`loginctl enable-linger`**——user service 要在登出/重開機後仍運行，見 §2「無 root 部署」
    步驟二那一行；新主機同樣要跑一次 `loginctl enable-linger "$USER"`，忘了這一步的症狀是
    「SSH 斷線 unit 就跟著死掉」。

11. **搬 `workRoot` 資料（狀態全在這裡，是唯一真正需要「搬資料」的目錄）**——**先停服務再複製**：
    ```bash
    systemctl --user stop rwe.service rwe-update.path
    ```
    再把整棵 `workRoot`（`rwe.config.json` 的 `workRoot` 鍵指到哪裡就是哪裡）複製到新主機，
    **含 `-wal`/`-shm` 檔**（或複製前對每個 `.db` 跑一次
    `sqlite3 <db> 'PRAGMA wal_checkpoint(TRUNCATE);'` 把 WAL 併回主檔，兩種做法擇一，不要漏掉
    `-wal` 又不 checkpoint，那樣會遺失還沒寫回主檔的最新資料）。裡面哪些是真正的狀態、哪些可丟：
    - **狀態，要搬**：`catalog.db*`（工作流程/版本/發布頻道）、`schedules.db*`、`webhooks.db*`、
      `self-update.db*`、`mcp-registry.db*`、`continuations.db*`、`auth-tokens.db`（啟用 auth
      時的 refresh token——換 issuer 網域的話這個檔案裡的 token 會失效，見上面第 7 點，仍可以
      搬過去只是使用者要重新授權一次）、`cas/`、`store/`、`workflows/`、`model-probe/`、
      `assets/`、`_global_assets/`。
    - **可丟**：`.graph-analyzer-scratch/`（暫存用途，重跑會自己重建）。
    - 複製完，`chmod` 維持原本的權限（部分檔案是 0600），啟動前確認 `RWE_CONFIG_PATH` 指到
      新主機上正確的 `rwe.config.json`。

12. **啟動與自我更新鏈路，回想一次完整流向**——`git tag` 推上官方 remote → `.github/workflows/`
    的 Release CI 重跑 typecheck + 完整測試 → 綠燈才建立 GitHub Release → Release **published**
    觸發第 9 點的 webhook → 引擎驗 HMAC、寫 `updateFlagPath`（第 3 點裡固定是 `$HOME/rwe-update.flag`）
    → `rwe-update.path`（第 3 點）偵測到旗標 → `rwe-update.service` 跑
    `deploy/rwe-update.sh`（`git fetch` 官方 remote限定 → checkout tag → `npm ci && npm run
    build` → 跑 `npm run check-config`（有設 `RWE_CONFIG_PATH` 才跑）→ 全綠才
    `$SYSTEMCTL restart rwe`）→ 失敗在任何一步都安全失敗、服務留在原版本，見 §6b「可觀測性」。
    新主機第一次啟動建議手動跑一次（`systemctl --user start rwe.service`），確認正常後才
    `enable` 讓它開機自動跑。

13. **收尾驗證清單（照這個順序）**：
    - `journalctl --user -u rwe.service | grep -i "confinement\|listening"`——確認看到
      `Bash confinement: CONFINED`（或已知會是 `UNCONFINED` 並接受第 1 點的差異）與監聽位址/port
      跟預期一致。
    - `curl -s http://127.0.0.1:<RWE_PORT>/api/version`——版本號跟搬過來前的 `git describe` 對得上。
    - `scripts/smoke.sh`——見 §2「上線前煙霧測試」，`PASS` 才算過（不需要任何供應商金鑰）。
    - `curl -i https://<公開網域>/mcp`（啟用 auth 時）——預期 `401`，且
      `WWW-Authenticate` 標頭帶 `scope`（D-BIND 的 fail-closed 行為，見 README「安全模型」）。
    - 打一個測試 tag 走一次完整自我更新鏈（第 12 點）到 `result.json` 記 `"status":"applied"`，
      才算連自我更新這條路也在新主機上真的接通，不是只有手動啟動能動。

## 附錄：辨識端點（僅供 Ollama 除錯用）

> `provider` 只有 `anthropic|openrouter|ollama` 三種（見§情境配方 0）。以下只用來確認你的
> **自架 Ollama（或 Ollama API 相容）伺服器**是否真的活著，由能連到端點的機器執行，
> `BASE=http://那台:PORT`：

```bash
BASE=http://那台:PORT
curl -s $BASE/api/version ; echo          # Ollama ⇒ {"version":"0.x.x"}（另有 /api/tags）
curl -s $BASE/api/tags | head -c 400      # 看有哪些模型 tag——腳本的 model.default 就填 "ollama/<這些tag之一>"
```


