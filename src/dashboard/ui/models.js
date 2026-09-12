// src/dashboard/ui/models.js
// DES-207, ARCH-125, ARCH-123, TASK-212 (REQ-078) — the Models tab, PORTED unchanged from the
// pre-v27 `loadModels()` (dashboard-page.ts:409-431): same endpoint (`/api/models`), same six
// columns (provider|model|capability|stability|costLevel|modalities), same degrade wording — only
// the DOM-write mechanics differ (a `.js` module writing via `document.createElement`/`textContent`
// rather than the old page's raw HTML-string build; D5, DES-206). No sorting, no filtering, no new
// endpoint (DES-207's boundary).
//
// [v27c] DES-206's "one timer" completion: this view exports `onTick(container, bodies, ctx)` per
// the same uniform view contract as `home.js`/`workflow.js`/`run.js`, instead of scheduling its own
// repeated fetch. `app.js`'s tab strip (`activateTab`) mounts this module via `render()` only, so
// `render()` calls `onTick()` once itself for first paint; `poll.js`'s `models` route already names
// this view's endpoint for whenever the tab strip's own poll wiring joins it to the app-wide tick.

import { getJSON } from './poll.js';
import { el } from './dom.js';

function buildTable(entries) {
  const t = document.createElement('table');
  t.className = 'table models-table'; // DES-209 STYLE_HOOKS: .table (component layer) + the
                                       // ported .models-table modifier (DES-209 boundary clause 5).
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  ['provider', 'model', 'capability', 'stability', 'costLevel', 'modalities'].forEach((h) => {
    hrow.appendChild(el('th', undefined, h));
  });
  thead.appendChild(hrow);
  t.appendChild(thead);
  const tbody = document.createElement('tbody');
  entries.forEach((entry) => {
    const tr = document.createElement('tr');
    const td = (v) => el('td', undefined, v != null ? String(v) : '—');
    tr.appendChild(td(entry.provider));
    tr.appendChild(td(entry.model));
    tr.appendChild(td(entry.capability));
    tr.appendChild(td(entry.stability));
    tr.appendChild(td(entry.costLevel != null ? String(entry.costLevel) : '—'));
    const ins = entry.modalities && entry.modalities.in ? entry.modalities.in.join(',') : '?';
    const outs = entry.modalities && entry.modalities.out ? entry.modalities.out.join(',') : '?';
    tr.appendChild(td(ins + ' → ' + outs));
    tbody.appendChild(tr);
  });
  t.appendChild(tbody);
  return t;
}

/** [v27c] DES-206's uniform view contract, poll half — fetches `/api/models` and paints; returns
 *  the endpoint's status so a caller folding it into `nextConnection` can do so like every other
 *  view (`app.js`'s `tick()` shape). */
export async function onTick(container, _bodies, _ctx) {
  if (!container.isConnected) return undefined;
  const res = await getJSON('/api/models');
  if (!container.isConnected) return undefined;
  const entries = res.body;
  if (!entries || !Array.isArray(entries)) {
    container.replaceChildren(el('div', 'empty', '(unavailable)'));
  } else if (!entries.length) {
    container.replaceChildren(el('div', 'empty', '(no models)'));
  } else {
    container.replaceChildren(buildTable(entries));
  }
  return { '/api/models': res.status };
}

/** DES-206's uniform view contract — `vm`/`handlers` are unused; `onTick` owns the actual fetch and
 *  paint, called once here for first paint since nothing else calls it yet. */
export function render(container, _vm, _handlers) {
  onTick(container, {}, {});
}
