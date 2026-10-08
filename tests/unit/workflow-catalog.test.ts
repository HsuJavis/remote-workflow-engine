// UT-011: WorkflowCatalog — registry, workspace rooting, path escape rejection (DES-011)
import { describe, it, expect, vi } from 'vitest';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';
import { CatalogNotFoundError, WorkspaceEscapeError } from '../../src/errors.js';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { FIXTURE_SCRIPT, FIXTURE_AGENT_LABEL } from '../../src/tool-specs.js';

// A fixed literal name here (`join(tmpdir(), 'rwe-test-catalog')`) would already be owned by
// whichever uid last ran this suite in this tmp root — mkdtemp guarantees a fresh directory this
// process actually owns, unique per test run.
const WORK_ROOT = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-'));

describe('WorkflowCatalog', () => {
  // v22 (DES-111): get()/getFull() are deleted — resolve()/resolveDetail() take a selector.
  // An explicit {version} selector always resolves regardless of channel/publish state.
  it('register creates an entry retrievable by resolve({version})', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const { version } = await cat.register({ name: 'my-flow', script: 'export const meta = { phases: [] };\nreturn 1;', mermaid: 'graph LR' });
    expect(typeof version).toBe('string');
    const entry = await cat.resolve('my-flow', { version });
    expect(entry.script).toBe('export const meta = { phases: [] };\nreturn 1;');
    expect(entry.version).toBe(version);
  });

  // issue #154 B5 (2026-10-07 reverify — NOT FIXED): `insertVersion` writes a fresh
  // `this._clock.isoNow()` into workflow_versions.createdAt on every call, but `resolveDetail`'s
  // `createdAt` came from `_requireName(name)` — the WORKFLOW-level `workflows.createdAt`, set
  // once on first registration and identical for every version forever. Two versions registered
  // minutes apart reported the SAME createdAt.
  it("resolveDetail's createdAt is the RESOLVED VERSION's own registration time, not the workflow's first (#154 B5)", async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-b5-'));
    const script = 'export const meta = { phases: [] };\nreturn 1;';
    const cat1 = new WorkflowCatalog(workRoot, new FixedClock(new Date('2026-01-01T00:00:00.000Z')));
    const { version: v1 } = await cat1.register({ name: 'b5-flow', script, mermaid: 'graph LR' });
    // A second WorkflowCatalog instance against the SAME on-disk db, minutes later by its own clock —
    // mirrors two real registrations of the same workflow separated in time.
    const cat2 = new WorkflowCatalog(workRoot, new FixedClock(new Date('2026-01-01T00:03:00.000Z')));
    const { version: v2 } = await cat2.register({ name: 'b5-flow', script, mermaid: 'graph LR' });
    expect(v1).not.toBe(v2);
    const d1 = await cat2.resolveDetail('b5-flow', { version: v1 });
    const d2 = await cat2.resolveDetail('b5-flow', { version: v2 });
    expect(d1.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(d2.createdAt).toBe('2026-01-01T00:03:00.000Z');
    expect(d1.createdAt).not.toBe(d2.createdAt);
  });

  it('registering the same name twice bumps the version and keeps BOTH retrievable (v22, REQ-096)', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const { version: v1 } = await cat.register({ name: 'bump-flow', script: 'export const meta = { phases: [] };\nreturn 1;', mermaid: 'graph LR' });
    const { version: v2 } = await cat.register({ name: 'bump-flow', script: 'export const meta = { phases: [] };\nreturn 2;', mermaid: 'graph LR' });
    expect(v2).not.toBe(v1);
    expect((await cat.resolve('bump-flow', { version: v2 })).script).toBe('export const meta = { phases: [] };\nreturn 2;');
    expect((await cat.resolve('bump-flow', { version: v1 })).script).toBe('export const meta = { phases: [] };\nreturn 1;');
  });

  it('resolve() on unknown name throws CatalogNotFoundError', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    await expect(cat.resolve('no-such-workflow', {})).rejects.toThrow(CatalogNotFoundError);
  });

  it('deregister removes a registered workflow (gone from resolve() and list())', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const { version } = await cat.register({ name: 'temp-flow', script: 'export const meta = { phases: [] };\nreturn 1;', mermaid: 'graph LR' });
    const { removed } = await cat.deregister('temp-flow');
    expect(removed).toBe(true);
    await expect(cat.resolve('temp-flow', { version })).rejects.toThrow(CatalogNotFoundError);
    expect((await cat.list()).map((e) => e.name)).not.toContain('temp-flow');
  });

  it('deregister on an unknown name returns removed:false (no throw)', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const { removed } = await cat.deregister('never-registered');
    expect(removed).toBe(false);
  });

  it('list() returns all registered workflows', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    await cat.register({ name: 'alpha', script: 'export const meta = { phases: [] };\nreturn 1;', mermaid: 'graph LR' });
    await cat.register({ name: 'beta', script: 'export const meta = { phases: [] };\nreturn 2;', mermaid: 'graph LR' });
    const entries = await cat.list();
    const names = entries.map((e) => e.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  it('runWorkspace returns different paths for different runIds', () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const ws1 = cat.runWorkspace('my-flow', 'run-aaa');
    const ws2 = cat.runWorkspace('my-flow', 'run-bbb');
    expect(ws1).not.toBe(ws2);
  });

  it('workFolder is stable (same name → same path across calls)', () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    expect(cat.workFolder('stable-flow')).toBe(cat.workFolder('stable-flow'));
  });

  it('workFolders for different workflows are distinct', () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    expect(cat.workFolder('flow-x')).not.toBe(cat.workFolder('flow-y'));
  });

  it('resolveInWorkspace rejects path traversal via ..', () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    expect(() => cat.resolveInWorkspace('run-abc', '../secret')).toThrow(WorkspaceEscapeError);
    expect(() => cat.resolveInWorkspace('run-abc', '/etc/passwd')).toThrow(WorkspaceEscapeError);
  });

  it('resolveInWorkspace resolves safe relative paths inside the workspace', () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const resolved = cat.resolveInWorkspace('run-abc', 'output/result.json');
    expect(resolved).toMatch(/run-abc/);
    expect(resolved).toMatch(/result\.json$/);
  });
});

