// UT-141 (DES-140, v24): callTool(deps, name, args, principal) — one deps object, schema BEFORE
// authz, one switch with `default: never`. Written test-first (Gate 5, RED) — callTool's v24
// shape does not exist yet (server.ts:900-913 still takes 17 positional params today).
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — the v24 callTool(deps, name, args, principal) shape does not exist yet
import { callTool } from '../../src/call-tool.js';

describe('callTool — schema before authz, one deps object (UT-141, DES-140)', () => {
  it('[T1] a schema failure short-circuits before authorize() is ever called', async () => {
    const authorizeSpy = vi.fn();
    const deps = { facade: {}, lookup: {}, audit: {}, authorize: authorizeSpy };
    await callTool(deps, 'run_start', { /* missing required `name` */ }, { kind: 'user', id: 'bob' });
    expect(authorizeSpy).not.toHaveBeenCalled();
  });

  it('an unknown tool name yields the JSON-RPC unknown-tool response, not a catalog code', async () => {
    const deps = { facade: {}, lookup: {}, audit: {} };
    const result = await callTool(deps, 'workflow_run', {}, { kind: 'user', id: 'bob' });
    expect(result.error?.code).toBe(-32601);
  });

  it('a valid call reaches the switch and dispatches to the matching facade handler exactly once', async () => {
    const runStart = vi.fn().mockResolvedValue({ runId: 'r1' });
    const deps = { facade: { runStart }, lookup: { workflowOwner: () => 'bob' }, audit: {} };
    await callTool(deps, 'run_start', { name: 'wf', args: {} }, { kind: 'user', id: 'bob' });
    expect(runStart).toHaveBeenCalledTimes(1);
  });
});
