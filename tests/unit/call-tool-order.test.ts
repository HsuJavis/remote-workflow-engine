// UT-141 (DES-140, v24): callTool(deps, name, args, principal) — one deps object, schema BEFORE
// authz, one switch with `default: never`. Written test-first (Gate 5, RED) — callTool's v24
// shape does not exist yet (server.ts:900-913 still takes 17 positional params today).
import { describe, it, expect, vi } from 'vitest';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';

/** Each case supplies ONLY the collaborators the path under test actually reaches — the point of
 *  these three cases is ORDER (schema before authz) and dispatch arity, not `ToolDeps`
 *  completeness, and a full 9-field deps object would hide which field each path really needs.
 *  The cast is deliberate and local; `tsc` still checks every field name that IS supplied. */
function partialDeps(d: Record<string, unknown>): ToolDeps {
  return d as unknown as ToolDeps;
}
type ToolEnvelope = { error?: { code?: string | number } };

describe('callTool — schema before authz, one deps object (UT-141, DES-140)', () => {
  it('[T1] a schema failure short-circuits before authorize() is ever called', async () => {
    const authorizeSpy = vi.fn();
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: authorizeSpy });
    await callTool(deps, 'run_start', { /* missing required `name` */ }, { kind: 'user', id: 'bob' });
    expect(authorizeSpy).not.toHaveBeenCalled();
  });

  it('an unknown tool name yields the JSON-RPC unknown-tool response, not a catalog code', async () => {
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {} });
    const result = (await callTool(deps, 'workflow_run', {}, { kind: 'user', id: 'bob' })) as ToolEnvelope;
    expect(result.error?.code).toBe(-32601);
  });

  it('a valid call reaches the switch and dispatches to the matching facade handler exactly once', async () => {
    const runStart = vi.fn().mockResolvedValue({ runId: 'r1' });
    const deps = partialDeps({ facade: { runStart }, lookup: { workflowOwner: () => 'bob' }, audit: {} });
    // `run_start`'s schema is CLOSED (DES-142) — no stray `args` key (not a declared property).
    await callTool(deps, 'run_start', { name: 'wf' }, { kind: 'user', id: 'bob' });
    expect(runStart).toHaveBeenCalledTimes(1);
  });
});
