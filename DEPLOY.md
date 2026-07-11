# 部署 / 維運手冊 — remote-workflow-engine

> 人類導向文件（繁體中文）。由 Gate 7.5 validator 依實際部署步驟撰寫，步驟可重跑。
> 凡 validator 為了把系統跑起來而做、但 README quickstart 未涵蓋的動作，都記在這裡。
>
> ---
> ## ⭐ v3（2026-07-11，最新 — 目前實際部署狀態，凡與下方舊輪敘述衝突者，以本塊為準）
>
> 這一輪把系統實際切到 **`gateway:"sdk"`** 常駐運行，並經真實 Gate 7.5（透過 remote-workflow-plugin
> 對真實 `qwen2.5:7b` 端對端）驗證。相對於下方 v1/v2 敘述，**三件事已改變**：
>
> 1. **實際部署走 `gateway:"sdk"`（不是 `direct-fetch`）**。這條路徑才有 agent 工具迴圈 + MCP，
>    所以需要 LiteLLM 代理（見 §1 的 Python 3.11/3.12 setup）。若你只要純工作流程邏輯、不需要
>    `agent()` 真的用工具，`direct-fetch` 仍是可用的免依賴退回選項（見 §2b Ollama-only）。
>    **systemd unit 的 `PATH` 必須含 litellm venv 的 `bin/`**，否則 sdk 開機 `spawn('litellm')`
>    會 `ENOENT` 失敗（範例：`Environment=PATH=/home/<you>/.rwe-litellm-venv/bin:/home/<you>/.local/node/bin:/usr/bin:/bin`）。
>
> 2. **預設工具面已擴充（D-V3M-3）**：`Read`/`Write` → **`Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash`**，
>    全部**限制在該次 run 自己的工作目錄**（`cwd`=run workspace + §1c(d) 的 realpath 邊界檢查，
>    每次呼叫都經 `canUseTool` 與 `PreToolUse` 強制）。這**刻意反轉了**舊 v2 §1c(b) 的「預設不含
>    Bash」——當初排除 Bash 是因為那時**還沒有** fs jail；jail 現在存在了（§1c(a)(d)），所以
>    Bash 以「confined 在固定工作目錄下」的形式回到預設。**Web 外連（`WebFetch`/`WebSearch`）與
>    子 agent 生成（`Task`/`Agent`）仍不在預設**（破壞工作目錄封閉性 / 繞過引擎自己的
>    orchestration+DOS 模型）——需要時仍可在某 `agentType` 的 `tools:` 或呼叫端 `opts.allowedTools`
>    明確 opt-in（所有工具都仍可 opt-in 啟用，只是預設集不含它們）。
>
> 3. **LiteLLM 代理 port 改為動態（D-V3M-4）**：沒有設定 `litellmPort` 時，**綁一個 OS 分配的
>    ephemeral 空閒 port**，不再霸佔寫死的 4000。這根治了「一台主機上多個 litellm（或跑測試時
>    撞到常駐服務）搶 4000」的老問題——實測常駐 sdk 服務現在跑在動態 port（例如 `:34129`），
>    可與完整測試套件並存。明確指定 `litellmPort` 仍有效（會走既有的 stale-owner pre-bind 檢查）。
>
> 4. **⚠️ `workRoot` 必須在任何 Claude project 之外（D-V3M-5，安全）**：每個 run 的 workspace 是
>    `<workRoot>/workflows/.../runs/<id>/`。若 `workRoot` 巢狀在一個 Claude Code project 內（祖先目錄
>    有 `.git` 或 `CLAUDE.md`），SDK-gateway 的 agent CLI（跑在 `settingSources:['project']` 以載入
>    workspace 自己的 `.claude/skills`）會把 project root 解析到那個祖先、**載入該 project 的
>    `CLAUDE.md` + `~/.claude/projects/<hash>/memory` 進 agent context**——這是**繞過 tool 層工作目錄
>    jail** 的洩漏（session-init 載入，不經 Read 工具呼叫，§1c 的邊界檢查攔不到；實測 qwen agent 曾
>    逐字吐回 operator 的 MEMORY.md）。**修復**：`composeConfig()` 現在啟動時 fail-closed——若 `workRoot`
>    或其任一祖先含 `.git`/`CLAUDE.md`，直接以 `WORKROOT_INSIDE_PROJECT` 拒絕啟動並指出補救。
>    **部署設定**：`workRoot` 請用 repo 外的絕對路徑（無 root 範例 `/home/user/.local/share/rwe-data`；
>    有 root `/var/lib/remote-workflow-engine`）——**不要**用 `./data`（會落在 repo 內、觸發 guard）。
>
> **v3 也啟用的能力**（sdk 模式下才有；細節見各自章節/`journal.md`）：MCP 依名 provisioning
> （管理工具 `mcp_provision` 註冊 → workflow 用 `agent(p,{mcp:['name']})` 引用 → 只注入被引用者，
> `strictMcpConfig` 隔離不變）、伺服器端 secret（config 內 `${secret:NAME}` handle → 由
> `RWE_SECRET_<NAME>` 環境變數解析，缺失則該次 run 明確 `SECRET_MISSING` 失敗、絕不外洩字面值）、
> 以及 D-DOS 觀測端點 `GET /api/status`（回 `{agentSemaphore:{total,inUse,queued}}`）。
> hook 明確不支援（`asset_push` kind:hook 一律拒絕）。
> ---
>
> ## ⭐ 區網部署 + remote→local 落地（v1，2026-07-11）
>
> ### A. 綁到區網（LAN）給其他機器用
> 引擎預設綁 `127.0.0.1`（只本機）。要讓區網其他機器連進來:
> 1. 把 bind 改成**這台的 LAN IP**（不要用 `0.0.0.0` 全開）。優先改 systemd unit 的
>    `Environment=RWE_BIND=<你的 LAN IP>`（unit env 覆蓋 config），例:
>    `Environment=RWE_BIND=192.168.0.125`，然後 `systemctl --user daemon-reload && systemctl --user restart rwe.service`。
>    確認: `ss -ltnp | grep :8787` 應顯示 `192.168.0.125:8787`（不是 `127.0.0.1`）。
> 2. **防火牆白名單（必做）**——引擎 **v3 前無任何 auth**,綁上區網 = 任何能連到 `/mcp` 的裝置都能
>    送 workflow，讓 Bash agent 在**這台主機上執行任意程式碼**、`asset_push` 任意寫檔。用 OS 防火牆
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
>    （`ssh -L 8787:127.0.0.1:8787 user@<host>`）——零網路曝露,適合單人/跨網段。多租戶要等 v3 auth。
>
> ### B. 讓遠端 run 的程式碼變更「落地」到你本地(rwe-apply v1)
> 引擎的 agent 被 **jail 在 server 端 per-run workspace**,碰不到 client 機器（設計如此）。要把
> 「遠端推理」的程式碼變更帶回本地工作副本,用 **patch-in-result** 模式（設計由專家 panel 產出,
> 見 client plugin `remote-workflow-plugin` 的 `skills/rwe-apply/`）:
> 1. **workflow 回傳 git patch envelope**——用參考模式 `rwe-patch-return`（`skills/rwe-apply/references/`）:
>    seed client 傳來的 bounded base（`args.files`=[{path,contentB64}]、`args.baseSha`）→ agent 編輯 →
>    最後 `git diff --binary` → 腳本 `return { format:'git', baseSha, diff, touchedPaths, stats }`
>    （`workflow_result` 原樣帶回,引擎零改動）。
> 2. **client 端套用**——`/rwe-apply <runId>` skill:取 `workflow_result` → `apply_patch.py` 驗
>    envelope + **路徑守衛**（拒絕 `../`/絕對/`.git` 內部）+ 驗 baseSha + `git apply --check --3way`
>    dry-run → 經你**自己 session 的權限確認**套到新 `rwe/run-<id>` 分支（原分支不動）。變更只以
>    **可審查的 diff** 越過邊界,server 永遠拿不到你機器的寫入權。
> - **模型注意**: patch 模式的 git-plumbing agent(seed/finalize)**需要「真的會執行 Bash」的模型**。
>   qwen2.5:7b 會把工具呼叫吐成文字(D-F11 能力層)沒真跑 → 這幾步請指定 Claude 或夠大的本地模型;
>   引擎執行與 client 套用機制本身與模型無關,皆已驗證。
> ---
>
> **v2 Gate 7.5 ROUND 1（2026-07-04）結果摘要**：REQ-011（本節 §2b）已對真實獨立 process
> 驗證通過——`scripts/smoke.sh` 真實跑過、真實 pass；`npm install`/`npm ci` 皆真實、乾淨；優雅關閉
> 時真的會連帶砍掉 `litellm` 子行程（TASK-027，真實 `SIGTERM` 測過，2 秒內兩個 process 都消失，
> 不留孤兒）；`docker-compose.yml` 已做真實 YAML 語法驗證，但**這次驗證環境沒有安裝 docker，
> `docker compose up` 未能實際執行**（誠實記錄為環境缺口，非略過）；`deploy/rwe.service` 用
> `systemd-analyze verify` 驗證時，因為這個驗證環境的 Node 不是裝在系統路徑
> （`/usr/bin/npm` 不存在，而是使用者層級安裝），**改用實際存在的路徑後 `systemd-analyze verify`
> 通過（exit 0，無警告）**，確認 unit 檔本身語法/語意正確；`sudo systemctl enable --now` 因這次
> 驗證環境沒有 sudo 權限（需要互動式密碼）而未能實際執行，同樣誠實記錄為環境缺口。**重要：真正
> 部署時，`deploy/rwe.service` 裡的 `ExecStart=/usr/bin/npm run start`、`User=rwe`、
> `WorkingDirectory=/opt/remote-workflow-engine` 都只是預設範本值——請依你實際主機的 Node 安裝
> 路徑（`which npm`）、選定的服務帳號、部署目錄自行調整，否則 `systemctl` 啟動會失敗。**
> **同一輪也發現 REQ-009（見 README.md「已知限制」）尚未通過 Gate 7.5**——與部署封裝本身無關，
> 但如果你的部署計畫依賴「推送 skill/MCP config 給 agent 用」，目前這條路徑還沒打通，請先看
> README.md 的 v2 已知限制第 1 條。
>
> **Gate 6 v2 validation-round fixes（2026-07-04，本輪，D-V2V-1/2/3 route-back）**：上一段記錄的
> 兩個缺口已修復——**(1) D-V2V-1（REQ-009 資產接線）**：`asset_push` 接受的 `mcp-config` 資產現在
> 會在**每一次** `agent()` 呼叫前重新從磁碟讀取，接進真實 `@anthropic-ai/claude-agent-sdk`
> session 的 `options.mcpServers`（`strictMcpConfig:true` 維持不變，見
> `src/gateway/claude-agent-sdk-client.ts` 的 `readMcpConfigAssets()`）；`skill`/`hook` 資產現在
> 會被**實體化**進該次 run 自己的工作目錄下 `.claude/skills|hooks/<name>/`，且該次呼叫的
> `options.cwd` 改指到那個 run 工作目錄、`options.settingSources` 變成 `['project']`（宿主機層級
> 的 `'user'`/`'local'` 來源仍然關閉——D-F11 的隔離保證不變，只是現在多了「這次 run 自己的
> `.claude/`」這一個範圍內的來源）。這系統自己的 `rwe-*` skill/plugin 從頭到尾都不會被儲存、也
> 不會被實體化（D4 遞迴防護，不變）。見 `tests/integration/asset-mcp-config-wiring.test.ts`
> （IT-035）與 `tests/integration/asset-skill-materialization-wiring.test.ts`（IT-036）。
> **(2) D-V2V-2（REQ-008 瀏覽器儀表板）**：新增 `GET /dashboard`（同一個 port，與 `/mcp`、
> `/api/runs*` 共用同一個 `http.Server`）——一個自成一體、不需要建置工具的靜態 HTML/JS 頁面：
> run 清單、點進去看 phase/agent tree（每個 agent 的 state + token usage）、逐字稿檢視，且用
> `setInterval` 輪詢自動更新（不必手動重新整理）。`/dashboard/<runId>` 走同一個靜態頁面的
> client-side 路由（頁面自己的 JS 從 `location.pathname` 解析 runId）。頁面本身的 JS 呼叫的是
> 同一組既有的唯讀 `/api/runs*` JSON API（DES-018）——同一份資料模型，現在真的有兩種傳輸方式。
> 見 `tests/acceptance/val-018-dashboard-browser-ui.test.ts`（VAL-018）。
>
> **D-V2V-3（docker/systemd 環境缺口，已被 ORCH 接受，非阻擋項）**：上面第 6~17 行記錄的
> docker/systemd 缺口維持原狀——這個實作環境本身沒有 docker、也沒有可互動的 sudo 權限，所以
> `docker-compose.yml`/`deploy/rwe.service` 這兩支只做過語法/語意驗證（`docker compose config`
> 語法檢查、`systemd-analyze verify`），從未在這個環境裡真正跑起來過；`npm` 路徑部署 +
> `scripts/smoke.sh` 煙霧測試 + 優雅關閉不留孤兒這三項則是對真實獨立 process 驗證過的。**這是一個
> 明確記錄的環境缺口，不是待修的程式碼缺陷**——ORCH 已裁定接受，不再視為本輪 gate 的阻擋項；等你
> 真正部署到有 docker 或有 root 權限的主機時，請自己再跑一次
> `docker compose up`/`sudo systemctl enable --now rwe` 確認這兩支产物本身沒問題（語法驗證不等於
> 「真的能啟動」）。
>
> **Gate 7.5 v2 ROUND 2（2026-07-04，本輪，GATE PASSED）**：上面「Gate 6 v2 validation-round
> fixes」段落記錄的 2 個修復（D-V2V-1/D-V2V-2）在本輪由 validator **對一個獨立真實 process 重新
> 驗證**（不是只信任 Gate 6 實作報告）：真的推送一個 mcp-config + skill 資產，送出真實
> `agent()` 呼叫，直接讀取真正被 spawn 出來的 `claude` CLI 子行程自己在 OS 行程表（`ps aux`）
> 裡的命令列參數（不是讀原始碼），看到真實
> `--mcp-config {"mcpServers":{"demo-mcp-v2r2":{...}}} --setting-sources=project
> --strict-mcp-config`；run 完成後確認推送的 `SKILL.md` 真的被實體化進「那一次 run 自己」的工作
> 目錄下的 `.claude/skills/`（bytes 完全相符）。遞迴保護（D4）也對本輪自己的真實 instance 重新
> 驗證：推送本產品自己的 guidance skill（`plugin/skills/rwe-remote-workflow/SKILL.md`）與一個
> 指向自己 bind/port 的 mcp-config，兩者皆真實被排除、回應中附上原因，且確認未寫入磁碟。
> `/dashboard` 頁面也重新驗證：真實 `GET /dashboard` 回傳含 `<html>`/`<title>` 與真正 client JS
> 的 HTML，`GET /dashboard/<runId>` 走 SPA 路由，並示範不必手動重新整理的即時更新（同一個 client
> 在送出新 run 前後重新輪詢 `/api/runs`，筆數從 1 變 2）。這次驗證環境沒有可用的 headless
> browser（`npx playwright` 需要額外安裝，這個環境沒有預先準備），所以本輪對 `/dashboard` 的驗證
> 停在「curl + DOM 內容斷言」層級，不是逐畫素渲染層級——誠實記錄，未升級宣稱。REQ-010/011/015
> 則依「已通過、不重新覆蓋測試」的收斂原則，只做了煙霧回歸：真實 Claude Code CLI（`claude mcp
> list`）重新確認、`scripts/smoke.sh` 真實 pass、真實 `SIGTERM` 孤兒回收確認無孤兒程序；
> docker/sudo 環境缺口（D-V2V-3）維持不變，不再重複驗證。完整證據見
> `.sdlc/features/001-remote-workflow-engine/08-validation.md` 的「v2 ROUND 2」章節。
>
> **本文件下方 v1 章節為第七輪 Gate 7.5（Gate 8 收尾修復的範圍化重新驗證）後改寫，原樣保留。**
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
  **v1 提醒（第五輪起）已於 v2 TASK-027 修復，本輪（Gate 7.5 v2 ROUND 2）重新以真實 process
  確認**：正常關機（`SIGTERM`）現在真的會連帶停掉這個子行程，不再留孤兒；且可以在
  `rwe.config.json` 用 `litellmPort` 鍵讓每個實例指定不同 port（不再固定 4000），見 §1b/§6 第 7/8
  項。啟動前確認沒有孤兒 `litellm` process（下方 §2 步驟 5）仍建議保留作為額外保險，但已不是唯一
  防線。
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
>
> **Gate 7.5 v2 D-V2G8-1/2 安全性重新驗證這一輪（本輪）新發現並修正的第二個 config drift（更嚴重）**：
> 前一輪（Gate 8 v2 route-back, IMPL-064）已經把程式碼內建的 fallback 從 `["Read","Write","Bash"]`
> 改成不含 `Bash` 的 `["Read","Write"]`（D-V2G8-1(b)，見 §1c 安全模型），**但當時沒有同步檢查已進
> 版控的 `rwe.config.example.json`**——它自己仍然明文寫著
> `"defaultAllowedTools": ["Read", "Write", "Bash"]`，而 README.md/本文件 §2 步驟 3 的 quickstart
> 都指示使用者直接 `cp rwe.config.example.json rwe.config.json`。結果是：**任何依照文件步驟部署的
> 人，實際拿到的預設工具面仍然含 `Bash`**——設定檔本身把 D-V2G8-1(b) 這個「Bash 預設關閉、需明確
> opt-in」的修復整個蓋掉了，等於這個 HIGH 安全修復從未在真實部署路徑上生效過。**本輪已修正**：
> `rwe.config.example.json` 與下方 JSON 範例都已改成 `["Read", "Write"]`（不含 `Bash`），與程式碼
> 內建 fallback、§1c 安全模型描述的行為重新一致。這是 Gate 7.5 §4b「config drift = deploy failure
> waiting to happen」條款存在的確切理由——本輪視為一個真實發現+已修正的缺口記錄於此，並在
> `08-validation.md` 留下對應證據，不是靜默補丁。
> **（v3 更新，2026-07-11）**：上述 v2 敘述已被 D-V3M-3 取代——預設集現在**刻意含 `Bash`**（confined
> 在工作目錄下），範例與內建 fallback 皆為 `["Read","Write","Edit","Glob","Grep","Bash"]`。詳見頂部
> ⭐v3 塊與 §1c(b)。

