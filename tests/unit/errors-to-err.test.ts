// UT (DES-230, TASK-236, REQ-205): `toErr`/`capErrorEnvelope` move to `src/errors.ts` and become
// exported/total; the byte bound moves to the field that actually arrives (`message`, AFTER
// redact()). Written test-first (Gate 5, RED) — `src/errors.ts` exports neither symbol today
// (`toErr` is a private, unexported function inside `run-manager.ts`).
//
// Mock policy (unit): pure functions, no I/O.
//
// Scope note (DES-230 owner_decision, pending): REQ-205's fourth acceptance criterion (a
// structured `detail`/`violation` marker reaching `toErr`) is deliberately NOT tested here — the
// design traced that nothing upstream (sandbox/guards.ts, host.ts, child-entry.ts) ever forwards a
// `.detail` this far, and a test for it would be exactly the dead-code false-green this iteration
// exists to remove. See DES-230's `owner_decision: pending`.
import { describe, it, expect } from 'vitest';
import { toErr, capErrorEnvelope, MAX_ERROR_ENVELOPE_BYTES, MAX_SECRET_NAME_CHARS } from '../../src/errors.js';
import { redact, MARKER_PREFIX } from '../../src/secret-resolver.js';

describe('toErr (DES-230) — moved verbatim, now exported, still total', () => {
  it('a coded object {code, message} passes through with both stringified', () => {
    expect(toErr({ code: 'BOOM', message: 'went boom' })).toEqual({ code: 'BOOM', message: 'went boom' });
  });

  it('a genuine Error uses its name as code, message as message', () => {
    const e = new TypeError('bad value');
    expect(toErr(e)).toEqual({ code: 'TypeError', message: 'bad value' });
  });

  it('a primitive throw (string/number/undefined) becomes SCRIPT_ERROR with String(err) as message', () => {
    expect(toErr('boom')).toEqual({ code: 'SCRIPT_ERROR', message: 'boom' });
    expect(toErr(undefined)).toEqual({ code: 'SCRIPT_ERROR', message: 'undefined' });
  });
});

