// UT-096 (DES-097, ARCH-063, TASK-088): pure `isLoopbackPeer(remoteAddress, headers)` —
// exhaustive truth-table for the fail-closed loopback exemption.
//
// This is a SIBLING of the existing `isLoopback(bind)` in net-guard.ts, with DISTINCT
// semantics (peer exemption from auth-gate, NOT bind-address check).
//
// Cases (enumerated in DES-097 — all must be covered):
//   EXEMPT (loopback peer):
//     - 127.0.0.1 → exempt
//     - 127.0.0.2 (127.0.0.0/8) → exempt
//     - 127.255.255.255 (127.0.0.0/8 edge) → exempt
//     - ::1 → exempt
//     - ::ffff:127.0.0.1 (IPv4-mapped, dual-stack :: bind) → exempt  ← CRITICAL
//   NOT EXEMPT (fail-closed by default):
//     - undefined → NOT exempt (fail-closed, unknown source = deny)
//     - '10.0.0.1' → NOT exempt
//     - '192.168.1.100' → NOT exempt
//     - '::ffff:192.168.1.1' (non-loopback IPv4-mapped) → NOT exempt
//   FORWARDED HEADER PRESENT → NEVER exempt (tunnel-header fail-safe, D-AUTH-3):
//     - x-forwarded-for present + loopback remoteAddress → NOT exempt
//     - cf-connecting-ip present + loopback remoteAddress → NOT exempt
//     - forwarded present + loopback remoteAddress → NOT exempt
//     - x-real-ip present + loopback remoteAddress → NOT exempt
//
// Red reason: `isLoopbackPeer` is NOT yet exported from `src/net-guard.ts` →
//   import binds to `undefined` → calling isLoopbackPeer(...) throws TypeError →
//   all tests fail. Correct red for an unimplemented export.
//
// Mock policy (unit): pure function, zero I/O, zero clock, no network.

import { describe, it, expect } from 'vitest';
import { isLoopbackPeer } from '../../src/net-guard.js';

// empty-headers shorthand
const NO_HEADERS = {};

describe('isLoopbackPeer — EXEMPT cases (DES-097)', () => {
  it('127.0.0.1 is exempt (IPv4 loopback)', () => {
    expect(isLoopbackPeer('127.0.0.1', NO_HEADERS)).toBe(true);
  });

  it('127.0.0.2 is exempt (127.0.0.0/8)', () => {
    expect(isLoopbackPeer('127.0.0.2', NO_HEADERS)).toBe(true);
  });

  it('127.255.255.255 is exempt (127.0.0.0/8 upper edge)', () => {
    expect(isLoopbackPeer('127.255.255.255', NO_HEADERS)).toBe(true);
  });

  it('::1 is exempt (IPv6 loopback)', () => {
    expect(isLoopbackPeer('::1', NO_HEADERS)).toBe(true);
  });

  it('::ffff:127.0.0.1 is exempt (IPv4-mapped loopback on dual-stack :: bind)', () => {
    // Critical: missing this case spuriously 401s the local-admin/self-update rescue path.
    expect(isLoopbackPeer('::ffff:127.0.0.1', NO_HEADERS)).toBe(true);
  });

  it('::ffff:7f00:0001 is exempt (hex form of ::ffff:127.0.0.1)', () => {
    // Some OS stacks emit this compressed hex form
    expect(isLoopbackPeer('::ffff:7f00:0001', NO_HEADERS)).toBe(true);
  });
});

describe('isLoopbackPeer — NOT EXEMPT cases (DES-097)', () => {
  it('undefined remoteAddress → NOT exempt (fail-closed)', () => {
    expect(isLoopbackPeer(undefined, NO_HEADERS)).toBe(false);
  });

  it('empty string remoteAddress → NOT exempt (fail-closed)', () => {
    expect(isLoopbackPeer('', NO_HEADERS)).toBe(false);
  });

  it('10.0.0.1 → NOT exempt (private LAN)', () => {
    expect(isLoopbackPeer('10.0.0.1', NO_HEADERS)).toBe(false);
  });

  it('192.168.1.100 → NOT exempt (private LAN)', () => {
    expect(isLoopbackPeer('192.168.1.100', NO_HEADERS)).toBe(false);
  });

  it('::ffff:192.168.1.1 → NOT exempt (non-loopback IPv4-mapped)', () => {
    expect(isLoopbackPeer('::ffff:192.168.1.1', NO_HEADERS)).toBe(false);
  });

  it('1.2.3.4 → NOT exempt (public IP)', () => {
    expect(isLoopbackPeer('1.2.3.4', NO_HEADERS)).toBe(false);
  });

  it('::2 → NOT exempt (non-loopback IPv6)', () => {
    expect(isLoopbackPeer('::2', NO_HEADERS)).toBe(false);
  });
});

describe('isLoopbackPeer — forwarded header fail-safe (D-AUTH-3, DES-097)', () => {
  // ANY tunnel-injected client-IP header present ⇒ NEVER exempt (even if remoteAddress is loopback)
  // This closes the cloudflared-on-loopback hole: tunnel proxying to 127.0.0.1 would make every
  // public request arrive with a loopback socket peer and exempt the entire internet without auth.

  it('x-forwarded-for present + loopback remoteAddress → NOT exempt', () => {
    expect(isLoopbackPeer('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' })).toBe(false);
  });

  it('cf-connecting-ip present + loopback remoteAddress → NOT exempt', () => {
    expect(isLoopbackPeer('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' })).toBe(false);
  });

  it('forwarded present + loopback remoteAddress → NOT exempt', () => {
    expect(isLoopbackPeer('127.0.0.1', { forwarded: 'for=1.2.3.4' })).toBe(false);
  });

  it('x-real-ip present + loopback remoteAddress → NOT exempt', () => {
    expect(isLoopbackPeer('127.0.0.1', { 'x-real-ip': '1.2.3.4' })).toBe(false);
  });

  it('x-forwarded-for present + ::1 remoteAddress → NOT exempt', () => {
    expect(isLoopbackPeer('::1', { 'x-forwarded-for': '1.2.3.4' })).toBe(false);
  });

  it('x-forwarded-for present + ::ffff:127.0.0.1 → NOT exempt (tunnel-via-loopback hole)', () => {
    // The most dangerous case: cloudflared binds to loopback, forwards real client IP in header.
    // If we exempted this, the entire internet would bypass auth on a 127.0.0.1 socket peer.
    expect(isLoopbackPeer('::ffff:127.0.0.1', { 'x-forwarded-for': '8.8.8.8' })).toBe(false);
  });
});
