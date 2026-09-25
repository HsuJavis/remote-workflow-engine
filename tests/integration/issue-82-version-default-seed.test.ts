// Issue #82 (option B): a workflow VERSION may carry a default seed — a `seedManifestRef` bound at
// `workflow_register` time and stored on the (immutable) version row, together with the CAS
// namespace the registrant proved possession in. `RunManager.start()` — the one door every start
// path goes through (run_start, the schedule ticker, the resident `Scheduler.trigger()`, a webhook
// delivery) — materializes it when the run brings NO seed of its own. An explicit run seed
// REPLACES the default (never merges): same rule as run_start's own 4-way mutual exclusion.
//
// Red reason (before the fix): `workflow_versions` has no seed column, `insertVersion` drops the
// ref, `resolve()` returns none, and `start()` never looks — every triggered run starts EMPTY,
// which is exactly the reported bug (a fired run could not read data/input.txt).
//
// Mock policy (integration): real file-backed WorkflowCatalog, real CasStore, real RunManager
// (sandboxed `return 1;` script — no agent, no gateway), real SqliteSchedulerPort and
// WebhookRegistry, real McpFacade. Nothing on the SUT boundary is mocked.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { CasStore } from '../../src/cas-store.js';
import { SystemClock } from '../../src/clock.js';
import type { Principal } from '../../src/authz.js';

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const SCRIPT = 'return 1;';
const MERMAID = 'graph LR';
const INPUT = Buffer.from('hello from the version default seed\n');
const ALICE: Principal = { kind: 'author', id: 'alice' };
const BOB: Principal = { kind: 'author', id: 'bob' };

let dir: string;
let cas: CasStore;
let catalog: WorkflowCatalog;
let mgr: RunManager;
let facade: McpFacade;
const clock = new SystemClock();

/** Uploads `data/input.txt` + its manifest into `ns`, exactly as POST /assets/blob + /assets/manifest
 *  do (putBlob under the caller's namespace), and returns the manifest ref. */
async function seedIn(ns: string, content: Buffer = INPUT, path = 'data/input.txt'): Promise<string> {
  await cas.putBlob(ns, sha256(content), content);
  const manifest = Buffer.from(JSON.stringify([{ path, sha256: sha256(content) }]));
  return (await cas.putBlob(ns, sha256(manifest), manifest)).sha256;
}

async function registerViaFacade(name: string, principal: Principal, extra: Record<string, unknown>): Promise<Record<string, any>> {
  return facade.workflowRegister({ name, script: SCRIPT, mermaid: MERMAID, ...extra } as never, principal) as Promise<Record<string, any>>;
}

async function registerPublishedWithSeed(name: string, principal: Principal, seedManifestRef: string): Promise<string> {
  const r = await registerViaFacade(name, principal, { seedManifestRef });
  expect(r['status'], JSON.stringify(r)).toBe('completed');
  const version = r['result'].version as string;
  const p = await facade.workflowPublish({ name, version, channel: 'release' }, principal) as Record<string, any>;
  expect(p['status'], JSON.stringify(p)).toBe('completed');
  return version;
}

