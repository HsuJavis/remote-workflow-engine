// UT-065 (DES-058, REQ-068): pure tag-webhook verifier — extractTag + verifyTagWebhook → TagVerdict.
// TEST-FIRST (RED): src/self-update-webhook.ts does not exist yet; all cases fail with import error.
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { extractTag, verifyTagWebhook } from '../../src/self-update-webhook.js';

const TAG_PATTERN = /^v[0-9][0-9A-Za-z.\-+]*$/;
const SECRET = 'test-webhook-secret-ut065';

function makeRaw(body: object): Buffer { return Buffer.from(JSON.stringify(body)); }

function sig(rawBody: Buffer, s = SECRET): string {
  return 'sha256=' + createHmac('sha256', s).update(rawBody).digest('hex');
}

// A standard create-tag body used across multiple cases.
const RAW_CREATE = makeRaw({ ref_type: 'tag', ref: 'v1.2.3', repository: { full_name: 'test/repo' } });

// ─── extractTag ───────────────────────────────────────────────────────────────

describe('extractTag (DES-058)', () => {
  it('ping event → null', () => {
    expect(extractTag('ping', { zen: 'Non-blocking is better than blocking.' })).toBeNull();
  });

  it('create event with ref_type:tag → returns the ref', () => {
    expect(extractTag('create', { ref_type: 'tag', ref: 'v2.0.0' })).toBe('v2.0.0');
  });

  it('create event with ref_type:branch → null', () => {
    expect(extractTag('create', { ref_type: 'branch', ref: 'release/2.0' })).toBeNull();
  });

  it('push event with refs/tags/<tag> and deleted:false → the tag name', () => {
    expect(extractTag('push', { ref: 'refs/tags/v3.1.4', deleted: false })).toBe('v3.1.4');
  });

  it('push event with deleted:true (tag delete) → null', () => {
    expect(extractTag('push', { ref: 'refs/tags/v3.1.4', deleted: true })).toBeNull();
  });

  it('push event with refs/heads/main → null', () => {
    expect(extractTag('push', { ref: 'refs/heads/main', deleted: false })).toBeNull();
  });

  // `release` — the sequential-deploy trigger (self-update binds here, not `create`, so CI gates it).
  it('release event action:published → returns release.tag_name', () => {
    expect(extractTag('release', { action: 'published', release: { tag_name: 'v0.7.0' } })).toBe('v0.7.0');
  });

  it('release action:created (fires alongside published) → null — arm exactly once per release', () => {
    expect(extractTag('release', { action: 'created', release: { tag_name: 'v0.7.0' } })).toBeNull();
  });

  it('release action:released (also fires on publish) → null — arm exactly once per release', () => {
    expect(extractTag('release', { action: 'released', release: { tag_name: 'v0.7.0' } })).toBeNull();
  });

  it('release action:published but prerelease:true → null — a pre-release never auto-deploys to prod', () => {
    expect(extractTag('release', { action: 'published', release: { tag_name: 'v0.8.0-rc1', prerelease: true } })).toBeNull();
  });

  it('release action:published with no release.tag_name → null', () => {
    expect(extractTag('release', { action: 'published', release: {} })).toBeNull();
  });

  it('release action:edited/deleted (housekeeping) → null', () => {
    expect(extractTag('release', { action: 'edited', release: { tag_name: 'v0.7.0' } })).toBeNull();
    expect(extractTag('release', { action: 'deleted', release: { tag_name: 'v0.7.0' } })).toBeNull();
  });
});

// ─── verifyTagWebhook ─────────────────────────────────────────────────────────

