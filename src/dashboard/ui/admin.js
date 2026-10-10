// src/dashboard/ui/admin.js
// Dashboard auth spec §A2 (2026-09-30) — the admin (users & roles) tab. Visible only to a signed-in
// admin (`lib/principals.js` `tabsFor`); the server refuses its two routes to anyone else anyway.
// Reads GET /api/principals and writes POST /api/principals/role and (owner decision 2026-10-02)
// POST /api/principals/quota — the SAME backend as the MCP tools principals_list /
// principal_set_role / principal_set_quota, so this page can never grant what a tool refuses.
// Loads on mount, after each change, and (issue #117) once on a "resume" — a browser-tab
// visibility resume or returning to this in-app tab, `onTick`'s own `tick.fresh` below — but
// NEVER on the ambient 3s poll itself: that repaint-on-every-tick is what would reset a selector
// mid-edit, the one case `onTick` still declines to repaint over (a focused, non-empty quota
// input). Every string is `textContent` — ids are user-controlled emails.
//
// Service accounts spec (owner decision 2026-10-03): a SECOND section on this same page ("Service
// accounts"), reading/writing GET/POST /api/service-accounts* — the SAME 6 admin-only tools an MCP
// client calls. A `principal_set_role`/`principal_set_quota` row for an `sa:` id never appears in
// the table above: `principalRows`'s source list is filtered to kind:'human' only (service accounts
// are managed exclusively through this second section, never the role/quota table).

import { el, currentLang } from './dom.js';
import { t } from '../lib/strings.js';
import { getViewJSON, postJSON } from './poll.js';
import { principalRows, roleChangeValue, quotaLimitValue } from '../lib/principals.js';
import { serviceAccountRows, parseWorkflowsInput, parseExpiresAtInput, curlSnippet } from '../lib/service-accounts.js';

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
  const saShell = buildServiceAccountsShell(container, lang);
  return { lang, note, error, tbody, sa: saShell };
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
  // Issue #117: a 401 here (an expired/signed-out session) is handled INSIDE postJSON, exactly
  // like every GET poll — it redirects to the login page itself, so there is nothing left for
  // this call site to show; falling through to the generic error path below would paint a
  // confusing "unavailable" message on a page the browser is already about to navigate away from.
  const r = await postJSON('/api/principals/role', { id, role });
  if (r.httpStatus === 401) return;
  if (!r.ok) {
    const body = r.body;
    showError(state, t(state.lang, 'admError') + (body && (body.error || body.code) ? String(body.error || body.code) : String(r.httpStatus || 'network')));
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
  // Issue #117: see changeRole's comment just above — a 401 redirects inside postJSON itself.
  const r = await postJSON('/api/principals/quota', { id, limit });
  if (r.httpStatus === 401) return;
  if (!r.ok) {
    const body = r.body;
    showError(state, t(state.lang, 'admError') + (body && (body.error || body.code) ? String(body.error || body.code) : String(r.httpStatus || 'network')));
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
  // Service accounts spec: a service account's role/quota live on its own row — it is managed
  // exclusively through the "Service accounts" section below, never through this table.
  const rows = principalRows(body, state.lang).filter((row) => row.kind !== 'service');
  for (const row of rows) {
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
  await loadServiceAccounts(state.sa);
}

// ── Service accounts section (service accounts spec, owner decision 2026-10-03) ─────────────────

function buildServiceAccountsShell(container, lang) {
  const headWrap = el('div', 'page-head');
  headWrap.appendChild(el('h6', 'section-head', t(lang, 'saTitle')));
  container.appendChild(headWrap);
  const error = el('p', 'degraded', '');
  error.setAttribute('data-sa-error', '');
  error.hidden = true;
  container.appendChild(error);

  // Create form.
  const form = el('div', 'card');
  form.setAttribute('data-sa-create-form', '');
  form.appendChild(el('h6', undefined, t(lang, 'saCreateTitle')));
  const nameInput = el('input', 'input');
  nameInput.type = 'text';
  nameInput.placeholder = t(lang, 'saNamePlaceholder');
  nameInput.setAttribute('aria-label', t(lang, 'saName'));
  nameInput.setAttribute('data-sa-name', '');
  const roleSelect = el('select', 'input');
  roleSelect.setAttribute('data-sa-role', '');
  for (const value of ['user', 'author']) {
    const opt = el('option', undefined, value);
    opt.value = value;
    roleSelect.appendChild(opt);
  }
  const descInput = el('input', 'input');
  descInput.type = 'text';
  descInput.placeholder = t(lang, 'saDescription');
  descInput.setAttribute('data-sa-description', '');
  const workflowsInput = el('input', 'input');
  workflowsInput.type = 'text';
  workflowsInput.placeholder = t(lang, 'saWorkflowsPlaceholder');
  workflowsInput.setAttribute('data-sa-workflows', '');
  const expiresInput = el('input', 'input');
  expiresInput.type = 'text';
  expiresInput.placeholder = t(lang, 'saExpiresAtLabel');
  expiresInput.setAttribute('data-sa-expires', '');
  const submit = el('button', 'btn', t(lang, 'saSubmit'));
  submit.type = 'button';
  submit.setAttribute('data-sa-submit', '');
  for (const node of [nameInput, roleSelect, descInput, workflowsInput, expiresInput, submit]) form.appendChild(node);
  container.appendChild(form);

  // One-time secret banner (hidden until a create/rotate response arrives).
  const secretBanner = el('div', 'card');
  secretBanner.setAttribute('data-sa-secret-banner', '');
  secretBanner.hidden = true;
  container.appendChild(secretBanner);

  const table = el('table', 'table sys-table');
  table.setAttribute('data-sa-table', '');
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const key of ['saId', 'saRole', 'saWorkflows', 'saStatus', 'saLastUsed', 'saSecrets']) tr.appendChild(el('th', undefined, t(lang, key)));
  tr.appendChild(document.createElement('th'));
  thead.appendChild(tr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  container.appendChild(table);

  const state = { lang, error, tbody, nameInput, roleSelect, descInput, workflowsInput, expiresInput, secretBanner };
  submit.addEventListener('click', () => { createServiceAccount(state); });
  return state;
}

function showSaError(state, text) {
  state.error.textContent = text;
  state.error.hidden = !text;
}

function showSecretBanner(state, clientId, clientSecret) {
  const banner = state.secretBanner;
  banner.replaceChildren();
  banner.hidden = false;
  banner.appendChild(el('p', undefined, t(state.lang, 'saCreated').replace('{id}', clientId)));
  banner.appendChild(el('p', 'degraded', t(state.lang, 'saSecretOnce')));
  const secretRow = el('div', 'mono');
  secretRow.textContent = clientSecret;
  banner.appendChild(secretRow);
  const copyBtn = el('button', 'btn', t(state.lang, 'saCopy'));
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', () => {
    if (navigator.clipboard) navigator.clipboard.writeText(clientSecret).then(() => { copyBtn.textContent = t(state.lang, 'saCopied'); });
  });
  banner.appendChild(copyBtn);
  banner.appendChild(el('p', 'muted', t(state.lang, 'saSnippet')));
  const snippet = el('pre', 'mono');
  snippet.textContent = curlSnippet(window.location.origin, clientId, clientSecret);
  banner.appendChild(snippet);
}

