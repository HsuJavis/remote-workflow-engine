// v11 (REQ-066, DES-037): resolveEngineVersion — a NEW export that computes the running
// engine version from package.json + best-effort `git describe`, with an injectable exec seam.
// This file is RED at module load because `resolveEngineVersion` is not yet exported from
// issue-reporter.ts. That is the right red: the function doesn't exist yet.
import { describe, it, expect } from 'vitest';
import { resolveEngineVersion } from '../../src/github/issue-reporter.js'; // RED: not yet exported

describe('resolveEngineVersion (REQ-066, DES-037)', () => {
  it('returns pkg.version + git describe output when exec succeeds', () => {
    const result = resolveEngineVersion(() => 'v1.2.3-4-gabcdef0');
    // Must include the git describe tag so the caller can trace the exact commit.
    expect(result).toContain('v1.2.3-4-gabcdef0');
    // Must include a semver-like pkg.version prefix.
    expect(result).toMatch(/\d+\.\d+\.\d+/);
    // Must not be empty.
    expect(result.length).toBeGreaterThan(0);
  });

  it('falls back to pkg.version alone when exec throws (git absent / non-repo)', () => {
    const result = resolveEngineVersion(() => { throw new Error('git not found'); });
    // Falls back to package.json version — must be semver-ish.
    expect(result).toMatch(/\d+\.\d+\.\d+/);
    // Must not contain the string "undefined".
    expect(result).not.toContain('undefined');
    // Must not be empty.
    expect(result).not.toBe('');
  });

  it('never returns an empty string even if exec throws and no pkg.version', () => {
    // The function's final fallback is '0.0.0'; it may never return '' or 'undefined'.
    const result = resolveEngineVersion(() => { throw new Error(); });
    expect(result).not.toBe('');
    expect(result).not.toBe('undefined');
    expect(result.length).toBeGreaterThan(0);
  });
});