describe('verifyTagWebhook (DES-058)', () => {
  it('no secret → 503 UPDATE_WEBHOOK_UNCONFIGURED (fail-closed)', () => {
    const v = verifyTagWebhook(
      { event: 'create', rawBody: RAW_CREATE },
      { tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(false);
    if (v.arm) return;
    expect(v.httpStatus).toBe(503);
    expect(v.code).toBe('UPDATE_WEBHOOK_UNCONFIGURED');
  });

  it('absent signature header → 401', () => {
    const v = verifyTagWebhook(
      { event: 'create', rawBody: RAW_CREATE },
      { secret: SECRET, tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(false);
    if (v.arm) return;
    expect(v.httpStatus).toBe(401);
  });

  it('malformed signature (no sha256= prefix) → 401, does not throw', () => {
    const v = verifyTagWebhook(
      { event: 'create', signatureHeader: 'deadbeef', rawBody: RAW_CREATE },
      { secret: SECRET, tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(false);
    if (v.arm) return;
    expect(v.httpStatus).toBe(401);
  });

  it('sha256= prefix + 63 hex chars (wrong length) → 401, timingSafeEqual never throws', () => {
    // If the implementation uses timingSafeEqual on unequal-length buffers without a prior length
    // guard, this will throw. The test pins the length-safe contract.
    const v = verifyTagWebhook(
      { event: 'create', signatureHeader: 'sha256=' + 'a'.repeat(63), rawBody: RAW_CREATE },
      { secret: SECRET, tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(false);
    if (v.arm) return;
    expect(v.httpStatus).toBe(401);
  });

  it('wrong signature (correct format, wrong value) → 401', () => {
    const v = verifyTagWebhook(
      { event: 'create', signatureHeader: 'sha256=' + '0'.repeat(64), rawBody: RAW_CREATE },
      { secret: SECRET, tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(false);
    if (v.arm) return;
    expect(v.httpStatus).toBe(401);
  });

  it('ping event with correct signature → 200 PING (no-op)', () => {
    const rawPing = makeRaw({ zen: 'Anything added dilutes everything else.' });
    const v = verifyTagWebhook(
      { event: 'ping', signatureHeader: sig(rawPing), rawBody: rawPing },
      { secret: SECRET, tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(false);
    if (v.arm) return;
    expect(v.httpStatus).toBe(200);
    expect(v.code).toBe('PING');
  });

  it('form-encoded body (JSON.parse fails) with correct sig → 200 no-op', () => {
    // GitHub must be configured for application/json; a form-encoded delivery HMAC-verifies
    // but is not parseable → safe 200 no-op (no tag extractable).
    const rawForm = Buffer.from('payload=%7B%22ref%22%3A%22v1.0.0%22%7D');
    const v = verifyTagWebhook(
      { event: 'create', signatureHeader: sig(rawForm), rawBody: rawForm },
      { secret: SECRET, tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(false);
    if (v.arm) return;
    expect(v.httpStatus).toBe(200);
  });

  it('tag fails pattern (injection attempt "v1.0.0; rm -rf /") → 200 no-op', () => {
    const rawBad = makeRaw({ ref_type: 'tag', ref: 'v1.0.0; rm -rf /', repository: {} });
    const v = verifyTagWebhook(
      { event: 'create', signatureHeader: sig(rawBad), rawBody: rawBad },
      { secret: SECRET, tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(false);
    if (v.arm) return;
    expect(v.httpStatus).toBe(200);
  });

  it('valid signed create for v1.2.3 → arm:true, tag:v1.2.3, deliveryId preserved', () => {
    const deliveryId = 'gh-del-ut065-001';
    const v = verifyTagWebhook(
      { event: 'create', signatureHeader: sig(RAW_CREATE), deliveryId, rawBody: RAW_CREATE },
      { secret: SECRET, tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(true);
    if (!v.arm) return;
    expect(v.tag).toBe('v1.2.3');
    expect(v.deliveryId).toBe(deliveryId);
  });

  it('valid signed release/published for v0.7.0 → arm:true (the CI-gated deploy trigger)', () => {
    const rawRelease = makeRaw({ action: 'published', release: { tag_name: 'v0.7.0', prerelease: false } });
    const v = verifyTagWebhook(
      { event: 'release', signatureHeader: sig(rawRelease), deliveryId: 'gh-rel-001', rawBody: rawRelease },
      { secret: SECRET, tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(true);
    if (!v.arm) return;
    expect(v.tag).toBe('v0.7.0');
    expect(v.deliveryId).toBe('gh-rel-001');
  });

  it('valid signed release/published but prerelease → 200 no-op (does not arm)', () => {
    const rawPre = makeRaw({ action: 'published', release: { tag_name: 'v0.8.0-rc1', prerelease: true } });
    const v = verifyTagWebhook(
      { event: 'release', signatureHeader: sig(rawPre), rawBody: rawPre },
      { secret: SECRET, tagPattern: TAG_PATTERN },
    );
    expect(v.arm).toBe(false);
    if (v.arm) return;
    expect(v.httpStatus).toBe(200);
  });
});