| 設定檔 | 用途 | 本次是否異動 | 需補的鍵/值 |
|--------|------|--------------|-------------|
| `rwe.config.json`（不進版控；由 `.example` 複製而來，本身**不含機密**） | 伺服器啟動設定：`bind`、`port`、`workRoot`、`timeoutMs`、`retries`、`gateway`（`"sdk"｜"direct-fetch"`，見下）、`agentDefinitionsDir`（`agents/*.md` 定義目錄，見下）、`defaultAllowedTools`（見下）、`aliases`（模型別名 → provider/model 對照表）、**v2 新增選填鍵**：`schedulerDbPath`（排程 SQLite 檔路徑，省略預設 `$workRoot/schedules.db`）、`assetRoot`（`asset_push` 資產儲存根目錄，省略預設 `$workRoot/assets`）、`litellmPort`（見下方 Gate 7.5 v2 ROUND 2 補充——**現在可以設定**，用來避開多實例的 4000 port 碰撞） | 是（本輪 Gate 7.5 v2 ROUND 2 補充說明，見下） | 見下方「設定檔內容」；金鑰一律用環境變數，絕不寫進此檔 |
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
  "defaultAllowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
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
`defaultAllowedTools`（**第六輪補上文件說明，v2 Gate 8 review 後修正**）：`gateway:"sdk"` 路徑下，
當一次 `agent()` 呼叫沒有自帶 `opts.allowedTools`（且對應的 `agentType` 定義也沒有 `tools:`
frontmatter）時，套用的預設工具清單——縮小送給模型的工具面，避免小型本機模型被完整 Claude Code CLI
工具面（含此主機環境自己的外掛/MCP 工具）淹沒而放棄嘗試工具呼叫；省略此鍵時內建預設值是
**`["Read","Write","Edit","Glob","Grep","Bash"]`**（v3 D-V3M-3；`Bash` 已在預設但被工作目錄邊界
封閉，`WebFetch`/`WebSearch`/`Task`/`Agent` 仍需 opt-in——見下方「安全模型」(b)/(d)）。
優先序：呼叫端 `opts.allowedTools` > `agentType` 定義的 `tools:` > 這個設定鍵 > 內建預設，永遠不會
不設限。不提供 `aliases` 時，伺服器內建預設值等同上面拿掉 `local` 那份（全指向 anthropic）。
`agentDefinitionsDir` 省略時 agentType 註冊表為空（每個 `agentType` 都會回報 unknown，不影響不用
`agentType` 的腳本）。

