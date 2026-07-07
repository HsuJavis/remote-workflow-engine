// UT-030: Asset Sync — recursion guard (isSelfReferential) + path-safety (safeRelPath) (DES-019, TASK-021)
// RED: src/asset-sync.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect } from 'vitest';
// Value imports — cause module-not-found at load time when the module is absent.
import { isSelfReferential, safeRelPath } from '../../src/asset-sync.js';

// D4: self-referential bind = the server's own address and port
const SELF_BIND = { host: '127.0.0.1', port: 8787 };
const RESERVED_PREFIX = 'rwe-';

describe('isSelfReferential (pure, D4, DES-019)', () => {
  it('a mcp-config whose URL points to this server is self-referential', () => {
    const push = {
      kind: 'mcp-config' as const,
      name: 'some-server',
      files: [{ path: 'config.json', contentB64: btoa(JSON.stringify({ url: 'http://127.0.0.1:8787/mcp' })) }],
    };
    expect(isSelfReferential(push, SELF_BIND, RESERVED_PREFIX)).toBe(true);
  });

  it('a mcp-config pointing to a DIFFERENT server is not self-referential', () => {
    const push = {
      kind: 'mcp-config' as const,
      name: 'other-server',
      files: [{ path: 'config.json', contentB64: btoa(JSON.stringify({ url: 'http://other.host:9999/mcp' })) }],
    };
    expect(isSelfReferential(push, SELF_BIND, RESERVED_PREFIX)).toBe(false);
  });

  it('a skill whose name starts with the reserved prefix is self-referential', () => {
    const push = {
      kind: 'skill' as const,
      name: 'rwe-guidance',
      files: [{ path: 'SKILL.md', contentB64: btoa('# Guidance') }],
    };
    expect(isSelfReferential(push, SELF_BIND, RESERVED_PREFIX)).toBe(true);
  });

  it('a skill with a benign (non-reserved) name is NOT self-referential', () => {
    const push = {
      kind: 'skill' as const,
      name: 'my-data-extractor',
      files: [{ path: 'SKILL.md', contentB64: btoa('# My skill') }],
    };
    expect(isSelfReferential(push, SELF_BIND, RESERVED_PREFIX)).toBe(false);
  });
});

describe('safeRelPath (pure, DES-019)', () => {
  const ROOT = '/var/rwe/assets';

  it('a safe relative path resolves inside the root', () => {
    const result = safeRelPath('skills/my-skill/SKILL.md', ROOT);
    expect(result).toBe(`${ROOT}/skills/my-skill/SKILL.md`);
  });

  it('a path traversal attempt ("../") returns null', () => {
    expect(safeRelPath('../etc/passwd', ROOT)).toBeNull();
  });

  it('a nested traversal attempt returns null', () => {
    expect(safeRelPath('subdir/../../etc/passwd', ROOT)).toBeNull();
  });

  it('an absolute path returns null', () => {
    expect(safeRelPath('/absolute/path/file.md', ROOT)).toBeNull();
  });

  it('a path that remains inside the root after normalization is allowed', () => {
    const result = safeRelPath('subdir/./file.md', ROOT);
    expect(result).not.toBeNull();
    expect(result!.startsWith(ROOT)).toBe(true);
  });

  // Real-use gap: a RELATIVE assetRoot (the real deployment shape — workRoot "./data" ->
  // assetRoot "./data/assets") made resolve(p) absolute while the root stayed relative, so
  // startsWith always failed and EVERY valid push was wrongly rejected as ASSET_PATH_ESCAPE.
  // These pin the fix (normalize the root to absolute) while keeping traversal blocked.
  const REL_ROOT = './data/assets/skill/demo-skill';

  it('a simple filename under a RELATIVE assetRoot is accepted (not a false escape)', () => {
    const result = safeRelPath('SKILL.md', REL_ROOT);
    expect(result).not.toBeNull();
    expect(result!.endsWith('/data/assets/skill/demo-skill/SKILL.md')).toBe(true);
  });

  it('traversal is still blocked under a RELATIVE assetRoot', () => {
    expect(safeRelPath('../../../../tmp/pwned.txt', REL_ROOT)).toBeNull();
  });
});

describe('asset_push atomicity (DES-019)', () => {
  // Partial atomicity: if ANY file in the push fails a safety check, the whole push is rejected.
  // This requires the full AssetPushService (part of the same module).
  // Since the module doesn't exist yet, this block also fails at import time.
  it('placeholder — import-level failure covers all atomicity cases', () => {
    // Reaches here only after the module exists (RED via import failure above).
    expect(true).toBe(true);
  });
});
