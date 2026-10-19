// src/dashboard/lib/principals.js
// Dashboard auth spec §A/§A2 (2026-09-30) — pure projections for the signed-in header, the admin
// tab's visibility, and the admin (roles) page's rows. No `document` here (lib/ boundary); the
// DOM half lives in ui/app.js and ui/admin.js.

import { t } from './strings.js';

const BASE_TABS = ['workflows', 'models', 'system', 'issues'];
const ROLES = ['admin', 'author', 'user', 'none'];

/** The tab strip for this page load: the admin tab exists only for a signed-in admin (the server
 *  refuses its API to anyone else anyway — hiding it is presentation, not the control). */
export function tabsFor(auth) {
  if (isPending(auth)) return [];
  return auth && auth.enabled && auth.role === 'admin' ? [...BASE_TABS, 'admin'] : [...BASE_TABS];
}

/** Owner decision 2026-09-30: a signed-in principal with role 'none' is PENDING APPROVAL — the
 *  app shows the waiting page instead of any view (every data route would refuse it anyway). */
export function isPending(auth) {
  return !!(auth && auth.enabled && !auth.loopback && auth.role === 'none');
}

/** The header's identity cluster, or null when auth is disabled (nobody to name). */
export function headerIdentity(auth, lang) {
  if (!auth || !auth.enabled) return null;
  if (auth.loopback) return { label: t(lang, 'admLocal'), role: null, signOut: false };
  return { label: String(auth.id ?? ''), role: auth.role ?? null, signOut: true };
}

const SOURCE_KEY = { 'config-locked': 'admSrc_configLocked', db: 'admSrc_db', config: 'admSrc_config', default: 'admSrc_default' };

function fmtSeen(iso, lang) {
  return typeof iso === 'string' && iso.length >= 19 ? iso.replace('T', ' ').slice(0, 19) : t(lang, 'admNever');
}

/** Owner decision 2026-10-02: bytes as the admin page shows them (binary units). */
function fmtBytes(n) {
  if (n === null) return 'unlimited';
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : Number(v.toFixed(2))} ${units[i]}`;
}

function quotaFields(q, lang) {
  if (!q || typeof q !== 'object') return { quotaText: '', quotaOverride: false, quotaSourceText: '' };
  const override = q.source === 'override';
  const src = t(lang, override ? 'admQuotaOverride' : 'admQuotaRoleDefault');
  return {
    quotaText: `${fmtBytes(q.usedBytes)} / ${fmtBytes(q.limitBytes)}`,
    quotaOverride: override,
    quotaSourceText: override && q.updatedBy ? `${src} (${t(lang, 'admBy')} ${q.updatedBy})` : src,
  };
}

/** The quota input -> principal_set_quota's `limit`: blank clears the override (null), plain
 *  digits are bytes, anything else ("2GiB", "unlimited") is passed through for the server to parse. */
export function quotaLimitValue(text) {
  const s = String(text ?? '').trim();
  if (s === '') return null;
  return /^\d+$/.test(s) ? Number(s) : s;
}

/** Rows for the admin table from a `principals_list` result. `selected` is the role selector's
 *  value: the runtime override when there is one, '' (= no override / default) otherwise. */
export function principalRows(body, lang) {
  if (!body || !Array.isArray(body.principals)) return [];
  return body.principals.map((p) => {
    const locked = p.source === 'config-locked';
    const src = t(lang, SOURCE_KEY[p.source] ?? 'admSrc_default');
    return {
      id: String(p.id),
      // Service accounts spec (owner decision 2026-10-03): 'human' or 'service' — ui/admin.js
      // filters 'service' rows out of this table (managed in the "Service accounts" section).
      kind: p.kind,
      role: p.role,
      locked,
      pending: p.role === 'none',
      selected: p.source === 'db' ? p.role : (locked ? 'admin' : ''),
      lastSeen: fmtSeen(p.lastSeenAt, lang),
      sourceText: p.source === 'db' && p.updatedBy ? `${src} (${t(lang, 'admBy')} ${p.updatedBy})` : src,
      ...quotaFields(p.quota, lang),
    };
  });
}

/** The role-selector value -> the `role` sent to principal_set_role ('' = remove the override). */
export function roleChangeValue(value) {
  if (value === '') return null;
  return ROLES.includes(value) ? value : undefined;
}

/** Where a 401 sends the browser: the login route, carrying the current page back as `next`. */
export function loginUrlFor(pathname, search) {
  return '/dashboard/login?next=' + encodeURIComponent(String(pathname) + String(search || ''));
}
