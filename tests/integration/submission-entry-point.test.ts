// IT-008: fail-fast at the McpFacade entry point (ARCH-008)
//
// v22 adjudication #3 (M-6): the entry point MOVED for three of these cases. PARSE_ERROR and
// UNKNOWN_ALIAS were produced by SubmissionValidator's `if (spec.script)` block on
// `run_start({script})`; REQ-098 closed inline script and REQ-099/ADR-013 moved those checks to
// `WorkflowCatalog.register()` via `script-checks.ts`. The property this file exists to pin —
// a bad submission is refused SYNCHRONOUSLY at the facade, with one uniform error shape and no run
// created — is unchanged; only which facade method is the fail-fast door changed
// (`workflow_register` for script-shaped faults, `run_start` for name-shaped ones).
//
// Mock policy (integration): real McpFacade + real RunManager + real WorkflowCatalog on a tmp
// workRoot. The catalog is constructed with an explicit `aliasNames` set because that is what the
// composition root does (server.ts) — a catalog built with none accepts every alias, which would
// make the UNKNOWN_ALIAS case vacuous. ONE store instance is shared by RunManager and McpFacade
// (D-I1, the facade's own constructor comment) or every facade lookup 404s.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpFacade } from '../../src/mcp-facade.js';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SystemClock } from '../../src/clock.js';
import { facadeCaller, runScriptVia, AUTH_DISABLED } from '../helpers/workflow-fixtures.js';

let facade: McpFacade;
let catalog: WorkflowCatalog;
let workRoot: string;

beforeAll(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it008-'));
  const clock = new SystemClock();
  catalog = new WorkflowCatalog(workRoot, clock, { aliasNames: new Set(['sonnet', 'default']) });
  const store = new InMemoryRunStore(clock);
  const runManager = new RunManager({ store, clock, catalog, workRoot });
  facade = new McpFacade({ store, runManager, clock });
});

afterAll(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

describe('fail-fast at the McpFacade entry point (ARCH-008)', () => {
  it('workflow_register with TS syntax returns a failed envelope synchronously (PARSE_ERROR, nothing stored)', async () => {
    const env = await facade.workflowRegister({ name: 'it008-ts-syntax', script: 'const x: number = 1; return x;', mermaid: '' }, AUTH_DISABLED);
    expect(env['status']).toBe('failed');
    expect(env['error']).toBeDefined();
    expect((env['error'] as { code?: string }).code).toBe('PARSE_ERROR');
    expect(await catalog.exists('it008-ts-syntax')).toBe(false); // refused before any write
  });

  it('workflow_register with an unmapped model alias returns a failed envelope at registration', async () => {
    const env = await facade.workflowRegister({ name: 'it008-bad-alias', script: `return agent('x',{model:'no-alias'});`, mermaid: '' }, AUTH_DISABLED);
    expect(env['status']).toBe('failed');
    expect((env['error'] as { code?: string }).code).toBe('UNKNOWN_ALIAS');
  });

  it('run_start with an unknown workflow name returns UNKNOWN_WORKFLOW', async () => {
    const env = await facade.runStart({ name: 'does-not-exist-xyz' }, AUTH_DISABLED);
    expect(env.status).toBe('failed');
    expect(env.error?.code).toBe('UNKNOWN_WORKFLOW');
  });

  it('run_start of a valid registered workflow returns a runId immediately (async execution)', async () => {
    const env = await runScriptVia(facadeCaller(facade), 'return 1;');
    expect(env.status).not.toBe('failed');
    expect(env.result?.runId).toBeTruthy();
    expect(typeof env.result?.runId).toBe('string');
  }, 30000);

  it('validation errors have code and message fields (one uniform error shape)', async () => {
    const env = await facade.runStart({}, AUTH_DISABLED); // no name (and `script` is closed, REQ-098)
    expect(env.status).toBe('failed');
    expect(env.error).toBeDefined();
    expect(typeof env.error!.code).toBe('string');
    expect(typeof env.error!.message).toBe('string');
  });
});
