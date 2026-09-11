// src/dashboard/lib/agent.js
// DES-205, ARCH-124/131/129, TASK-207, REQ-135/136 — the agent slide-in panel is a projection of
// the RECORD (and its HarnessDescriptor), never a reconstruction from the DOM. Pure: `now` is a
// parameter, cost goes through `fmtCost` (DES-204).
import { fmtCost } from './runlist.js';

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

function tokenCols(tokens) {
  if (!tokens) return '—';
  return `in ${tokens.input ?? 0} · out ${tokens.output ?? 0} · cache read ${tokens.cacheRead ?? 0} · cache write ${tokens.cacheWrite ?? 0}`;
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
function effortText(effortApplied) {
  if (!effortApplied) return '—';
  if ('value' in effortApplied) return `${effortApplied.param} = ${effortApplied.value}`;
  return `not applied: ${effortApplied.reason}`;
}

// (4) issue #20's hung-vs-progressing signal: only meaningful while `running`. Advancing past
// `startedAt` (or freshly started, < 60s stale) reads as progressing; frozen/absent for > 60s
// reads as no activity.
function activityText(record, now, lang) {
  if (record.state !== 'running') return '—';
  const nowMs = Date.parse(now);
  const startMs = record.startedAt ? Date.parse(record.startedAt) : nowMs;
  const lastMs = record.lastActivityAt ? Date.parse(record.lastActivityAt) : startMs;
  const advancing = lastMs > startMs;
  const stale = nowMs - lastMs > 60000;
  const noActivity = !advancing && stale;
  if (noActivity) return lang === 'zh' ? '無活動' : 'no activity';
  return lang === 'zh' ? '進行中' : 'progressing';
}

// (6) the sentence must be TRUE on both cohorts: present -> "applied, N bytes, not shown" (never
// the content itself); ABSENT -> "no system-prompt record", never "not applied" (a pre-v27 record's
// absence means UNKNOWN, not "no" — the same defect class as a confident $0.00).
function systemPromptNote(harness, lang) {
  const sp = harness?.systemPrompt;
  if (sp) {
    return lang === 'zh'
      ? `系統提示詞:已套用(agentType ${sp.agentType},${sp.bytes} bytes)— 不顯示`
      : `system prompt: applied (agentType ${sp.agentType}, ${sp.bytes} bytes) — not shown`;
  }
  return lang === 'zh' ? '無 system prompt 紀錄' : 'no system-prompt record';
}

export function panelModel(record, harness, events, hasMore, now, lang) {
  const stats = [
    { label: 'Model', value: modelLine(record, harness) },
    { label: 'Tokens', value: tokenCols(record.tokens) },
    { label: 'Cost', value: fmtCost(record.costUSD, record.unpriced ? 1 : undefined, lang) },
    { label: 'Timeout', value: fmtTimeout(harness?.timeoutMs) },
    { label: 'Effort', value: effortText(harness?.effortApplied) },
    { label: 'Activity', value: activityText(record, now, lang) },
  ];
  return {
    stats,
    detail: record.detail,
    reasonCode: record.reasonCode,
    systemPromptNote: systemPromptNote(harness, lang),
    // (5) a capture with no reader is not observability — pass the raw lists through, never just
    // their counts, so the panel can render both the tags and how many there are.
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
