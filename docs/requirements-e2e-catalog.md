# remote-workflow-engine — 需求總覽 + E2E 測試方式

> 依 slice 分組,涵蓋 REQ-001..026。每項:**做什麼** · **E2E 怎麼測**(對活引擎 `http://<host>:8787/mcp`)· **狀態**。
> 狀態圖例:✅ 完成且真機驗證 · 🟡 完成但收尾/鏈結未補 · ⛔ 延後(使用者決定) · ⚙️ 環境/能力受限
>
> 通用 E2E 前置:引擎跑起來(`systemctl --user start rwe.service` 或 `npm run start`)。MCP 呼叫格式:
> ```bash
> curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
>   -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<TOOL>","arguments":{...}}}'
> ```
> 非同步契約:`workflow_run` 回 `runId` → poll `workflow_status` 到 terminal → `workflow_result` 取值。

---

## slice-1(v1 核心引擎)— REQ-001..007, 013, 014 ✅ 全部結案

| REQ | 做什麼 | E2E 測試方式 | 狀態 |
|---|---|---|---|
| **001** | 原封不動執行 Claude 產生的 workflow JS(100% API 相容) | `workflow_run{script:"return 6*7;"}` → poll → `workflow_result` = 42;貼一支真的用 `agent()/parallel()/pipeline()/phase()` 的腳本應照跑 | ✅ |
| **002** | Workflow 語意:巢狀、併發上限、預算計量 | `workflow_run` 帶 `budget`,腳本跑 `parallel()` 多個 `agent()`;`workflow_status.result` 看 phases/agents,超預算的 call 應被擋;`workflow()` 第二層巢狀 → `NESTING_ERROR` | ✅ |
| **003** | 每個 `agent()` 經 Claude Agent SDK 真實執行 | 腳本 `return await agent("say hi")`;`workflow_agent_log{runId,agentId}` 應有真實 transcript 事件(非空);provider 掛掉時 `agent()` → null(run 續跑) | ✅ |
| **004** | 多模型路由(alias → provider,經 gateway) | `rwe.config.json` 設 alias(如 `sonnet→ollama/qwen`);跑 `agent("x",{model:"sonnet"})`,transcript 的 provider/model 應對上;未知 alias → 提交時 `UNKNOWN_ALIAS` | ✅ |
| **005** | MCP Streamable HTTP 介面控制 run | `initialize` 握手回 protocolVersion;`tools/list` 回 22 工具;整個 submit→poll→result 走 MCP | ✅ |
| **006** | 生命週期:suspend / resume / stop,狀態持久 | 跑一支長腳本 → `workflow_suspend` → status=suspended → `workflow_resume` → 續跑;重啟引擎後 `workflow_status` 仍讀得到(SQLite 持久) | ✅ |
| **007** | 逐 agent 可觀測性(MCP 工具) | `workflow_status.result.agents[]` 看每個 agent 的 state/tokens;`workflow_agent_log` 取單一 agent transcript;`/dashboard` 頁即時顯示 | ✅ |
| **013** | 每 workflow 工作資料夾 + 每 run 獨立 workspace | 兩個 run 各自寫檔互不可見;`workflow_artifacts{runId}` 只列該 run 的檔;跨 run 讀對方 workspace 被 jail 擋 | ✅ |
| **014** | 具名 workflow registry(存/列/按名叫;`workflow(name)` 相容) | `workflow_register{name,script}` → `workflow_list` 看得到 → `workflow_run{name}` 按名跑;`workflow_deregister` 移除;叫未知名 → `CatalogNotFoundError`(訊息含名字) | ✅ |

---

## slice-2(v2 平台化)— REQ-008..011, 015 ✅ 結案(唯一未完成=下面 v3 的 OIDC)

| REQ | 做什麼 | E2E 測試方式 | 狀態 |
|---|---|---|---|
| **008** | Web dashboard(runs / agents) | 瀏覽器開 `http://<host>:8787/dashboard`;跑一個 run,頁面**不重整**即時更新;點 agent 看 transcript | ✅ |
| **009** | 同步上傳本地 skills(防遞迴) | `asset_push{kind:"skill",name,files}` → `asset_list` 看到;materialize 進 run workspace `.claude/skills/`;自我指涉/遞迴檔在 `excluded[]` 被擋 | ✅ |
| **010** | Claude Code client plugin(安裝 + 指導 skill,不衝突) | 裝 `remote-workflow-plugin`,`.mcp.json` 指向引擎;`workflow_*` 工具出現且不遮蔽本地 `Workflow` 工具 | ✅ |
| **011** | 可部署於本地 / 遠端 Linux | `systemctl --user start rwe.service` 真跑、enabled 開機自啟(**今天已真機驗證**);docker-compose 僅語法驗證(⚙️ 環境缺口) | ✅ (docker ⚙️) |
| **015** | 執行模式:cron / 一次性定時 / 常駐可觸發 | `schedule_create` 建 cron/一次性;`schedule_list`/`schedule_setEnabled`;`workflow_trigger{name}` 觸發常駐;disabled 觸發 → `SCHEDULE_DISABLED` | ✅ |

