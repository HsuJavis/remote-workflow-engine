// UT-086 (DES-086, ARCH-054, TASK-080): pure `isValidSha256Hex` and `isValidNamespace` validators.
// These are exported pure functions from `cas-store.ts` that run BEFORE any fd opens on the
// POST /assets/blob/:sha route — a path-traversal gate (a crafted ../.. sha or namespace must be
// rejected as a typed 400 before the filesystem is touched).
//
// Cases:
//   isValidSha256Hex:
//     - 64-char lowercase hex → valid
//     - 63-char → invalid (too short)
//     - 65-char → invalid (too long)
//     - uppercase hex (A-F) → invalid (lowercase-only, REJECT not normalize)
//     - non-hex chars (g, /, .) → invalid
//     - empty string → invalid
//     - a sha256 of real bytes → valid (happy)
//   isValidNamespace:
//     - 'tenantA' → valid
//     - empty string → invalid
//     - contains '/' → invalid (path-traversal)
//     - starts with '.' → invalid
//     - consecutive '.' ('..') → invalid
//     - only alphanumeric + '-' + '_' → valid
//     - contains space → invalid
//     - contains '../' → invalid
//
// Red reason: `isValidSha256Hex` and `isValidNamespace` are not yet exported from `cas-store.ts` →
//   import fails with "does not provide an export named 'isValidSha256Hex'" (or 'isValidNamespace') →
//   all tests fail at collect time. This is the correct red for an unimplemented feature.
//
// Mock policy (unit): pure functions, zero I/O, zero clock, no network.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { isValidSha256Hex, isValidNamespace } from '../../src/cas-store.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('isValidSha256Hex (DES-086 pure validator)', () => {
  it('accepts a valid 64-char lowercase hex string', () => {
    const h = sha256('hello world');
    expect(isValidSha256Hex(h)).toBe(true);
  });

  it('accepts all-zero 64-char hex (edge: valid format)', () => {
    expect(isValidSha256Hex('0'.repeat(64))).toBe(true);
  });

  it('rejects a 63-char hex (too short)', () => {
    expect(isValidSha256Hex('a'.repeat(63))).toBe(false);
  });

  it('rejects a 65-char hex (too long)', () => {
    expect(isValidSha256Hex('a'.repeat(65))).toBe(false);
  });

  it('rejects uppercase hex digits (REJECT not normalize)', () => {
    // sha256('test') = '9f86d081...' — first char is digit '9'; '9'.toUpperCase() === '9', so
    // the uppercased string is identical to the input and isValidSha256Hex correctly returns true.
    // Use sha256('abc') = 'ba7816...' — first char is letter 'b' → 'B' after toUpperCase(),
    // which is genuinely an uppercase hex digit that must be rejected.
    const h = sha256('abc');
    const upper = h[0]!.toUpperCase() + h.slice(1);
    expect(upper).not.toBe(h); // self-check: guard against accidentally using a digit-leading hash
    expect(isValidSha256Hex(upper)).toBe(false);
  });

  it('rejects all-uppercase hex (AAAA…)', () => {
    expect(isValidSha256Hex('A'.repeat(64))).toBe(false);
  });

  it('rejects hex with g (non-hex char)', () => {
    expect(isValidSha256Hex('g' + 'a'.repeat(63))).toBe(false);
  });

  it('rejects hex with "/" (path-traversal char)', () => {
    // e.g. a crafted "../.." blob sha
    expect(isValidSha256Hex('/' + 'a'.repeat(63))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidSha256Hex('')).toBe(false);
  });

  it('rejects a uuid (wrong format, contains hyphens)', () => {
    expect(isValidSha256Hex('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });
});

describe('isValidNamespace (DES-086 pure validator)', () => {
  it('accepts a simple alphanumeric namespace', () => {
    expect(isValidNamespace('tenantA')).toBe(true);
  });

  it('accepts a namespace with hyphens and underscores', () => {
    expect(isValidNamespace('tenant-A_1')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidNamespace('')).toBe(false);
  });

  it('rejects a namespace containing "/" (path-traversal)', () => {
    expect(isValidNamespace('a/b')).toBe(false);
  });

  it('rejects a namespace starting with "." (hidden dir)', () => {
    expect(isValidNamespace('.secret')).toBe(false);
  });

  it('rejects a namespace with consecutive dots ".." (path-traversal)', () => {
    expect(isValidNamespace('a..b')).toBe(false);
  });

  it('rejects a namespace with a space', () => {
    expect(isValidNamespace('a b')).toBe(false);
  });

  it('rejects a namespace with "../" (path-traversal pattern)', () => {
    expect(isValidNamespace('../etc')).toBe(false);
  });

  it('rejects a namespace with a newline', () => {
    expect(isValidNamespace('a\nb')).toBe(false);
  });
});
