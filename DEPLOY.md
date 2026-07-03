# 部署 / 維運手冊 — remote-workflow-engine

> 人類導向文件（繁體中文）。由 Gate 7.5 validator 依實際部署步驟撰寫，步驟可重跑。
> 凡 validator 為了把系統跑起來而做、但 README quickstart 未涵蓋的動作，都記在這裡。
> **本文件為第七輪 Gate 7.5（Gate 8 收尾修復的範圍化重新驗證）後改寫。**
>
> **第七輪結果摘要**：本輪任務是針對 Gate 8 review 發現、IMPL-051 修復的 6 項收尾項目
> （D-G8-1~6）中，前一輪文件明確標記「程式碼/測試層級已修復，尚未經 Gate 7.5 對獨立真實 process
> 重新驗證」的 3 項，逐一對獨立真實 process 重新驗證：**(1) D-G8-4 零設定逾時保底——CONFIRMED**：
> 完全不存在 `rwe.config.json` 的零設定啟動下，對一個真實、會無限期不回應的網路端點送出真實
> `agent()` 呼叫，run 在 5.2 秒內正確回傳 `result:null` 並進入 `completed`，從未卡住；另外直接對
> 真實（未 mock）`composeConfig()`/`ClaudeAgentSdkGatewayClient` 組合根程式碼確認零設定下解析出的
> `timeoutMs` 確實是 `15000`（而非 `undefined`），且對一個真的會永久卡住的 session，逾時保底確實在
> 15014 毫秒真實觸發。**(2) D-G8-2 逐字稿真實訊息事件——CONFIRMED**：真實設定（`local` 別名接
> 真實本機 Ollama）下的真實 `agent()` 呼叫，`workflow_agent_log` 現在會回傳真實的
> `"message"` 事件（而非過去只有最終 `"usage"` 摘要）。**(3) D-G8-3 `tools/list` 真實 schema——
> CONFIRMED**：真實 HTTP `tools/list` 回應對全部 10 個工具都有真實描述與真實
> `inputSchema.properties`/`required`。其餘 3 項（D-G8-1 巢狀 resume、D-G8-5 環境變數白名單、
> D-G8-6 預算並行保留）依本輪任務範圍指示由自動化回歸測試涵蓋（皆綠燈）+ 直接讀原始碼確認掛載點，
> 未本輪獨立重跑真實 process。完整證據見
> `.sdlc/features/001-remote-workflow-engine/08-validation.md` 的「ROUND 7」章節。
>
> **Gate 8 收尾修復說明（IMPL-051，本輪已對 3 項核心項目完成獨立真實 process 重新驗證，見上）**：
> 本輪 review 發現並修復 2 項與本文件直接相關的項目——(1) **D-G8-4 零設定逾時保底**：
> 零設定（不存在 `rwe.config.json`，`main.ts` 直接用內建預設）情境下，預設 `gateway:"sdk"` 路徑先前
> 完全沒有 `timeoutMs` 保底值，一個沒有回應的本機供應商會讓整個 run 無限期卡住；現在 `composeConfig()`
> 補上與 §1b/§5 表格中 `timeoutMs` 同樣的 `15000`（毫秒）保底值，與舊版 `gateway:"direct-fetch"`
> 路徑早已有的保底行為一致。(2) **D-G8-5 子行程環境變數白名單**：`gateway:"sdk"` 路徑先前把整個
> `process.env`（含任何未預期存在於本機的 `OPENAI_API_KEY`/`GEMINI_API_KEY`/其他機密）原封不動傳給
> 產生出的 `claude` CLI 子行程；現在改為明確白名單（`PATH`/`HOME`/`SHELL`/`LANG`/`LC_ALL`/
> `TMPDIR`/`TERM` + 覆寫過的 `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`），不再傳遞白名單以外的任何
> 主機環境變數。詳見 §1b 與 §5 的追加說明。
>
> **本輪（第六輪）結果摘要**：任務是重新驗證第五輪找到的 3 個問題並取得每一條 v1 REQ 驗收子句的
> 新鮮真實層證據。**2 項確認真的修好**——(a) `workflow_status` 能即時觀察到 in-flight agent 的
> `"queued"`/`"running"` 狀態（D-F12）；(b) `workflow_suspend` 後 `workflow_resume` 若原呼叫被
> 中止，現在會真的重新執行、產出真實結果，而非重播快取的 `null`（D-F13）。**1 項的程式碼修復已
> 確認生效，但正式歸類為「本機小模型能力上限」**——即使已將送給模型的工具清單縮減到最小
> （`Read`/`Write`/`Bash`，且真的排除了與本產品無關的外掛工具），本機 7B 級 Ollama 模型
> （`qwen2.5:7b`）透過本產品的 SDK gateway 仍然完全不會真的觸發工具呼叫（D-F11，見 §6 第 1 項）。
> 本輪也首次以真實 process 重新證實了 2 條先前多輪都停留在「未獨立重跑」的驗收子句：
> `bind:"0.0.0.0"` 對外監聽、`workflow_stop` + 帶編輯過腳本的 `workflow_resume`（快取前綴重播）。
> 完整證據見 `.sdlc/features/001-remote-workflow-engine/08-validation.md`。

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
  **第五輪起提醒（本輪重新確認仍然如此）**：`LiteLLMProxyManager` 固定使用 4000 port（不可設定），
  且正常關機不會停掉這個子行程（見 §6 已知限制）——啟動一個新的伺服器實例「之前」，務必先確認
  沒有前一次留下的孤兒 `litellm` process 還占著 4000 port，否則新實例可能誤連到舊代理（本輪已
  真實重現此風險 2 次，見 §6 第 8 項）。
