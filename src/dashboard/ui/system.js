// src/dashboard/ui/system.js
// DES-207, ARCH-125, ARCH-123, TASK-212 (REQ-076/077) — the System tab, PORTED from the pre-v27
// `loadSystem()` (dashboard-page.ts:392-407): same endpoint (`/api/system`), same rows (cpu cores,
// load avg, cpu util, memory, disk, sampled at). REQ-077's process metrics were never rendered on
// the pre-v27 panel either (`system_info`-only) — this port ships nothing new, per DES-207's "no
// resource bars" boundary.
//
// The ONE behaviour that DOES change (DES-207's own stated contract, not a redesign): a field that
// could not be sampled (`cpu.utilizationDegraded`, or `memory`/`disk` shaped as `{reason}` per
// REQ-076's degrade rule) renders the SAME `UNAVAILABLE` component instead of a confident '—' or a
// thrown render — the same defect class as a confident $0.00 (DES-204).
//
// [v27c] DES-206's "one timer" completion: this view exports `onTick(container, bodies, ctx)` per
// the same uniform view contract as `home.js`/`workflow.js`/`run.js`, instead of scheduling its own
// repeated fetch. `app.js`'s tab strip (`activateTab`) mounts this module via `render()` only, so
// `render()` calls `onTick()` once itself for first paint; `poll.js`'s `system` route already names
// this view's endpoint for whenever the tab strip's own poll wiring joins it to the app-wide tick.

import { getJSON } from './poll.js';

// system-info.ts's own UTIL_PCT_CONVENTION ('host-aggregate-0-100') — a fixed string, not a runtime
// value, so it is duplicated here rather than imported (a `.js` client module cannot import a
// server `.ts` module, DES-206's mock policy).
const UTIL_PCT_CONVENTION = 'host-aggregate-0-100';

// DES-207's ONE degraded-section component — every field this tab cannot sample renders THIS,
// never a fabricated 0/'—' number.
const UNAVAILABLE = '無法取樣';

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function sysRow(k, v) {
  const tr = document.createElement('tr');
  tr.appendChild(el('td', undefined, k));
  tr.appendChild(el('td', undefined, v));
  return tr;
}

function fmtBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB';
  return b + ' B';
}

function buildTable(data) {
  const t = document.createElement('table');
  t.className = 'table sys-table'; // DES-209 STYLE_HOOKS: .table (component layer) + the ported
                                    // .sys-table modifier (DES-209 boundary clause 5).
  t.appendChild(sysRow('cpu cores', String(data.cpu.cores)));
  t.appendChild(sysRow('load avg 1m/5m/15m', data.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / ')));
  const utilStr = data.cpu.utilizationPct != null ? data.cpu.utilizationPct.toFixed(1) + '%' : UNAVAILABLE;
  t.appendChild(sysRow('cpu util (' + UTIL_PCT_CONVENTION + ')', utilStr));
  if (data.memory && !('reason' in data.memory)) {
    t.appendChild(sysRow('memory', fmtBytes(data.memory.usedBytes) + ' / ' + fmtBytes(data.memory.totalBytes) + ' (' + data.memory.usedPct.toFixed(1) + '%)'));
  } else {
    t.appendChild(sysRow('memory', UNAVAILABLE));
  }
  if (data.disk && !('reason' in data.disk)) {
    t.appendChild(sysRow('disk ' + data.disk.path, fmtBytes(data.disk.usedBytes) + ' / ' + fmtBytes(data.disk.totalBytes) + ' (' + data.disk.usedPct.toFixed(1) + '%)'));
  } else {
    t.appendChild(sysRow('disk', UNAVAILABLE));
  }
  t.appendChild(sysRow('sampled at', data.sampledAt));
  return t;
}

/** [v27c] DES-206's uniform view contract, poll half — fetches `/api/system` and paints (the ONE
 *  degraded-section swap, DES-207's own stated behaviour change); returns the endpoint's status so
 *  a caller folding it into `nextConnection` can do so like every other view. */
export async function onTick(container, _bodies, _ctx) {
  if (!container.isConnected) return undefined;
  const res = await getJSON('/api/system');
  if (!container.isConnected) return undefined;
  if (!res.body) {
    container.replaceChildren(el('div', 'empty', UNAVAILABLE));
  } else {
    container.replaceChildren(buildTable(res.body));
  }
  return { '/api/system': res.status };
}

/** DES-206's uniform view contract — `vm`/`handlers` are unused; `onTick` owns the actual fetch and
 *  paint, called once here for first paint since nothing else calls it yet. */
export function render(container, _vm, _handlers) {
  container.id = 'system-panel';
  onTick(container, {}, {});
}
