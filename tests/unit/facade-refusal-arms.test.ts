// UT-163 (v24, Gate 6.5+7 round 2): the refusal / non-default arms of `McpFacade`,
// `WorkflowCatalog` and `materializeAssets` that the coverage measurement found unexercised on
// v24-touched code. Every case below targets a line the per-function bar reported missing — a
// refusal branch, a filter branch, or a fallback — not a re-test of an already-covered happy path.
//
// Mock policy (unit): a REAL `WorkflowCatalog` on a real tmp sqlite through a REAL `RunManager`
// (this file's siblings' convention — a hand-mocked catalog cannot exercise the genuine arms),
// with a fake `fs`/`resolveMcp` only where the function under test declares them as injected seams.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
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
    await catalog.register({ name: 'owned', script: "export const meta = { phases: [] };\nreturn 1;", mermaid: 'graph LR', principal: ALICE.id });
    const res = await facade.workflowDeregister({ name: 'owned' }, BOB) as Record<string, unknown>;
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('NOT_WORKFLOW_OWNER');
    // Issue #90: the refused (non-owner) caller's envelope must not name the actual owner.
    expect((res['error'] as { message?: string }).message).not.toContain('alice@x.com');
    expect((res['error'] as { message?: string }).message).toMatch(/^NOT_WORKFLOW_OWNER:/);
  });

  it('workflowDeregister on an unknown name is WORKFLOW_NOT_FOUND, not a removed:false success', async () => {
    const res = await facade.workflowDeregister({ name: 'never-existed' }, OPEN) as Record<string, unknown>;
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('WORKFLOW_NOT_FOUND');
  });

  it('workflowPublish refuses an unrecognised channel INVALID_CHANNEL rather than quietly meaning beta', async () => {
    const { version } = await catalog.register({ name: 'pub', script: "export const meta = { phases: [] };\nreturn 1;", mermaid: 'graph LR' });
    const res = await facade.workflowPublish({ name: 'pub', version, channel: 'nightly' as never }, OPEN) as Record<string, unknown>;
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('INVALID_CHANNEL');
    // and the two legal channels still pass
    expect((await facade.workflowPublish({ name: 'pub', version, channel: 'beta' }, OPEN))['status']).toBe('completed');
    expect((await facade.workflowPublish({ name: 'pub', version }, OPEN))['status']).toBe('completed'); // defaults to release
  });

  // Issue #98 item 8: `workflow_publish({version:null})` CLEARS a channel — before this fix no tool
  // could ever do this (VERSION_PINNED_BY_CHANNEL said "unpublish it first" with no such door). RED
  // reason (schema layer, verified against the pre-fix `tool-specs.ts` inputSchema with a throwaway
  // ajv compile, not re-asserted here as a test): `version` was `{type:'string'}` — `version: null`
  // failed ajv's own type check ("/version must be string") before `workflowPublish` ever ran, the
  // same INVALID_ARGUMENT class `call-tool.ts`'s `validateArgs` answers for every other schema
  // mismatch. This file calls `facade.workflowPublish` directly (below `call-tool.ts`'s ajv gate,
  // same as every other case in this describe block), so it exercises the HANDLER's new `version:
  // string | null` acceptance; `tool-specs-guard.test.ts` covers the schema itself accepting null.
  it('workflowPublish({version:null}) clears the named channel — a subsequent resolve() answers CHANNEL_UNPUBLISHED, same as never-published', async () => {
    const { version } = await catalog.register({ name: 'clearable', script: "export const meta = { phases: [] };\nreturn 1;", mermaid: 'graph LR' });
    const published = await facade.workflowPublish({ name: 'clearable', version, channel: 'release' }, OPEN) as Record<string, unknown>;
    expect(published['status']).toBe('completed');
    await expect(catalog.resolve('clearable', { channel: 'release' })).resolves.toMatchObject({ version });

    const cleared = await facade.workflowPublish({ name: 'clearable', version: null, channel: 'release' }, OPEN) as Record<string, unknown>;
    expect(cleared['status']).toBe('completed');
    expect((cleared['result'] as { version?: string | null } | undefined)?.version).toBeNull();
    expect((cleared['result'] as { from?: string | null } | undefined)?.from).toBe(version);
    await expect(catalog.resolve('clearable', { channel: 'release' })).rejects.toMatchObject({ code: 'CHANNEL_UNPUBLISHED' });

    // the OTHER channel (beta) is untouched by clearing release
    await facade.workflowPublish({ name: 'clearable', version, channel: 'beta' }, OPEN);
    await expect(catalog.resolve('clearable', { channel: 'beta' })).resolves.toMatchObject({ version });
  });

  it('workflowPublish({version:null}) clearing an ALREADY-unpublished channel is a harmless idempotent no-op, never NOT_WORKFLOW_OWNER or VERSION_NOT_FOUND', async () => {
    await catalog.register({ name: 'never-published', script: "export const meta = { phases: [] };\nreturn 1;", mermaid: 'graph LR' });
    const res = await facade.workflowPublish({ name: 'never-published', version: null, channel: 'release' }, OPEN) as Record<string, unknown>;
    expect(res['status']).toBe('completed');
    expect((res['result'] as { from?: string | null } | undefined)?.from).toBeNull();
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
    // Issue #102: a workflow-scoped delete now requires the workflow to actually be registered
    // (WORKFLOW_NOT_FOUND otherwise) — 'w' must exist for this routing case to reach assetSync at all.
    await catalog.register({ name: 'w', script: "export const meta = { phases: [] };\nreturn 1;", mermaid: 'graph LR' });
    const calls: unknown[] = [];
    facade.bindAssetSync({ delete: async (req: unknown) => { calls.push(req); return { deleted: true }; } } as never);
    expect((await facade.workspaceDelete({ workflow: 'w', kind: 'skill', name: 'n' }, OPEN))['status']).toBe('completed');
    expect((await facade.workspaceDelete({ scope: 'global', kind: 'skill', name: 'n' }, OPEN))['status']).toBe('completed');
    expect(calls).toEqual([
      { scope: 'workflow', workflow: 'w', kind: 'skill', name: 'n' },
      { scope: 'global', kind: 'skill', name: 'n' },
    ]);
  });

  // Issue #92 part B: workspace_delete used to hardcode `{deleted: true}` regardless of what the
  // bound assetSync actually did — a caller could not tell "removed" from "there was never any such
  // asset". This pins the ANSWER threading through, both ways, not just the route.
  it('workspaceDelete answers the REAL {deleted} boolean from assetSync.delete, not a hardcoded true', async () => {
    // Issue #102: 'w' must be registered for a workflow-scoped delete to reach assetSync at all.
    await catalog.register({ name: 'w', script: "export const meta = { phases: [] };\nreturn 1;", mermaid: 'graph LR' });
    facade.bindAssetSync({ delete: async () => ({ deleted: false }) } as never);
    const missResult = await facade.workspaceDelete({ workflow: 'w', kind: 'skill', name: 'never-existed' }, OPEN) as Record<string, unknown>;
    expect(missResult['status']).toBe('completed');
    expect((missResult['result'] as { deleted?: boolean } | undefined)?.deleted).toBe(false);

    facade.bindAssetSync({ delete: async () => ({ deleted: true }) } as never);
    const hitResult = await facade.workspaceDelete({ scope: 'global', kind: 'skill', name: 'real' }, OPEN) as Record<string, unknown>;
    expect(hitResult['status']).toBe('completed');
    expect((hitResult['result'] as { deleted?: boolean } | undefined)?.deleted).toBe(true);
  });

  // Issue #92 part B follow-up (advisor-caught defect): `{kind, name}` with NEITHER `scope:'global'`
  // NOR `workflow` set matches no declared mode at the tool-specs level (deleteMode() resolves
  // 'invalid'), but the facade's own guard only checked `!a.kind || !a.name` — the else branch fell
  // straight through with `workflow: a.workflow!` (`undefined`), and the server.ts adapter's
  // `c.workflow ?? ''` then silently resolved that to the GLOBAL scope sentinel, deleting a global
  // asset's catalog row under an arg shape that never named `scope:'global'`. Pinned here as a unit
  // guard: assetSync.delete must never be reached for this shape.
  it('workspaceDelete refuses INVALID_ARGUMENT when neither scope:"global" nor workflow is given — never silently defaults to the global scope', async () => {
    let called = false;
    facade.bindAssetSync({ delete: async () => { called = true; return { deleted: true }; } } as never);
    const res = await facade.workspaceDelete({ kind: 'skill', name: 'x' }, OPEN) as Record<string, unknown>;
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('INVALID_ARGUMENT');
    expect(called).toBe(false);
  });

  // Issue #92 part B/C follow-up: the exact same gap on the PUSH side. `workspacePush` computes
  // `scope = a.scope === 'global' ? 'global' : 'workflow'` — an arg set naming NEITHER `scope:
  // 'global'` NOR `workflow` still resolves to `'workflow'`, and the request sent to `assetSync.
  // push` then carries `workflow: undefined`. Before the server.ts adapter hardening (this same
  // issue), that `undefined` silently became the GLOBAL-scope sentinel — a `kind:'mcp'` push with
  // no on-disk step to fail on would land as a global row under `pushMode()`'s role-only `'invalid'`
  // row (any authenticated principal, not just admin). Pinned here as a unit guard, mirroring the
  // delete-side fix above: assetSync.push must never be reached for this shape.
  it('workspacePush refuses INVALID_ARGUMENT when neither scope:"global" nor workflow is given — never silently defaults to the global scope', async () => {
    let called = false;
    facade.bindAssetSync({ push: async () => { called = true; return { stored: 'x' }; } } as never);
    const res = await facade.workspacePush({ kind: 'mcp', name: 'x', config: { url: 'https://example.com' } }, OPEN) as Record<string, unknown>;
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('INVALID_ARGUMENT');
    expect(called).toBe(false);
  });

  // Issue #96: workspace_delete(run mode) used to ABORT the whole batch as soon as one path was
  // rejected — the response was {deleted:[], missing:[], rejected:[...]}, so a real, still-present
  // file in the SAME call silently went neither deleted nor reported. Every input path must now
  // land in exactly one of the three buckets, independent of every other path's own verdict — a
  // real (deleted), a never-existed (missing), and an escaping (rejected) path all in one call.
  it('workspaceDelete (run mode) puts every path in exactly one bucket instead of aborting the batch on the first rejected path', async () => {
    const wsDir = mkdtempSync(join(tmpdir(), 'rwe-ut163-ws96-'));
    writeFileSync(join(wsDir, 'keep.txt'), 'hi');
    const fakeStore = { getRun: async () => ({ status: 'completed' }) } as never;
    const fakeRunManager = {
      withTerminalRun: async (_runId: string, fn: () => unknown) => fn(),
      workspacePath: async () => wsDir,
    } as never;
    const f = new McpFacade({ store: fakeStore, runManager: fakeRunManager, clock: CLOCK });
    try {
      const res = await f.workspaceDelete(
        { runId: 'r1', paths: ['keep.txt', 'does/not/exist.txt', '../escape.txt'] },
        OPEN,
      ) as Record<string, unknown>;
      expect(res['status']).toBe('completed');
      const result = res['result'] as { deleted: string[]; missing: string[]; rejected: Array<{ path: string; reason: string }> };
      expect(result.deleted).toEqual(['keep.txt']);
      expect(result.missing).toEqual(['does/not/exist.txt']);
      expect(result.rejected).toEqual([{ path: '../escape.txt', reason: 'ESCAPE' }]);
      // the real file was actually removed from disk, not just reported as deleted
      expect(existsSync(join(wsDir, 'keep.txt'))).toBe(false);
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });
});