---

## slice-3(v3 provider/安全強化)— REQ-016..021（+ REQ-012 延後）✅ Gate 1-8 結案(VAL-025..030 real:true)

| REQ | 做什麼 | E2E 測試方式 | 狀態 |
|---|---|---|---|
| **016** | 非-Anthropic 模型跑完整 harness(tool loop + MCP + skills)經 SDK gateway | `agent("寫檔",{model:"local"})`(Ollama alias),`workflow_agent_log` 應見原生 `tool_use` + 檔真的寫進 workspace;非-Anthropic alias thinking 應 disabled(不 400) | ⚙️ 7B tool-use 能力受限(D-F11);harness 路徑本身已驗 |
| **017** | MCP 工具 server 端 provision(registry)、按名引用、明確注入 | `mcp_provision{name,kind,config}`(會真 probe);腳本 `agent("x",{mcp:["未provision名"]})` → run failed `MCP_NOT_PROVISIONED`;只有明確引用的 MCP 被注入(strictMcpConfig) | ✅ 錯誤路徑+registry 已真驗;happy-path 需真 stdio MCP server |
| **018** | Provider/MCP 機密經 server 端 store,workspace 不可達 | 用 `${secret:NAME}` handle;缺 secret → 明確 `SECRET_MISSING`(非洩漏字面、非 hang);grep run workspace 應無任何 secret | ✅ 真驗(VAL-028:secret 存 handle、缺→SECRET_MISSING、workspace 無洩漏;happy-path 需真 stdio MCP server) |
| **019** | Hooks 明確不支援(移除上傳的 user hooks) | `asset_push{kind:"hook"}` → `excluded:[{reason:"HOOKS_UNSUPPORTED"}]`,nothing written(關 RCE 向量);引擎自己的 PreToolUse 邊界 hook 不受影響 | ✅ **今天真機驗證** |
| **020** | SDK gateway 路徑對 hung LLM call 設界(timeout + retries) | alias 指向不可達 provider,`agent()` 在 timeout 內 resolve `null`(run 續跑);失敗記錄在 agent record,非假成功文字。測試:`val-023` | ✅ 真驗(VAL-029) |
| **021** | 無宿主 project 的 CLAUDE.md / auto-memory 洩漏進 agent context(workRoot 隔離) | 用 `RWE_WORK_ROOT=<repo內含.git的路徑>` 開機 → 應 fail-fast `WORKROOT_INSIDE_PROJECT`(指出違規 ancestor);workRoot 在 project 外則正常開機 | ✅ 真驗(VAL-030,真 boot fail-fast) |
| **012** | OAuth 2.0 / 通用 OIDC resource server | (延後,未建)啟用 OIDC issuer 後無/錯 token → 401 + resource metadata;PKCE 流程完成後可存取;停用時 = v1 相容 | ⛔ 使用者 D5 延後 |

> **補償控制(取代 OIDC)**:引擎綁 LAN + ufw allowlist(只放 192.168.0.0/24 + SSH),或 127.0.0.1 + SSH tunnel。**今天已設定並驗證**。

---

## slice-4(v4 傳輸/工作區生命週期)— REQ-022..026 ✅ Gate 1-8 結案(VAL-031..035 real:true)

| REQ | 做什麼 | E2E 測試方式 | 狀態 |
|---|---|---|---|
| **022** | `workflow_artifacts` 遞迴列檔 + sha256 | run 寫巢狀檔 → `workflow_artifacts{runId}` 回每檔 path/size/sha256(可 diff 驗證);`.git`/`venv` 不列 | ✅ |
| **023** | `workflow_artifact_get` 分塊、realpath-contained 取檔 | `workflow_artifact_get{runId,path,offset,length}` 取窗格 bytes;`../`/symlink 逃逸 → 拒絕(typed error) | ✅ |
| **024** | readBody 413 上限(過大請求體擋下) | POST 超大 body 到 `/mcp` → 413(不 OOM) | ✅ |
| **025** | seed-into-workspace + `.claude` strip | `workflow_run{seed:[{path,contentB64}]}`;檔在 agent 啟動前 materialize 進 workspace;`.git` 被剝除;seed 到 `.claude/` 的規則 | ✅ |
| **026** | `workspace_purge` + TTL-GC | terminal run → `workspace_purge{runId}` 刪 workspace(保留 journal);active run 拒絕 `RUN_NOT_TERMINAL`;TTL 過期自動 GC | ✅ |

