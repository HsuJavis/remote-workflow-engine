// issue #24/#22: resolveTimeout validates a caller-supplied per-call AgentOpts.timeoutMs. Only a
// positive finite number is honored; anything else falls back (undefined) to the gateway default —
// a bad value from an untrusted script can never DISABLE the timeout bound.
import { describe, it, expect } from 'vitest';
import { resolveTimeout } from '../../src/gateway/client.js';

describe('resolveTimeout (issue #24/#22 per-call timeout validation)', () => {
  it('honors a positive finite number (both shorter and longer than any default)', () => {
    expect(resolveTimeout(150)).toBe(150);
    expect(resolveTimeout(600000)).toBe(600000);
    expect(resolveTimeout(0.5)).toBe(0.5);
  });

  it('rejects non-positive values → undefined (fall back to the configured default)', () => {
    expect(resolveTimeout(0)).toBeUndefined();
    expect(resolveTimeout(-1)).toBeUndefined();
    expect(resolveTimeout(-0)).toBeUndefined();
  });

  it('rejects non-finite and non-number values → undefined', () => {
    expect(resolveTimeout(NaN)).toBeUndefined();
    expect(resolveTimeout(Infinity)).toBeUndefined();
    expect(resolveTimeout('5000')).toBeUndefined(); // a string from an untrusted script
    expect(resolveTimeout(null)).toBeUndefined();
    expect(resolveTimeout(undefined)).toBeUndefined();
    expect(resolveTimeout({})).toBeUndefined();
  });
});
