# Feature: Remote Workflow Engine(遠端 Workflow 執行環境)

> 單頁摘要(存於本 feature ledger)。完整追溯與進度:本 feature 的 `dashboard.html`
> (或 workspace 索引 `.sdlc/dashboard.html`)。

- **Status**: v1 done(Gate 1–8 全數通過,2026-07-03;v2 排程/同步/dashboard/plugin 待啟動)
- **Current iteration**: v1(核心引擎)
- **Owner**: hsuhungjung
- **One line**: 讓 Claude 產生的 workflow JS 檔可以 100% 相容地跑在自架(本地/遠端 Linux)伺服器上 —— 以 MCP Streamable HTTP 為介面,可換用 OpenAI/Gemini/本地 LLM,支援 suspend/resume/stop 與逐 agent 觀察。

## 迭代切片
- **v1 核心引擎**(REQ-001~007, 013, 014):workflow JS 相容執行、Claude Agent SDK agent 引擎、LiteLLM 多模型路由、MCP 介面、生命週期、MCP 觀察工具、各 workflow 專屬 work folder + 每次 run 獨立 workspace、具名 workflow registry(`workflow(name)` 相容)。無認證、預設只綁 localhost。
- **v2 遠端與同步**(REQ-008~011, 015):Web dashboard、本地 skills/hooks/MCP 設定同步上傳(含防遞迴)、Claude Code 客戶端 plugin、Linux 部署、執行模式(cron 排程/定時一次/常駐使用者 trigger)。
- **v3 認證**(REQ-012):OAuth 2.0 / 泛用 OIDC resource server(開發用 Keycloak、企業接 SSO/Entra ID)。

> 相容性基準文件:ledger 內的 `dynamic-workflow-compat-spec.md`(現行 dynamic Workflow 工具全能力盤點 + 本產品的擴充對照)。

## Layout
- Ledger (docs): `.sdlc/features/001-remote-workflow-engine/`(01-08 + 本 feature 的 `dashboard.html`)
- Source: `src/`(依 `state.yaml` `layout.src`)
- Tests: `tests/{unit,integration,e2e,acceptance}`
- Human handover: 產品根目錄的 `README.md` / `DEPLOY.md`(Gate 7.5 產出)

## Quick commands (from the repo root)
```bash
L=.sdlc/features/001-remote-workflow-engine
sh .sdlc/trace $L                   # regenerate this feature's dashboard.html
sh .sdlc/trace $L --check           # gate check
sh .sdlc/trace $L --impact <ID>     # iteration impact analysis
sh .sdlc/trace --features .         # workspace index + cross-feature split check
```
