// src/dashboard/lib/agent.js
// DES-205, ARCH-124/131/129, TASK-207, REQ-135/136 — the agent slide-in panel is a projection of
// the RECORD (and its HarnessDescriptor), never a reconstruction from the DOM. Pure: `now` is a
// parameter, cost goes through `fmtCost` (DES-204).
import { fmtCost, sumTokens, fmtTok, fmtStartedAt } from './runlist.js';
import { t } from './strings.js';

function withCommas(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// (3) timeout rendered TWICE — human (`15m 0s`) and raw (`900,000 ms`) — in the same card, so a
// value that only round-trips through one of the two forms still shows the other.
function fmtTimeout(ms) {
  if (ms === undefined) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s (${withCommas(ms)} ms)`;
}

// [v32, REQ-200] these four were English literals in BOTH languages — REQ-150 localized the six card
// labels one level up and never reached the sub-labels under them.
function tokenCols(tokens, lang) {
  if (!tokens) return '—';
  return `${t(lang, 'tokIn')} ${tokens.input ?? 0} · ${t(lang, 'tokOut')} ${tokens.output ?? 0}`
    + ` · ${t(lang, 'tokCacheRead')} ${tokens.cacheRead ?? 0} · ${t(lang, 'tokCacheWrite')} ${tokens.cacheWrite ?? 0}`;
}

// (1) the model card's second line — REQ-125's provider/transport/proxyModel triple, so "which of
// the three paths broke" is answerable. Sourced from the RECORD (the wire fields), not the harness.
function modelLine(record, harness) {
  const model = record.model || harness?.model || '—';
  const provider = record.provider || harness?.provider || '—';
  const transport = record.transport ?? '—';
  const proxy = record.proxyModel ? ` · ${record.proxyModel}` : '';
  return `${model} — ${provider} · ${transport}${proxy}`;
}

// (2) effortApplied renders on BOTH branches — the applied `{param,value}` and the honest
// not-applied `{reason}` — never only the happy one.
function effortText(effortApplied, lang) {
  if (!effortApplied) return '—';
  if ('value' in effortApplied) return `${effortApplied.param} = ${effortApplied.value}`;
  // [v32, REQ-200] the PREFIX is UI text; `reason` is wire text and stays exactly as it arrived.
  return `${t(lang, 'effortNotApplied')}: ${effortApplied.reason}`;
}

// (4) issue #20's hung-vs-progressing signal: only meaningful while `running`.
//
// [v32, REQ-197, F11] Rewritten. The old predicate was `!advancing && stale`, with `lastActivityAt`
// falling back to `startedAt` when absent — which made it the opposite of its own purpose:
//
//   never reported   -> lastMs === startMs -> advancing false -> 無活動 after 60s   (FALSE ALARM)
//   reported, froze  -> lastMs >   startMs -> advancing true  -> 進行中 forever     (MISSED HANG)
//
// Both were measured. A healthy ollama call read 無活動 at t+67s and finished at 3m38s (a provider
// that does not stream mid-call has nothing to report until it returns); and a call that reported
// once and then froze for four minutes read 進行中 the whole time.
//
// Owner ruling 2026-09-20: absence is UNKNOWN, not frozen — the same class as R30-A1 ("an
// un-measured figure is absent, not zero") on the time axis. "No activity" is reserved for a call
// that reported and then went quiet, which is the only case the signal can honestly claim. The 60s
// threshold is unchanged.
function activityText(record, now, lang) {
  if (record.state !== 'running') return '—';
  if (!record.lastActivityAt) return t(lang, 'noReportYet');
  const stale = Date.parse(now) - Date.parse(record.lastActivityAt) > 60000;
  if (stale) return lang === 'zh' ? '無活動' : 'no activity';
  return lang === 'zh' ? '進行中' : 'progressing';
}

// [v30, REQ-166] README §3's duration card: "Duration (start → end)". A run still in flight has no
// `endedAt`, so it falls back to what `activityText` already said — never a fabricated end time.
function durationText(record, now, lang) {
  const start = record.startedAt ? Date.parse(record.startedAt) : NaN;
  const end = record.endedAt ? Date.parse(record.endedAt) : NaN;
  if (Number.isNaN(start)) return activityText(record, now, lang);
  if (Number.isNaN(end)) return activityText(record, now, lang);
  const s = Math.max(0, Math.round((end - start) / 1000));
  const m = Math.floor(s / 60);
  return (m > 0 ? `${m}m ${s % 60}s` : `${s}s`);
}

// [v30, REQ-166] README §3: "Tokens (total + `Input · Output · Cache read · Cache write`)". The
// total was absent, so the one figure a reader actually compares between agents was not on the
// card at all.
function tokenTotalAndCols(tokens, lang) {
  // [v31, REQ-186] An absent tokens object is `—`, not a zero total with a zero-filled breakdown:
  // a running agent has no usage event yet.
  const total = sumTokens(tokens);
  if (total === undefined) return '—';
  return `${fmtTok(total)} · ${tokenCols(tokens, lang)}`;
}

export function panelModel(record, harness, events, hasMore, now, lang) {
  // [v29, REQ-150] The six labels were English literals in both languages.
  // [v30, REQ-166] The SET and the ORDER are REQ-135's own acceptance text, restated verbatim from
  // README §3: 模型 / 努力程度 / 逾時 / 耗時(開始→結束)/ Tokens(總數 + 四欄)/ 費用.
  // What shipped had `活動` where `耗時` belongs and a Tokens card with no total. REQ-147 governs
  // how these cards LOOK; nothing ruled on which six they are, so this was unruled drift.
  // `activityText` is not deleted — it moves onto the duration card as its secondary line, where a
  // frozen or freshly-started agent still reads as such.
  const stats = [
    { label: t(lang, 'model'), value: modelLine(record, harness) },
    { label: t(lang, 'effort'), value: effortText(harness?.effortApplied, lang) },
    { label: t(lang, 'timeout'), value: fmtTimeout(harness?.timeoutMs) },
    // [v32, REQ-199] README §3 names this card "Duration (start → end)". The sub-line appears only
    // when BOTH stamps exist — a running call has no end, and inventing `now` as one would be the
    // same fabrication R30-A1 ruled against. `meta` is optional; the other five cards omit it, and
    // the single-line Timeout card stays single-line (ruled, `agent.js:12-19`).
    {
      label: t(lang, 'duration'),
      value: durationText(record, now, lang),
      ...(record.startedAt && record.endedAt
        ? { meta: `${fmtStartedAt(record.startedAt)} → ${fmtStartedAt(record.endedAt)}` }
        : {}),
    },
    { label: t(lang, 'tokens'), value: tokenTotalAndCols(record.tokens, lang) },
    { label: t(lang, 'cost'), value: fmtCost(record.costUSD, record.unpriced ? 1 : undefined, lang) },
  ];
  return {
    stats,
    detail: record.detail,
    reasonCode: record.reasonCode,
    // (5) a capture with no reader is not observability — pass the raw lists through, never just
    // their counts, so the panel can render both the tags and how many there are.
    // [v30, REQ-167] The LISTS, not only their counts. The rule was already written four lines
    // above — "a capture with no reader is not observability … never just their counts" — and
    // this module already honoured it for `mcpUnresolved`/`unmapped`; the three curated-surface
    // lists were the ones it stopped short on, so the view had only counts to render.
    tools: harness?.tools ?? [],
    mcpServers: harness?.mcpServers ?? [],
    skills: harness?.skills ?? [],
    mcpUnresolved: harness?.mcpUnresolved ?? [],
    unmapped: record.unmapped ?? [],
    ...eventListModel(events, hasMore),
  };
}

// The wire gives no total, so the marker must not invent one: "shown N / of M+", never a count
// the client made up.
export function eventListModel(events, hasMore) {
  return {
    rows: events,
    marker: hasMore ? { shown: events.length, more: true } : null,
  };
}

export function clipText(s, limit) {
  if (s.length <= limit) return { shown: s, clipped: false };
  return { shown: s.slice(0, limit), clipped: true };
}