- 外部依賴：不需要資料庫伺服器（狀態存在本機檔案：SQLite + JSONL journal，路徑見 `workRoot`）。
- LLM 供應商（依你要用的模型別名擇一或多個）：

  | 變數 | 用途 | 範例/來源 |
  |------|------|-----------|
  | `ANTHROPIC_API_KEY` | `provider:"anthropic"` 別名（預設 `sonnet`/`haiku`/`opus`/`default` 皆指向此） | Anthropic Console 的 API key，或內部 sandbox key |
  | `OPENAI_API_KEY` | `provider:"openai"` 別名 | OpenAI Platform 的 API key |
  | `GEMINI_API_KEY` | `provider:"gemini"` 別名 | Google AI Studio 的 API key |
  | `OLLAMA_BASE_URL` | `provider:"ollama"` 別名（本機/內網模型，免金鑰） | 預設 `http://localhost:11434`；本次驗證即用此跑 `qwen2.5:7b` 全程真實測試，`OLLAMA_BASE_URL` 未設也能用；**但見下方已知限制第 1 條：目前無法真的用工具讀寫檔案（模型能力上限，非程式碼缺陷）** |

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

| 設定檔 | 用途 | 本次是否異動 | 需補的鍵/值 |
|--------|------|--------------|-------------|
| `rwe.config.json`（不進版控；由 `.example` 複製而來，本身**不含機密**） | 伺服器啟動設定：`bind`、`port`、`workRoot`、`timeoutMs`、`retries`、`gateway`（`"sdk"｜"direct-fetch"`，見下）、`agentDefinitionsDir`（`agents/*.md` 定義目錄，見下）、`defaultAllowedTools`（見下）、`aliases`（模型別名 → provider/model 對照表） | 否 | 見下方「設定檔內容」；金鑰一律用環境變數，絕不寫進此檔 |
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
  "defaultAllowedTools": ["Read", "Write", "Bash"],
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
`defaultAllowedTools`（**第六輪補上文件說明**）：`gateway:"sdk"` 路徑下，當一次 `agent()` 呼叫
沒有自帶 `opts.allowedTools`（且對應的 `agentType` 定義也沒有 `tools:` frontmatter）時，套用的
預設工具清單——縮小送給模型的工具面，避免小型本機模型被完整 Claude Code CLI 工具面（含此主機環境
自己的外掛/MCP 工具）淹沒而放棄嘗試工具呼叫；省略此鍵時內建預設值等同上面 `["Read","Write","Bash"]`。
優先序：呼叫端 `opts.allowedTools` > `agentType` 定義的 `tools:` > 這個設定鍵 > 內建預設，永遠不會
不設限。不提供 `aliases` 時，伺服器內建預設值等同上面拿掉 `local` 那份（全指向 anthropic）。
`agentDefinitionsDir` 省略時 agentType 註冊表為空（每個 `agentType` 都會回報 unknown，不影響不用
`agentType` 的腳本）。

