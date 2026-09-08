// UT-163 (v24, Gate 6.5+7 round 2): the refusal / non-default arms of `McpFacade`,
// `WorkflowCatalog` and `materializeAssets` that the coverage measurement found unexercised on
// v24-touched code. Every case below targets a line the per-function bar reported missing — a
// refusal branch, a filter branch, or a fallback — not a re-test of an already-covered happy path.
//
// Mock policy (unit): a REAL `WorkflowCatalog` on a real tmp sqlite through a REAL `RunManager`
// (this file's siblings' convention — a hand-mocked catalog cannot exercise the genuine arms),
// with a fake `fs`/`resolveMcp` only where the function under test declares them as injected seams.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { MAX_META_LITERAL_BYTES } from '../../src/workflow-meta.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { materializeAssets } from '../../src/gateway/claude-agent-sdk-client.js';
import type { Principal } from '../../src/authz.js';

const CLOCK = new FixedClock(new Date('2026-09-02T10:00:00.000Z'));
const OPEN: Principal = { kind: 'auth-disabled' };
const ALICE: Principal = { kind: 'author', id: 'alice@x.com' };
const BOB: Principal = { kind: 'author', id: 'bob@x.com' };

let workRoot: string;
let catalog: WorkflowCatalog;
let facade: McpFacade;
beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-ut163-'));
  catalog = new WorkflowCatalog(workRoot, CLOCK);
  facade = new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }), clock: CLOCK });
});
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

describe('McpFacade refusal arms (UT-163)', () => {
  it('workflowDeregister turns a catalog THROW into the failed envelope (the catch arm)', async () => {
    await catalog.register({ name: 'owned', script: 'return 1;', mermaid: 'graph LR', principal: ALICE.id });
    const res = await facade.workflowDeregister({ name: 'owned' }, BOB) as Record<string, unknown>;
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('NOT_WORKFLOW_OWNER');
    expect((res['error'] as { message?: string }).message).toContain('alice@x.com');
  });

  it('workflowDeregister on an unknown name is WORKFLOW_NOT_FOUND, not a removed:false success', async () => {
    const res = await facade.workflowDeregister({ name: 'never-existed' }, OPEN) as Record<string, unknown>;
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('WORKFLOW_NOT_FOUND');
  });

  it('workflowPublish refuses an unrecognised channel INVALID_CHANNEL rather than quietly meaning beta', async () => {
    const { version } = await catalog.register({ name: 'pub', script: 'return 1;', mermaid: 'graph LR' });
    const res = await facade.workflowPublish({ name: 'pub', version, channel: 'nightly' as never }, OPEN) as Record<string, unknown>;
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('INVALID_CHANNEL');
    // and the two legal channels still pass
    expect((await facade.workflowPublish({ name: 'pub', version, channel: 'beta' }, OPEN))['status']).toBe('completed');
    expect((await facade.workflowPublish({ name: 'pub', version }, OPEN))['status']).toBe('completed'); // defaults to release
  });

  it('runList scopes to the caller for a non-admin principal and stays unfiltered for admin/auth-disabled', async () => {
    const scoped = await facade.runList({}, ALICE);
    expect(scoped.status).toBe('completed');
    expect(scoped.result).toEqual([]);           // alice owns no run in a fresh store
    const open = await facade.runList({}, OPEN);
    expect(open.status).toBe('completed');
    expect(open.result).toEqual([]);
    const admin = await facade.runList({}, { kind: 'admin', id: 'root@x.com' });
    expect(admin.status).toBe('completed');
  });

  it('workspaceDelete in asset mode refuses INVALID_ARGUMENT when no assetSync is bound', async () => {
    const res = await facade.workspaceDelete({ workflow: 'w', kind: 'skill', name: 'n' }, OPEN) as Record<string, unknown>;
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('INVALID_ARGUMENT');
  });

  it('workspaceDelete routes the workflow scope and the global scope to the bound assetSync', async () => {
    const calls: unknown[] = [];
    facade.bindAssetSync({ delete: async (req: unknown) => { calls.push(req); } } as never);
    expect((await facade.workspaceDelete({ workflow: 'w', kind: 'skill', name: 'n' }, OPEN))['status']).toBe('completed');
    expect((await facade.workspaceDelete({ scope: 'global', kind: 'skill', name: 'n' }, OPEN))['status']).toBe('completed');
    expect(calls).toEqual([
      { scope: 'workflow', workflow: 'w', kind: 'skill', name: 'n' },
      { scope: 'global', kind: 'skill', name: 'n' },
    ]);
  });
});