describe('WorkflowCatalog non-default arms (UT-163)', () => {
  it('deregister refuses a non-owner NOT_WORKFLOW_OWNER naming the real owner', async () => {
    await catalog.register({ name: 'owned2', script: "export const meta = { phases: [] };\nreturn 1;", mermaid: 'graph LR', principal: ALICE.id });
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

  it('a meta literal that THROWS while evaluating still degrades PARAMS to "no params" (parseMetaParams\'s own eval-catch arm, exercised directly — see tests/unit/workflow-meta.test.ts)', async () => {
    // `checkMeta` accepts this as a pure literal (its grammar is syntactic: no calls, vars,
    // spreads or templates), but V8 refuses to evaluate it — `SyntaxError: Duplicate __proto__
    // fields are not allowed in object literals`. `parseMetaParams`' own eval-catch arm still
    // degrades this to "no params" (workflow-meta.test.ts's "guard arms" describe block asserts
    // that directly) — but v39 (owner decision 2026-09-30) added a SECOND, independent read of
    // the same unevaluable literal: `checkMetaPhases` cannot tell "no phases declared" from "meta
    // is unreadable" (both are the same {declared:false}), so it refuses PHASES_REQUIRED — the
    // params-degrades-gracefully arm is still reached (params DOES resolve to the empty
    // contract), it is simply no longer sufficient for the OVERALL registration to succeed.
    const script = `export const meta = { __proto__: {}, __proto__: {} };\nreturn 1;`;
    await expect(catalog.register({ name: 'odd-meta', script, mermaid: 'graph LR' }))
      .rejects.toMatchObject({ code: 'PHASES_REQUIRED' });
  });
});

// Issue #144: the second `materializeAssets` param is a PRIVATE per-dispatch directory, never the
// run workspace — `/ws` below is just this suite's name for it (kept short; it is no longer a
// workspace path semantically, only a stand-in string the fake `fs` facade is checked against).
describe('materializeAssets scope precedence (UT-163)', () => {
  const fakeFs = (present: Set<string>, copied: string[][]) => ({
    exists: (p: string) => present.has(p),
    copyDir: (from: string, to: string) => { copied.push([from, to]); },
    writeFile: () => {},
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
    expect(copied).toEqual([[join('/gl', 'skill', 'shared'), join('/ws', 'skills', 'shared')]]);
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