// Issue audit A1 (owner decision 2026-10-06): `auth.legacyOwner` replaces the old hard-coded
// BOOT_BACKFILL_EMAIL ('hsuhungjung@gmail.com' in workflow-catalog.ts). Seeds a NULL-owner row
// directly on disk (same v22-schema pattern tests/integration/workflow-ownership.test.ts's own
// IT-080 case already uses) so each case can construct a FRESH WorkflowCatalog instance against it.
describe('boot owner backfill — auth.legacyOwner (A1)', () => {
  function seedNullOwnerRow(workRoot: string, name: string): void {
    const db = new Database(join(workRoot, 'catalog.db'));
    db.exec('CREATE TABLE IF NOT EXISTS workflows (name TEXT PRIMARY KEY, createdAt TEXT NOT NULL, owner TEXT, release_version TEXT, beta_version TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS workflow_versions (name TEXT NOT NULL, version TEXT NOT NULL, script TEXT NOT NULL, defaults TEXT, params TEXT, createdAt TEXT NOT NULL, PRIMARY KEY (name, version))');
    const now = new Date().toISOString();
    db.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)').run(name, now, 'v1');
    db.prepare("INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, 'v1', ?, ?)").run(name, "export const meta = { phases: [] };\nreturn 1;", now);
    db.close();
  }

  it('absent (auth off): NULL-owner rows stay NULL, no hint logged', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-legacyowner-off-'));
    seedNullOwnerRow(workRoot, 'wf-a1-authoff');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const cat = new WorkflowCatalog(workRoot);
      const detail = await cat.resolveDetail('wf-a1-authoff', { version: 'v1' });
      expect(detail.owner).toBeNull();
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes('auth.migrate'))).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('absent (auth on, no legacyOwner): NULL-owner rows stay NULL; ONE boot line names the count and hints at auth.legacyOwner', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-legacyowner-hint-'));
    seedNullOwnerRow(workRoot, 'wf-a1-hint');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const cat = new WorkflowCatalog(workRoot, undefined, { authEnabled: true });
      const detail = await cat.resolveDetail('wf-a1-hint', { version: 'v1' });
      expect(detail.owner).toBeNull();
      const printed = logSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(printed).toMatch(/1 workflow\(s\) have no owner/);
      expect(printed.toLowerCase()).toContain('auth.legacyowner');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('present: NULL-owner rows are backfilled to it, idempotently (re-construction is a no-op)', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-legacyowner-present-'));
    seedNullOwnerRow(workRoot, 'wf-a1-present');
    const cat1 = new WorkflowCatalog(workRoot, undefined, { backfillOwner: 'ops@example.com', authEnabled: true });
    expect((await cat1.resolveDetail('wf-a1-present', { version: 'v1' })).owner).toBe('ops@example.com');

    // A second boot against the same on-disk DB: the row already has an owner, so it must not be
    // touched again (and a DIFFERENT legacyOwner proves re-backfill would have been visible).
    const cat2 = new WorkflowCatalog(workRoot, undefined, { backfillOwner: 'someone-else@example.com', authEnabled: true });
    expect((await cat2.resolveDetail('wf-a1-present', { version: 'v1' })).owner).toBe('ops@example.com');
  });
});

