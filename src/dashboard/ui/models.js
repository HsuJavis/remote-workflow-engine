// src/dashboard/ui/models.js
// DES-207, ARCH-125, ARCH-123, TASK-212 (REQ-078) — the Models tab, PORTED unchanged from the
// pre-v27 `loadModels()` (dashboard-page.ts:409-431): same endpoint (`/api/models`), same six
// columns (provider|model|capability|stability|costLevel|modalities), same degrade wording — only
// the DOM-write mechanics differ (a `.js` module writing via `document.createElement`/`textContent`
// rather than the old page's raw HTML-string build; D5, DES-206). No sorting, no filtering, no new
// endpoint (DES-207's boundary).
//
// This tab is not part of `app.js`'s single poll tick (it never becomes `currentView`, DES-206) —
// like the pre-v27 page it owns its own fetch loop, same as `ui/run.js`/`ui/workflow.js`'s pattern:
// a self-rescheduling `setTimeout` guarded by `container.isConnected` so a torn-down tab stops
// polling.

import { getJSON } from './poll.js';

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildTable(entries) {
  const t = document.createElement('table');
  t.className = 'models-table';
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

/** DES-206's uniform view contract — `vm`/`handlers` are unused; this tab fetches its own data. */
export function render(container, _vm, _handlers) {
  async function tick() {
    if (!container.isConnected) return;
    const res = await getJSON('/api/models');
    if (!container.isConnected) return;
    const entries = res.body;
    if (!entries || !Array.isArray(entries)) {
      container.replaceChildren(el('div', 'empty', '(unavailable)'));
    } else if (!entries.length) {
      container.replaceChildren(el('div', 'empty', '(no models)'));
    } else {
      container.replaceChildren(buildTable(entries));
    }
    setTimeout(tick, 3000);
  }
  tick();
}
