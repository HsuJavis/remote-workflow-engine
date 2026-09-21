// UT-302 (DES-246, ARCH-155, TASK-244, REQ-211/REQ-096): `deregisterVersion(name, version, actor)`
// — a SIBLING of `deregister()`, never a mode flag — answers six outcomes in a PINNED order
// (ownership → name-absent → version-not-found → channel-pinned → last-remaining → pinned-by-run),
// deletes EXACTLY two rows (`workflow_versions`, `workflow_diagrams`) inside one transaction, and
// leaves `assets`/`workflows` untouched. The whole-name `deregister()` path and every one of its
// codes stay byte-identical (REQ-211's own regression clause).
//
// Red reason: `WorkflowCatalog.prototype.deregisterVersion` does not exist — every call is a
// TypeError.
//
// Mock policy (unit): a REAL WorkflowCatalog over a real temp-dir SQLite file (this module's own
// mock policy note: `InMemoryRunStore` is real, not a mock; the catalog here needs no run store at
// all for its own unit tier).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function catalog(): { cat: WorkflowCatalog; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-ut302-dereg-'));
  dirs.push(dir);
  return { cat: new WorkflowCatalog(dir, clock), dir };
}

const ALICE = { id: 'alice', bypass: false, idSource: 'authenticated' as const };
const MALLORY = { id: 'mallory', bypass: false, idSource: 'authenticated' as const };
const ADMIN = { id: 'root-admin', bypass: true, idSource: 'authenticated' as const };

async function twoVersions(cat: WorkflowCatalog, name: string): Promise<[string, string]> {
  const { version: v1 } = await cat.insertVersion({ name, script: "meta = {description:'x'};\nreturn 1;", mermaid: 'flowchart LR\n', params: undefined as any, principal: 'alice' });
  const { version: v2 } = await cat.insertVersion({ name, script: "meta = {description:'y'};\nreturn 2;", mermaid: 'flowchart LR\n', params: undefined as any, principal: 'alice' });
  return [v1, v2];
}

describe('UT-302: deregisterVersion — six outcomes in order, two DELETEs, re-keyed diagram guard', () => {
  it('1 (ownership, first): a stranger is refused NOT_WORKFLOW_OWNER before anything else is checked', async () => {
    const { cat } = catalog();
    const [v1] = await twoVersions(cat, 'ut302-owner');
    await expect((cat as any).deregisterVersion('ut302-owner', v1, MALLORY)).rejects.toThrow(/NOT_WORKFLOW_OWNER/);
  });

  it('2: an absent NAME is {removed:false, remaining:[]}, mirroring deregister() — not an error', async () => {
    const { cat } = catalog();
    const result = await (cat as any).deregisterVersion('does-not-exist', 'v1', ALICE);
    expect(result).toEqual(expect.objectContaining({ removed: false, remaining: [] }));
  });

  it('3: an absent VERSION on a known name is VERSION_NOT_FOUND', async () => {
    const { cat } = catalog();
    await twoVersions(cat, 'ut302-vnf');
    await expect((cat as any).deregisterVersion('ut302-vnf', 'v99', ALICE)).rejects.toThrow(/VERSION_NOT_FOUND/);
  });

  it('4: a channel-pinned version is refused VERSION_PINNED_BY_CHANNEL', async () => {
    const { cat } = catalog();
    const [v1] = await twoVersions(cat, 'ut302-chan');
    await cat.publish('ut302-chan', v1, 'release', 'alice');
    await expect((cat as any).deregisterVersion('ut302-chan', v1, ALICE)).rejects.toThrow(/VERSION_PINNED_BY_CHANNEL/);
  });

  it('5: the LAST remaining version is refused VERSION_LAST_REMAINING, hinting workflow_deregister({name})', async () => {
    const { cat } = catalog();
    const { version } = await cat.insertVersion({ name: 'ut302-last', script: "meta = {description:'x'};\nreturn 1;", mermaid: 'flowchart LR\n', params: undefined as any, principal: 'alice' });
    await expect((cat as any).deregisterVersion('ut302-last', version, ALICE)).rejects.toThrow(/VERSION_LAST_REMAINING/);
  });

  it('success: EXACTLY two DELETEs — workflow_versions/workflow_diagrams gone, assets and the workflows row SURVIVE', async () => {
    const { cat, dir } = catalog();
    const [v1] = await twoVersions(cat, 'ut302-success');
    cat.putAsset({ workflow: 'ut302-success', kind: 'skill', name: 'a-skill', pushedBy: 'alice', pushedAt: clock.isoNow() });
    cat.putDiagramResult('ut302-success', v1, { status: 'ready', diagram: 'graph', generatedAt: clock.isoNow(), bindingsFp: 'fp' });

    const result = await (cat as any).deregisterVersion('ut302-success', v1, ALICE);
    expect(result.removed).toBe(true);

    const db = new Database(join(dir, 'catalog.db'), { readonly: true });
    const versionRow = db.prepare('SELECT * FROM workflow_versions WHERE name = ? AND version = ?').get('ut302-success', v1);
    const diagramRow = db.prepare('SELECT * FROM workflow_diagrams WHERE name = ? AND version = ?').get('ut302-success', v1);
    const assetRow = db.prepare('SELECT * FROM assets WHERE workflow = ?').get('ut302-success');
    const wfRow = db.prepare('SELECT * FROM workflows WHERE name = ?').get('ut302-success');
    db.close();
    expect(versionRow).toBeUndefined();
    expect(diagramRow).toBeUndefined();
    expect(assetRow).toBeDefined();
    expect(wfRow).toBeDefined();
  });

  it('the re-keyed diagram guard: a putDiagramResult AFTER its version was deleted writes nothing', async () => {
    const { cat } = catalog();
    const [v1] = await twoVersions(cat, 'ut302-guard');
    await (cat as any).deregisterVersion('ut302-guard', v1, ALICE);
    cat.putDiagramResult('ut302-guard', v1, { status: 'ready', diagram: 'late-graph', generatedAt: clock.isoNow(), bindingsFp: 'fp' });
    expect(cat.getDiagram('ut302-guard', v1)).toBeNull();
  });

  it('triggers: an id declared ONLY by the deleted version IS released; one still declared by the surviving version is NOT', async () => {
    const { cat } = catalog();
    const { version: v1 } = await cat.insertVersion({ name: 'ut302-trig', script: "meta = {description:'x'};\nreturn 1;", mermaid: 'flowchart LR\n', params: undefined as any, principal: 'alice', triggers: ['only-in-v1', 'in-both'] });
    await cat.insertVersion({ name: 'ut302-trig', script: "meta = {description:'y'};\nreturn 2;", mermaid: 'flowchart LR\n', params: undefined as any, principal: 'alice', triggers: ['in-both'] });
    const result = await (cat as any).deregisterVersion('ut302-trig', v1, ALICE);
    expect(result.claimedTriggers).toEqual(['only-in-v1']);
    expect(cat.declaredTriggers('ut302-trig').has('in-both')).toBe(true);
  });

  it('every whole-name deregister() test stays green: unrelated to the new sibling method', async () => {
    const { cat } = catalog();
    await twoVersions(cat, 'ut302-whole');
    const { removed } = await cat.deregister('ut302-whole', 'alice');
    expect(removed).toBe(true);
  });

  it("an admin (bypass:true) MAY delete another owner's version", async () => {
    const { cat } = catalog();
    const [v1] = await twoVersions(cat, 'ut302-admin');
    const result = await (cat as any).deregisterVersion('ut302-admin', v1, ADMIN);
    expect(result.removed).toBe(true);
  });
});