環境變數也可覆蓋設定檔部分欄位（不需要設定檔也能啟動）：
| 環境變數 | 對應 | 預設 |
|----------|------|------|
| `RWE_CONFIG_PATH` | 要讀取的 JSON 設定檔路徑 | `./rwe.config.json`（不存在則略過，全用內建預設） |
| `RWE_BIND` | `bind` | `127.0.0.1` |
| `RWE_PORT` | `port` | `8787` |
| `RWE_WORK_ROOT` | `workRoot`（狀態/journal/工作目錄根） | 設定檔值，否則系統暫存目錄下自動建立 |

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

# 步驟 4：無需資料庫遷移/初始化 —— SQLite schema 由伺服器啟動時自動建立於 $workRoot/store

# 步驟 5（重要，第五輪起適用，本輪再次確認風險仍在）：啟動前先確認沒有前一次殘留的孤兒 litellm
# process 占著 4000 port
ps aux | grep '[l]itellm --config' && echo "先清掉這些 process 再繼續！" \
  || echo "乾淨，可以啟動"
# 若有殘留： ps aux | grep '[l]itellm --config' | awk '{print $2}' | xargs -r kill

# 步驟 6：啟動服務
RWE_CONFIG_PATH=./rwe.config.json RWE_WORK_ROOT=/var/lib/remote-workflow-engine npm run start
# 建議用 systemd / pm2 / docker 常駐；此指令本身是前景長駐程序，SIGINT/SIGTERM 會優雅關閉
# （但見 §6「仍待下一輪修復」第 1 條：目前優雅關閉不會連帶停掉內部的 litellm 子行程，需另外清理，
#  且見上方步驟 5：下次啟動前務必先清乾淨，否則有誤連舊代理的風險）
```

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
# 注意（§6「仍待下一輪修復」第 1 條已知限制）：這不會停掉伺服器內部管理的 litellm 子行程，需另外找到並清理：
ps aux | grep '[l]itellm --config' | awk '{print $2}' | xargs -r kill
# （務必在啟動下一個實例之前做這一步，否則見 §6 第 8 項的誤連風險）

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
| 關掉伺服器後還有一個 `litellm --config ...` process 留著（可能佔用 4000 port，讓下一個伺服器誤連到舊代理） | 已知限制（§6）：優雅關閉沒有連帶停掉子行程；第五輪起已知：因為代理固定用 4000 port，下一個伺服器實例的健康檢查可能誤判連到的是舊的孤兒代理（本輪已真實重現 2 次） | 手動 `ps aux \| grep litellm` 找到後 `kill`（務必在啟動下一個伺服器實例「之前」做）；見 §4 回滾指令 |
| Node 啟動就報 SyntaxError / 找不到 `--experimental-transform-types` | Node 版本 < 22.6 | 升級 Node 到 22.6 以上（`node --version` 確認） |

## 6. 維運注意事項 / 已知限制（第六輪 Gate 7.5：對獨立真實 process + 真實 Ollama 重新驗證，
本輪 GATE 通過，測試證據見 `08-validation.md` VAL-001~007/013/014/015）

- 日誌位置：目前僅 stdout/stderr（`[remote-workflow-engine] ...` 前綴），交給你的 process manager
  （systemd/pm2/docker）收集；沒有另外寫檔案 log。
- 狀態位置：`$workRoot/store`（SQLite run 索引 + 具名工作流程註冊表）與
  `$workRoot/workflows/<name>/runs/<runId>/`（每次執行的工作目錄，含 `agent-*.jsonl` transcript
  事件檔）。

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

- **仍待處理的操作面風險（非 REQ 阻斷，自第二/五輪起已知，本輪重新確認仍存在）**：
  7. 正常關機不會停止內部管理的 `litellm` 子行程（孤兒 process，需手動清理）；其暫存設定目錄
     （`/tmp/rwe-litellm-*`）也不會自動清除。
  8. `LiteLLMProxyManager` 固定使用 4000 port，結合上一項的孤兒行程問題，第二個伺服器實例可能對
     一個殘留自前一個實例的舊代理誤判「健康檢查通過」，實際上接的可能是設定不同的舊代理——本輪已
     真實重現此風險 2 次（見 §1/§2/§4/§5 的啟動前清理提醒）。

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
  給中止的 agent 紀錄一個專屬終止狀態、修掉 `litellm` port 4000 碰撞風險、拿更大的本機模型或付費
  供應商重測工具呼叫能力等 5 項。
