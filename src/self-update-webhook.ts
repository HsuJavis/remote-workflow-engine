/**
 * DES-058 / TASK-061 — pure GitHub tag-webhook verifier.
 * No fs/net/process imports; clock-free (GitHub signs no timestamp).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TagVerdict =
  | { arm: true; tag: string; deliveryId?: string }
  | { arm: false; httpStatus: 200 | 401 | 503; code?: string; reason: string };

export interface VerifyInput {
  event: string;
  signatureHeader?: string;
  deliveryId?: string;
  rawBody: Buffer;
}

export interface VerifyDeps {
  secret?: string;
  tagPattern?: RegExp;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Constant-time string comparison (length-safe: unequal lengths → false without timingSafeEqual). */
function safeStringEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ─── extractTag ───────────────────────────────────────────────────────────────

/**
 * Extract a tag name from a GitHub webhook event body.
 * Returns null for non-tag events (ping, branch push, tag delete).
 * Does NOT validate the tag pattern — that is the caller's responsibility.
 */
export function extractTag(event: string, body: unknown): string | null {
  if (event === 'ping') return null;

  if (event === 'create') {
    const b = body as { ref_type?: string; ref?: string };
    if (b.ref_type === 'tag' && typeof b.ref === 'string') return b.ref;
    return null;
  }

  if (event === 'push') {
    const b = body as { ref?: string; deleted?: boolean };
    if (b.deleted === true) return null;
    if (typeof b.ref === 'string' && b.ref.startsWith('refs/tags/')) {
      return b.ref.slice('refs/tags/'.length);
    }
    return null;
  }

  // `release` — the sequential-deploy trigger. The Release-workflow (`.github/workflows/release.yml`)
  // re-runs typecheck + the full suite on the tagged commit and ONLY publishes a GitHub Release when
  // green; publishing fires this event. Binding self-update here (instead of the tag `create` event)
  // makes the pipeline strictly ordered: tag push → CI → green → Release published → self-update —
  // never CI and self-update in parallel. Publishing one normal release fires several deliveries
  // (`created`, `published`, `released`); accept ONLY `published` so the updater arms exactly once.
  // A `prerelease` (e.g. `v0.8.0-rc1`, which passes TAG_PATTERN) is excluded so a pre-release never
  // auto-deploys to prod — only a full release does.
  if (event === 'release') {
    const b = body as { action?: string; release?: { tag_name?: string; prerelease?: boolean } };
    if (b.action === 'published' && b.release?.prerelease !== true && typeof b.release?.tag_name === 'string') {
      return b.release.tag_name;
    }
    return null;
  }

  return null;
}

// ─── verifyTagWebhook ─────────────────────────────────────────────────────────

/**
 * Verify a GitHub webhook delivery and determine whether to arm a self-update.
 *
 * Ordering (DES-058):
 *   1. Secret must be configured (fail-closed → 503).
 *   2. HMAC-SHA256 over the raw Buffer (never toString) — absent/malformed/mismatch → 401.
 *   3. Ping → 200 PING no-op.
 *   4. JSON.parse failure (e.g. form-encoded body) → 200 no-op.
 *   5. extractTag → null → 200 no-op.
 *   6. tag fails pattern → 200 no-op.
 *   7. else arm:true.
 */
export function verifyTagWebhook(input: VerifyInput, deps: VerifyDeps): TagVerdict {
  const { event, signatureHeader, deliveryId, rawBody } = input;
  const { secret, tagPattern } = deps;

  // Step 1 — Secret must exist.
  if (!secret) {
    return {
      arm: false,
      httpStatus: 503,
      code: 'UPDATE_WEBHOOK_UNCONFIGURED',
      reason: 'webhook secret not configured',
    };
  }

  // Step 2 — Verify HMAC-SHA256 over the raw Buffer.
  // Compute over rawBody directly (never rawBody.toString) to preserve wire bytes.
  const expectedSig = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

  if (!signatureHeader) {
    return { arm: false, httpStatus: 401, reason: 'missing X-Hub-Signature-256 header' };
  }
  if (!signatureHeader.startsWith('sha256=')) {
    return { arm: false, httpStatus: 401, reason: 'malformed signature (no sha256= prefix)' };
  }
  // safeStringEquals checks lengths before calling timingSafeEqual — safe against wrong-length input.
  if (!safeStringEquals(expectedSig, signatureHeader)) {
    return { arm: false, httpStatus: 401, reason: 'signature mismatch' };
  }

  // Step 3 — Ping is a no-op (verified but harmless).
  if (event === 'ping') {
    return { arm: false, httpStatus: 200, code: 'PING', reason: 'ping handshake' };
  }

  // Step 4 — Parse body as JSON (GitHub must send application/json; form-encoded is safe no-op).
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { arm: false, httpStatus: 200, reason: 'body is not valid JSON' };
  }

  // Step 5 — Extract tag name.
  const tag = extractTag(event, body);
  if (tag === null) {
    return { arm: false, httpStatus: 200, reason: 'event does not carry a tag' };
  }

  // Step 6 — Validate tag pattern (rejects injection attempts like "v1.0.0; rm -rf /").
  if (tagPattern && !tagPattern.test(tag)) {
    return { arm: false, httpStatus: 200, reason: `tag "${tag}" fails validation pattern` };
  }

  // Step 7 — Armed.
  return { arm: true, tag, deliveryId };
}