// issue #155 B2a (owner-approved, 2026-10-07): VALUE_MISMATCH / COLLAPSED_EDGE must reach the real
// `register()` caller as their OWN `.code`, not folded into MERMAID_INVALID — the whole point of the
// fix (a client branching on `code` could not otherwise tell "diagram parses fine but disagrees with
// one declared value" / "wrote the `&` fan-out shorthand" apart from a genuinely unparsable diagram).
describe('register() surfaces VALUE_MISMATCH / COLLAPSED_EDGE as their own .code (issue #155 B2a)', () => {
  it('a value-triple that disagrees with the declared agent default is refused VALUE_MISMATCH, not MERMAID_INVALID', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-b2a-value-'));
    const cat = new WorkflowCatalog(workRoot);
    const mermaid =
      `graph LR\nsubgraph "Greet"\n${FIXTURE_AGENT_LABEL}(["${FIXTURE_AGENT_LABEL}<br/>anthropic/claude-haiku-4-5-20251001 · medium · 60s"])\nend`;
    // FIXTURE_SCRIPT declares effort.default:'low' — the diagram's triple above says 'medium'.
    await expect(cat.register({ name: 'b2a-value', script: FIXTURE_SCRIPT, mermaid })).rejects.toMatchObject({ code: 'VALUE_MISMATCH' });
  });

  it('an `&` fan-out edge shorthand is refused COLLAPSED_EDGE, not MERMAID_INVALID', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-b2a-collapsed-'));
    const cat = new WorkflowCatalog(workRoot);
    const script =
      "export const meta = {\n" +
      "  phases: [{ title: 'Greet' }],\n" +
      "  params: { agents: { greet: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, other: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },\n" +
      "};\n" +
      "phase('Greet');\n" +
      "await agent('greet', { prompt: 'hi' });\n" +
      "return await agent('other', { prompt: 'hi' });";
    const mermaid = 'graph LR\nsubgraph "Greet"\ngreet(["greet"])\nother(["other"])\nend\ngreet --> other & other';
    await expect(cat.register({ name: 'b2a-collapsed', script, mermaid })).rejects.toMatchObject({ code: 'COLLAPSED_EDGE' });
  });
});