async function postServiceAccounts(state, path, body) {
  showSaError(state, '');
  // Issue #117: same 401 -> login-redirect rule as changeRole/changeQuota above, via postJSON.
  const r = await postJSON(`/api/service-accounts${path}`, body);
  if (r.httpStatus === 401) return null;
  if (!r.ok) {
    showSaError(state, t(state.lang, 'saError') + ((r.body && (r.body.error || r.body.code)) || String(r.httpStatus || 'network')));
    return null;
  }
  return r.body;
}

async function createServiceAccount(state) {
  const name = state.nameInput.value.trim();
  if (!name) return;
  const body = {
    name, role: state.roleSelect.value,
    description: state.descInput.value.trim() || undefined,
    workflows: parseWorkflowsInput(state.workflowsInput.value),
    expiresAt: parseExpiresAtInput(state.expiresInput.value),
  };
  const out = await postServiceAccounts(state, '', body);
  if (!out) return;
  state.nameInput.value = '';
  state.descInput.value = '';
  state.workflowsInput.value = '';
  state.expiresInput.value = '';
  showSecretBanner(state, out.clientId, out.clientSecret);
  await loadServiceAccounts(state);
}

async function rotateSecret(state, name) {
  const out = await postServiceAccounts(state, '/rotate', { name });
  if (!out) return;
  showSecretBanner(state, `sa:${name}`, out.clientSecret);
  await loadServiceAccounts(state);
}

async function revokeSecret(state, name, secretId) {
  if (!window.confirm(t(state.lang, 'saConfirmRevoke').replace('{id}', name))) return;
  const out = await postServiceAccounts(state, '/revoke', { name, secretId });
  if (!out) return;
  await loadServiceAccounts(state);
}

async function toggleDisabled(state, name, disabled) {
  const key = disabled ? 'saConfirmDisable' : 'saConfirmEnable';
  if (!window.confirm(t(state.lang, key).replace('{id}', name))) return;
  const out = await postServiceAccounts(state, '/update', { name, disabled });
  if (!out) return;
  await loadServiceAccounts(state);
}