**Gate 7.5 v2 ROUND 2 config-file sync check 補充（本輪新發現的文件漂移，已修正）**：`litellmPort`
（型別 `number`，選填）在 v2 TASK-027 就已經被 `composeConfig()` 真的接進
`LiteLLMProxyManager(aliases, {port: fileConfig.litellmPort})`（`tests/unit/
compose-config-v2-wiring.test.ts` 綠燈確認）。**v3 D-V3M-4 更新**：省略 `litellmPort` 時**不再預設
4000，而是綁一個 OS 分配的 ephemeral 空閒 port**（`net` 綁 `:0` 取得），徹底避開多實例/測試撞
port 的問題（實測常駐 sdk 服務跑在動態 port，可與完整測試套件並存）；明確指定 `litellmPort` 仍
有效，會走既有的 stale-owner pre-bind 檢查。`schedulerDbPath`/`assetRoot` 兩個 v2 鍵
（型別皆 `string`，選填）也是同一批新增鍵，皆有可用預設值，一般部署可以省略不填。

環境變數也可覆蓋設定檔部分欄位（不需要設定檔也能啟動）：
| 環境變數 | 對應 | 預設 |
|----------|------|------|
| `RWE_CONFIG_PATH` | 要讀取的 JSON 設定檔路徑 | `./rwe.config.json`（不存在則略過，全用內建預設） |
| `RWE_BIND` | `bind` | `127.0.0.1` |
| `RWE_PORT` | `port` | `8787` |
| `RWE_WORK_ROOT` | `workRoot`（狀態/journal/工作目錄根） | 設定檔值，否則系統暫存目錄下自動建立 |