async function seededInput(runId: string): Promise<string | null> {
  const ws = await mgr.workspacePath(runId);
  const f = join(ws!, 'data', 'input.txt');
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-issue82-'));
  cas = new CasStore(join(dir, 'cas'));
  catalog = new WorkflowCatalog(dir, clock);
  mgr = new RunManager({ store: new InMemoryRunStore(clock), clock, workRoot: dir, catalog, cas });
  facade = new McpFacade({ runManager: mgr, store: undefined } as never);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('#82 — workflow_register({seedManifestRef}) binds a default seed to the version', () => {
  it('stores the ref and the registrant namespace on the version row; resolve() returns them', async () => {
    const ref = await seedIn('alice');
    const v = await registerPublishedWithSeed('wf-store', ALICE, ref);
    const entry = await catalog.resolve('wf-store', { version: v }) as unknown as Record<string, unknown>;
    expect(entry['seedManifestRef']).toBe(ref);
    expect(entry['seedNamespace']).toBe('alice');
  });

  it('workflow_describe shows the version seed ref', async () => {
    const ref = await seedIn('alice');
    const v = await registerPublishedWithSeed('wf-describe', ALICE, ref);
    const d = await facade.workflowDescribe({ name: 'wf-describe', version: v }, ALICE) as Record<string, any>;
    expect(d['result'].seedManifestRef).toBe(ref);
  });

  it('a ref the registrant never uploaded is refused at REGISTER time (MISSING_BLOBS) and no version is written', async () => {
    const r = await registerViaFacade('wf-missing', ALICE, { seedManifestRef: 'b'.repeat(64) });
    expect(r['status']).toBe('failed');
    expect(r['code']).toBe('MISSING_BLOBS');
    expect(await catalog.exists('wf-missing')).toBe(false);
  });

  it("a FOREIGN ref (uploaded under another principal's namespace) is refused the same way", async () => {
    const aliceRef = await seedIn('alice');
    const r = await registerViaFacade('wf-foreign', BOB, { seedManifestRef: aliceRef });
    expect(r['status']).toBe('failed');
    expect(r['code']).toBe('MISSING_BLOBS');
    expect(await catalog.exists('wf-foreign')).toBe(false);
  });

  it('a manifest blob that is not a manifest is refused INVALID_SEED_SPEC at register time', async () => {
    const junk = Buffer.from('not json');
    await cas.putBlob('alice', sha256(junk), junk);
    const r = await registerViaFacade('wf-junk', ALICE, { seedManifestRef: sha256(junk) });
    expect(r['code']).toBe('INVALID_SEED_SPEC');
  });

  for (const key of ['seed', 'seedManifest', 'seedRef'] as const) {
    it(`inline \`${key}\` on register is refused INVALID_ARGUMENT (refs only), not silently dropped`, async () => {
      const value = key === 'seedRef' ? { repoUrl: 'https://example.invalid/r.git', sha: 'a'.repeat(40) } : [{ path: 'a.txt', contentB64: 'AAAA' }];
      const r = await registerViaFacade(`wf-inline-${key}`, ALICE, { [key]: value });
      expect(r['code']).toBe('INVALID_ARGUMENT');
      expect(String(r['error']?.message)).toContain('seedManifestRef');
      expect(await catalog.exists(`wf-inline-${key}`)).toBe(false);
    });
  }
});

describe('#82 — every start path materializes the version default seed (no per-path code)', () => {
  it('manual start with no seed: the run workspace holds data/input.txt', async () => {
    await registerPublishedWithSeed('wf-manual', ALICE, await seedIn('alice'));
    const runId = await mgr.start({ name: 'wf-manual', origin: 'local', principal: 'alice' });
    expect(await seededInput(runId)).toBe(INPUT.toString());
  });

  it('a start with NO principal (the trigger shape) reads the REGISTRANT namespace, not "local"', async () => {
    await registerPublishedWithSeed('wf-noprincipal', ALICE, await seedIn('alice'));
    const runId = await mgr.start({ name: 'wf-noprincipal', origin: 'local' });
    expect(await seededInput(runId)).toBe(INPUT.toString());
  });

  it('an explicit run seed REPLACES the default (no merge)', async () => {
    await registerPublishedWithSeed('wf-override', ALICE, await seedIn('alice'));
    const runId = await mgr.start({ name: 'wf-override', origin: 'local', seed: [{ path: 'other.txt', contentB64: Buffer.from('mine').toString('base64') }] });
    const ws = (await mgr.workspacePath(runId))!;
    expect(readFileSync(join(ws, 'other.txt'), 'utf8')).toBe('mine');
    expect(existsSync(join(ws, 'data', 'input.txt'))).toBe(false);
  });

  it('an explicit run seedManifestRef also replaces the default', async () => {
    await registerPublishedWithSeed('wf-override-ref', ALICE, await seedIn('alice'));
    const mine = await seedIn('local', Buffer.from('explicit'), 'data/input.txt');
    const runId = await mgr.start({ name: 'wf-override-ref', origin: 'local', seedManifestRef: mine });
    expect(await seededInput(runId)).toBe('explicit');
  });

  it('resident trigger (SqliteSchedulerPort.trigger) — same door, seeded', async () => {
    await registerPublishedWithSeed('wf-resident', ALICE, await seedIn('alice'));
    const scheduler = new SqliteSchedulerPort({ clock, catalog, runManager: mgr, dbPath: join(dir, 'schedules.db') });
    const r = await scheduler.trigger('wf-resident');
    expect('result' in r, JSON.stringify(r)).toBe(true);
    expect(await seededInput(r.result!.runId)).toBe(INPUT.toString());
  });

  it('webhook delivery (WebhookRegistry.deliver) — same door, seeded', async () => {
    await registerPublishedWithSeed('wf-hook', ALICE, await seedIn('alice'));
    const webhooks = new WebhookRegistry({ clock, runManager: mgr, catalog, dbPath: join(dir, 'webhooks.db') });
    const c = await webhooks.create({ workflow: 'wf-hook' });
    if ('error' in c) throw new Error('webhook create failed');
    const body = '{"x":1}';
    const sig = 'sha256=' + createHmac('sha256', c.secret).update(body).digest('hex');
    const out = await webhooks.deliver(c.webhookId, { signature: sig, timestamp: clock.isoNow(), deliveryId: 'd1', rawBody: body, parsedBody: { x: 1 } });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(await seededInput((out as { runId: string }).runId)).toBe(INPUT.toString());
  });

  it('a version registered WITHOUT a seed still starts empty (no behaviour change)', async () => {
    const r = await registerViaFacade('wf-plain', ALICE, {});
    await facade.workflowPublish({ name: 'wf-plain', version: r['result'].version, channel: 'release' }, ALICE);
    const runId = await mgr.start({ name: 'wf-plain', origin: 'local' });
    expect(await seededInput(runId)).toBeNull();
  });

  it('a new seed is a new version: v1 keeps its ref, v2 carries the new one', async () => {
    const ref1 = await seedIn('alice');
    const ref2 = await seedIn('alice', Buffer.from('second'));
    const v1 = await registerPublishedWithSeed('wf-versions', ALICE, ref1);
    const v2 = await registerPublishedWithSeed('wf-versions', ALICE, ref2);
    expect(v1).not.toBe(v2);
    expect(((await catalog.resolve('wf-versions', { version: v1 })) as unknown as Record<string, unknown>)['seedManifestRef']).toBe(ref1);
    expect(((await catalog.resolve('wf-versions', { version: v2 })) as unknown as Record<string, unknown>)['seedManifestRef']).toBe(ref2);
    const runId = await mgr.start({ name: 'wf-versions', origin: 'local', version: v1 });
    expect(await seededInput(runId)).toBe(INPUT.toString());
  });
});
