// src/dashboard/lib/system.js
// [v28] DES-215, ARCH-134, ADR-057, TASK-223, REQ-138 — the System tab's pure projections: two
// state readers over `SystemInfoView`'s two DIFFERENT degrade shapes (`sectionState` for the three
// DISCRIMINATED-UNION sections — `memory`, `disk`, `process.system` — and `cpuUtilState` for the
// ONE sibling-key section, `cpu`, whose `cores`/`loadAvg` stay real even while `utilizationPct` is
// degraded, `system-info.ts:77-100`), the four cards' arithmetic (`statCard`), the process table's
// row projection (`procRow`/`procTotals`), a moved formatter (`fmtBytes`, verbatim from
// `ui/system.js:38` pre-v28), and the counts-card fold (`catalogCounts`, ADR-057's three written
// definitions). All pure, no DOM, no fetch, no clock read (this file is covered by the standing
// `grep -rn 'new Date()|Date.now()|document\.|fetch(' src/dashboard/lib/` falsifier, DES-210).

import { t } from './strings.js';

/** `sectionState(value)` — classifies one of `SystemInfoView`'s discriminated-union sections
 *  (`memory`, `disk`, `process.system`): a real value is `{kind:'ok', value}`, a `{reason,detail?}`
 *  `Degraded` is `{kind:'unavailable', reason}`. Three of the five `Reason` values are NOT faults
 *  (`awaiting-second-sample`/`unsupported-platform`/`sample-window-too-short`) — that distinction is
 *  carried in the reason string itself, not collapsed here, so a caller can render "wait one tick"
 *  differently from "this host cannot report it". */
export function sectionState(value) {
  if (value && typeof value === 'object' && 'reason' in value) {
    return { kind: 'unavailable', reason: value.reason };
  }
  return { kind: 'ok', value };
}

/** `cpuUtilState(cpu)` — the ONE sibling-key section: `cpu.cores`/`cpu.loadAvg` are real even on a
 *  degrade, so this reads ONLY `utilizationPct`/`utilizationDegraded` and returns just the
 *  percentage's own state, never the whole `cpu` object (DES-215's own boundary: a single reader
 *  pretending `cpu` is shaped like `memory`/`disk` either lies about `cores` on a degrade, or can't
 *  tell a real value from a `Degraded` one). */
export function cpuUtilState(cpu) {
  if (cpu.utilizationPct == null && cpu.utilizationDegraded) {
    return { kind: 'unavailable', reason: cpu.utilizationDegraded.reason };
  }
  return { kind: 'ok', value: cpu.utilizationPct };
}

/** `statCard(kind, input, lang) → { value, pct: number|undefined, meta, kicker? }` — one signature
 *  for all four cards (DES-215's own warning: pretending one shape serves them all is how three
 *  good cards get blanked). `kind` is `'cpu' | 'memory' | 'disk' | 'counts'`.
 *  - `'cpu'`: `input` is `cpuUtilState()`'s own output, optionally carrying `cores`/`loadAvg`
 *    alongside it (those two are never degraded, so a caller free to attach them for the meta line).
 *  - `'memory' | 'disk'`: `input` is `sectionState()`'s own output — its `ok` arm's `value` is the
 *    WHOLE section object (`{totalBytes, usedBytes, freeBytes, usedPct}`, plus `path` for disk), so
 *    no second parameter is needed to carry those.
 *  - `'counts'`: `input` is `catalogCounts()`'s own output directly, `{workflows, versions,
 *    runRecords}` — ADR-057's client fold has no denominator, so `pct` is ALWAYS `undefined` here,
 *    never a fabricated full bar (INV-V28-4). */
