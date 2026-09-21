// IT-299 (Gate-8 send-back, DES-246, TASK-244, REQ-211/REQ-096): `insertVersion` allocates
// `v${MAX+1}` over the workflow's REMAINING rows (workflow-catalog.ts:656-659) — so deleting the
// HIGHEST version (v3 of v1..v3) lets the next registration reallocate the SAME key ('v3') that
// `DiagramRenderer`'s cache is keyed on (`name + KEY_SEP + version`, diagram-render.ts:47). The
// whole-name `deregister()` path already calls `diagramCache?.invalidate(name)` for exactly this
// staleness reason (mcp-facade.ts:455); the version-scoped `deregisterVersion` path (added by
// TASK-244) does not, so a viewer who re-opens the SAME (name, version) pair after a delete +
// re-register sees the DELETED version's rendered diagram.
//
// Red reason: `McpFacade.workflowDeregister({name, version})`'s version-scoped branch
// (mcp-facade.ts:402-427) never calls `this.diagramCache?.invalidate(a.name)` — confirmed by
// reading the file (the call exists only in the whole-name branch below it, :455). This test
// reproduces the STALENESS itself (not merely a spy call), the way UT-167 already exercises
// DiagramRenderer's real cache: a REAL DiagramRenderer with a counting render fake proves both (a)
// that a stale SVG would otherwise be served, and (b) that the render count increments (a genuine
// re-render, not a coincidental cache hit).
//
// Mock policy (integration, DES-119 precedent): real WorkflowCatalog (SQLite) + real McpFacade +
// real DiagramRenderer; only DiagramRenderer's own injectable `render` seam is faked (a synchronous
// echo, never a real headless-Chrome spawn — same convention as tests/unit/diagram-renderer.test.ts).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { FixedClock } from '../../src/clock.js';
import { DiagramRenderer, type RenderOutcome } from '../../src/diagram-render.js';
import type { Principal } from '../../src/authz.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-it299-diagram-cache-'));
  dirs.push(d);
  return d;
}

const ALICE: Principal = { kind: 'user', id: 'alice' };

/** Same shape as diagram-renderer.test.ts's `countingFake`, but echoes the SOURCE mermaid into the
 *  SVG so a test can tell which version's diagram was actually rendered/served. */
function echoFake(): { render: (mermaid: string) => Promise<RenderOutcome>; calls: () => number } {
  let n = 0;
  return {
    render: (mermaid: string) => { n++; return Promise.resolve<RenderOutcome>({ ok: true, svg: `<svg data-src="${mermaid}"/>` }); },
    calls: () => n,
  };
}

describe('IT-299: workflow_deregister({name, version}) invalidates the diagram cache too (Gate-8 send-back, real defect)', () => {
  it('a delete + re-register cycle that reallocates the SAME version key never serves the DELETED version\'s stale SVG', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const catalog = new WorkflowCatalog(join(dir, 'catalog'), clock);
    const runManager = new RunManager({ store, clock, catalog, workRoot: dir } as any);
    const fake = echoFake();
    const diagramCache = new DiagramRenderer({ render: fake.render });
    const facade = new McpFacade({ clock, store, runManager, diagramCache } as any);

    const NAME = 'it299-diagram-stale';
    const M1 = 'flowchart LR\na[one]';
    const M2 = 'flowchart LR\nb[two]';
    const M3_OLD = 'flowchart LR\nc[three-OLD]';
    await catalog.insertVersion({ name: NAME, script: "meta={description:'1'};\nreturn 1;", mermaid: M1, params: undefined as any, principal: 'alice' });
    await catalog.insertVersion({ name: NAME, script: "meta={description:'2'};\nreturn 2;", mermaid: M2, params: undefined as any, principal: 'alice' });
    const { version: v3 } = await catalog.insertVersion({ name: NAME, script: "meta={description:'3old'};\nreturn 3;", mermaid: M3_OLD, params: undefined as any, principal: 'alice' });
    expect(v3).toBe('v3');

    // Warm the cache for (NAME, v3) with the OLD version's diagram — a real viewer having opened it.
    const warm = await diagramCache.get(NAME, v3, M3_OLD);
    expect(warm.ok && warm.svg).toBe(`<svg data-src="${M3_OLD}"/>`);
    expect(fake.calls()).toBe(1);

    // Delete v3 (the HIGHEST version) via the facade's version-scoped path.
    const result = await (facade as any).workflowDeregister({ name: NAME, version: v3 }, ALICE);
    expect(result.status).toBe('completed');

    // Re-register: only v1/v2 remain, so `MAX+1` reallocates 'v3' again — the SAME cache key.
    const M3_NEW = 'flowchart LR\nd[three-NEW]';
    const { version: v3again } = await catalog.insertVersion({ name: NAME, script: "meta={description:'3new'};\nreturn 4;", mermaid: M3_NEW, params: undefined as any, principal: 'alice' });
    expect(v3again).toBe('v3'); // the collision this bug depends on

    // A viewer opening (NAME, v3) now must get the NEW diagram, rendered fresh — not the stale
    // cached SVG from the deleted version.
    const after = await diagramCache.get(NAME, v3again, M3_NEW);
    expect(fake.calls()).toBe(2); // a genuine re-render, not a stale cache hit
    expect(after.ok && after.svg).toBe(`<svg data-src="${M3_NEW}"/>`);
  });
});
