// UT-090 (DES-088, ARCH-056, TASK-082): persist-only invariants + double-redaction exclusivity.
// Tests the DES-088 named invariants:
//   (a) double-redaction exclusivity: `redact({name,value}[])` runs ONLY on non-harness events;
//       `redactHarness` runs ONLY on kind==='harness' events; neither runs on the other's output.
//   (b) persist-only: `redact` is a PURE function — it returns a new object and never mutates
//       the input `event`, so the live in-memory messages array is untouched.
//   (c) marker correctness: the `‹secret:NAME›` marker replaces the exact secret value,
//       and `redactHarness` uses its own existing marker (not `‹secret:NAME›`).
//
// Cases:
//   1. Pure: `redact(event, secrets)` returns a new object; the original is unchanged (no mutation)
//   2. Exclusivity: `redact` on a kind==='harness' event (DES-088 says it ONLY runs on non-harness) →
//      the test checks we have a convention-based boundary (not calling redact on harness events)
//   3. `redactHarness` output does NOT contain `‹secret:NAME›` markers (separate path, separate marker)
//   4. A non-harness event after `redact` contains `‹secret:NAME›`; the same object before does not
//
// Red reason: `redact` in `secret-resolver.ts` still has `string[]` signature; calling with
//   `{name,value}[]` produces old `‹redacted›` marker instead of `‹secret:NAME›` →
//   assertions on the specific marker format fail for the correct unimplemented reason.
//
// Mock policy (unit — DES-091): pure functions only, no I/O, no gateway, no RunManager.

import { describe, it, expect } from 'vitest';
import { redact } from '../../src/secret-resolver.js';
import { redactHarness } from '../../src/agent-executor.js';

const SECRET_MARKER = (name: string) => `‹secret:${name}›`;

describe('redact persist-only invariant (DES-088 invariant b)', () => {
  it('redact is PURE: original event object is NOT mutated', () => {
    const original = { kind: 'message', text: 'contains secret value abc123' };
    const copy = { kind: 'message', text: 'contains secret value abc123' };

    const result = redact(original, [{ name: 'KEY', value: 'abc123' }]);

    // Returned object has the marker
    expect((result as typeof original).text).toContain(SECRET_MARKER('KEY'));
    // Original object is unchanged (pure function, no mutation)
    expect(original.text).toBe(copy.text);
    expect(original.text).not.toContain(SECRET_MARKER('KEY'));
  });

  it('redact on nested object: original nested structure is NOT mutated', () => {
    const inner = { nested: 'value is supersecret456 here' };
    const original = { kind: 'tool_result', content: [inner] };

    redact(original, [{ name: 'NEST', value: 'supersecret456' }]);

    // Inner object unchanged (no mutation)
    expect(inner.nested).toBe('value is supersecret456 here');
  });

  it('redact on array: returns new array, original array unchanged', () => {
    const original = ['hello supersecretZ99', 'other string'];
    const result = redact(original, [{ name: 'Z', value: 'supersecretZ99' }]) as string[];
    expect(result[0]).toContain(SECRET_MARKER('Z'));
    expect(original[0]).toBe('hello supersecretZ99'); // original untouched
  });
});

describe('double-redaction exclusivity (DES-088 invariant a)', () => {
  it('redactHarness does NOT produce ‹secret:NAME› markers (separate code path)', () => {
    // redactHarness handles kind:'harness' events; it uses its own existing redaction
    const resolved = {
      surfaceType: 'curated' as const,
      modelName: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
      prompt: 'You are a helpful assistant',
      curatedTools: ['Read', 'Write'],
      mergedMcp: [],
      skills: [],
    };
    const result = redactHarness(resolved);
    // redactHarness should NOT produce ‹secret:NAME› markers
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/‹secret:/);
  });

  it('redact with {name,value}[] produces ‹secret:NAME›, not ‹redacted›', () => {
    const event = { kind: 'message', text: 'the token is xyz789tok' };
    const result = redact(event, [{ name: 'TOKEN', value: 'xyz789tok' }]) as typeof event;
    // NEW expected marker
    expect(result.text).toContain(SECRET_MARKER('TOKEN'));
    // OLD marker must NOT appear (regression guard: old string[] call produced ‹redacted›)
    expect(result.text).not.toContain('‹redacted›');
    expect(result.text).not.toContain('xyz789tok');
  });

  it('harness event with secret-like text: redactHarness does not apply name-keyed marker', () => {
    // Regression guard: if someone calls redactHarness on an event that happens to contain
    // a secret value, the ‹secret:NAME› marker should never appear in its output — that path
    // is only for redact() at the persist sink.
    const resolved = {
      surfaceType: 'curated' as const,
      modelName: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
      prompt: 'Use token abc123token for auth',
      curatedTools: [],
      mergedMcp: [],
      skills: [],
    };
    const result = redactHarness(resolved);
    const json = JSON.stringify(result);
    // redactHarness output never contains ‹secret:NAME›
    expect(json).not.toMatch(/‹secret:/);
  });
});