## 1c. 安全模型（Security Model，v2 Gate 8 review 收尾修復，D-V2G8-1(a)(b)(c)(d)）

> 本節記錄 `gateway:"sdk"` 路徑（`ClaudeAgentSdkGatewayClient`）的 agent 工具權限、供應商金鑰
> 存放、以及 run 工作目錄隔離這三件事**實際**如何運作——修復對象是 v2 Gate 8 review 發現的
> V3 HIGH 缺陷：舊版把 `permissionMode:'bypassPermissions'`（跳過每一次工具呼叫的裁決）與預設
> 就含 `Bash` 的工具面、外加只有 `cwd` 而無任何路徑邊界檢查三者疊加，讓任何 `agent()` prompt
> 都能誘使 CLI 讀取工作目錄以外的任意路徑（例如 LiteLLM 代理自己的 `config.yaml`——內含供應商
> API 金鑰——或另一個 run 的工作目錄）。**本節描述的是修復後的行為，也是目前的實際行為**——不是
> 尚待實作的計畫。

**(a) 不再用 `bypassPermissions`**：`options.permissionMode` 固定是 `'default'`（不是舊版的
`'bypassPermissions'`）。headless 模式下仍然不會卡在互動式權限提示——因為下面 (d) 的
`canUseTool`/`PreToolUse` 回呼一律會同步回傳一個明確決策（`allow` 或 `deny`），從不回傳
`null`/pending。

