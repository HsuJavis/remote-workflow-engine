// UT-263 (DES-217, ARCH-134, ARCH-133, TASK-224, REQ-139/REQ-067): `lib/issues.js` — ONE export,
// `safeIssueHref(url) -> string | null`. An issue title/URL is attacker-influenceable content on an
// UNAUTHENTICATED page (anyone can open a GitHub issue with a `javascript:`/`data:` URL somewhere
// in its body, and `issue-reporter.ts` republishes it verbatim) — `https:` only, else `null` so the
// row renders as TEXT with no link, never an executable href.
//
// Tier: unit, `.js`, pure, total (never throws).
//
// Red reason (measured): `src/dashboard/lib/issues.js` does not exist — whole-file import failure.
import { describe, it, expect } from 'vitest';
import { safeIssueHref } from '../../src/dashboard/lib/issues.js';

describe('lib/issues.js: safeIssueHref(url) — https: only, total, never throws (UT-263, DES-217)', () => {
  it('a javascript: URL returns null', () => {
    expect(safeIssueHref('javascript:alert(1)')).toBe(null);
  });
  it('a data: URL returns null', () => {
    expect(safeIssueHref('data:text/html,<script>alert(1)</script>')).toBe(null);
  });
  it('a plain http: URL returns null (https: ONLY)', () => {
    expect(safeIssueHref('http://evil.example/')).toBe(null);
  });
  it('a relative path returns null (new URL() throws on a bare path with no base — caught, not propagated)', () => {
    expect(safeIssueHref('/relative/path')).toBe(null);
  });
  it('a malformed string returns null, never throws', () => {
    expect(() => safeIssueHref('not a url at all')).not.toThrow();
    expect(safeIssueHref('not a url at all')).toBe(null);
  });
  it('a real https: GitHub URL is returned UNCHANGED', () => {
    const url = 'https://github.com/HsuJavis/remote-workflow-engine/issues/42';
    expect(safeIssueHref(url)).toBe(url);
  });
});