// Issue #154 B1-B4 (2026-10-07 reverify): a static registration rule added AFTER a version was
// already stored never retroactively applied to it — a fresh registration of a script is refused,
// but the ALREADY-STORED row of an equivalent script (seeded directly against the db, the same
// "already-migrated cohort" raw-insert pattern catalog-v24.test.ts/catalog-versions.test.ts use —
// `register()` itself cannot produce such a row, since it always runs the CURRENT rule set) keeps
// reproducing the original bug at dispatch. `validateStoredVersion` is the fix: re-run the same
// static checks against the STORED script, called from every real admission door.
describe('validateStoredVersion() — re-validates an ALREADY-STORED version against the CURRENT rule set (#154 B1-B4)', () => {
  function seedRawVersion(workRoot: string, name: string, version: string, script: string): void {
    const db = new Database(join(workRoot, 'catalog.db'));
    const now = new Date().toISOString();
    db.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)').run(name, now, version);
    db.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run(name, version, script, now);
    db.close();
  }

  it('a stored row whose script now fails the #154 NEW-HIGH scan rule (allowedTools via a variable) is NOT_RUNNABLE', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-stale-'));
    const cat = new WorkflowCatalog(workRoot); // creates the schema
    const script =
      "export const meta = { phases: [] };\n" +
      "const tools = ['Bash', 'Write'];\n" +
      "return await agent('a', { prompt: 'x', allowedTools: tools });";
    seedRawVersion(workRoot, '154-stale-scan', 'v1', script);
    const result = await cat.validateStoredVersion('154-stale-scan', 'v1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_RUNNABLE');
      expect(result.detail?.['violation']).toBe('AGENT_OPTS_VALUE_NOT_LITERAL');
    }
  });

  it('a stored row whose script still passes every current check is ok:true', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-healthy-'));
    const cat = new WorkflowCatalog(workRoot);
    const script = "export const meta = { phases: [] };\nreturn 1;";
    seedRawVersion(workRoot, '154-healthy', 'v1', script);
    const result = await cat.validateStoredVersion('154-healthy', 'v1');
    expect(result).toEqual({ ok: true });
  });

  it('a script that no longer even PARSES (B1) is also NOT_RUNNABLE, not a crash', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-parse-'));
    const cat = new WorkflowCatalog(workRoot);
    seedRawVersion(workRoot, '154-badparse', 'v1', 'this is not { valid javascript at all (((');
    const result = await cat.validateStoredVersion('154-badparse', 'v1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_RUNNABLE');
  });

  it('memoizes per (name, version) — a second call does not re-read the row (mutating the script between calls does not change the verdict)', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-memo-'));
    const cat = new WorkflowCatalog(workRoot);
    seedRawVersion(workRoot, '154-memo', 'v1', "export const meta = { phases: [] };\nreturn 1;");
    const first = await cat.validateStoredVersion('154-memo', 'v1');
    expect(first).toEqual({ ok: true });
    // Mutate the stored script directly to something that would now fail — a real version row is
    // immutable (ADR-025), so this simulates "impossible in practice" only to prove the cache, not
    // a reachable state.
    const db = new Database(join(workRoot, 'catalog.db'));
    db.prepare('UPDATE workflow_versions SET script = ? WHERE name = ? AND version = ?').run('not valid js (((', '154-memo', 'v1');
    db.close();
    const second = await cat.validateStoredVersion('154-memo', 'v1');
    expect(second).toEqual({ ok: true }); // still the cached, first verdict
  });

  it('does not re-check mermaid/diagram-grammar rules — a v1-contract diagram shape never refuses here', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-mermaid-'));
    const cat = new WorkflowCatalog(workRoot);
    // No phase()/agent() calls, no meta.phases at all — would fail v39's PHASES_REQUIRED at a
    // FRESH registration, and would never have passed checkMermaid's v2 grammar either; a row this
    // shaped is exactly what a pre-v26/pre-v39 grandfathered row looks like.
    seedRawVersion(workRoot, '154-mermaid', 'v1', "return 1;");
    const result = await cat.validateStoredVersion('154-mermaid', 'v1');
    expect(result).toEqual({ ok: true });
  });

  // Issue #154 B4 PARTIAL left open (2026-10-07 reverify): `_computeStoredVersionValidity`
  // deliberately skipped `isValidBareName(name)` — the code comment claimed re-checking it "can
  // never produce a different verdict than it did at registration", which is true for a row
  // REGISTERED under the current rule set but false for a row that predates it: `register()`
  // itself cannot produce an invalid name any more, but a row seeded directly (the same
  // "already-migrated cohort" shape every other #154 B1-B4 case in this file uses) or left over
  // from before the rule existed is never re-checked by anything. The live reverify measured this
  // as a stored row renamed to `../store` staying `runnable:true` and actually completing a
  // `run_start`, with its agent workspace landing at `<workRoot>/store/runs/<runId>` — the SAME
  // path the run store's own on-disk directory for that run occupies.
  it('a stored row whose NAME is no longer a valid bare name is NOT_RUNNABLE / INVALID_NAME', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-b4-name-'));
    const cat = new WorkflowCatalog(workRoot);
    const script = "export const meta = { phases: [] };\nreturn 1;";
    seedRawVersion(workRoot, '../store', 'v1', script);
    const result = await cat.validateStoredVersion('../store', 'v1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_RUNNABLE');
      expect(result.detail?.['violation']).toBe('INVALID_NAME');
    }
  });

  it('an empty-string stored name is also NOT_RUNNABLE / INVALID_NAME (not merely the dotdot shape)', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-b4-empty-'));
    const cat = new WorkflowCatalog(workRoot);
    seedRawVersion(workRoot, '', 'v1', "export const meta = { phases: [] };\nreturn 1;");
    const result = await cat.validateStoredVersion('', 'v1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail?.['violation']).toBe('INVALID_NAME');
  });

  it('a valid name is unaffected by the new name check (no false positive)', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-b4-valid-'));
    const cat = new WorkflowCatalog(workRoot);
    seedRawVersion(workRoot, '154-b4-valid-name', 'v1', "export const meta = { phases: [] };\nreturn 1;");
    const result = await cat.validateStoredVersion('154-b4-valid-name', 'v1');
    expect(result).toEqual({ ok: true });
  });
});

