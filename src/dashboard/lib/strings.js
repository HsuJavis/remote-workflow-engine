// src/dashboard/lib/strings.js
// DES-201, ARCH-124, ADR-049, TASK-206, REQ-131/133 — the zh/en string table and t(lang, key).
// C3: neither language may carry the retired UI term that the repo-wide mechanical grep guard
// (ADR-022, REQ-105) forbids across src/** -- the same term this project always calls "the C3 word".
//
// [v27b, ADR-051] warningText(lang, raw) maps the DAG route's warning grammar
// (`WARNING := TOKEN (': ' DETAIL)?`, DES-198) to a rendered sentence for the two known TOKENs,
// or passes an unrecognized string through UNCHANGED — a `layoutGraph` prose warning carries no
// token and must reach the viewer verbatim, in either language.

// [v27 README-fidelity build] `brand` (README "Header / chrome": nav brand text next to the source
// tag) is the SAME literal in both languages — the design shows zh/en side by side always, it does
// not swap on the lang toggle — but it still lives here, not as a hard-coded literal in `ui/app.js`,
// so REQ-131's "both languages come from one source" holds even for a string that happens not to
// vary by language today.
export const STR = {
  zh: {
    predictedLayout: '預測結構',
    predictedLayoutUnavailable: '預測結構不可用',
    predictedLayoutFromFallback: '預測結構來自替代版本 v{resolved}',
    laneUntitled: '未命名 lane',
    // [v27m, DES-206 (S)] the ONE Unavailable component's text, for EVERY view — the zh/en pair is
    // REQ-138's own (01-requirements.md:1874). It lands in both languages in the same edit on
    // purpose: `t()` has no fallback, so a one-language key renders the literal string `undefined`
    // (the BF-5/BF-6 defect class, inside the repair for it). `ui/system.js:29`'s zh-only
    // `UNAVAILABLE` const is the pre-existing second copy — QD-R3 debt, retired when that site is
    // repaired, not before, or the two diverge.
    unavailable: '無法取樣',
    brand: '工作流引擎 / Workflow Engine',
    // [v28, DES-212, TASK-220, REQ-143] `demoData` is the nav tag's text while demo mode is
    // engaged (`ui/app.js`'s `demoEngages` arm); `demoBanner` is the shell banner painted OUTSIDE
    // `mountLazy`'s per-route `replaceChildren()` reach, so it survives every tab/route switch for
    // as long as demo mode stays engaged.
    demoData: '示範資料',
    demoBanner: '示範資料 — 引擎目前無法連線,以下畫面為示範內容',
    // [v28b, DES-220, TASK-226, REQ-143 amended clause] the per-route disclosure for a route with
    // no DEMO map entry (DES-212) — shown instead of a frozen/synthesized paint on a demo tick.
    // [widened v28b, owner ruling 2026-09-18] a colon-terminated PREFIX, not a complete sentence:
    // every call site appends its OWN literal route string directly after this value.
    noDemoData: '此路由無示範資料:',
    // [v29, REQ-148] run status + trigger type, for the history table's two untranslated columns.
    // Key names follow the delivery handoff's own STR table (`stCompleted`, `byType_client`) so the
    // oracle and the implementation use one vocabulary. Only the values the history table can
    // actually render land here — the rest of REQ-150's sweep is c3, not this commit.
    stQueued: '排隊', stRunning: '執行中', stCompleted: '完成', stFailed: '失敗',
    stStopped: '停止', stSuspended: '暫停', stInterrupted: '中斷', stRefused: '拒絕',
    byType_client: '客戶端', byType_webhook: 'Webhook', byType_schedule: '排程',
    byType_chain: '鏈結', byType_unknown: '未知',
    // [v29, REQ-150] The set the side-by-side audit measured as untranslated in the zh UI.
    // Key names follow the delivery handoff's own STR table wherever it has one.
    cores: '核心', load: '負載', of: '/', avail: '可用',
    versionsStored: '個版本', runsStored: '次執行記錄', totalProcs: '總處理程序',
    model: '模型', tokens: 'Tokens', cost: '費用', timeout: '逾時', effort: '努力程度', activity: '活動',
    stable: '穩定', variable: '變動', bestEffort: '盡力', remote: '遠端', local: '本機', free: '免費',
    issuesOpen: '未解決', issuesResolved: '已解決', openOnGitHub: '在 GitHub 開啟 ↗',
    stDone: '完成',
    // [v29c, REQ-153/154/155] the detail page's structural strings. Key names follow the delivery
    // handoff's own STR table (`home`, `triggers`, `graph`, `selectRun`, `history`, `none`).
    home: '總覽', triggers: '觸發器', graph: '工作流圖', selectRun: '檢視執行',
    history: '執行歷史', none: '(無)', stPending: '待執行', legend: '圖例',
    kind_message: '訊息', kind_tool_call: '工具呼叫', kind_tool_result: '工具結果',
    kind_usage: '用量', kind_harness: '設定', kind_log: '日誌', kind_refused: '拒絕',
  },
  en: {
    predictedLayout: 'predicted layout',
    predictedLayoutUnavailable: 'predicted layout unavailable',
    predictedLayoutFromFallback: 'predicted layout from substitute version v{resolved}',
    laneUntitled: 'untitled lane',
    unavailable: 'Unavailable',
    brand: '工作流引擎 / Workflow Engine',
    demoData: 'Demo data',
    demoBanner: 'Demo data — the engine is unreachable; this view is showing demo content',
    noDemoData: 'No demo data for this route: ',
    stQueued: 'Queued', stRunning: 'Running', stCompleted: 'Completed', stFailed: 'Failed',
    stStopped: 'Stopped', stSuspended: 'Suspended', stInterrupted: 'Interrupted', stRefused: 'Refused',
    byType_client: 'client', byType_webhook: 'webhook', byType_schedule: 'schedule',
    byType_chain: 'chain', byType_unknown: 'unknown',
    cores: 'cores', load: 'Load', of: 'of', avail: 'free',
    versionsStored: 'versions', runsStored: 'run records', totalProcs: 'Total processes',
    model: 'Model', tokens: 'Tokens', cost: 'Cost', timeout: 'Timeout', effort: 'Effort', activity: 'Activity',
    stable: 'Stable', variable: 'Variable', bestEffort: 'Best effort', remote: 'Remote', local: 'Local', free: 'Free',
    issuesOpen: 'Open', issuesResolved: 'Resolved', openOnGitHub: 'Open on GitHub \u2197',
    stDone: 'Done',
    home: 'Overview', triggers: 'Triggers', graph: 'Workflow graph', selectRun: 'Viewing run',
    history: 'Run history', none: '(none)', stPending: 'Pending', legend: 'Legend',
    kind_message: 'message', kind_tool_call: 'tool call', kind_tool_result: 'tool result',
    kind_usage: 'usage', kind_harness: 'harness', kind_log: 'log', kind_refused: 'refused',
  },
};

