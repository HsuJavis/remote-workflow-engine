// UT-001: MCP result envelope contract (DES-001)
import { describe, it, expect } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';
import { facadeCaller, runScriptVia, AUTH_DISABLED } from '../helpers/workflow-fixtures.js';

// v24 (TASK-139/DES-159): `triggerPorts`/`graphAnalyzer` are gone from McpFacadeDeps with the
// trigger-bindings/graph-analyzer ports they read.
const DEPS = {};

describe('McpFacade — ResultEnvelope contract', () => {
  it('run_start returns an envelope with runId and status, not a bare throw', async () => {
    const facade = new McpFacade(DEPS);
    const env = await runScriptVia(facadeCaller(facade), 'return 42;');
    expect(env).toHaveProperty('runId');
    expect(env).toHaveProperty('status');
    expect(typeof env.runId).toBe('string');
  });

  it('unknown runId in run_status returns error envelope not thrown exception', async () => {
    const facade = new McpFacade(DEPS);
    const env = await facade.runStatus({ runId: 'nonexistent-000' }, AUTH_DISABLED, false, null);
    expect(env.error).toBeDefined();
    expect(env.error!.code).toBe('RUN_NOT_FOUND');
    // Must not throw — the error lives inside the envelope
  });

  it('run_result for unknown runId returns error envelope', async () => {
    const facade = new McpFacade(DEPS);
    const env = await facade.runResult({ runId: 'nonexistent-000' }, AUTH_DISABLED, false, null);
    expect(env.error?.code).toBe('RUN_NOT_FOUND');
  });

  it('workflow_list returns an array result', async () => {
    const facade = new McpFacade(DEPS);
    // v22 (DES-116, TASK-111): ctx is required, no default — see mcp-facade.ts's ReadContext.
    const env = await facade.workflowList({}, AUTH_DISABLED);
    expect(Array.isArray(env.result)).toBe(true);
  });

  it('run_status is uniform: only {runId,status,result} at top level — RunStatusView lives in result (C-3)', async () => {
    const facade = new McpFacade(DEPS);
    const run = await runScriptVia(facadeCaller(facade), `phase('p'); return 1;`);
    const runId = run.result!.runId;
    let env = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
    for (let i = 0; i < 60 && (env.status === 'running' || env.status === 'queued'); i++) {
      await new Promise((r) => setTimeout(r, 20));
      env = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
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