describe('capErrorEnvelope (DES-230) — bounds the SERIALIZED envelope, applied AFTER redact()', () => {
  it('an under-bound value returns unchanged (identity)', () => {
    const e = { code: 'SCRIPT_ERROR', message: 'short' };
    expect(capErrorEnvelope(e)).toEqual(e);
  });

  it('an over-bound message is truncated with a visible marker; code is never truncated', () => {
    const huge = { code: 'SCRIPT_ERROR', message: 'x'.repeat(MAX_ERROR_ENVELOPE_BYTES + 500) };
    const capped = capErrorEnvelope(huge);
    expect(capped.code).toBe('SCRIPT_ERROR');
    expect(capped.message.length).toBeLessThan(huge.message.length);
    expect(capped.message).toMatch(/truncated/i);
  });

  it('the cut is utf8-safe — never splits a multi-byte character', () => {
    // a multi-byte char repeated so the natural byte-cut point would land mid-character
    const huge = { code: 'SCRIPT_ERROR', message: '中'.repeat(MAX_ERROR_ENVELOPE_BYTES) };
    const capped = capErrorEnvelope(huge);
    // Buffer.from(...) round-trip must not throw / produce the U+FFFD replacement character
    expect(Buffer.from(capped.message, 'utf8').toString('utf8')).not.toContain('�');
  });

  it('the ordering test: a secret straddling the cut, composed as capErrorEnvelope(redact(toErr(e))), ' +
    'yields the redaction marker and no half-secret substring', () => {
    const secretName = 'UT230_TOKEN';
    const secretValue = 'ut230-secret-abcdefghijklmnop';
    // pad the message so the secret's OWN bytes straddle MAX_ERROR_ENVELOPE_BYTES exactly.
    const pad = 'p'.repeat(MAX_ERROR_ENVELOPE_BYTES - 10);
    const err = new Error(pad + secretValue);
    const composed = capErrorEnvelope(redact(toErr(err), [{ name: secretName, value: secretValue }]) as { code: string; message: string });
    expect(composed.message).toContain(`‹secret:${secretName}›`);
    // no half-secret substring: neither half of the raw value (split at an arbitrary interior
    // point) should survive as a literal substring of the capped message.
    const half = secretValue.slice(0, secretValue.length / 2);
    expect(composed.message).not.toContain(half);
  });

  // v35 GREEN-phase regression guard: the cut can land INSIDE the marker's own `‹secret:` prefix
  // (not just at its exact boundary) — a fix that only recognizes the FULL prefix already present
  // in the truncated head misses this and silently drops the marker instead of completing it.
  it('the cut landing mid-prefix (not just at the marker boundary) still completes the marker', () => {
    const secretName = 'UT230_TOKEN';
    const secretValue = 'ut230-secret-abcdefghijklmnop';
    // 5 bytes short of the marker's own straddle point — the naive cut lands inside `‹secret:`
    // itself (after `‹se`), not merely adjacent to it.
    const pad = 'p'.repeat(MAX_ERROR_ENVELOPE_BYTES - 5);
    const err = new Error(pad + secretValue);
    const composed = capErrorEnvelope(redact(toErr(err), [{ name: secretName, value: secretValue }]) as { code: string; message: string });
    expect(composed.message).toContain(`‹secret:${secretName}›`);
  });

  // v35 send-back (C-2): the forward extension to complete a marker split by the cut used to be an
  // UNBOUNDED scan (`e.message.indexOf('›', markerStart)` against the whole rest of a
  // script-controlled message) — it must now be bounded to `MARKER_PREFIX.length +
  // MAX_SECRET_NAME_CHARS` past the marker's start. These vary the DISTANCE from the cut to the
  // closing glyph (not just the cut offset, which the MAX_ERROR_ENVELOPE_BYTES-{10..-2} sweep above
  // already covers) — the bug class this misses is a closing glyph that exists but sits far away.
  describe('bounded forward scan (v35 send-back C-2)', () => {
    // Builds a message whose cut lands mid-prefix (`‹se|cret:...`, same landing point as the test
    // above) with a fake marker whose NAME is `nameLen` chars long before its closing `›`.
    function messageWithMarkerAt(nameLen: number): string {
      const pad = 'p'.repeat(MAX_ERROR_ENVELOPE_BYTES - 5);
      return `${pad}${MARKER_PREFIX}${'X'.repeat(nameLen)}›TAIL`;
    }

    it('a closing glyph exactly at the bound (name = MAX_SECRET_NAME_CHARS) still completes the marker', () => {
      const msg = messageWithMarkerAt(MAX_SECRET_NAME_CHARS);
      const capped = capErrorEnvelope({ code: 'SCRIPT_ERROR', message: msg });
      expect(capped.message).toContain(`${MARKER_PREFIX}${'X'.repeat(MAX_SECRET_NAME_CHARS)}›`);
    });

    it('a closing glyph one char past the bound is NOT reached — the incomplete marker is dropped, not completed', () => {
      const msg = messageWithMarkerAt(MAX_SECRET_NAME_CHARS + 1);
      const capped = capErrorEnvelope({ code: 'SCRIPT_ERROR', message: msg });
      expect(capped.message).not.toContain('›');
      expect(capped.message).not.toContain('X'.repeat(MAX_SECRET_NAME_CHARS + 1));
    });

    it('a closing glyph millions of chars away does not balloon the result (demonstrates the fixed unbounded-scan finding)', () => {
      // Before the fix this reproduced a ~50MB persisted envelope from a single throw; this uses a
      // smaller multiple to keep the test fast while still exercising "far past any realistic bound".
      const farMsg = messageWithMarkerAt(2_000_000);
      const capped = capErrorEnvelope({ code: 'SCRIPT_ERROR', message: farMsg });
      // Bounded: the result must stay close to MAX_ERROR_ENVELOPE_BYTES, never scale with the
      // attacker-controlled distance to the far-away '›'.
      expect(Buffer.byteLength(capped.message, 'utf8')).toBeLessThan(MAX_ERROR_ENVELOPE_BYTES + 200);
      expect(capped.message).not.toContain('›');
    });
  });
});
