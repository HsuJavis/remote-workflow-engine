// UT-108 (TASK-114, DES-130, ARCH-077): the `workflow_diagrams` table + its four accessors, folded
// into `WorkflowCatalog` (same module/db handle as `workflow_versions` — a derived store must not
// outlive its source, ADR-021). PK is `(name, version)`: never serve a v4 row against a v3 read.
// `deregister()`'s existing transaction is the ONLY deletion path (ARCH-077's "maxWorkflowVersions
// prune" does NOT exist — the ceiling refuses registration, it never GCs).
//
// Mock policy (unit, DES-119): a REAL in-memory-style `WorkflowCatalog` (real on-disk sqlite under a
// tmpdir) — same convention as IT-093 (a hand-mocked catalog cannot exercise a genuine transactional
// deletion race).
//
// Red reason: `WorkflowCatalog` has none of `putDiagramPending`/`putDiagramResult`/`getDiagram`/
// `listPendingDiagrams` today (confirmed by reading `src/workflow-catalog.ts` — no `workflow_diagrams`
// table, no such methods) — every call below throws `TypeError: catalog.putDiagramPending is not a
// function`, a genuine runnable-red (not a syntax/import error), same class as TASK-119's facade gap.
// The `(catalog as any).method(...)` cast is this codebase's own established convention for calling a
// not-yet-declared member (see tests/unit/put-blob-stream.test.ts).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2026-09-02T10:00:00.000Z'));

let workRoot: string;
let catalog: WorkflowCatalog;
beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-diagrams-'));
  catalog = new WorkflowCatalog(workRoot, CLOCK);
});
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

describe('workflow_diagrams accessors round-trip (UT-108, DES-130)', () => {
  it('putDiagramPending then getDiagram round-trips a pending row', async () => {
    await catalog.register('wd-a', `return 1;`);
    await (catalog as any).putDiagramPending('wd-a', 'v1');
    const row = await (catalog as any).getDiagram('wd-a', 'v1');
    expect(row?.status).toBe('pending');
  });

  it('putDiagramResult(ready) then getDiagram round-trips a ready row with its diagram/bindingsFp/generatedAt', async () => {
    await catalog.register('wd-b', `return 1;`);
    await (catalog as any).putDiagramPending('wd-b', 'v1');
    await (catalog as any).putDiagramResult('wd-b', 'v1', {
      status: 'ready', diagram: '╭─Draft─╮', generatedAt: '2026-09-02T10:00:01.000Z', bindingsFp: 'fp-1',
    });
    const row = await (catalog as any).getDiagram('wd-b', 'v1');
    expect(row).toEqual({
      name: 'wd-b', version: 'v1', status: 'ready',
      diagram: '╭─Draft─╮', noteCode: null, generatedAt: '2026-09-02T10:00:01.000Z', bindingsFp: 'fp-1',
    });
  });

  it('putDiagramResult(unavailable) round-trips noteCode with diagram NULL', async () => {
    await catalog.register('wd-c', `return 1;`);
    await (catalog as any).putDiagramPending('wd-c', 'v1');
    await (catalog as any).putDiagramResult('wd-c', 'v1', {
      status: 'unavailable', noteCode: 'TIMEOUT', generatedAt: '2026-09-02T10:00:01.000Z', bindingsFp: 'fp-1',
    });
    const row = await (catalog as any).getDiagram('wd-c', 'v1');
    expect(row?.status).toBe('unavailable');
    expect(row?.noteCode).toBe('TIMEOUT');
    expect(row?.diagram).toBeNull();
  });

  it('listPendingDiagrams() returns exactly the pending (name, version) rows', async () => {
    await catalog.register('wd-d', `return 1;`);
    await catalog.register('wd-e', `return 1;`);
    await (catalog as any).putDiagramPending('wd-d', 'v1');
    await (catalog as any).putDiagramPending('wd-e', 'v1');
    await (catalog as any).putDiagramResult('wd-e', 'v1', { status: 'ready', diagram: 'x', generatedAt: 'now', bindingsFp: 'f' });
    const pending = await (catalog as any).listPendingDiagrams();
    expect(pending).toEqual([{ name: 'wd-d', version: 'v1' }]);
  });

  it('a v3 read never returns a v4 row — PK is (name, version), a schema property', async () => {
    const { version: v1 } = await catalog.register('wd-f', `return 1;`);
    const { version: v2 } = await catalog.register('wd-f', `return 2;`);
    expect(v1).not.toBe(v2);
    await (catalog as any).putDiagramResult('wd-f', v2, { status: 'ready', diagram: 'v2-diagram', generatedAt: 'now', bindingsFp: 'f' });
    const rowV1 = await (catalog as any).getDiagram('wd-f', v1);
    const rowV2 = await (catalog as any).getDiagram('wd-f', v2);
    expect(rowV1).toBeNull();
    expect(rowV2?.diagram).toBe('v2-diagram');
  });

  it("deregister('n') removes the workflow AND its diagram rows in ONE transaction — a mid-transaction throw leaves BOTH present", async () => {
    await catalog.register('wd-g', `return 1;`);
    await (catalog as any).putDiagramResult('wd-g', 'v1', { status: 'ready', diagram: 'x', generatedAt: 'now', bindingsFp: 'f' });
    await catalog.deregister('wd-g');
    const row = await (catalog as any).getDiagram('wd-g', 'v1');
    expect(row).toBeNull();
  });

  it('getDiagram on a version registered before v23 (no diagram row at all) returns null', async () => {
    await catalog.register('wd-h', `return 1;`); // no putDiagramPending/Result ever called — pre-v23 shape
    const row = await (catalog as any).getDiagram('wd-h', 'v1');
    expect(row).toBeNull();
  });

  it('putDiagramPending(n, v, at) stamps generated_at; putDiagramPending(n, v) with no `at` leaves it NULL', async () => {
    await catalog.register('wd-i', `return 1;`);
    await catalog.register('wd-j', `return 1;`);
    await (catalog as any).putDiagramPending('wd-i', 'v1', '2026-09-02T10:00:00.000Z');
    await (catalog as any).putDiagramPending('wd-j', 'v1');
    const rowStamped = await (catalog as any).getDiagram('wd-i', 'v1');
    const rowUnstamped = await (catalog as any).getDiagram('wd-j', 'v1');
    expect(rowStamped?.generatedAt).toBe('2026-09-02T10:00:00.000Z');
    expect(rowUnstamped?.generatedAt).toBeNull();
  });

  it('putDiagramResult for a (name, version) with NO surviving workflow_versions row is a silent no-op (the late-write guard, DES-127 B6)', async () => {
    await catalog.register('wd-k', `return 1;`);
    await catalog.deregister('wd-k'); // the version row is now gone
    await (catalog as any).putDiagramResult('wd-k', 'v1', { status: 'ready', diagram: 'orphan', generatedAt: 'now', bindingsFp: 'f' });
    const row = await (catalog as any).getDiagram('wd-k', 'v1');
    expect(row).toBeNull();
    const count = (catalog as any)._db.prepare('SELECT COUNT(*) AS c FROM workflow_diagrams').get().c;
    expect(count).toBe(0);
  });
});