async function deleteServiceAccount(state, name) {
  if (!window.confirm(t(state.lang, 'saConfirmDelete').replace('{id}', name))) return;
  const out = await postServiceAccounts(state, '/delete', { name });
  if (!out) return;
  await loadServiceAccounts(state);
}

function paintServiceAccounts(state, list) {
  state.tbody.replaceChildren();
  for (const row of serviceAccountRows(list)) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-sa-row', row.id);
    tr.appendChild(el('td', 'mono', row.id));
    tr.appendChild(el('td', undefined, row.role));
    tr.appendChild(el('td', 'muted', row.workflowsText ?? t(state.lang, 'saWorkflowsNone')));
    tr.appendChild(el('td', undefined, t(state.lang, row.statusKey)));
    tr.appendChild(el('td', 'mono', row.lastUsed ?? t(state.lang, 'saNever')));
    const secretsCell = document.createElement('td');
    for (const s of row.secrets) {
      const line = el('div', 'muted');
      line.textContent = `${s.id.slice(0, 8)}… (${s.lastUsed ? s.lastUsed : t(state.lang, 'saNever')}, ${s.expiresAt ?? t(state.lang, 'saNoExpiry')})`;
      const revoke = el('button', 'btn', t(state.lang, 'saRevoke'));
      revoke.type = 'button';
      revoke.setAttribute('data-sa-revoke', s.id);
      revoke.addEventListener('click', () => { revokeSecret(state, row.name, s.id); });
      line.appendChild(revoke);
      secretsCell.appendChild(line);
    }
    tr.appendChild(secretsCell);
    const actions = document.createElement('td');
    const rotate = el('button', 'btn', t(state.lang, 'saRotate'));
    rotate.type = 'button';
    rotate.setAttribute('data-sa-rotate', '');
    rotate.addEventListener('click', () => { rotateSecret(state, row.name); });
    actions.appendChild(rotate);
    const toggle = el('button', 'btn', t(state.lang, row.disabled ? 'saEnableAction' : 'saDisable'));
    toggle.type = 'button';
    toggle.setAttribute('data-sa-toggle', '');
    toggle.addEventListener('click', () => { toggleDisabled(state, row.name, !row.disabled); });
    actions.appendChild(toggle);
    const del = el('button', 'btn', t(state.lang, 'saDelete'));
    del.type = 'button';
    del.setAttribute('data-sa-delete', '');
    del.addEventListener('click', () => { deleteServiceAccount(state, row.name); });
    actions.appendChild(del);
    tr.appendChild(actions);
    state.tbody.appendChild(tr);
  }
  if (list.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'muted';
    td.textContent = t(state.lang, 'saEmpty');
    tr.appendChild(td);
    state.tbody.appendChild(tr);
  }
}

async function loadServiceAccounts(state) {
  const r = await getViewJSON('/api/service-accounts');
  if (r.status !== 'ok' || !Array.isArray(r.body)) {
    showSaError(state, t(state.lang, 'saError') + ((r.body && (r.body.error || r.body.code)) || 'unavailable'));
    return;
  }
  paintServiceAccounts(state, r.body);
}

// Issue #117 ("重新整理" — distinct from the 401/"過期" clause fixed above): keyed by container
// (`ui/home.js`'s own pattern) so `onTick` can reach the SAME state `render` built, across a
// language-toggle remount (a fresh container, a fresh WeakMap entry — never a stale one).
const stateByContainer = new WeakMap();

export function render(container) {
  const state = buildShell(container, currentLang());
  stateByContainer.set(container, state);
  load(state);
}

/** Issue #117: this view still refreshes on mount and after each change only w.r.t. the AMBIENT
 *  3s poll (`poll.js`'s `admin: () => []` is deliberate — repainting on that cadence would reset
 *  a selector mid-edit, see this file's header). But nothing refreshed it on RETURN either: not a
 *  browser-tab visibility resume, not re-activating the in-app Admin tab after visiting another
 *  one — both replay the exact same stale paint forever. `app.js`'s `tick.fresh` is true for
 *  exactly the one immediate tick a resume/tab-activation fires (never the ambient continuations
 *  after it), so reloading here on `fresh` is a one-time catch-up, not the forbidden continuous
 *  repaint. Skipped during a demo tick (no `/api/principals` in the demo fiction — a reload would
 *  paint `admError` over the fictional rows) and while the viewer has an unsaved quota figure
 *  typed (a focused, non-empty quota `<input>` inside this container) — the role `<select>`s need
 *  no such guard, since a change fires its own confirm() immediately and is never left half-set. */
export function onTick(container, bodies, ctx, tick) {
  const state = stateByContainer.get(container);
  if (!state || !tick || !tick.fresh || tick.source === 'demo') return undefined;
  const active = document.activeElement;
  if (active && active.tagName === 'INPUT' && active.value && container.contains(active)) return undefined;
  load(state);
  return undefined;
}