// Issue #154 B4 PARTIAL (2026-10-07 reverify): `workFolder`'s containment check was against
// `this._workRoot` as a WHOLE — `join(workRoot, 'workflows', '../store')` resolves to
// `<workRoot>/store`, which is STILL inside `workRoot`, so the pre-fix check saw no escape at all.
// `<workRoot>/store` is exactly where `SqliteRunStore`/`InMemoryRunStore` keep their own on-disk
// state (the `store` subdirectory passed at construction in every real deployment and in this
// file's own sibling fixtures) — a workflow named `../store` could make its own agent workspace
// alias the engine's run-store directory. Fixed by containing against `<workRoot>/workflows`
// itself, not `workRoot` at large.
describe("workFolder() — containment against 'workRoot/workflows', not 'workRoot' at large (#154 B4 PARTIAL)", () => {
  it("a name of '../store' no longer resolves inside workRoot/workflows — refused, not silently aliased to a sibling directory", () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-workfolder-'));
    const cat = new WorkflowCatalog(workRoot);
    expect(() => cat.workFolder('../store')).toThrow();
    try {
      cat.workFolder('../store');
      throw new Error('workFolder did not throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('INVALID_NAME');
    }
  });

  it('a ridiculously-dotted name escaping workRoot entirely is still refused (unchanged behaviour)', () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-workfolder-deep-'));
    const cat = new WorkflowCatalog(workRoot);
    expect(() => cat.workFolder('../../../../tmp/evil')).toThrow();
  });

  it('an ordinary name still resolves fine (no false positive)', () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-test-catalog-154-workfolder-ok-'));
    const cat = new WorkflowCatalog(workRoot);
    expect(cat.workFolder('my-flow')).toBe(join(workRoot, 'workflows', 'my-flow'));
  });
});
