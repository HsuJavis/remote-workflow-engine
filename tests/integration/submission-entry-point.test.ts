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
// 2026-09-26 (alias mechanism removed): a malformed (non-full-ref) `model.default` is refused
// UNKNOWN_MODEL regardless of any catalog snapshot — the ref-shape check runs before any catalog
// lookup — so this file needs no special catalog wiring to keep that case non-vacuous, unlike the
// old alias table (which had to be configured with a known name set or every alias passed).
//
// Mock policy (integration): real McpFacade + real RunManager + real WorkflowCatalog on a tmp
// workRoot (no `catalogSnapshot` configured — the permissive empty-catalog default, irrelevant to
// the malformed-ref case below). ONE store instance is shared by RunManager and McpFacade
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
  catalog = new WorkflowCatalog(workRoot, clock);
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

  it('workflow_register with a malformed (non-full-ref) declared model.default returns a failed envelope at registration', async () => {
    // 2026-09-26: an agent()'s own call options can never carry a tunable key (SCAN_VIOLATION,
    // regardless of value) — the bad ref has to be declared in the contract instead, same rewrite
    // val-109's registration-checks file already applies.
    const script = [
      "export const meta = { params: { agents: { x: {",
      "  model: { type: 'string', default: 'no-such-ref' },",
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
      "  timeoutMs: { type: 'number', default: 60000 },",
      "} } } };",
      "phase('Work');",
      "return agent('x', {});",
    ].join('\n');
    const env = await facade.workflowRegister({ name: 'it008-bad-model-ref', script, mermaid: '' }, AUTH_DISABLED);
    expect(env['status']).toBe('failed');
    expect((env['error'] as { code?: string }).code).toBe('UNKNOWN_MODEL');
  });

  // v24 (integrator, DES-137): `WORKFLOW_NOT_FOUND` — the member of the closed ErrorCode union
  // that `run_start` actually advertises. `UNKNOWN_WORKFLOW` was never in the catalog.
  it('run_start with an unknown workflow name returns WORKFLOW_NOT_FOUND', async () => {
    const env = await facade.runStart({ name: 'does-not-exist-xyz' }, AUTH_DISABLED);
    expect(env.status).toBe('failed');
    expect(env.error?.code).toBe('WORKFLOW_NOT_FOUND');
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
