# REQ-117 冷主體實驗(第三次)— 2026-09-22,對 v37 的介面

## 協定
v37 由 DES-258 改寫了**即時** `workflow_authoring_guide` 的內容(host-path-grants 段落改為依
開機實測的監牢姿態渲染),VAL-245 的 v35 證據因此不再是這一版的證據 —— 與 v35 當時的裁決同理。
orchestrator 以當前程式碼另起 scratch 引擎(port 8795、auth 關閉、全新空 workRoot),
只交出 URL 給一個**與前兩次都不同**的全新獨立實例,禁讀本機任何檔案與 git。

開機日誌(本次實驗的受測對象之一):
`Bash confinement: UNCONFINED (bwrap: No permissions to create a new namespace...) —
remote run submissions will be refused; local (loopback) runs still proceed, unconfined`

## 結果:16 次 MCP 往返、零伺服器端失敗或拒絕,端到端成功
雙 agent 協作(writer 起草俳句 → critic 審閱)一次註冊通過(含泳道圖三段節點與邊),
run `389be6a2` 完成,`failedAgentCount: 0`,成本 $0.00425。

## 三個觀察點(前兩點是 v35 的回歸檢查,第一點是 v37 新增)

**(1) 開跑前能否知道 agent 的 Bash 在這台主機上能碰什麼 —— 能,且指名出處。**
主體引用 guide 的「Host path grants」段:「On this deployment, `Bash` is not confined:
the boot-time probe found no working sandbox on this host, so `Bash` runs with the same
filesystem access as the engine process itself」。**DES-258 的即時姿態渲染確實教到人。**
主體誠實加註:它兩個 agent 都用 `allowedTools: []`,所以只有文件宣稱、無實證 —— 這個保留是對的。

**(2) 能否預測失敗成本與 sequential 失敗的回傳 —— 能,而且它自己造了實驗去驗。**
主體另建一個 `critic.timeoutMs.default = 1` 的工作流程,事先從 `workflow_describe` 讀到
`attempts: 2, worstCaseMs: 2`,跑完確認 `critic` `state:"failed"`、`run_result.result.reviewed === null`。
**同時抓到一個文件缺口**:預測上界 2ms,實測 `startedAt→endedAt` 88ms ——
`worstCaseMs` 界定的是**模型等待預算**,不含派發與記帳開銷,所以它是下限而非精確上界,文件未說。

**(3) 跑完能否判斷裡面到底有沒有成功 —— 能,但不能只看頂層狀態。**
主體實測:強制逾時那次,頂層 `status` 仍是 `"completed"`(因為腳本接住 null 後正常返回),
但 `failedAgentCount: 1` 與 per-agent `state:"failed"` 說了實話,與 `run_status` 自己的說明一致。
它另以 `run_agent_log` 取回真實模型逐字稿交叉確認。**v35 的 D1 修復在 v36/v37 大改後仍然成立。**

## 主體挖出的三個不一致(全部登記,見下)
1. `workflow_describe` 廣告「predicted lane membership (phases[].agents)」,但實回 `phases: []`。
   orchestrator 追根:`mcp-facade:587` 由 `view.phases` 推導 → `workflow-view:207` 取 `full.phases ?? []`
   → catalog 的 `resolveDetail` 回傳 script/version/mermaid/params/triggers/diagramContract,
   **從來就沒有 phases**。此欄位對任何新註冊的工作流程**結構上恆為空**。
2. `workflow_register` 說明無條件寫「the caller becomes its owner」,但關閉驗證的部署上
   `workflow_describe` 回 `owner: null`。
3. `worstCaseMs` 是下限非精確上界(見上)。

## 結論
REQ-117 對 v37 的介面成立。本列同時是 DES-258(姿態即時渲染)最強的外部證據,
並為 v38 提供三條由冷客端實際踩出來的缺口。
