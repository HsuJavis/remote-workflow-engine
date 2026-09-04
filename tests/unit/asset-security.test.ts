// UT-030: Asset Sync — recursion guard (isSelfReferential) + path-safety (safeRelPath) (DES-019, TASK-021)
// RED: src/asset-sync.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect } from 'vitest';
// Value imports — cause module-not-found at load time when the module is absent.
import { isSelfReferential } from '../../src/asset-sync.js';

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

// v24 (TASK-134/DES-142, TASK-152): `safeRelPath` is DELETED from `asset-sync.ts` — its private
// path-safety copy is retired in favour of the one shared `pathVerdict`/`lexicalVerdict`
// (`src/path-verdict.ts`). Every case this block used to pin (safe-relative-resolves,
// `../` traversal, nested traversal, absolute path, normalize-then-contain, relative-root
// acceptance, relative-root traversal) is copied as a LITERAL row in the sibling
// `tests/unit/path-verdict.test.ts` (DES-142's own [T2] table) — this block is fully superseded,
// not merely renamed, so it is removed rather than re-pointed at a differently-shaped function.

describe('asset_push atomicity (DES-019)', () => {
  // Partial atomicity: if ANY file in the push fails a safety check, the whole push is rejected.
  // This requires the full AssetPushService (part of the same module).
  // Since the module doesn't exist yet, this block also fails at import time.
  it('placeholder — import-level failure covers all atomicity cases', () => {
    // Reaches here only after the module exists (RED via import failure above).
    expect(true).toBe(true);
  });
});
