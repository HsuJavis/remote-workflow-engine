// UT-097 (DES-099, ARCH-062, TASK-089): pure `resolveHarnessParams` per-param merge and
// `HarnessDefaults` shared type from `src/harness-defaults.ts`.
//
// Cases (per-param merge semantics, DES-099):
//   - no registered defaults + no overrides → all params undefined (pre-v15 behaviour)
//   - registered defaults only → effective params equal registered
//   - override only (no registered) → effective params equal override
//   - run-time override wins per-param (override timeoutMs keeps registered model)
//   - override some params, registered supplies the rest (mixed)
//   - backward-compat: undefined registered → same as absent defaults (no crash)
//   - skills in registered defaults → present in effective params (deferred at register time,
//     resolved at run time — but merge still includes them in the effective output)
//   - explicit undefined override key → falls back to registered value (not a forced undefined)
//
// Red reason: `src/harness-defaults.ts` does not exist → MODULE NOT FOUND → all tests fail
//   at collect time. Correct red for an unimplemented module.
//
// Mock policy (unit): pure function, zero I/O.

import { describe, it, expect } from 'vitest';
import { resolveHarnessParams } from '../../src/harness-defaults.js';
import type { HarnessDefaults } from '../../src/harness-defaults.js';

describe('resolveHarnessParams pure per-param merge (DES-099)', () => {
  it('no registered + no overrides → all params absent (pre-v15 behaviour)', () => {
    const effective = resolveHarnessParams(undefined, {});
    // Should not crash and should not inject unexpected values
    expect(effective.model).toBeUndefined();
    expect(effective.timeoutMs).toBeUndefined();
    expect(effective.tools).toBeUndefined();
  });

  it('registered defaults only → effective equals registered', () => {
    const registered: HarnessDefaults = {
      model: 'sonnet',
      timeoutMs: 30_000,
      tools: ['read_file'],
      prompt: 'You are a helpful assistant.',
    };
    const effective = resolveHarnessParams(registered, {});
    expect(effective.model).toBe('sonnet');
    expect(effective.timeoutMs).toBe(30_000);
    expect(effective.tools).toEqual(['read_file']);
    expect(effective.prompt).toBe('You are a helpful assistant.');
  });

  it('override only (no registered) → effective equals override', () => {
    const effective = resolveHarnessParams(undefined, { model: 'haiku', timeoutMs: 10_000 });
    expect(effective.model).toBe('haiku');
    expect(effective.timeoutMs).toBe(10_000);
  });

  it('override timeoutMs only → model falls back to registered (per-param granularity)', () => {
    const registered: HarnessDefaults = { model: 'opus', timeoutMs: 60_000 };
    const effective = resolveHarnessParams(registered, { timeoutMs: 5_000 });
    expect(effective.model).toBe('opus');      // falls back
    expect(effective.timeoutMs).toBe(5_000);   // overridden
  });

  it('override model only → timeoutMs falls back to registered', () => {
    const registered: HarnessDefaults = { model: 'opus', timeoutMs: 60_000 };
    const effective = resolveHarnessParams(registered, { model: 'haiku' });
    expect(effective.model).toBe('haiku');     // overridden
    expect(effective.timeoutMs).toBe(60_000); // falls back
  });

  it('mixed: override tools only, registered supplies model+timeoutMs', () => {
    const registered: HarnessDefaults = { model: 'sonnet', timeoutMs: 30_000, tools: ['read_file'] };
    const effective = resolveHarnessParams(registered, { tools: ['write_file', 'read_file'] });
    expect(effective.model).toBe('sonnet');
    expect(effective.timeoutMs).toBe(30_000);
    expect(effective.tools).toEqual(['write_file', 'read_file']);
  });

  it('skills in registered → present in effective (skills existence deferred to run time)', () => {
    const registered: HarnessDefaults = { model: 'sonnet', skills: ['my-skill'] };
    const effective = resolveHarnessParams(registered, {});
    expect(effective.skills).toEqual(['my-skill']);
  });

  it('override skills → override wins', () => {
    const registered: HarnessDefaults = { skills: ['skill-a'] };
    const effective = resolveHarnessParams(registered, { skills: ['skill-b'] });
    expect(effective.skills).toEqual(['skill-b']);
  });

  it('backward-compat: undefined registered does not crash and matches pre-v15 (no model forced)', () => {
    expect(() => resolveHarnessParams(undefined, {})).not.toThrow();
    const effective = resolveHarnessParams(undefined, {});
    expect(effective.model).toBeUndefined();
  });

  it('registered with all fields + full override → override wins for every field', () => {
    const registered: HarnessDefaults = {
      model: 'opus', timeoutMs: 60_000, tools: ['a'], skills: ['s1'], prompt: 'base',
    };
    const overrides: HarnessDefaults = {
      model: 'haiku', timeoutMs: 5_000, tools: ['b'], skills: ['s2'], prompt: 'override',
    };
    const effective = resolveHarnessParams(registered, overrides);
    expect(effective.model).toBe('haiku');
    expect(effective.timeoutMs).toBe(5_000);
    expect(effective.tools).toEqual(['b']);
    expect(effective.skills).toEqual(['s2']);
    expect(effective.prompt).toBe('override');
  });
});