describe('WorkflowCatalog non-default arms (UT-163)', () => {
  it('deregister refuses a non-owner NOT_WORKFLOW_OWNER naming the real owner', async () => {
    await catalog.register({ name: 'owned2', script: 'return 1;', mermaid: 'graph LR', principal: ALICE.id });
    await expect(catalog.deregister('owned2', BOB.id)).rejects.toMatchObject({ code: 'NOT_WORKFLOW_OWNER' });
    // the owner may, and the row really goes
    await expect(catalog.deregister('owned2', ALICE.id)).resolves.toMatchObject({ removed: true });
  });

  it('listAssets filters by kind when one is given, and returns every kind when it is not', () => {
    catalog.putAsset({ workflow: 'w', kind: 'skill', name: 's1', pushedBy: 'alice', pushedAt: CLOCK.isoNow(), config: null });
    catalog.putAsset({ workflow: 'w', kind: 'mcp', name: 'm1', pushedBy: 'alice', pushedAt: CLOCK.isoNow(), config: '{}' });
    expect(catalog.listAssets('w').map((r) => r.name).sort()).toEqual(['m1', 's1']);
    expect(catalog.listAssets('w', 'mcp').map((r) => r.name)).toEqual(['m1']);
    expect(catalog.listAssets('w', 'skill').map((r) => r.name)).toEqual(['s1']);
  });

  it('a meta literal over the source-size bound is refused PARAM_CONTRACT_INVALID, not evaluated', async () => {
    const filler = 'x'.repeat(MAX_META_LITERAL_BYTES + 100);
    const script = `export const meta = { description: '${filler}' };\nreturn 1;`;
    await expect(catalog.register({ name: 'huge-meta', script, mermaid: 'graph LR' }))
      .rejects.toMatchObject({ code: 'PARAM_CONTRACT_INVALID' });
  });

  it('a meta literal that THROWS while evaluating degrades to "no params" — registration still succeeds', async () => {
    // `checkMeta` accepts this as a pure literal (its grammar is syntactic: no calls, vars,
    // spreads or templates), but V8 refuses to evaluate it — `SyntaxError: Duplicate __proto__
    // fields are not allowed in object literals`. That is the one reachable input for
    // `_parseParams`' eval-catch arm, and the design says such a script degrades to "no params"
    // rather than failing the registration.
    const script = `export const meta = { __proto__: {}, __proto__: {} };\nreturn 1;`;
    const { version } = await catalog.register({ name: 'odd-meta', script, mermaid: 'graph LR' });
    expect(version).toBe('v1');
    const resolved = await catalog.resolve('odd-meta', { version }) as { params?: { agents?: unknown; args?: unknown } };
    expect(resolved.params).toEqual({ agents: {}, args: {} }); // the empty contract, not a refusal
  });
});

describe('materializeAssets scope precedence (UT-163)', () => {
  const fakeFs = (present: Set<string>, copied: string[][]) => ({
    exists: (p: string) => present.has(p),
    copyDir: (from: string, to: string) => { copied.push([from, to]); },
    writeFile: () => { /* .mcp.json */ },
  });

  it('falls back to the GLOBAL skill root when the workflow root has no such skill', async () => {
    const copied: string[][] = [];
    const roots = { workflow: '/wf', global: '/gl' };
    const res = await materializeAssets(
      roots, '/ws', { skills: ['shared'], mcp: [] },
      async () => ({ configs: {}, missing: [] }),
      fakeFs(new Set([join('/gl', 'skill', 'shared')]), copied) as never,
    );
    expect(res.skills).toEqual(['shared']);
    expect(copied).toEqual([[join('/gl', 'skill', 'shared'), join('/ws', '.claude', 'skills', 'shared')]]);
  });

  it('workflow scope WINS the same name, and a name in neither root lands in missing', async () => {
    const copied: string[][] = [];
    const roots = { workflow: '/wf', global: '/gl' };
    const present = new Set([join('/wf', 'skill', 'both'), join('/gl', 'skill', 'both')]);
    const res = await materializeAssets(
      roots, '/ws', { skills: ['both', 'nowhere'], mcp: [] },
      async () => ({ configs: {}, missing: [] }),
      fakeFs(present, copied) as never,
    );
    expect(res.skills).toEqual(['both']);
    expect(res.missing).toEqual(['nowhere']);
    expect(copied[0]![0]).toBe(join('/wf', 'skill', 'both'));
  });
});

describe('WorkflowCatalog.insertVersion refusal arms (UT-163)', () => {
  // `insertVersion` is the FACADE's registration step (DES-149 step 4). Its two in-transaction
  // refusals — a non-owner writing a new version, and the version ceiling — were both unexercised
  // (31/44), even though `register()`'s convenience path has its own copy that is covered.
  const params = { agents: {}, args: {} } as never;

  it('a non-owner inserting a new version of an owned workflow is refused NOT_WORKFLOW_OWNER', async () => {
    await catalog.insertVersion({ name: 'iv-owned', script: 'return 1;', mermaid: 'graph LR', params, principal: ALICE.id });
    await expect(catalog.insertVersion({ name: 'iv-owned', script: 'return 2;', mermaid: 'graph LR', params, principal: BOB.id }))
      .rejects.toMatchObject({ code: 'NOT_WORKFLOW_OWNER' });
    // the OWNER may, and the allocator moves to v2
    await expect(catalog.insertVersion({ name: 'iv-owned', script: 'return 2;', mermaid: 'graph LR', params, principal: ALICE.id }))
      .resolves.toEqual({ version: 'v2' });
  });

  it('a null principal (auth-disabled) is NOT treated as "some other owner"', async () => {
    await catalog.insertVersion({ name: 'iv-open', script: 'return 1;', mermaid: 'graph LR', params, principal: ALICE.id });
    await expect(catalog.insertVersion({ name: 'iv-open', script: 'return 2;', mermaid: 'graph LR', params, principal: null }))
      .resolves.toEqual({ version: 'v2' });
  });

  it('inserting past the maxWorkflowVersions ceiling is refused VERSION_CEILING_EXCEEDED', async () => {
    const capped = new WorkflowCatalog(join(workRoot, 'capped'), CLOCK, { ceilings: { maxWorkflowVersions: 2 } as never });
    await capped.insertVersion({ name: 'iv-cap', script: 'return 1;', mermaid: 'graph LR', params });
    await capped.insertVersion({ name: 'iv-cap', script: 'return 2;', mermaid: 'graph LR', params });
    await expect(capped.insertVersion({ name: 'iv-cap', script: 'return 3;', mermaid: 'graph LR', params }))
      .rejects.toMatchObject({ code: 'VERSION_CEILING_EXCEEDED' });
  });
});

