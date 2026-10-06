// UT-155 (DES-153, v24): AssetSyncService v24 — two scopes, catalog rows, kind:'mcp' gated
// (egress before probe, both before the row), pushedAt from the injected clock. Written
// test-first (Gate 5, RED) — today's AssetSyncDeps has no `catalog`/`clock`/`probe`/
// `egressAllowlist`, and `push()` takes the pre-v24 flat AssetPush shape (no `scope`).
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetSyncService, resolveMcp, type AssetCatalogRow, GLOBAL_SKILL_BODY_MAX_BYTES } from '../../src/asset-sync.js';
import { FixedClock } from '../../src/clock.js';

function fakeCatalogPort() {
  const rows: AssetCatalogRow[] = [];
  return { putAsset: vi.fn((row: AssetCatalogRow) => { rows.push(row); }), deleteAsset: vi.fn(), listAssets: vi.fn(() => rows) };
}

describe('AssetSyncService v24 — two scopes, mcp gating, clock-sourced pushedAt (UT-155, DES-153)', () => {
  it('kind:"mcp" over http checks egress BEFORE any fetch — EGRESS_DENIED, probe never called, nothing stored', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const probe = { probe: vi.fn() };
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'),
        selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog, probe, egressAllowlist: [],
      });
      const result = await svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'mcp', name: 'srv', config: { url: 'https://evil.example.com' }, pushedBy: 'bob' });
      expect(result).toMatchObject({ error: 'EGRESS_DENIED' });
      expect(probe.probe).not.toHaveBeenCalled();
      expect(catalog.putAsset).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Owner decision 2026-09-30: EGRESS_DENIED for a `kind:'mcp'` push must carry a message
  // pointing the caller at `system_info`'s `policy.mcpEgressAllowlist` (where the currently
  // allowed https prefixes are visible) — and, since the CODE `EGRESS_DENIED` is shared with
  // seedRef (errors.ts's ERROR_CATALOG hint stays generic for both), the MCP-specific pointer
  // lives HERE, in asset-sync's own message, not in the shared catalog hint. The message must
  // echo the URL the caller sent and nothing host-measured beyond that (no matched-prefix detail).
  it('kind:"mcp" EGRESS_DENIED carries a detail.message pointing at system_info policy.mcpEgressAllowlist, echoing only the caller\'s URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const probe = { probe: vi.fn() };
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'),
        selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog, probe, egressAllowlist: [],
      });
      const result = await svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'mcp', name: 'srv', config: { url: 'https://evil.example.com/hook' }, pushedBy: 'bob' });
      expect(result).toMatchObject({ error: 'EGRESS_DENIED' });
      const detail = (result as { detail?: Record<string, unknown> }).detail;
      expect(detail?.['message']).toEqual(expect.stringContaining('system_info'));
      expect(detail?.['message']).toEqual(expect.stringContaining('policy.mcpEgressAllowlist'));
      expect(detail?.['message']).toEqual(expect.stringContaining('https://evil.example.com/hook'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // issue #103(b): `push()` used to collapse a failed probe to the bare string `{error:
  // 'MCP_PROBE_FAILED'}`, dropping the probe's own `code`/`message` — the caller learned only
  // that IT failed, never WHY (unreachable? wrong transport? timed out?). The probe's code/message
  // now travel in `detail`, redacted (no raw URL/command — see the facade-level test for the
  // wire-shape assertion of what "redacted" means here).
  it('kind:"mcp" probe failure carries the probe\'s own code/message/transport in `detail`, not just the bare code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const probe = { probe: vi.fn().mockResolvedValue({ ok: false, code: 'UNREACHABLE', message: 'MCP HTTP endpoint unreachable: fetch failed' }) };
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'),
        selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog, probe, egressAllowlist: ['https://example.com/'],
      });
      const result = await svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'mcp', name: 'srv', config: { type: 'http', url: 'https://example.com/mcp' }, pushedBy: 'bob' });
      expect(result).toMatchObject({
        error: 'MCP_PROBE_FAILED',
        detail: { code: 'UNREACHABLE', message: expect.stringContaining('unreachable'), transport: 'remote-http' },
      });
      expect(catalog.putAsset).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kind:"hook" is refused by the schema enum — HOOKS_UNSUPPORTED is retired, no path can produce it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      // 'hook' is not a v24 AssetKind ('skill'|'mcp') — deliberately mistyped to prove the runtime guard.
      await expect(svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'hook', name: 'x', files: [], pushedBy: 'bob' } as unknown as Parameters<typeof svc.push>[0]))
        .rejects.toThrow(/INVALID_ARGUMENT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pushedAt comes from deps.clock, never Date.now()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const clock = new FixedClock(new Date('2026-06-15T00:00:00Z'));
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 }, clock,
        catalog, probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      await svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'skill', name: 'reviewer', files: [{ path: 'SKILL.md', contentB64: Buffer.from('x').toString('base64') }], pushedBy: 'bob' });
      expect(catalog.putAsset).toHaveBeenCalledWith(expect.objectContaining({ pushedAt: clock.isoNow() }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('list({workflow, kind}) returns BOTH scopes in one response, each marked scope/builtin/pushedBy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      const result = await svc.list({ workflow: 'wf-a', kind: 'skill' });
      expect(Array.isArray(result)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Review send-back F0 (MEDIUM, issue #109 follow-up): `list({workflow, kind})` merges GLOBAL rows
  // in RAW — any author who can register a workflow could read every admin-pushed global MCP
  // server's full `config` (command/args/env/url) through their OWN workflow's asset listing, even
  // though `listGlobal()` (the dedicated `scope:'global'` door) already projects the exact same row
  // down to `{name, transport}`. A global row reached via `{workflow, kind}` is exactly as sensitive
  // as one reached via `{scope:'global', kind}` — only a WORKFLOW-SCOPED row the caller already owns
  // may keep its full config.
  it('[F0] list({workflow, kind:"mcp"}) projects a GLOBAL mcp row to {kind,name,transport} — config/command/args/env never reach the per-workflow listing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-f0-'));
    try {
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog, probe: { probe: vi.fn().mockResolvedValue({ ok: true }) }, egressAllowlist: [],
      });
      await svc.push({ scope: 'global', kind: 'mcp', name: 'house-thinker', config: { type: 'stdio', command: 'npx', args: ['g', '--token=SECRET-XYZ-999'], env: { G109_API_KEY: 'sekrit-value-12345' } } as never, pushedBy: 'admin' });
      const result = await svc.list({ workflow: 'some-authors-own-workflow', kind: 'mcp' });
      // The row's existing non-secret metadata (scope/builtin/pushedBy/pushedAt — REQ-113's "a
      // global asset lists as builtin", advertised-surface-truth.test.ts) survives; only `config` is
      // gone, replaced by the same safe `transport` field `listGlobal()` itself would return.
      expect(result).toEqual([expect.objectContaining({ scope: 'global', builtin: true, kind: 'mcp', name: 'house-thinker', transport: 'stdio' })]);
      expect(Object.hasOwn(result[0] as object, 'config')).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/SECRET-XYZ-999|sekrit-value-12345|command|args|env/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[F0] list({workflow, kind}) keeps the FULL row for a workflow-scoped asset — only the global merge is projected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-f0b-'));
    try {
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog, probe: { probe: vi.fn().mockResolvedValue({ ok: true }) }, egressAllowlist: [],
      });
      await svc.push({ scope: 'workflow', workflow: 'wf-owned', kind: 'mcp', name: 'own-server', config: { type: 'stdio', command: 'npx', args: ['y'] } as never, pushedBy: 'bob' });
      const result = await svc.list({ workflow: 'wf-owned', kind: 'mcp' });
      expect(result).toEqual([expect.objectContaining({ scope: 'workflow', name: 'own-server', config: { type: 'stdio', command: 'npx', args: ['y'] } })]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Review send-back LOW-3 (issue #109 follow-up): `description: >-` / `|` / `|-` is legal YAML a
  // skill author may reasonably write for a multi-line description; the one-line frontmatter reader
  // used to return the bare indicator string itself (e.g. literally `">-"`) as the description.
  async function pushSkillWithBody(svc: AssetSyncService, name: string, body: string): Promise<void> {
    const r = await svc.push({ scope: 'global', kind: 'skill', name, files: [{ path: 'SKILL.md', contentB64: Buffer.from(body).toString('base64') }], pushedBy: 'admin' });
    if ('error' in r) throw new Error(`push failed: ${JSON.stringify(r)}`);
  }

  it('[LOW-3] a folded block-scalar description (">-") is folded into text, never the bare ">-" marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-low3a-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')), catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      await pushSkillWithBody(
        svc,
        'block-desc',
        '---\nname: block-desc\ndescription: >-\n  Formats quarterly\n  reports nicely.\n---\n\nbody\n',
      );
      const [row] = await svc.listGlobal('skill');
      expect(row).toEqual({ kind: 'skill', name: 'block-desc', description: 'Formats quarterly reports nicely.' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[LOW-3] a literal block-scalar description ("|") keeps its line breaks, never the bare "|" marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-low3b-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')), catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      await pushSkillWithBody(
        svc,
        'block-desc-lit',
        '---\nname: block-desc-lit\ndescription: |\n  Line one.\n  Line two.\n---\n\nbody\n',
      );
      const [row] = await svc.listGlobal('skill');
      expect(row).toEqual({ kind: 'skill', name: 'block-desc-lit', description: 'Line one.\nLine two.' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[LOW-3] an empty block scalar (no following indented lines) returns null, never the bare marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-low3c-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')), catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      await pushSkillWithBody(svc, 'block-desc-empty', '---\nname: block-desc-empty\ndescription: |-\n---\n\nbody\n');
      const [row] = await svc.listGlobal('skill');
      expect(row).toEqual({ kind: 'skill', name: 'block-desc-empty', description: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Issue #146: an author with no exact name in hand could discover a global skill's {name,
// description} but not its SKILL.md BODY — the instructions, and any dependency it names (e.g.
// "requires MCP X") — before registering a workflow that declares it. The owner-approved
// lightweight fix: `listGlobal('skill', {includeBody:true})` also returns the body, bounded and
// truncated (never the default response — that stays exactly as small as issue #109 left it).
describe('AssetSyncService.listGlobal — opt-in SKILL.md body for discovery (issue #146)', () => {
  function svcIn(dir: string) {
    return new AssetSyncService({
      workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
      clock: new FixedClock(new Date('2026-01-01T00:00:00Z')), catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
    });
  }

  it('default (no includeBody) never carries a body — issue #109\'s small-by-default shape is unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-146-default-'));
    try {
      const svc = svcIn(dir);
      await svc.push({ scope: 'global', kind: 'skill', name: 'lotcode-kit', files: [{ path: 'SKILL.md', contentB64: Buffer.from('---\ndescription: Lot codes.\n---\n\nRequires MCP tooltest-everything for batch totals.').toString('base64') }], pushedBy: 'admin' });
      const [row] = await svc.listGlobal('skill');
      expect(row).toEqual({ kind: 'skill', name: 'lotcode-kit', description: 'Lot codes.' });
      expect(Object.hasOwn(row as object, 'body')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('includeBody:true returns the full SKILL.md text (frontmatter + body) so a dependency like "requires MCP X" is readable before registering', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-146-body-'));
    try {
      const svc = svcIn(dir);
      const md = '---\ndescription: Lot codes.\n---\n\nTo get lot codes use the bundled CLI. For batch totals, this skill REQUIRES the MCP server tooltest-everything.';
      await svc.push({ scope: 'global', kind: 'skill', name: 'lotcode-kit', files: [{ path: 'SKILL.md', contentB64: Buffer.from(md).toString('base64') }], pushedBy: 'admin' });
      const [row] = await svc.listGlobal('skill', { includeBody: true }) as Array<{ kind: 'skill'; name: string; description: string | null; body: string | null; bodyTruncated: boolean }>;
      expect(row.body).toBe(md);
      expect(row.bodyTruncated).toBe(false);
      expect(row.description).toBe('Lot codes.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a SKILL.md over the cap is truncated to the bound, with bodyTruncated:true', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-146-trunc-'));
    try {
      const svc = svcIn(dir);
      const big = '---\ndescription: d.\n---\n\n' + 'x'.repeat(GLOBAL_SKILL_BODY_MAX_BYTES + 500);
      await svc.push({ scope: 'global', kind: 'skill', name: 'huge-kit', files: [{ path: 'SKILL.md', contentB64: Buffer.from(big).toString('base64') }], pushedBy: 'admin' });
      const [row] = await svc.listGlobal('skill', { includeBody: true }) as Array<{ body: string | null; bodyTruncated: boolean }>;
      expect(row.bodyTruncated).toBe(true);
      expect(Buffer.byteLength(row.body ?? '', 'utf-8')).toBeLessThanOrEqual(GLOBAL_SKILL_BODY_MAX_BYTES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never returns a sibling file\'s content (only SKILL.md) — includeBody:true on a skill with a bin/ CLI file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-146-sibling-'));
    try {
      const svc = svcIn(dir);
      await svc.push({
        scope: 'global', kind: 'skill', name: 'tooled-kit', pushedBy: 'admin',
        files: [
          { path: 'SKILL.md', contentB64: Buffer.from('---\ndescription: d.\n---\n\nUse ./bin/tool.').toString('base64') },
          { path: 'bin/tool', contentB64: Buffer.from('#!/bin/sh\necho SECRET-BINARY-CONTENT').toString('base64'), exec: true },
          { path: 'notes.txt', contentB64: Buffer.from('SECRET-SIDE-NOTE').toString('base64') },
        ],
      });
      const [row] = await svc.listGlobal('skill', { includeBody: true }) as Array<{ body: string | null }>;
      expect(row.body).not.toContain('SECRET-BINARY-CONTENT');
      expect(row.body).not.toContain('SECRET-SIDE-NOTE');
      expect(row.body).toContain('Use ./bin/tool.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('includeBody:true never leaks into the per-workflow list() merge of a global row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-146-perworkflow-'));
    try {
      const svc = svcIn(dir);
      await svc.push({ scope: 'global', kind: 'skill', name: 'merged-kit', files: [{ path: 'SKILL.md', contentB64: Buffer.from('---\ndescription: d.\n---\n\nSECRET-MERGE-BODY').toString('base64') }], pushedBy: 'admin' });
      const result = await svc.list({ workflow: 'someones-workflow', kind: 'skill' });
      expect(JSON.stringify(result)).not.toContain('SECRET-MERGE-BODY');
      expect(Object.hasOwn(result[0] as object, 'body')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a missing SKILL.md with includeBody:true degrades to {body: null, bodyTruncated: false}, never throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-146-missing-'));
    try {
      const catalog = fakeCatalogPort();
      catalog.listAssets = vi.fn((): AssetCatalogRow[] => [{ scope: 'global', builtin: true, kind: 'skill', name: 'ghost-kit', pushedBy: 'admin', pushedAt: '2026-01-01T00:00:00Z' }]);
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')), catalog, probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      const [row] = await svc.listGlobal('skill', { includeBody: true }) as Array<{ body: string | null; bodyTruncated: boolean }>;
      expect(row).toEqual({ kind: 'skill', name: 'ghost-kit', description: null, body: null, bodyTruncated: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// `delete()` (DES-153, issue #92 part B) — the catalog port's `{deleted}` boolean must be threaded
// out, not assumed. `fakeCatalogPort()`'s `deleteAsset` returns `undefined` by default, which is
// exactly the pre-fix shape (`WorkflowCatalog.deleteAsset` really returns `{deleted}` in
// production, but `AssetCatalogPort` declared `void` and `AssetSyncService.delete()` discarded it) —
// so each case below supplies its own `deleteAsset` fake returning the real port's shape.
// ---------------------------------------------------------------------------
describe('AssetSyncService.delete() threads the catalog port\'s {deleted} boolean (issue #92 part B)', () => {
  it('kind:"skill", catalog reports deleted:true — the on-disk tree is removed and {deleted:true} is returned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-del-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog: { putAsset: vi.fn(), listAssets: vi.fn(() => []), deleteAsset: vi.fn(() => ({ deleted: true })) },
        probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      // Materialize the tree first (push), then delete it.
      await svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'skill', name: 'reviewer', files: [{ path: 'SKILL.md', contentB64: Buffer.from('x').toString('base64') }], pushedBy: 'bob' });
      const skillDir = join(dir, 'wf-a', 'skill', 'reviewer');
      const { existsSync } = await import('node:fs');
      expect(existsSync(skillDir)).toBe(true);
      const result = await svc.delete({ scope: 'workflow', workflow: 'wf-a', kind: 'skill', name: 'reviewer' });
      expect(result).toEqual({ deleted: true });
      expect(existsSync(skillDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kind:"skill", catalog reports deleted:false (no such row) — the on-disk tree is left ALONE and {deleted:false} is returned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-del-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog: { putAsset: vi.fn(), listAssets: vi.fn(() => []), deleteAsset: vi.fn(() => ({ deleted: false })) },
        probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      // An orphan tree on disk with NO catalog row (simulates a name that was never pushed, or
      // whose row is already gone) — the fix must not blindly rmSync it just because kind==='skill'.
      const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
      const skillDir = join(dir, 'wf-a', 'skill', 'orphan');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# orphan');
      const result = await svc.delete({ scope: 'workflow', workflow: 'wf-a', kind: 'skill', name: 'orphan' });
      expect(result).toEqual({ deleted: false });
      expect(existsSync(skillDir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kind:"mcp" is catalog-only — {deleted} still reflects the catalog\'s answer either way', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-del-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog: { putAsset: vi.fn(), listAssets: vi.fn(() => []), deleteAsset: vi.fn(() => ({ deleted: false })) },
        probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      const result = await svc.delete({ scope: 'global', kind: 'mcp', name: 'nope' });
      expect(result).toEqual({ deleted: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// `resolveMcp` (DES-153) — the pure catalog-port helper the SDK gateway binds to. Added at
// Gate 6.5+7 (verifier): the shipped UT-155 covered `push()` only, leaving `resolveMcp` at 0/17
// lines despite it being the whole replacement for the deleted `mcp-registry.ts` (TASK-139/145).
// ---------------------------------------------------------------------------
describe('resolveMcp — workflow scope wins a name clash with global (UT-155, DES-153)', () => {
  const row = (over: Partial<AssetCatalogRow>): AssetCatalogRow => ({
    scope: 'global', builtin: false, kind: 'mcp', name: 'x', pushedBy: 'alice', pushedAt: '2026-01-01T00:00:00Z',
    config: { command: 'global-bin' } as never, ...over,
  });

  it('resolves a global row when no workflow row shadows it', async () => {
    const { configs, missing } = await resolveMcp({ listAssets: () => [row({ name: 'gh' })] }, 'wf-a', ['gh']);
    expect(missing).toEqual([]);
    expect(configs.gh).toEqual({ command: 'global-bin' });
  });

  it('a workflow-scoped row of the SAME name shadows the global one — only for its own workflow', async () => {
    const rows = [
      row({ name: 'gh' }),
      row({ name: 'gh', scope: 'workflow', workflow: 'wf-a', config: { command: 'wf-bin' } as never }),
    ];
    const mine = await resolveMcp({ listAssets: () => rows }, 'wf-a', ['gh']);
    expect(mine.configs.gh).toEqual({ command: 'wf-bin' });
    const other = await resolveMcp({ listAssets: () => rows }, 'wf-b', ['gh']);
    expect(other.configs.gh).toEqual({ command: 'global-bin' });
  });

  it('a name with no row at either scope lands in missing[], never as a silent empty config', async () => {
    const { configs, missing } = await resolveMcp({ listAssets: () => [row({ name: 'gh' })] }, 'wf-a', ['gh', 'nope']);
    expect(missing).toEqual(['nope']);
    expect(Object.keys(configs)).toEqual(['gh']);
  });

  it('a matching row carrying no config is MISSING, not an undefined entry in configs', async () => {
    const { configs, missing } = await resolveMcp({ listAssets: () => [row({ name: 'gh', config: undefined })] }, 'wf-a', ['gh']);
    expect(missing).toEqual(['gh']);
    expect(Object.keys(configs)).toEqual([]);
  });

  it('a skill row never satisfies an mcp name, and an empty request resolves to nothing', async () => {
    const skillOnly = await resolveMcp({ listAssets: () => [row({ name: 'gh', kind: 'skill', config: undefined })] }, 'wf-a', ['gh']);
    expect(skillOnly.missing).toEqual(['gh']);
    const none = await resolveMcp({ listAssets: () => [row({ name: 'gh' })] }, 'wf-a', []);
    expect(none).toEqual({ configs: {}, missing: [] });
  });

  it('awaits a Promise-returning listAssets (the real SQLite catalog port)', async () => {
    const { configs } = await resolveMcp({ listAssets: async () => [row({ name: 'gh' })] }, 'wf-a', ['gh']);
    expect(configs.gh).toEqual({ command: 'global-bin' });
  });
});

// issue #126 B: an unknown ${run:...} placeholder in a pushed mcp config is refused at push time,
// BEFORE the (possibly slow/network-touching) probe ever runs — so an author with a typo finds out
// immediately, and the probe is never asked to launch a config it cannot resolve.
describe('AssetSyncService.push() refuses an unknown ${run:...} placeholder (issue #126 B)', () => {
  it('UNKNOWN_RUN_PLACEHOLDER before the probe is ever called, nothing stored', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const probe = { probe: vi.fn() };
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'),
        selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog, probe, egressAllowlist: [],
      });
      const result = await svc.push({
        scope: 'global', kind: 'mcp', name: 'kv',
        config: { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { MEMORY_FILE_PATH: '${run:bogus}/memory.jsonl' } } as never,
        pushedBy: 'admin',
      });
      expect(result).toMatchObject({ error: 'UNKNOWN_RUN_PLACEHOLDER' });
      const detail = (result as { detail?: Record<string, unknown> }).detail;
      expect(detail?.['message']).toEqual(expect.stringContaining('${run:bogus}'));
      expect(probe.probe).not.toHaveBeenCalled();
      expect(catalog.putAsset).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('${run:dir} and ${run:id} are accepted (not refused) and reach the probe unresolved — stored verbatim with the placeholder still in it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const probe = { probe: vi.fn().mockResolvedValue({ ok: true }) };
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'),
        selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog, probe, egressAllowlist: [],
      });
      const config = { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { MEMORY_FILE_PATH: '${run:dir}/memory.jsonl', RUN: '${run:id}' } };
      const result = await svc.push({ scope: 'global', kind: 'mcp', name: 'kv', config: config as never, pushedBy: 'admin' });
      expect(result).toEqual({ stored: 'kv' });
      // The STORED row keeps the placeholder — resolution is per-dispatch, not at push time.
      expect(catalog.putAsset).toHaveBeenCalledWith(expect.objectContaining({ config }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
