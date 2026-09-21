# REQ-117 冷主體實驗(第二次)— 2026-09-21,對 v35 的介面

## 協定
v35 實質改寫了 `workflow_authoring_guide`(新增「Three things a cold author gets wrong」一節),
因此 VAL-231(v34 的冷主體)不再是這一版的證據。orchestrator 以**當前程式碼**另起 scratch 引擎
(port 8794、auth 關閉、全新空的 workRoot,避免看到前次實驗留下的 workflow),只交出 URL;
主體是**與上次不同的全新獨立實例**,未繼承本對話任何脈絡,並被明文禁止讀取本機任何檔案與 git。

## 結果:10 次 MCP 呼叫、10 次第一次就成功、0 失敗
`tools/list` → `workflow_authoring_guide` → `workflow_register` → `run_start` → `run_status`×3
→ `workflow_describe` → `models_list` → `run_result`。雙 agent 協作(writer 起草俳句 →
critic 評論並給分)一次註冊通過,含嚴格的泳道圖契約(LANE/TOOLS/EDGE/DIAGRAM 四條全過),
run `764c2b42` 跑到 completed 並取回真實評論文字。

唯一一次「第一次失敗」與本引擎無關:它自己的 harness 擋掉了 `sleep 30 && curl` 這種輪詢寫法。

## 對照:上一次冷主體(VAL-231)踩到的四個坑,這次全部被介面主動教會

- **D2(宣告 timeoutMs 只界定單次嘗試)**:主體引用 guide 原文「`timeoutMs` bounds ONE attempt,
  never the whole call」,並實際從 `workflow_describe` 讀到自己那兩個 agent 的
  `attempts: 2 / worstCaseMs: 120000` —— **開跑之前就算得出最壞等待時間**。REQ-207 成立。
- **D3(失敗的 sequential `await agent()` 回 null 不拋)**:主體引用明文的兩層規則 ——
  一般失敗/逾時 resolve 成 `null` 由腳本自行檢查,引擎級拒絕(如 `BUDGET_EXCEEDED`)才 throw 並帶 code。
  上一位冷主體就是不知道這條,讓 `null` 被字串化接進下一個 prompt。REQ-207 成立。
- **D1(全部 agent 失敗仍報 completed)**:主體用 `failedAgentCount: 0` 與
  「失敗時 `result.error` 是 `{code,message}`」兩個**文件化**欄位判定裡面確實成功,
  不必自己去翻 `agents[]` 逐一比對。REQ-207 成立。
- **D4(回應雙重 JSON 編碼)**:主體引用 initialize 的揭露文字,全程零解析錯誤。REQ-210 成立。

## 另一項獨立觀察:v33 的行為改變再次復現
主體註冊後**沒有 publish**,直接用 `{version}` 跑(`release=null`),並主動引用 `run_start` 的說明
作為「照字面做就對」的一處。這是 REQ-201 改寫後第二個互不相識的冷客端做出同樣選擇 ——
對照 2026-09-20 那台遠端機器(四個名稱全部立刻 publish 到 release),同一個介面、同一類客端,行為反了過來。

## 結論
REQ-117 對 v35 的介面成立,且本次實驗同時是 REQ-207/REQ-210 最強的一份外部證據:
它們不是由寫 code 的人宣稱「有說清楚」,而是由一個看不到 code 的陌生實例**實際用出來**。
