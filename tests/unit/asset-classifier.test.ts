// UT-047: Asset-Ingestion Policy — pure classifyAsset (DES-028, TASK-034)
// RED: src/asset-sync.js exists but does NOT export classifyAsset yet — named-import fails at load.
import { describe, it, expect } from 'vitest';
// Value import — `classifyAsset` does not exist on this module yet (module-not-found-equivalent:
// "does not provide an export named 'classifyAsset'").
import { classifyAsset } from '../../src/asset-sync.js';

describe('classifyAsset — pure per-kind disposition (DES-028, REQ-019)', () => {
  it('a hook-kind asset is REJECTED with HOOKS_UNSUPPORTED — closes the RCE vector by construction', () => {
    const disposition = classifyAsset('hook', { name: 'my-hook', files: [] });
    expect(disposition).toEqual({ action: 'reject', code: 'HOOKS_UNSUPPORTED' });
  });

  it('an mcp-config-kind asset is redirected to provisioning, not per-run materialized (REQ-009 rescope)', () => {
    const disposition = classifyAsset('mcp-config', { name: 'my-mcp', files: [] });
    expect(disposition).toEqual({ action: 'redirect-to-provisioning' });
  });

  it('a skill-kind asset is materialized (ARCH-012 unchanged)', () => {
    const disposition = classifyAsset('skill', { name: 'my-skill', files: [] });
    expect(disposition).toEqual({ action: 'materialize' });
  });
});
