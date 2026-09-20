# REQ-117 冷主體實驗 — 2026-09-20(v34 後的 guide 與工具面)

## 協定遵循
REQ-117 的驗收要求主體必須是**沒看過本專案開發過程**的全新實例,且驗證只能由真跑產生。
本次:orchestrator 自行以 scratch 設定(port 8793、auth 關閉、workRoot 在 repo 外)啟動引擎,
只把 `http://127.0.0.1:8793/mcp` 這個 URL 交給主體;主體被明文禁止讀取本機任何檔案與 git repo,
資訊來源僅限 `tools/list` 與各工具自身的回應。主體為獨立 agent,未繼承本次對話的任何脈絡。

## 結果:通過(端到端完成),且**零引擎拒絕碼**
主體自行撰寫了雙 agent 協作腳本(`collab-draft-critique`:writer 起草 → critic 評論 → writer 修訂),
連同 Mermaid 泳道圖一次註冊成功,發布、啟動、輪詢到終態、讀回結果全部完成。
**84 次 tools/call 中,沒有任何一次收到 JSON-RPC error 或引擎拒絕碼** ——
沒有 SCAN_VIOLATION、DIAGRAM_MISMATCH、LANE_MISMATCH、EDGE_MISMATCH、PARAM_* 。

主體指名「第一次讀就做對」的四處:
- `run_start` 的說明(v33 REQ-201 改寫的那段):「剛註冊的沒有 release —— 用 {version} 跑」與
  「run_start 不回結果,要輪詢 run_status 到終態再 run_result」,照字面做即成功。
- guide 的 canonical「draft, critique, revise」範例與其泳道圖,近乎原樣照抄即通過註冊。
- `run_start.overrides` 的 `{agents:{'<label>':{model,effort,timeoutMs,appendPrompt}}}` 結構。
- `workflow_publish` 的 schema 直接告訴它版本字串格式是 `"v1"`,不必猜。

## 主體踩到的四個坑(全部登記為文件/介面缺陷,依 REQ-117 自己的規定)
**D1 — 全部 agent 都失敗,run 仍報 `status:"completed"`、`result:null`。**
第一次跑的三個 agent 全部逾時失敗(`default` alias 指向沒有回應的本機 ollama qwen2.5:7b),
但頂層狀態是 completed。主體是去讀 `agents[]` 才發現的。介面上沒有任何一句話說這是可能的。

**D2 — 宣告 `timeoutMs: 60000`,實際 120000ms 才失敗(兩次,精確兩倍)。**
根因已查實:`types.ts:189` 寫著「On timeout the call yields null (after retries)」,
而部署的 `retries: 1` 代表兩次嘗試 —— **宣告的 timeoutMs 界定單次嘗試,不是整個呼叫**。
這件事只存在於原始碼註解,廣告介面與 guide 都沒說。

**D3 — 失敗的 `await agent()` 回 `null` 而不拋例外,腳本靜默帶著壞資料往下走。**
主體實測到 critic 收到的 prompt 是 `"Critique this draft in one sentence: null"`。
`types.ts:189` 明文「it does NOT throw」,是刻意設計;但 guide 只講了 `parallel()` 的 thunk 失敗給 null,
從未說裸的 sequential `await agent()` 同樣如此。對串接多個 agent 的作者,這是會壞資料的缺口。

**D4 — 每個工具回應的 `content[0].text` 是雙重 JSON 編碼,且 guide 約 39.5KB。**
主體的輸出被截斷兩次,必須先寫檔再讀回。介面沒有警告酬載大小,也沒說明這層包裝。

## 處置
D1/D2/D3 併入 v35(與「失敗 run 不留痕跡」同族:**失敗是靜默的**);D4 併入 v36。
本檔即 REQ-117 在 v34 之後的真跑證據,取代 VAL-190/192(它們早於 v34 對 guide 的實質改寫)。