---

## slice-5(v5 GitHub issue 報告)— REQ-027..030 ✅ Gate 1-8 結案(VAL-036..039 real:true)

> 新 MCP 工具 `issue_report`:任何連進來的 client/agent 把 agent 事先分析好的結構化問題報告開成 GitHub issue(`HsuJavis/remote-workflow-engine`)——「report→agent 解 issue flow」的進料端。GitHub token 用 server 端 secret(REQ-018 機制)。

| REQ | 做什麼 | E2E 測試方式 | 狀態 |
|---|---|---|---|
| **027** | `issue_report` 開結構化 GitHub issue | `issue_report{title,reproSteps,analysis,logs?,severity?,component?,runId?}` → `{issueNumber,url}`;缺必填 → `ISSUE_REPORT_INVALID`、不開 issue | ✅ 真開 issue #1 驗證 |
| **028** | GitHub token 只從 server 端 secret,workspace 不可達 | token 存 `RWE_SECRET_GITHUB_TOKEN`;缺 → `GITHUB_TOKEN_MISSING`(非洩漏/非 no-op);grep workspace 無 token | ✅ |
| **029** | 結構化 agent 可讀 body + labels | issue body 固定模板(Summary/複製步驟/Logs/分析/環境+版本+時間/Linked run)+ `agent-reported`/`severity:` label | ✅ 真 issue GET 驗 6 section+labels |
| **030** | bounded、typed-error GitHub API(不吊死/不崩) | provider 不可達/timeout/非2xx → `GITHUB_API_ERROR`(帶 status);4xx 不重試 | ✅ |

## slice-6(v6 issue 讀寫工具集)— REQ-031..036 ✅ Gate 1-8 結案(VAL-040..045 real:true)

> 「report→解」flow 需要的讀寫原語 + `issue_report` 兩項升級。同一把 PAT(Issues:R/W)、同 `GithubIssueClient` 模式。真正「解 issue」= Claude Code CLI 本地解 + `Fixes #N` commit 關閉。

| REQ | 做什麼 | E2E 測試方式 | 狀態 |
|---|---|---|---|
| **031** | `issue_get{number}` 讀單一 issue | → `{number,title,state,labels,body,url,commentCount}`;未知 → `ISSUE_NOT_FOUND` | ✅ 真跑 issue #2 驗 |
| **032** | `issue_list{labels?,state?,since?,limit?}` 枚舉 issue | → bounded `[{number,title,state,labels,url}]`(預設 open;如 `labels:["agent-reported"]`) | ✅ |
| **033** | `issue_comments{number}` 讀回覆 | → `[{id,author,body,createdAt}]`(對話/先前嘗試) | ✅ |
| **034** | `issue_comment{number,body}` 發回覆 | → `{commentId,url}`;空 body → `ISSUE_COMMENT_INVALID`;未知 issue → `ISSUE_NOT_FOUND` | ✅ |
| **035** | `issue_report` dedup(不洗版) | 同 fingerprint 有 open issue → comment 到既有、回 `deduped:true`、不開新 issue | ✅ 真驗(deduped:true,未開 #3) |
| **036** | `issue_report` runId 自動富化 | 帶 `runId` → body `## Linked run` 段自動塞該 run 的 status/agent_log/artifacts(best-effort,拉不到不失敗) | ✅ 機制單元驗+report 路徑真驗 |

---

## 目前「可以做到」的能力總結(一句話)

**一個自架的 MCP 服務(共 27 工具),讓 agent/client 遠端提交 Claude 格式的 dynamic-workflow JS,在 server 端 per-run 隔離的 workspace 裡跑真實多 agent 編排(可換 provider:Anthropic / OpenAI / Ollama / 任何 OpenAI 相容端點),支援 submit→poll→result 非同步契約、suspend/resume/stop、具名 registry、排程(cron/一次性/常駐)、seed 進去 + artifacts 拉回、per-run DoS 上限、server 端機密與 MCP provision、workRoot 隔離、Web dashboard;並內建一組 GitHub issue 工具(`issue_report` 含 dedup + runId 富化、`issue_get`/`issue_list`/`issue_comments`/`issue_comment`)當「report→agent 解 issue」的進料+讀寫原語;可用 systemd 部署 + LAN allowlist 對外服務。** 尚缺:內建認證(OIDC,延後)。**6 個 slice(v1-v6)全 Gate 1-8 結案。**
