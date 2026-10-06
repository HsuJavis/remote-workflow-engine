// V3-M2 (repair-round defect, 2026-10-06): `assertPositiveInteger` printed `value` unquoted in its
// message — for a STRING value like "8" the message read "agentSlots must be a positive integer,
// got 8", indistinguishable from the valid number 8. It also lacked the "rwe.config.json: … Refusing
// to start (ADR-028 fail-closed)" framing every other composeConfig() refusal uses (gateway,
// maxEffort, mcpEgressAllowlist, legacyOwner) — RunManager's own plain wording must stay as-is
// (it is not a composeConfig refusal and has its own existing test coverage, run-concurrency-default.test.ts).
//
// Mock policy (unit): pure function, no I/O, no clock.

import { describe, it, expect } from 'vitest';
import { assertPositiveInteger } from '../../src/config-numeric.js';

describe('assertPositiveInteger (V3-M2)', () => {
  it('a valid positive integer does not throw', () => {
    expect(() => assertPositiveInteger(7, 'agentSlots')).not.toThrow();
  });

  it('null/undefined (absent) does not throw — "use the default" convention is preserved', () => {
    expect(() => assertPositiveInteger(null, 'agentSlots')).not.toThrow();
    expect(() => assertPositiveInteger(undefined, 'agentSlots')).not.toThrow();
  });

  it('without a prefix (RunManager\'s own call), the message has no rwe.config.json/ADR-028 framing', () => {
    try {
      assertPositiveInteger(0, 'runConcurrency');
      throw new Error('expected assertPositiveInteger to throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/runConcurrency must be a positive integer/);
      expect(msg).not.toMatch(/rwe\.config\.json|Refusing to start/);
    }
  });

  it('a STRING value is quoted via JSON.stringify so it reads as a string, not the number it looks like', () => {
    try {
      assertPositiveInteger('8' as unknown as number, 'agentSlots');
      throw new Error('expected assertPositiveInteger to throw');
    } catch (e) {
      expect((e as Error).message).toMatch(/got "8"/);
    }
  });

  it('a plain number value still prints unquoted (no behaviour-visible change for the common case)', () => {
    try {
      assertPositiveInteger(0, 'agentSlots');
      throw new Error('expected assertPositiveInteger to throw');
    } catch (e) {
      expect((e as Error).message).toMatch(/got 0(?!")/);
    }
  });

  it('with { prefix: "rwe.config.json: " } (composeConfig\'s call), the message is framed like every other composeConfig refusal', () => {
    try {
      assertPositiveInteger('8' as unknown as number, 'agentSlots', { prefix: 'rwe.config.json: ' });
      throw new Error('expected assertPositiveInteger to throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/^rwe\.config\.json: agentSlots must be a positive integer, got "8"\. Refusing to start \(ADR-028 fail-closed\)\.$/);
    }
  });

  it('a non-integer (1.5) still refuses, with or without a prefix', () => {
    expect(() => assertPositiveInteger(1.5, 'maxWorkflowDepth')).toThrow(/maxWorkflowDepth must be a positive integer/);
    expect(() => assertPositiveInteger(1.5, 'maxWorkflowDepth', { prefix: 'rwe.config.json: ' })).toThrow(
      /rwe\.config\.json: maxWorkflowDepth must be a positive integer/,
    );
  });
});
