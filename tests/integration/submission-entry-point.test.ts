// IT-008: SubmissionValidator at the McpFacade entry point (ARCH-008)
import { describe, it, expect } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';

describe('SubmissionValidator at entry point (ARCH-008)', () => {
  it('workflow_run with TS syntax returns failed envelope synchronously (no runId)', async () => {
    const facade = new McpFacade();
    const env = await facade.workflow_run({ script: 'const x: number = 1; return x;' });
    expect(env.status).toBe('failed');
    expect(env.runId).toBe('');
    expect(env.error).toBeDefined();
    expect(env.error!.code).toBe('PARSE_ERROR');
  });

  it('workflow_run with unmapped model alias returns failed envelope at submission', async () => {
    const facade = new McpFacade();
    const env = await facade.workflow_run({ script: `return agent('x',{model:'no-alias'});` });
    expect(env.status).toBe('failed');
    expect(env.error?.code).toBe('UNKNOWN_ALIAS');
  });

  it('workflow_run with unknown workflow name (no inline script) returns UNKNOWN_WORKFLOW', async () => {
    const facade = new McpFacade();
    const env = await facade.workflow_run({ name: 'does-not-exist-xyz' });
    expect(env.status).toBe('failed');
    expect(env.error?.code).toBe('UNKNOWN_WORKFLOW');
  });

  it('workflow_run with valid script returns a runId immediately (async execution)', async () => {
    const facade = new McpFacade();
    const env = await facade.workflow_run({ script: 'return 1;' });
    expect(env.status).not.toBe('failed');
    expect(env.result?.runId).toBeTruthy();
    expect(typeof env.result?.runId).toBe('string');
  });

  it('validation errors have code and message fields (one uniform error shape)', async () => {
    const facade = new McpFacade();
    const env = await facade.workflow_run({});  // no script and no name
    expect(env.status).toBe('failed');
    expect(env.error).toBeDefined();
    expect(typeof env.error!.code).toBe('string');
    expect(typeof env.error!.message).toBe('string');
  });
});
