// UT-082 (DES-079, ARCH-052, TASK-077): pure `isEgressAllowed` SSRF-matrix + `normalizeSeedRefAllowlist`
// config-load validator. Zero network — every assertion is a deterministic pure-function call.
//
// Red reason: `src/seedref-egress.ts` does not exist yet → "Cannot find module" at vitest
// collect time. This is the correct red: the feature is unimplemented.
//
// Mock policy (unit): pure functions, no I/O, no clock.

import { describe, it, expect } from 'vitest';
import {
  isEgressAllowed,
  normalizeSeedRefAllowlist,
  assertHttpsAllowlist,
} from '../../src/seedref-egress.js';

const ALLOWLIST = ['https://github.com/HsuJavis/'];

describe('isEgressAllowed (DES-079 SSRF-matrix — deny-by-default, pure, no network)', () => {
  it('empty allowlist → SEEDREF_DISABLED (fail-closed, transport is OFF by default)', () => {
    const v = isEgressAllowed('https://github.com/HsuJavis/repo', []);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('SEEDREF_DISABLED');
  });

  it('absent/undefined-treated allowlist (empty array) → SEEDREF_DISABLED', () => {
    const v = isEgressAllowed('https://github.com/HsuJavis/repo', [] as string[]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('SEEDREF_DISABLED');
  });

  it('SSRF: http://169.254.169.254/ (link-local metadata) → EGRESS_DENIED (non-https)', () => {
    const v = isEgressAllowed('http://169.254.169.254/', ALLOWLIST);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('EGRESS_DENIED');
  });

  it('SSRF: http://localhost/something → EGRESS_DENIED (non-https scheme)', () => {
    const v = isEgressAllowed('http://localhost/something', ALLOWLIST);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('EGRESS_DENIED');
  });

  it('SSRF: file:// scheme → EGRESS_DENIED', () => {
    const v = isEgressAllowed('file:///etc/passwd', ALLOWLIST);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('EGRESS_DENIED');
  });

  it('SSRF: ssh:// scheme → EGRESS_DENIED', () => {
    const v = isEgressAllowed('ssh://github.com/HsuJavis/repo', ALLOWLIST);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('EGRESS_DENIED');
  });

  it('SSRF: git:// scheme → EGRESS_DENIED', () => {
    const v = isEgressAllowed('git://github.com/HsuJavis/repo', ALLOWLIST);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('EGRESS_DENIED');
  });

  it('userinfo (user:pass@host) → EGRESS_DENIED', () => {
    const v = isEgressAllowed('https://user:pass@github.com/HsuJavis/repo', ALLOWLIST);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('EGRESS_DENIED');
  });

  it('URL parse failure → EGRESS_DENIED', () => {
    const v = isEgressAllowed('not a valid url !!', ALLOWLIST);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('EGRESS_DENIED');
  });

  it('trailing-/ over-match guard: github.com/HsuJavisEvil/ must NOT match github.com/HsuJavis/', () => {
    const v = isEgressAllowed('https://github.com/HsuJavisEvil/malicious-repo', ALLOWLIST);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('EGRESS_DENIED');
  });

  it('non-matching host: github.com/Other/ vs allowlist github.com/HsuJavis/ → DENIED', () => {
    const v = isEgressAllowed('https://github.com/OtherOrg/repo', ALLOWLIST);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('EGRESS_DENIED');
  });

  it('happy path: allowlisted https URL → ok:true with parsed URL', () => {
    const v = isEgressAllowed('https://github.com/HsuJavis/some-repo', ALLOWLIST);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.url).toBeInstanceOf(URL);
      expect(v.url.host).toBe('github.com');
    }
  });

  it('happy path: URL with path beyond the allowlist prefix still matches', () => {
    const v = isEgressAllowed('https://github.com/HsuJavis/remote-workflow-plugin.git', ALLOWLIST);
    expect(v.ok).toBe(true);
  });

  it('multiple allowlist entries: first match wins, non-matching still denied', () => {
    const multi = ['https://forge.internal/', 'https://github.com/HsuJavis/'];
    expect(isEgressAllowed('https://forge.internal/project/repo', multi).ok).toBe(true);
    expect(isEgressAllowed('https://github.com/HsuJavis/rw', multi).ok).toBe(true);
    expect(isEgressAllowed('https://evil.example.com/repo', multi).ok).toBe(false);
  });
});

