// Issue #92 part B/C follow-up: `assetWorkflowColumn` (server.ts) is the ONE place that turns
// `{scope, workflow}` into the `assets.workflow` DB column value (`''` is ARCH-098's global-scope
// sentinel). It used to be two separately-inlined `row.scope === 'global' ? '' : (row.workflow ??
// '')` expressions (one in the `putAsset` adapter, one in `deleteAsset`) — a MISSING workflow name
// at a non-global scope silently mapped to the SAME sentinel a real `scope:'global'` produces. This
// is the second, independent hardening layer behind the facade's own arg-shape guard
// (workspacePush/workspaceDelete in mcp-facade.ts): an `undefined` workflow at a non-global scope
// is now an INVARIANT VIOLATION (throws), never a silent alias for global.
// Mock policy (unit): pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { assetWorkflowColumn } from '../../src/server.js';

describe('assetWorkflowColumn — the ONE {scope, workflow} -> assets.workflow column mapping (issue #92 part B/C)', () => {
  it('scope:"global" always maps to the "" sentinel, regardless of what workflow carries', () => {
    expect(assetWorkflowColumn('global', undefined)).toBe('');
    expect(assetWorkflowColumn('global', 'some-workflow')).toBe('');
  });

  it('scope:"workflow" with a real name passes it through unchanged', () => {
    expect(assetWorkflowColumn('workflow', 'wf-a')).toBe('wf-a');
  });

  it('scope:"workflow" with workflow:undefined THROWS — it must never silently become the global sentinel', () => {
    expect(() => assetWorkflowColumn('workflow', undefined)).toThrow(/invariant/);
  });
});
