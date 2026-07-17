// UT-001: MCP result envelope contract (DES-001)
import { describe, it, expect } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';

describe('McpFacade — ResultEnvelope contract', () => {
  it('workflow_run returns an envelope with runId and status, not a bare throw', async () => {
    const facade = new McpFacade();
    const env = await facade.workflow_run({ script: 'return 42;' });
    expect(env).toHaveProperty('runId');
    expect(env).toHaveProperty('status');
    expect(typeof env.runId).toBe('string');
  });

  it('unknown runId in workflow_status returns error envelope not thrown exception', async () => {
    const facade = new McpFacade();
    const env = await facade.workflow_status({ runId: 'nonexistent-000' });
    expect(env.error).toBeDefined();
    expect(env.error!.code).toBe('RUN_NOT_FOUND');
    // Must not throw — the error lives inside the envelope
  });

  it('workflow_result for unknown runId returns error envelope', async () => {
    const facade = new McpFacade();
    const env = await facade.workflow_result({ runId: 'nonexistent-000' });
    expect(env.error?.code).toBe('RUN_NOT_FOUND');
  });

  it('workflow_list returns an array result', async () => {
    const facade = new McpFacade();
    const env = await facade.workflow_list();
    expect(Array.isArray(env.result)).toBe(true);
  });

  it('workflow_status is uniform: only {runId,status,result} at top level — RunStatusView lives in result (C-3)', async () => {
    const facade = new McpFacade();
    const run = await facade.workflow_run({ script: `phase('p'); return 1;` });
    const runId = run.result!.runId;
    let env = await facade.workflow_status({ runId });
    for (let i = 0; i < 60 && (env.status === 'running' || env.status === 'queued'); i++) {
      await new Promise((r) => setTimeout(r, 20));
      env = await facade.workflow_status({ runId });
    }
    // The RunStatusView payload (phases/agents/scriptVersion) must NOT leak to the top level —
    // it belongs under `result`, same envelope shape as every other tool.
    expect(Object.keys(env).sort()).toEqual(['result', 'runId', 'status']);
    expect(env).not.toHaveProperty('phases');
    expect(env).not.toHaveProperty('agents');
    expect(env).not.toHaveProperty('scriptVersion');
    expect(env.result).toHaveProperty('phases');
    expect(env.result).toHaveProperty('agents');
  });
});
