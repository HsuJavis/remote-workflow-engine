// IT-296 (DES-246, ARCH-156, TASK-244, REQ-211/REQ-096/REQ-097): the pinned-run refusal lives at
// the FACADE (runs and workflows are two separate SQLite files — no cross-file transaction exists
// in better-sqlite3), probing `store.listRuns()` for a genuinely non-terminal run BEFORE calling
// the catalog. Both sides of the version compare are normalized (`String(x).replace(/^v/,'')`) —
// the run pin is stored NUMERIC/normalized while a catalog row may legitimately be UNPREFIXED
// ("3"), and an un-normalized compare would make this security gate silently never fire.
//
// Red reason: `McpFacade.workflowDeregister` has no `version` parameter at all (calling it with one
// is silently ignored — today's whole-name path always fires), so the pinned-run refusal path is
// entirely unreachable; the version-scoped success path (catalog.deregisterVersion) does not exist.
//
// Mock policy (integration): a REAL SqliteRunStore with a genuinely non-terminal run row (not a
// mock), a real WorkflowCatalog, real facade dispatch.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { FixedClock } from '../../src/clock.js';
import type { Principal } from '../../src/authz.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-it296-pinned-'));
  dirs.push(d);
  return d;
}

const ALICE: Principal = { kind: 'user', id: 'alice' };

function boot(dir: string) {
  const store = new SqliteRunStore(join(dir, 'store'), clock);
  const catalog = new WorkflowCatalog(join(dir, 'catalog'), clock);
  const runManager = new RunManager({ store, clock, catalog, workRoot: dir } as any);
  const facade = new McpFacade({ clock, store, runManager } as any);
  return { store, catalog, facade };
}

describe('IT-296: workflow_deregister({name, version}) refuses a version PINNED BY A NON-TERMINAL RUN — enforced at the FACADE', () => {
  it('a run genuinely non-terminal, catalog row stored UNPREFIXED ("3") — the gate still fires (normalized compare)', async () => {
    const dir = tempDir();
    const { store, catalog, facade } = boot(dir);

    // Three versions so the pinned one is not also the last-remaining.
    await catalog.insertVersion({ name: 'it296-pin', script: "meta={description:'x'};\nreturn 1;", mermaid: 'flowchart LR\n', params: undefined as any, principal: 'alice' });
    await catalog.insertVersion({ name: 'it296-pin', script: "meta={description:'y'};\nreturn 2;", mermaid: 'flowchart LR\n', params: undefined as any, principal: 'alice' });
    const { version: v3 } = await catalog.insertVersion({ name: 'it296-pin', script: "meta={description:'z'};\nreturn 3;", mermaid: 'flowchart LR\n', params: undefined as any, principal: 'alice' });

    // A genuinely non-terminal run row, pinned to the UNPREFIXED numeric form of v3's version.
    const runId = await store.createRun({ name: 'it296-pin', script: 'return 1;' } as any, '3');
    await store.recordTransition(runId, null, 'running', clock.isoNow());

    const result = await (facade as any).workflowDeregister({ name: 'it296-pin', version: v3 }, ALICE);
    expect(result.status).toBe('failed');
    expect(result.error?.code ?? result.code).toBe('VERSION_PINNED_BY_RUN');
    expect(JSON.stringify(result)).toContain(runId);

    // The catalog must NEVER have been called on this branch — v3 must still be fully present.
    const known = await catalog.resolveDetail('it296-pin', { version: v3 });
    expect(known.version).toBe(v3);
  });

  it('the whole-name deregister({name}) path is byte-identical and unaffected by the new version-scoped gate', async () => {
    const dir = tempDir();
    const { catalog, facade } = boot(dir);
    await catalog.insertVersion({ name: 'it296-whole', script: "meta={description:'x'};\nreturn 1;", mermaid: 'flowchart LR\n', params: undefined as any, principal: 'alice' });
    const result = await (facade as any).workflowDeregister({ name: 'it296-whole' }, ALICE);
    expect(result.status).toBe('completed');
  });
});
