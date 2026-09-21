// UT-297 (DES-241, ARCH-169/170, TASK-239, REQ-216/REQ-205): `captureFailure(err, secrets,
// maxBytes)` = `capErrorEnvelope(redact(toErr(err), secrets), maxBytes)`, in that order — redact
// BEFORE bounding (INV-V26-5: a substring cut applied to the raw message first can split a secret
// so redact()'s value-exact match finds neither half). `capErrorEnvelope` gains a defaulted second
// `maxBytes` parameter so the two existing capture sites (4096 bytes / 200 bytes) can share one
// function without unifying their bounds. Written test-first (Gate 5, RED) — `src/errors.ts`
// exports neither `captureFailure` today, nor does `capErrorEnvelope` take a second parameter
// (single-arg only) — both TypeErrors at call time (function does not accept 2 args / not a
// function), which is red for the right reason: unimplemented, not a logic bug.
//
// Mock policy (unit): pure functions, no I/O, no clock/store.
import { describe, it, expect } from 'vitest';
import { captureFailure, capErrorEnvelope, MAX_ERROR_ENVELOPE_BYTES, MAX_SECRET_NAME_CHARS } from '../../src/errors.js';
import { MARKER_PREFIX } from '../../src/secret-resolver.js';

const secrets = [{ name: 'GH_TOKEN', value: 'sekrit-value-123' }];

describe('UT-297: captureFailure — one pure capture, redact() then capErrorEnvelope(), bound is a parameter', () => {
  it('is exported and total: a coded object round-trips through redact+bound with no secrets configured', () => {
    expect(captureFailure({ code: 'BOOM', message: 'went boom' }, [])).toEqual({ code: 'BOOM', message: 'went boom' });
  });

  it('composition ORDER is redact-then-bound: a secret value straddling the cut yields an INTACT marker, never a split half', () => {
    // Build a message where the secret value sits exactly across the default 4096-byte cut point,
    // so a slice-first implementation would split it and redact() would then match neither half.
    const pad = 'x'.repeat(MAX_ERROR_ENVELOPE_BYTES - 8);
    const msg = pad + secrets[0]!.value + 'tail-after-secret';
    const out = captureFailure(new Error(msg), secrets);
    expect(out.message).toContain(`${MARKER_PREFIX}GH_TOKEN›`);
    expect(out.message).not.toContain(secrets[0]!.value);
  });

  it('a message under the bound is unchanged apart from redaction (identity path)', () => {
    const out = captureFailure(new Error(`short with ${secrets[0]!.value} inside`), secrets, 200);
    expect(out.message).toBe(`short with ${MARKER_PREFIX}GH_TOKEN› inside`);
  });

  it('K3 byte-exact: a 256-code-unit marker NAME at maxBytes=200 comes back within the documented worst case with the marker INTACT', () => {
    const bigName = 'N'.repeat(MAX_SECRET_NAME_CHARS);
    const bigSecrets = [{ name: bigName, value: 'the-actual-secret-value' }];
    const pad = 'y'.repeat(200 - 4);
    const msg = pad + bigSecrets[0]!.value;
    const out = captureFailure(new Error(msg), bigSecrets, 200);
    const worstCase = 200 + (MARKER_PREFIX.length + MAX_SECRET_NAME_CHARS + 1) * 3;
    expect(Buffer.byteLength(out.message, 'utf8')).toBeLessThanOrEqual(worstCase);
    expect(out.message).toContain(`${MARKER_PREFIX}${bigName}›`);
  });

  it('K3 byte-exact at the envelope bound (4096): same arithmetic, default maxBytes', () => {
    const bigName = 'N'.repeat(MAX_SECRET_NAME_CHARS);
    const bigSecrets = [{ name: bigName, value: 'the-actual-secret-value' }];
    const pad = 'y'.repeat(MAX_ERROR_ENVELOPE_BYTES - 4);
    const msg = pad + bigSecrets[0]!.value;
    const out = captureFailure(new Error(msg), bigSecrets);
    const worstCase = MAX_ERROR_ENVELOPE_BYTES + (MARKER_PREFIX.length + MAX_SECRET_NAME_CHARS + 1) * 3;
    expect(Buffer.byteLength(out.message, 'utf8')).toBeLessThanOrEqual(worstCase);
    expect(out.message).toContain(`${MARKER_PREFIX}${bigName}›`);
  });

  it('capErrorEnvelope accepts a defaulted second maxBytes parameter — every existing 1-arg call stays byte-identical', () => {
    const e = { code: 'SCRIPT_ERROR', message: 'x'.repeat(MAX_ERROR_ENVELOPE_BYTES + 500) };
    const oneArg = capErrorEnvelope(e);
    const twoArgDefaulted = capErrorEnvelope(e, MAX_ERROR_ENVELOPE_BYTES);
    expect(twoArgDefaulted).toEqual(oneArg);
    const narrowed = capErrorEnvelope(e, 200);
    expect(Buffer.byteLength(narrowed.message, 'utf8')).toBeLessThanOrEqual(200 + (MARKER_PREFIX.length + MAX_SECRET_NAME_CHARS + 1) * 3);
  });

  it('is pure: no clock, no store, no manager — same input twice yields byte-identical output', () => {
    const err = new Error(`carrying ${secrets[0]!.value}`);
    expect(captureFailure(err, secrets)).toEqual(captureFailure(err, secrets));
  });
});
