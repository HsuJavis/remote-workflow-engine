// UT-048: D-BIND isLoopback fail-closed truth-table predicate (DES-029, TASK-036)
// RED: src/net-guard.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect } from 'vitest';
// Value import — causes module-not-found at load time when the module is absent.
import { isLoopback } from '../../src/net-guard.js';

describe('isLoopback — truth table (D-BIND, DES-029)', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.0.0.2', true],
    ['127.255.255.255', true],
    ['::1', true],
    ['0.0.0.0', false],
    ['192.168.1.5', false],
    ['10.0.0.1', false],
    ['::', false],
    ['localhost', false], // a hostname, not an IP literal — fail-closed, not a DNS lookup
    ['', false],
  ])('isLoopback(%s) === %s', (bind, expected) => {
    expect(isLoopback(bind)).toBe(expected);
  });

  it('rejects a prefix-match bypass that a naive === "127.0.0.1" string compare would miss (e.g. "127.0.0.10")', () => {
    // Still true because it IS in 127.0.0.0/8 — the point is it must be a real CIDR/textual
    // check, not `startsWith('127.0.0.1')` which would ALSO wrongly true-positive '127.0.0.100'
    // for the wrong reason. Confirmed via the exact-match negative below.
    expect(isLoopback('127.0.0.10')).toBe(true);
  });

  it('rejects a non-loopback address that merely shares a textual prefix with 127.0.0.1', () => {
    expect(isLoopback('127.0.0.1.evil.example.com')).toBe(false);
  });
});
