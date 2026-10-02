// src/dashboard/lib/service-accounts.js
// Service accounts spec (owner decision 2026-10-03) — pure projections for the admin page's
// "Service accounts" section. No `document` here (lib/ boundary); the DOM half lives in
// ui/admin.js. Rows come straight off GET /api/service-accounts (service_account_list's own wire
// shape — see call-tool.ts's renderServiceAccount): `{ clientId, name, description, role,
// workflows, expiresAt, createdBy, createdAt, disabled, lastUsedAt, secrets:
// [{id, createdAt, expiresAt, lastUsedAt}] }`.

function fmtSeen(iso) {
  return typeof iso === 'string' && iso.length >= 19 ? iso.replace('T', ' ').slice(0, 19) : null;
}

function isExpired(iso, now) {
  return typeof iso === 'string' && Date.parse(iso) <= now;
}

/** One secret row for the table — `label` folds expiry/lastUsed into one glance, `id` is what
 *  the revoke button's confirm/POST body needs. */
export function secretRows(secrets, lang, now = Date.now()) {
  return (secrets ?? []).map((s) => ({
    id: s.id,
    createdAt: fmtSeen(s.createdAt) ?? '',
    lastUsed: fmtSeen(s.lastUsedAt),
    expiresAt: fmtSeen(s.expiresAt),
    expired: isExpired(s.expiresAt, now),
  }));
}

/** The admin table's rows — one per account, plus the derived `statusKey` (STR key) and
 *  `workflowsText` (null = "unrestricted", rendered with the saWorkflowsNone string). */
export function serviceAccountRows(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  return list.map((a) => {
    const expired = isExpired(a.expiresAt, now);
    return {
      id: a.clientId,
      name: a.name,
      role: a.role,
      description: a.description ?? '',
      workflowsText: Array.isArray(a.workflows) && a.workflows.length > 0 ? a.workflows.join(', ') : null,
      disabled: !!a.disabled,
      expired,
      statusKey: a.disabled ? 'saDisabledStatus' : expired ? 'saExpired' : 'saEnabled',
      lastUsed: fmtSeen(a.lastUsedAt),
      expiresAt: fmtSeen(a.expiresAt),
      secrets: secretRows(a.secrets, undefined, now),
    };
  });
}

/** The create form's `workflows` text input -> service_account_create's `workflows` argument:
 *  blank = omitted (unrestricted), else a comma-separated list, trimmed, empties dropped. */
export function parseWorkflowsInput(text) {
  const s = String(text ?? '').trim();
  if (!s) return undefined;
  const items = s.split(',').map((x) => x.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** The create form's `expiresAt` text input -> service_account_create's `expiresAt` argument:
 *  blank = omitted (never expires). Validity (parseable ISO-8601) is the SERVER's job
 *  (INVALID_ARGUMENT) — this is just the omit-when-blank rule. */
export function parseExpiresAtInput(text) {
  const s = String(text ?? '').trim();
  return s === '' ? undefined : s;
}

/** A ready-to-run curl snippet for the one-time secret banner (service accounts spec §Docs). */
export function curlSnippet(origin, clientId, clientSecret) {
  return `curl -s ${origin}/token -d grant_type=client_credentials -d client_id=${clientId} -d client_secret=${clientSecret}`;
}
