// DES-079 (ARCH-052, TASK-077): pure egress gate — deny-by-default SSRF filter.
// isEgressAllowed: pure function, no I/O, no clock, no network.
// normalizeSeedRefAllowlist: config-load validator; throws codedError on bad entry.
// NOT a reuse of net-guard.ts (that is the HTTP server-bind/host-header plane).

import { codedError, type ErrorCode } from './errors.js';

export type EgressVerdict =
  | { ok: true; url: URL }
  // v24 (DES-137): constrained to the closed ErrorCode union at its declaration.
  | { ok: false; code: Extract<ErrorCode, 'SEEDREF_DISABLED' | 'EGRESS_DENIED'>; reason: string };

/**
 * Deny-by-default egress gate. Returns SEEDREF_DISABLED when allowlist is empty/absent.
 * Returns EGRESS_DENIED for: non-https scheme, userinfo, URL parse failure, or no
 * prefix match. Match = (url.origin + url.pathname + enforced trailing /) starts-with a
 * normalized allowlist entry. Re-appends trailing / idempotently so it is TOTAL on any string[].
 */
export function isEgressAllowed(repoUrl: string, allowlist: readonly string[]): EgressVerdict {
  if (allowlist.length === 0) {
    return { ok: false, code: 'SEEDREF_DISABLED', reason: 'seedRefAllowlist is empty or not configured' };
  }

  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    return { ok: false, code: 'EGRESS_DENIED', reason: `URL parse failure: ${repoUrl}` };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, code: 'EGRESS_DENIED', reason: `non-https scheme: ${url.protocol}` };
  }

  if (url.username || url.password) {
    return { ok: false, code: 'EGRESS_DENIED', reason: 'userinfo (username/password) not allowed in seedRef URL' };
  }

  // Normalized URL key: origin + pathname + enforced trailing /
  const urlKey = (url.origin + url.pathname).replace(/\/*$/, '/');

  for (const entry of allowlist) {
    // Re-append trailing / idempotently (TOTAL on any string[])
    const normalized = entry.endsWith('/') ? entry : entry + '/';
    if (urlKey.startsWith(normalized)) {
      return { ok: true, url };
    }
  }

  return {
    ok: false,
    code: 'EGRESS_DENIED',
    reason: `${url.host}${url.pathname} is not in the seedRefAllowlist`,
  };
}

/**
 * Config-load validator: rejects any non-https or unparseable entry with a codedError naming
 * the entry. Normalizes each valid https entry to origin+pathname with enforced trailing /.
 */
export function normalizeSeedRefAllowlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw codedError('SEEDREF_ALLOWLIST_INVALID', `seedRefAllowlist must be an array, got ${typeof raw}`);
  }
  return raw.map((entry) => {
    if (typeof entry !== 'string') {
      throw codedError('SEEDREF_ALLOWLIST_INVALID', `seedRefAllowlist entry must be a string, got ${typeof entry}: ${String(entry)}`);
    }
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw codedError('SEEDREF_ALLOWLIST_INVALID', `seedRefAllowlist entry is not a valid URL: ${entry}`);
    }
    if (url.protocol !== 'https:') {
      throw codedError('SEEDREF_ALLOWLIST_INVALID', `seedRefAllowlist entry must use https:, got ${url.protocol} in: ${entry}`);
    }
    // Normalize: origin + pathname + trailing /
    const base = url.origin + url.pathname;
    return base.endsWith('/') ? base : base + '/';
  });
}