**(b) 預設工具面 = 受限的檔案+搜尋+shell 集（v3 D-V3M-3 更新，取代舊的「不含 Bash」）**：
`gateway:"sdk"` 路徑下，一次 `agent()` 呼叫若沒有自帶 `opts.allowedTools`（且對應 `agentType`
定義也沒有 `tools:` frontmatter）、也沒有設定 `defaultAllowedTools`，套用的內建預設工具清單是
**`["Read","Write","Edit","Glob","Grep","Bash"]`**——與真實 dynamic-workflow agent 的工作工具面
對齊。**`Bash` 現在在預設集裡，但被 (d) 的工作目錄邊界封閉**（`cwd`=該次 run 工作目錄 + 每次呼叫
的 realpath 路徑檢查；一個試圖逃出工作目錄的 Bash 指令會被 `deny`）。這**刻意反轉**了 v2 當初把
Bash 排除於預設的決定：那個排除只在「還沒有 fs jail」時成立（Bash 預設 + `bypassPermissions` 會
在父信任區跑任意 shell）；現在兩半都變了——`permissionMode` 是 `'default'`（見 (a)）、且 (d) 的
realpath 邊界對每次呼叫強制，jail 已存在，所以 Bash 以「限制在固定工作目錄下」的形式回到預設。
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

