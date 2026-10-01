// src/dashboard/ui/admin.js
// Dashboard auth spec §A2 (2026-09-30) — the admin (users & roles) tab. Visible only to a signed-in
// admin (`lib/principals.js` `tabsFor`); the server refuses its two routes to anyone else anyway.
// Reads GET /api/principals and writes POST /api/principals/role and (owner decision 2026-10-02)
// POST /api/principals/quota — the SAME backend as the MCP tools principals_list /
// principal_set_role / principal_set_quota, so this page can never grant what a tool refuses.
// Loads on mount and after each change only (never on the 3s poll: a repaint would reset a
// selector mid-edit). Every string is `textContent` — ids are user-controlled emails.

import { el, currentLang } from './dom.js';
import { t } from '../lib/strings.js';
import { getViewJSON } from './poll.js';
import { principalRows, roleChangeValue, quotaLimitValue } from '../lib/principals.js';

function buildShell(container, lang) {
  container.replaceChildren();
  const head = el('div', 'page-head');
  head.appendChild(el('h6', 'section-head', t(lang, 'admTitle')));
  container.appendChild(head);
  const note = el('p', 'muted', '');
  note.hidden = true;
  container.appendChild(note);
  const error = el('p', 'degraded', '');
  error.setAttribute('data-admin-error', '');
  error.hidden = true;
  container.appendChild(error);
  const table = el('table', 'table sys-table');
  table.setAttribute('data-admin-table', '');
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const key of ['admId', 'admRole', 'admSource', 'admLastSeen', 'admChange', 'admQuota']) tr.appendChild(el('th', undefined, t(lang, key)));
  thead.appendChild(tr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  container.appendChild(table);
  return { lang, note, error, tbody };
}

function showError(state, text) {
  state.error.textContent = text;
  state.error.hidden = !text;
}

async function changeRole(state, id, value, select, previous) {
  const role = roleChangeValue(value);
  if (role === undefined) return;
  const label = role === null ? t(state.lang, 'admDefault') : role;
  if (!window.confirm(t(state.lang, 'admConfirm').replace('{id}', id).replace('{role}', label))) {
    select.value = previous;
    return;
  }
  showError(state, '');
  try {
    const res = await fetch('/api/principals/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'rwe-dashboard' },
      body: JSON.stringify({ id, role }),
    });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      showError(state, t(state.lang, 'admError') + (body && (body.error || body.code) ? String(body.error || body.code) : String(res.status)));
      select.value = previous;
      return;
    }
  } catch {
    showError(state, t(state.lang, 'admError') + 'network');
    select.value = previous;
    return;
  }
  await load(state);
}

/** Owner decision 2026-10-02: set (`limit`) or clear (null) a per-account storage quota override. */
async function changeQuota(state, id, limit) {
  const label = limit === null ? t(state.lang, 'admQuotaClear') : String(limit);
  if (!window.confirm(t(state.lang, 'admQuotaConfirm').replace('{id}', id).replace('{limit}', label))) return;
  showError(state, '');
  try {
    const res = await fetch('/api/principals/quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'rwe-dashboard' },
      body: JSON.stringify({ id, limit }),
    });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      showError(state, t(state.lang, 'admError') + (body && (body.error || body.code) ? String(body.error || body.code) : String(res.status)));
      return;
    }
  } catch {
    showError(state, t(state.lang, 'admError') + 'network');
    return;
  }
  await load(state);
}

function quotaCell(state, row) {
  const cell = document.createElement('td');
  cell.setAttribute('data-admin-quota', row.id);
  cell.appendChild(el('span', 'mono', row.quotaText));
  cell.appendChild(el('div', 'muted', row.quotaSourceText));
  const input = el('input', 'input');
  input.type = 'text';
  input.placeholder = t(state.lang, 'admQuotaPlaceholder');
  input.setAttribute('aria-label', `${t(state.lang, 'admQuota')} ${row.id}`);
  const set = el('button', 'btn', t(state.lang, 'admQuotaSet'));
  set.type = 'button';
  set.setAttribute('data-admin-quota-set', '');
  set.addEventListener('click', () => {
    const limit = quotaLimitValue(input.value);
    if (limit !== null) changeQuota(state, row.id, limit);
  });
  cell.appendChild(input);
  cell.appendChild(set);
  if (row.quotaOverride) {
    const clear = el('button', 'btn', t(state.lang, 'admQuotaClear'));
    clear.type = 'button';
    clear.setAttribute('data-admin-quota-clear', '');
    clear.addEventListener('click', () => { changeQuota(state, row.id, null); });
    cell.appendChild(clear);
  }
  return cell;
}

function paint(state, body) {
  state.note.textContent = t(state.lang, 'admAuthOff');
  state.note.hidden = body.authEnabled !== false;
  state.tbody.replaceChildren();
  for (const row of principalRows(body, state.lang)) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-admin-row', row.id);
    tr.appendChild(el('td', 'mono', row.id));
    const roleCell = document.createElement('td');
    roleCell.appendChild(el('span', 'tag', row.pending ? `none (${t(state.lang, 'admPending')})` : row.role));
    tr.appendChild(roleCell);
    tr.appendChild(el('td', 'muted', row.sourceText));
    tr.appendChild(el('td', 'mono', row.lastSeen));
    const cell = document.createElement('td');
    const select = el('select', 'input');
    select.setAttribute('aria-label', `${t(state.lang, 'admChange')} ${row.id}`);
    for (const value of ['', 'admin', 'author', 'user', 'none']) {
      const opt = el('option', undefined, value === '' ? t(state.lang, 'admDefault') : value);
      opt.value = value;
      select.appendChild(opt);
    }
    select.value = row.selected;
    select.disabled = row.locked;
    select.addEventListener('change', () => { changeRole(state, row.id, select.value, select, row.selected); });
    cell.appendChild(select);
    // Owner decision 2026-09-30: a pending ('none') principal gets one-click grants.
    if (row.pending && !row.locked) {
      for (const grant of ['user', 'author', 'admin']) {
        const b = el('button', 'btn', `${t(state.lang, 'admGrant')} ${grant}`);
        b.type = 'button';
        b.setAttribute('data-admin-grant', grant);
        b.addEventListener('click', () => { changeRole(state, row.id, grant, select, row.selected); });
        cell.appendChild(b);
      }
    }
    tr.appendChild(cell);
    tr.appendChild(quotaCell(state, row));
    state.tbody.appendChild(tr);
  }
}

async function load(state) {
  const r = await getViewJSON('/api/principals');
  if (r.status !== 'ok' || !r.body) {
    showError(state, t(state.lang, 'admError') + ((r.body && (r.body.error || r.body.code)) || 'unavailable'));
    return;
  }
  paint(state, r.body);
}

export function render(container) {
  const state = buildShell(container, currentLang());
  load(state);
}

/** No per-tick work: this view refreshes on mount and after each change only (see the header). */
export function onTick() {
  return undefined;
}