describe('normalizeSeedRefAllowlist (DES-079 config-load validator)', () => {
  it('appends trailing / when missing', () => {
    const result = normalizeSeedRefAllowlist(['https://github.com/HsuJavis']);
    expect(result[0]).toBe('https://github.com/HsuJavis/');
  });

  it('idempotent: trailing / already present stays as-is', () => {
    const result = normalizeSeedRefAllowlist(['https://github.com/HsuJavis/']);
    expect(result[0]).toBe('https://github.com/HsuJavis/');
  });

  it('rejects a non-https entry with a codedError naming the entry', () => {
    expect(() => normalizeSeedRefAllowlist(['http://github.com/HsuJavis/']))
      .toThrow();
  });

  it('rejects an unparseable entry with a codedError', () => {
    expect(() => normalizeSeedRefAllowlist(['not a url']))
      .toThrow();
  });

  it('returns empty array for empty input', () => {
    expect(normalizeSeedRefAllowlist([])).toEqual([]);
  });

  it('preserves multiple valid entries in order, each normalized', () => {
    const result = normalizeSeedRefAllowlist([
      'https://forge.internal/projects',
      'https://github.com/HsuJavis/',
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('https://forge.internal/projects/');
    expect(result[1]).toBe('https://github.com/HsuJavis/');
  });

  it('still throws a codedError with .code SEEDREF_ALLOWLIST_INVALID (no regression from sharing assertHttpsAllowlist, V3-M1)', () => {
    try {
      normalizeSeedRefAllowlist('nope');
      throw new Error('expected normalizeSeedRefAllowlist to throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('SEEDREF_ALLOWLIST_INVALID');
    }
  });
});

// V3-M1: one shared https-allowlist validator for seedRefAllowlist (normalizeSeedRefAllowlist,
// above) and mcpEgressAllowlist (main.ts composeConfig) — same rule, no duplicated hand-written
// parse+scheme-check, and the error always names the KEY it was called with.
describe('assertHttpsAllowlist (V3-M1 shared validator — names the right key)', () => {
  it('names mcpEgressAllowlist, not seedRefAllowlist, when called for mcpEgressAllowlist', () => {
    expect(() => assertHttpsAllowlist('not-an-array', 'mcpEgressAllowlist')).toThrow(/mcpEgressAllowlist must be an array/);
    expect(() => assertHttpsAllowlist(['http://mcp.example/'], 'mcpEgressAllowlist')).toThrow(/mcpEgressAllowlist entry must use https/);
  });

  it('names seedRefAllowlist, not mcpEgressAllowlist, when called for seedRefAllowlist', () => {
    expect(() => assertHttpsAllowlist('not-an-array', 'seedRefAllowlist')).toThrow(/seedRefAllowlist must be an array/);
    expect(() => assertHttpsAllowlist(['http://seeds.example/'], 'seedRefAllowlist')).toThrow(/seedRefAllowlist entry must use https/);
  });

  it('with { frame: true }, wraps the message with the rwe.config.json / ADR-028 fail-closed framing composeConfig uses', () => {
    expect(() => assertHttpsAllowlist(['http://mcp.example/'], 'mcpEgressAllowlist', { frame: true })).toThrow(
      /^rwe\.config\.json: mcpEgressAllowlist entry must use https.*Refusing to start \(ADR-028 fail-closed\)\.$/s,
    );
  });

  it('without frame (the default), carries no rwe.config.json/ADR-028 framing (matches normalizeSeedRefAllowlist\'s existing plain wording)', () => {
    try {
      assertHttpsAllowlist(['http://seeds.example/'], 'seedRefAllowlist');
      throw new Error('expected assertHttpsAllowlist to throw');
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/rwe\.config\.json|Refusing to start/);
    }
  });

  it('returns the normalized array for valid https entries, regardless of key name', () => {
    expect(assertHttpsAllowlist(['https://mcp.example'], 'mcpEgressAllowlist')).toEqual(['https://mcp.example/']);
  });
});