# 步驟 5（v2 TASK-027 修復後為額外保險，非唯一防線；正常 SIGTERM 關機已會自動清掉）：
# 啟動前先確認沒有非正常關機（如 kill -9）殘留的孤兒 litellm process 占著 4000 port
# （或你在 rwe.config.json 設定的 litellmPort）
ps aux | grep '[l]itellm --config' && echo "先清掉這些 process 再繼續！" \
  || echo "乾淨，可以啟動"
# 若有殘留： ps aux | grep '[l]itellm --config' | awk '{print $2}' | xargs -r kill

# 步驟 6：啟動服務
RWE_CONFIG_PATH=./rwe.config.json RWE_WORK_ROOT=/var/lib/remote-workflow-engine npm run start
# 建議用 systemd / pm2 / docker 常駐；此指令本身是前景長駐程序，SIGINT/SIGTERM 會優雅關閉
# （但見 §6「仍待下一輪修復」第 1 條：目前優雅關閉不會連帶停掉內部的 litellm 子行程，需另外清理，
#  且見上方步驟 5：下次啟動前務必先清乾淨，否則有誤連舊代理的風險）
```

## 2b. 容器化 / systemd 常駐化 / 上線前煙霧測試（v2, REQ-011, DES-022, TASK-023）

> 本節記錄 v2 新增的三個部署封裝產物：`docker-compose.yml`、`deploy/rwe.service`（systemd
> unit）、`scripts/smoke.sh`（非互動式、以結束碼判斷成敗的煙霧測試）。**本機與遠端主機的部署
> 步驟完全相同**——沒有「本機才有的捷徑」。

**docker-compose**（不需要另外寫 Dockerfile；直接把 repo 掛進官方 Node 22 image，跑與手動部署
完全相同的 `npm ci && npm run start`）：
```bash
docker compose up                              # 預設 profile：只跑 server，走免依賴的
                                                # direct-fetch/SDK 路徑，不需要 LiteLLM/Python
