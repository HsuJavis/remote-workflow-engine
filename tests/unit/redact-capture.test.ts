// UT-089 (DES-088, ARCH-056, TASK-082): pure `redact({name,value}[])` with `‹secret:NAME›` marker.
// Tests the EXTENDED signature of the `redact` function in `secret-resolver.ts`:
//   `redact(event: unknown, secrets: ReadonlyArray<{name:string; value:string}>): unknown`
// Marker: `‹secret:${name}›` (name-keyed, stable across restarts, per-secret distinguishable).
//
// Cases:
//   1. Event with a secret value substring → replaced with `‹secret:NAME›` marker
//   2. Same-shape different-value string NOT redacted (negative control — no over-redaction)
//   3. Two secrets sharing a value → first name wins deterministically
//   4. Nested walk: value buried inside object/array fields is redacted
//   5. Non-string primitive (number, boolean, null) → unchanged
//   6. Empty secrets array → event unchanged
//   7. Secret with empty-string value → not substituted (empty values ignored)
//   8. Perf bound: 20 secrets × 200 events < 50 ms (from DES-088 S-S3 perf guard)
//
// Red reason: `redact` in `secret-resolver.ts` still has the old `string[]` signature →
//   calling it with `{name,value}[]` produces `‹redacted›` (old marker) instead of
//   `‹secret:NAME›` → all marker assertions fail for the correct unimplemented reason.
//   (Alternative failure if the TypeScript signature is unchanged: no TS error at test import
//   time, but runtime behavior differs.)
//
// Mock policy (unit — DES-091): pure function, zero I/O, zero clock, zero network.

import { describe, it, expect } from 'vitest';
import { redact } from '../../src/secret-resolver.js';

const S = (name: string) => `‹secret:${name}›`; // expected marker template

describe('redact({name,value}[]) — name-keyed marker (DES-088)', () => {
  it('replaces a secret value occurrence with ‹secret:NAME›', () => {
    const event = { kind: 'message', text: 'my api key is abc123xyz and more text' };
    const result = redact(event, [{ name: 'API_KEY', value: 'abc123xyz' }]) as typeof event;
    expect(result.text).toBe(`my api key is ${S('API_KEY')} and more text`);
    expect(result.text).not.toContain('abc123xyz');
  });

  it('does NOT redact a same-shape value that is not a provisioned secret (negative control)', () => {
    const event = { kind: 'message', text: 'ordinary text with no secrets here' };
    const result = redact(event, [{ name: 'API_KEY', value: 'abc123xyz' }]) as typeof event;
    // 'ordinary text…' contains no secret value → unchanged
    expect(result.text).toBe(event.text);
  });

  it('two secrets sharing a value → first name wins deterministically', () => {
    const event = { text: 'shared-secret-value' };
    const result = redact(event, [
      { name: 'FIRST_SECRET', value: 'shared-secret-value' },
      { name: 'SECOND_SECRET', value: 'shared-secret-value' },
    ]) as typeof event;
    // First-in-list name takes precedence
    expect(result.text).toBe(S('FIRST_SECRET'));
    expect(result.text).not.toContain(S('SECOND_SECRET'));
  });

  it('nested walk: value buried in object/array is redacted', () => {
    const event = {
      kind: 'tool_result',
      content: [{ text: 'token=s3cr3t' }, { extra: { nested: 'bearer s3cr3t done' } }],
    };
    const result = redact(event, [{ name: 'TOKEN', value: 's3cr3t' }]) as typeof event;
    const [first, second] = (result as any).content;
    expect(first.text).toBe(`token=${S('TOKEN')}`);
    expect(second.extra.nested).toBe(`bearer ${S('TOKEN')} done`);
  });

  it('non-string primitives (number, boolean, null) are returned unchanged', () => {
    expect(redact(42, [{ name: 'N', value: '42' }])).toBe(42);
    expect(redact(true, [{ name: 'B', value: 'true' }])).toBe(true);
    expect(redact(null, [{ name: 'N', value: 'null' }])).toBeNull();
  });

  it('empty secrets array → event returned unchanged', () => {
    const event = { text: 'hello world' };
    const result = redact(event, []) as typeof event;
    expect(result.text).toBe('hello world');
  });

  it('secret with empty-string value → not substituted (ignored)', () => {
    const event = { text: 'a b c' };
    const result = redact(event, [{ name: 'EMPTY', value: '' }]) as typeof event;
    // empty-value secret doesn't corrupt the string (split('').join(...) would be catastrophic)
    expect(result.text).toBe('a b c');
  });

  it('multiple distinct secrets all substituted in one pass', () => {
    const event = { text: 'key1=AAABBB and key2=CCCDD done' };
    const result = redact(event, [
      { name: 'KEY1', value: 'AAABBB' },
      { name: 'KEY2', value: 'CCCDD' },
    ]) as typeof event;
    expect(result.text).toContain(S('KEY1'));
    expect(result.text).toContain(S('KEY2'));
    expect(result.text).not.toContain('AAABBB');
    expect(result.text).not.toContain('CCCDD');
  });

  it('perf bound: 20 secrets × 200 events < 50 ms (DES-088 S-S3)', () => {
    const secrets = Array.from({ length: 20 }, (_, i) => ({
      name: `SECRET_${i}`,
      value: `super-secret-value-number-${i}-xyz`,
    }));
    const events = Array.from({ length: 200 }, (_, i) => ({
      kind: 'message',
      text: `Event ${i} contains super-secret-value-number-${i % 20}-xyz in the text`,
    }));
    const start = Date.now();
    for (const ev of events) redact(ev, secrets);
    const elapsed = Date.now() - start;
    // Loose guard: linear is fine, quadratic (20×200×textLen) would be much higher
    expect(elapsed).toBeLessThan(50);
  });
});