export function statCard(kind, input, lang) {
  if (kind === 'counts') {
    // README §5's own literal (`9 versions · 13 run records`) — locale-invariant like DES-213's
    // `fmtLatency`/`fmtBenchmarks` ("TTFT 900ms · p50 6.8s", "78 avg"): mostly numeric, reads fine
    // unchanged in either language, and `strings.js` is out of this task's file scope (TASK-206/220
    // own it) — `lang` is accepted for signature parity with the other three kinds, unused here.
    return {
      value: String(input.workflows),
      pct: undefined,
      meta: `${input.versions} versions · ${input.runRecords} run records`,
    };
  }
  if (input.kind === 'unavailable') {
    // DES-215: "the reason travels out and renders as the card's secondary text" — the raw Reason
    // token IS that text (no separate i18n table exists for the five values, and each is already a
    // distinct, self-describing string), never a fabricated number in `value`/`pct`. `unavailable`
    // is the one key this card family shares with every other view (`strings.js:28,42`).
    return { value: t(lang, 'unavailable'), pct: undefined, meta: input.reason };
  }
  if (kind === 'cpu') {
    const pct = input.value;
    const meta = input.cores != null && input.loadAvg
      ? `${input.cores} cores · Load ${input.loadAvg.map((v) => v.toFixed(2)).join(' / ')}`
      : undefined;
    return { value: `${Math.round(pct)}%`, pct, meta };
  }
  // 'memory' | 'disk'
  const v = input.value;
  return {
    value: `${Math.round(v.usedPct)}%`,
    pct: v.usedPct,
    meta: `${fmtBytes(v.usedBytes)} of ${fmtBytes(v.totalBytes)} · ${fmtBytes(v.freeBytes)} free`,
    kicker: kind === 'disk' ? v.path : undefined,
  };
}

/** `procRow(proc, selfPid)` — one `process.topN` entry projected for the table; `isSelf` marks the
 *  engine's own row (README §5's ★, ONLY that pid) so `ui/system.js` never re-derives the check. */
export function procRow(proc, selfPid) {
  return { pid: proc.pid, name: proc.name, cpuPct: proc.cpuPct, memBytes: proc.memBytes, isSelf: proc.pid === selfPid };
}

/** `procTotals(system, lang) → string` — `system` is `process.system`'s OWN `ok` shape
 *  (`{total, byState}`; a caller checks `sectionState` first and never calls this on a `Degraded`
 *  one). `byState`'s key set is OPEN (`system-info.ts:323-326` counts `p.state` verbatim from
 *  `/proc`), so this renders the top states BY COUNT with a stable tiebreak (`Object.entries`
 *  preserves insertion order, and `Array#sort` is stable per spec — ties keep their original
 *  relative order) — never a hard-coded S/R pair, never a throw on a letter nobody has seen. The
 *  header ends in "…" (README §5: `Total processes 312 · S 298 · R 7 …`) because the key set stays
 *  open even when every state this tick happens to hold got listed. */
export function procTotals(system, _lang) {
  const top = Object.entries(system.byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([state, count]) => `${state} ${count}`)
    .join(' · ');
  // README §5's own literal ("Total processes 312 · S 298 · R 7 …") — locale-invariant, same
  // rationale as `statCard`'s `counts`/`memory`/`disk` meta lines above.
  return `Total processes ${system.total}${top ? ' · ' + top : ''} …`;
}

/** `fmtBytes(n) → string` — MOVED verbatim from `ui/system.js:38` (pre-v28). */
export function fmtBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB';
  return b + ' B';
}

/** `catalogCounts(workflows, runs) → { workflows, versions, runRecords }` — ADR-057's three written
 *  definitions, and the counts card's ONLY input: `workflows` = `entries.length`, `versions` = the
 *  SUM of each entry's `versions.length`, `runRecords` = `/api/runs`'s `.length`. This is the exact
 *  client-side fold the run-history table already reads (`/api/runs`), so the two can never
 *  disagree. */
export function catalogCounts(workflows, runs) {
  return {
    workflows: workflows.length,
    versions: workflows.reduce((sum, w) => sum + w.versions.length, 0),
    runRecords: runs.length,
  };
}
