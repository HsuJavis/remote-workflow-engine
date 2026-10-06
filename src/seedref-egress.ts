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
 * V3-M1 (repair-round defect, 2026-10-06): the ONE https-allowlist rule shared by
 * `normalizeSeedRefAllowlist` below (seedRefAllowlist) and composeConfig()'s mcpEgressAllowlist
 * check (src/main.ts) — before this, both hand-wrote the identical "must be an array" / "must be a
 * valid URL" / "must use https:" parse+scheme rule, which is exactly the drift risk a shared
 * validator (A9: "one shared validator, no duplicated rules") removes. `keyName` is interpolated
 * into every message so a caller's errors always name the right config key. `makeError` lets
 * `normalizeSeedRefAllowlist` keep throwing its existing `codedError('SEEDREF_ALLOWLIST_INVALID', …)`
 * (no code/behaviour change there); `{ frame: true }` lets composeConfig's mcpEgressAllowlist call
 * site keep the "rwe.config.json: … Refusing to start (ADR-028 fail-closed)." framing every other
 * composeConfig refusal uses (gateway, maxEffort, legacyOwner) — a framing seedRefAllowlist's own
 * pre-existing plain wording never had and still doesn't.
 */
export function assertHttpsAllowlist(
  raw: unknown,
  keyName: string,
  opts: { frame?: boolean; makeError?: (message: string) => Error } = {},
): string[] {
  const makeError = opts.makeError ?? ((m: string) => new Error(m));
  const wrap = (msg: string) => (opts.frame ? `rwe.config.json: ${msg}. Refusing to start (ADR-028 fail-closed).` : msg);
  if (!Array.isArray(raw)) {
    throw makeError(wrap(`${keyName} must be an array, got ${typeof raw}`));
  }
  return raw.map((entry) => {
    if (typeof entry !== 'string') {
      throw makeError(wrap(`${keyName} entry must be a string, got ${typeof entry}: ${String(entry)}`));
    }
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw makeError(wrap(`${keyName} entry is not a valid URL: ${entry}`));
    }
    if (url.protocol !== 'https:') {
      throw makeError(wrap(`${keyName} entry must use https:, got ${url.protocol} in: ${entry}`));
    }
    // Normalize: origin + pathname + trailing /
    const base = url.origin + url.pathname;
    return base.endsWith('/') ? base : base + '/';
  });
}

/**
 * Config-load validator: rejects any non-https or unparseable entry with a codedError naming
 * the entry. Normalizes each valid https entry to origin+pathname with enforced trailing /.
 */
export function normalizeSeedRefAllowlist(raw: unknown): string[] {
  return assertHttpsAllowlist(raw, 'seedRefAllowlist', {
    makeError: (m) => codedError('SEEDREF_ALLOWLIST_INVALID', m),
  });
}