export function t(lang, key) {
  return STR[lang][key];
}

// The two TOKEN literals DES-198's grammar allows — anything else is layoutGraph prose.
const TOKEN_KEYS = {
  PREDICTED_FROM_FALLBACK_VERSION: 'predictedLayoutFromFallback',
  PREDICTED_OVERLAY_UNAVAILABLE: 'predictedLayoutUnavailable',
};

// DETAIL := k=v (' ' k=v)* — returns null (malformed) rather than a partial object, so a
// caller can tell "no detail parsed" from "detail parsed with an unexpected key set".
function parseDetail(detail) {
  const kv = {};
  for (const part of detail.split(' ')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) return null;
    kv[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return kv;
}

export function warningText(lang, raw) {
  const splitAt = raw.indexOf(': ');
  if (splitAt === -1) return raw;
  const head = raw.slice(0, splitAt);
  const key = TOKEN_KEYS[head];
  if (!key) return raw; // unknown head — layoutGraph prose, pass through raw.

  const kv = parseDetail(raw.slice(splitAt + 2));
  if (!kv) return raw; // malformed detail — never render a guess.

  if (key === 'predictedLayoutFromFallback') {
    if (!kv.resolved) return raw; // required key missing — never the detail half alone.
    return t(lang, key).replace('{resolved}', kv.resolved.replace(/^v/, ''));
  }
  return t(lang, key);
}

// [v29, REQ-150] One home for the three wire-vocabulary -> label maps. `lib/runlist.js` held a
// private copy of the first two (v29 c1); `ui/agent-panel.js` needed the same two plus the event
// kinds, and a second copy is how two surfaces drift apart. Each is TOTAL over the wire: an
// unrecognised value passes through UNCHANGED rather than rendering the literal string
// `undefined` — `t()` has no fallback, which is the BF-5/BF-6 defect class this repo has closed
// before.
const STATE_KEY = {
  queued: 'stQueued', running: 'stRunning', completed: 'stCompleted', done: 'stDone',
  failed: 'stFailed', stopped: 'stStopped', suspended: 'stSuspended',
  interrupted: 'stInterrupted', refused: 'stRefused',
};
const TRIGGER_KEY = {
  client: 'byType_client', webhook: 'byType_webhook', schedule: 'byType_schedule',
  chain: 'byType_chain', unknown: 'byType_unknown',
};
const KIND_KEY = {
  message: 'kind_message', tool_call: 'kind_tool_call', tool_result: 'kind_tool_result',
  usage: 'kind_usage', harness: 'kind_harness', log: 'kind_log', refused: 'kind_refused',
};

function lookup(map, lang, raw) {
  if (raw === undefined || raw === null || raw === '') return '—';
  const key = map[String(raw)];
  return key ? t(lang, key) : String(raw);
}

export const stateLabel = (lang, raw) => lookup(STATE_KEY, lang, raw);
export const triggerLabel = (lang, raw) => lookup(TRIGGER_KEY, lang, raw);
export const kindLabel = (lang, raw) => lookup(KIND_KEY, lang, raw);