docker compose --profile litellm up server-litellm
                                                # 選用 profile：容器內額外安裝 Python 3.11 +
                                                # litellm[proxy]（同 §1 的 D-R3 版本 pin 理由）
```

**systemd**（`deploy/rwe.service`，`Restart=on-failure` 自我修復）：
```bash
sudo cp deploy/rwe.service /etc/systemd/system/rwe.service
sudo systemctl daemon-reload
sudo systemctl enable --now rwe.service
```
`ExecStart` 用的是與本文件 §2 步驟 6 完全相同的 `npm run start`（此 repo 沒有另外維護一份編譯產
物 `dist/main.js`，見該檔案內註解）。

### 無 root 部署：systemd **user** service + 本地 Ollama（實測路徑，2026-07-07 驗證）

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

**三個實際會踩到的坑（本次實測排除，v2.1 已修 + 補測試）**：
1. **`ExecStart` 不要用 `npm`** —— 若 node 是用版本管理器裝的（例如在 `~/.local/node/bin/`），
   `/usr/local/bin/npm` 可能是失效 symlink，而 systemd 用最小環境看不到互動 shell 的 PATH →
   `status=203/EXEC`。範本改用 **node 絕對路徑直接跑 tsx**：
   `ExecStart=<node 絕對路徑> node_modules/tsx/dist/cli.mjs src/main.ts`，並在 unit 裡設
   `Environment=PATH=<node bin 目錄>:/usr/bin:/bin`。用 `node -e 'console.log(process.execPath)'`
   查你的 node 真實路徑。
2. **免依賴啟動要設 `useLiteLLMProxy:false`** —— 否則開機/首次 `agent()` 會去 `spawn litellm`，
   沒裝就 `ENOENT` 崩潰。設 `gateway:"direct-fetch"` + `useLiteLLMProxy:false`，ollama 走原生直連
   `localhost:11434`，完全不碰 LiteLLM。
3. **`timeoutMs` 是「單次 `agent()` LLM 呼叫」的斷路器，不是整體 workflow 逾時**（workflow 本身
   非同步、無總時長限制）。本地 7B 生成大回應會超過預設 15 秒 → 被切成 null；跑本地模型建議調高
   到 `300000`（5 分鐘）。

**上線前煙霧測試**（`scripts/smoke.sh`，非互動式、結束碼 0=成功）：
```bash
scripts/smoke.sh
```
啟動伺服器 → 送出一個**不呼叫 `agent()`** 的範例 `workflow_run` → 輪詢 `workflow_status`/
`workflow_result` 至完成 → 關閉伺服器。不需要任何 LLM 供應商金鑰或 LiteLLM/Python，只驗證
`workflow_run`/`workflow_status`/`workflow_result` 這條核心路徑本身能不能跑完。

### 沒有身份驗證的已知風險（v2 no-auth caveat，D5/C4）

**`asset_push` 目前會把任意內容真實寫入伺服器端磁碟**（`$workRoot/assets/<kind>/<name>/...`，
已對真實 process 驗證）。v2 完全沒有 authentication/authorization（v3 才會補上 OIDC
resource-server，見 ARCH 決策 D5/C4）——任何能連到 `/mcp` 這個 HTTP 端點的人都能呼叫
`asset_push`。**在 v3 補上真正的身份驗證之前，遠端部署只能透過 SSH 通道（例如
`ssh -L 8787:127.0.0.1:8787 user@host`）或 VPN 存取這台伺服器，絕對不要把 `asset_push` 所在的
port 直接暴露在公開網路上。**

> **Gate 7.5 v2 ROUND 1 更正（本輪發現的文件與現實落差）**：本節先前的文字說推送的 skill/hook
> 檔案「之後會被真實載入/執行」——**這在目前版本並不成立**：已對真實獨立 process 確認，
> `agent()` 呼叫（`ClaudeAgentSdkGatewayClient`）目前寫死 `settingSources:[]`（略過所有檔案系統
> skill 探索）與 `strictMcpConfig:true`（`mcpServers` 從未被填入），且 `composeConfig()`/
> `createServer()` 從未把 `AssetSyncService` 存的資產接進 gateway。**推送的 skill/MCP config 目前
> agent 完全用不到**，見 `.sdlc/features/001-remote-workflow-engine/08-validation.md` 的
> `VAL-017`。上述「任意寫入磁碟」的風險本身依然真實存在（`asset_push` 仍是真實的伺服器端檔案
> 寫入能力），SSH 通道/VPN 的建議維持不變；只是「寫入後會被執行」這個額外風險，在這個接線缺口
> 修好之前，**目前並不成立**。

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
# v2 TASK-027 起：這個 SIGTERM 現在會自動連帶砍掉伺服器內部管理的 litellm 子行程（見 §6 第 7 項，
# 本輪已用真實 SIGTERM 重新確認）。若你懷疑仍有非正常關機（kill -9）留下的孤兒，手動確認/清理：
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
| 關掉伺服器後還有一個 `litellm --config ...` process 留著 | **v2 TASK-027 修復前**（v1 已知限制）：優雅關閉不會連帶停掉子行程。**v2 起已修復**（本輪 Gate 7.5 v2 ROUND 2 config-sync check 重新以真實 `SIGTERM` 確認）：正常 `SIGTERM`/`SIGINT` 關機現在真的會連帶砍掉內部管理的 `litellm` 子行程，2 秒內從 `ps aux` 消失，不留孤兒。若你仍看到殘留 process，多半是非正常關機（如 `kill -9`）留下的 | 手動 `ps aux \| grep litellm` 找到後 `kill`；正常關機（`SIGTERM`/Ctrl-C）應已足夠，不需要每次都手動檢查；也可以用 §1b 的 `litellmPort` 鍵讓每個實例用不同 port，徹底避開誤連風險 |
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

- **仍待處理的操作面風險（v1 文字，第二/五輪起已知——見下方 v2 TASK-027 修復說明，7/8 已解決）**：
  7. ~~正常關機不會停止內部管理的 `litellm` 子行程（孤兒 process，需手動清理）~~ **已在 v2
     TASK-027（DES-022，orphan-reap）修復，Gate 7.5 v2 ROUND 1/2 皆對獨立真實 process 重新確認，
     本輪（v2 ROUND 2 config-sync check）再次親自重跑確認仍然成立**：對一個真實 `gateway:"sdk"`
     實例（自己會 spawn 真實 `litellm[proxy]` 子行程）送一個真實 `SIGTERM`，Node 主行程與
     `litellm` 子行程兩者皆在 2 秒內從 `ps aux` 消失，沒有孤兒殘留。其暫存設定目錄
     （`/tmp/rwe-litellm-*`）目前仍不會自動清除（純磁碟空間問題，非阻斷）。
  8. ~~`LiteLLMProxyManager` 固定使用 4000 port，結合上一項的孤兒行程問題，第二個伺服器實例可能
     誤連到殘留自前一個實例的舊代理~~ **v2 TASK-027 引入 `litellmPort` 設定鍵後風險大幅降低**：
     (a) 正常關機現在真的會清掉子行程（見上一項），不再留下孤兒；(b) 即使仍想保守起見，每個實例
     可以在自己的 `rwe.config.json` 明確指定不同的 `litellmPort`，讓多實例天生就不會共用同一個
     port（見 §1b）。啟動前確認沒有孤兒 `litellm` process 這個操作習慣（見 §1/§2/§4/§5）仍建議
     保留作為額外保險，但不再是唯一防線。

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
  給中止的 agent 紀錄一個專屬終止狀態、拿更大的本機模型或付費供應商重測工具呼叫能力等項目。
  ~~修掉 `litellm` port 4000 碰撞風險~~ **已在 v2 TASK-027 解決**（orphan-reap + `litellmPort`
  設定鍵，見上方第 7/8 項與 §1b），不再是待辦項。
