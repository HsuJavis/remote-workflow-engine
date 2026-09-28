// Issue #100 (owner-approved policy) + #98 item 6.
//
// Policy: a NON-OWNER principal (not the workflow's owner, not admin — admin keeps the SAME
// bypass notion `canMutate`/`actorFor(...,'bypass')` already use elsewhere in this file, e.g.
// workflow_publish/workflow_deregister) may run ANOTHER principal's workflow ONLY at its current
// RELEASE version:
//   Q1 beta channel        -> refused for non-owners, even when beta happens to equal release today.
//   Q2 explicit {version}   -> allowed only when it equals the current release version.
//   Q5 refusal code         -> VERSION_NOT_FOUND (existence-masking; the message must not name the
//                              owner) — genuinely-unknown and hidden-non-release must be indistinguishable.
//   Q4 nested workflow()    -> ALWAYS resolves the target's release, never a caller-chosen selector
//                              (own describe/tests/integration/nested-workflow-n-level.test.ts style).
//   Q6 triggers              -> schedule/webhook firings are release-pinned by construction
//                              (resolveScheduleTarget/webhooks.deliver both hardcode
//                              `channel:'release'`) — this file proves the pin; the impossibility of
//                              a cross-principal CLAIM in the first place is already pinned by
//                              tests/integration/register-trigger-ownership.test.ts (NOT_TRIGGER_OWNER
//                              / NOT_WORKFLOW_OWNER), not re-derived here.
// Owner-less legacy rows: `canMutate`'s own `!owner` truthy rule — unrestricted, same as today.
//
// #98 item 6: `workflow_describe({version})` must compute `runnable`/`runnableReason` for the
// RESOLVED version and the CALLER — not the release pointer's global publish state (the old
// `published = release!=null || beta!=null` term answered CHANNEL_UNPUBLISHED for an OWNER
// describing their own never-published version even though `run_start({version})` runs it fine).
//
// Mock policy (integration): real on-disk WorkflowCatalog + real RunManager + real McpFacade,
// called directly with hand-built `Principal` objects (mirrors
// tests/integration/registered-remote-admission.test.ts's `callTool`-adjacent, non-HTTP pattern —
// no bearer/token-store machinery needed since `McpFacade` methods take a `Principal` directly).
// Scripts are plain `return "...";` — no agent()/gateway needed to prove admission.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { FixedClock } from '../../src/clock.js';
import type { Principal } from '../../src/authz.js';
import { registerPublished, startScript, synthesizeMeta, synthesizePhase, synthesizeMermaid } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2026-09-28T00:00:00.000Z'));

const ALICE_ID = 'alice@x.com';
const BOB_ID = 'bob@x.com';
const ALICE: Principal = { kind: 'author', id: ALICE_ID };
const BOB: Principal = { kind: 'author', id: BOB_ID };
const ADMIN: Principal = { kind: 'admin', id: 'root@x.com' };

const NAME = 'nonowner-gate-wf';

let dir: string;
let catalog: WorkflowCatalog;
let runManager: RunManager;
let facade: McpFacade;
let v1: string; // release, owned by alice
let v2: string; // beta, owned by alice
let v3: string; // unpublished, owned by alice

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-it100-'));
  catalog = new WorkflowCatalog(dir, CLOCK);
  runManager = new RunManager({ clock: CLOCK, workRoot: dir, catalog });
  facade = new McpFacade({ runManager });

  ({ version: v1 } = await registerPublished(catalog, NAME, 'return "v1";', { principal: ALICE_ID, channel: 'release' }));
  ({ version: v2 } = await registerPublished(catalog, NAME, 'return "v2";', { principal: ALICE_ID, channel: 'beta' }));
  // v3: registered, never published to any channel.
  const v3Script = synthesizeMeta(synthesizePhase('return "v3";'));
  const { version } = await catalog.register({ name: NAME, script: v3Script, mermaid: synthesizeMermaid(v3Script), principal: ALICE_ID });
  v3 = version;
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('run_start (#100 Q1/Q2/Q5): non-owner is confined to the current release version', () => {
  it('[LOAD-BEARING] BOB (non-owner): default channel (release) => ok', async () => {
    const r = await facade.runStart({ name: NAME }, BOB);
    expect(r.error).toBeUndefined();
    expect(typeof r.runId).toBe('string');
    expect(r.runId.length).toBeGreaterThan(0);
  });

  it('BOB: explicit channel:"release" => ok', async () => {
    const r = await facade.runStart({ name: NAME, channel: 'release' }, BOB);
    expect(r.error).toBeUndefined();
  });

  it('[LOAD-BEARING] Q2 BOB: explicit version equal to the current release => ok', async () => {
    const r = await facade.runStart({ name: NAME, version: v1 }, BOB);
    expect(r.error).toBeUndefined();
  });

  it('[LOAD-BEARING] Q1 BOB: explicit channel:"beta" => VERSION_NOT_FOUND (never CHANNEL_UNPUBLISHED/NOT_WORKFLOW_OWNER — existence-masking)', async () => {
    const r = await facade.runStart({ name: NAME, channel: 'beta' }, BOB);
    expect(r.error?.code).toBe('VERSION_NOT_FOUND');
    expect(r.error?.message).not.toContain(ALICE_ID);
  });

  it('[LOAD-BEARING] Q2 BOB: explicit version equal to beta (not release) => VERSION_NOT_FOUND', async () => {
    const r = await facade.runStart({ name: NAME, version: v2 }, BOB);
    expect(r.error?.code).toBe('VERSION_NOT_FOUND');
    expect(r.error?.message).not.toContain(ALICE_ID);
  });

  it('BOB: explicit version that was never published at all => VERSION_NOT_FOUND, same code as a genuinely unknown version', async () => {
    const r = await facade.runStart({ name: NAME, version: v3 }, BOB);
    expect(r.error?.code).toBe('VERSION_NOT_FOUND');
    const unknown = await facade.runStart({ name: NAME, version: 'v999' }, BOB);
    expect(unknown.error?.code).toBe('VERSION_NOT_FOUND');
  });

  it('ALICE (owner): every version/channel is runnable, including her own unpublished v3', async () => {
    for (const args of [{ name: NAME, channel: 'beta' as const }, { name: NAME, version: v2 }, { name: NAME, version: v3 }]) {
      const r = await facade.runStart(args, ALICE);
      expect(r.error).toBeUndefined();
    }
  });

  it('ADMIN: bypasses the gate exactly like it bypasses workflow_publish/workflow_deregister ownership', async () => {
    for (const args of [{ name: NAME, channel: 'beta' as const }, { name: NAME, version: v2 }, { name: NAME, version: v3 }]) {
      const r = await facade.runStart(args, ADMIN);
      expect(r.error).toBeUndefined();
    }
  });

  it('owner-less legacy row (owner NULL): unrestricted for a non-owner, same as today (canMutate\'s own `!owner` rule)', async () => {
    const legacyName = 'nonowner-gate-legacy-wf';
    const { version: legacyV1 } = await registerPublished(catalog, legacyName, 'return "L1";', { principal: null, channel: 'release' });
    const { version: legacyV2 } = await registerPublished(catalog, legacyName, 'return "L2";', { principal: null, channel: 'beta' });
    expect(legacyV1).not.toBe(legacyV2);
    const r = await facade.runStart({ name: legacyName, channel: 'beta' }, BOB);
    expect(r.error).toBeUndefined();
  });
});

describe('workflow_describe (#98 item 6 + #100 Q5): runnable/runnableReason for the RESOLVED version and the CALLER', () => {
  it('[LOAD-BEARING #98 item 6] ALICE describing her OWN unpublished v3 by explicit version => runnable:true (matches run_start, not the release pointer\'s CHANNEL_UNPUBLISHED)', async () => {
    const r = await facade.workflowDescribe({ name: NAME, version: v3 }, ALICE) as { status?: string; result?: { runnable?: boolean; runnableReason?: string | null } };
    expect(r.status).toBe('completed');
    expect(r.result?.runnable).toBe(true);
    expect(r.result?.runnableReason).toBeNull();
  });

  it('[LOAD-BEARING #98 item 6, the issue\'s own repro shape] a workflow with NO channel published at all: the owner describing its only version by explicit version => runnable:true (channels:{release:null,beta:null} must not answer CHANNEL_UNPUBLISHED for an explicit-version request)', async () => {
    const onlyName = 'issue98-item6-never-published-wf';
    const script = synthesizeMeta(synthesizePhase('return "only";'));
    const { version } = await catalog.register({ name: onlyName, script, mermaid: synthesizeMermaid(script), principal: ALICE_ID });
    const r = await facade.workflowDescribe({ name: onlyName, version }, ALICE) as { status?: string; result?: { channels?: { release: string | null; beta: string | null }; runnable?: boolean; runnableReason?: string | null } };
    expect(r.status).toBe('completed');
    expect(r.result?.channels).toEqual({ release: null, beta: null });
    expect(r.result?.runnable).toBe(true);
    expect(r.result?.runnableReason).toBeNull();
    // And run_start({version}) really does run it, for the SAME owner — describe and run_start
    // must agree.
    const started = await facade.runStart({ name: onlyName, version }, ALICE);
    expect(started.error).toBeUndefined();
  });

  it('BOB describing v1 (== release) => runnable:true', async () => {
    const r = await facade.workflowDescribe({ name: NAME, version: v1 }, BOB) as { status?: string; result?: { runnable?: boolean } };
    expect(r.status).toBe('completed');
    expect(r.result?.runnable).toBe(true);
  });

  it('[LOAD-BEARING] BOB describing channel:"beta" => the SAME VERSION_NOT_FOUND envelope a genuinely unknown version gets (existence-masking, Q5)', async () => {
    const r = await facade.workflowDescribe({ name: NAME, channel: 'beta' }, BOB) as { status?: string; code?: string; error?: { code?: string; message?: string } };
    expect(r.status).toBe('failed');
    expect(r.code).toBe('VERSION_NOT_FOUND');
    expect(r.error?.message).not.toContain(ALICE_ID);

    const unknown = await facade.workflowDescribe({ name: NAME, version: 'v999' }, BOB) as { status?: string; code?: string };
    expect(unknown.code).toBe('VERSION_NOT_FOUND');
  });

  it('BOB describing v2 (== beta, not release) by explicit version => VERSION_NOT_FOUND', async () => {
    const r = await facade.workflowDescribe({ name: NAME, version: v2 }, BOB) as { status?: string; code?: string };
    expect(r.status).toBe('failed');
    expect(r.code).toBe('VERSION_NOT_FOUND');
  });

  it('BOB describing v3 (never published) => VERSION_NOT_FOUND', async () => {
    const r = await facade.workflowDescribe({ name: NAME, version: v3 }, BOB) as { status?: string; code?: string };
    expect(r.status).toBe('failed');
    expect(r.code).toBe('VERSION_NOT_FOUND');
  });

  it('ADMIN describing v3 (unpublished, owned by alice) => runnable:true, same bypass as run_start', async () => {
    const r = await facade.workflowDescribe({ name: NAME, version: v3 }, ADMIN) as { status?: string; result?: { runnable?: boolean } };
    expect(r.status).toBe('completed');
    expect(r.result?.runnable).toBe(true);
  });
});

// Follow-up (owner: "don't reveal existence" is not just refusal — an ALLOWED describe/list/source
// response must not enumerate non-release version ids either): `versions[]`/`channels.beta` are
// masked for a non-owner (same `canRunResolved`-false semantics: not owner, not admin/bypass, not
// an ownerless legacy row); owner/admin still see everything.
describe('workflow_describe/workflow_list/workflow_source (owner follow-up): non-owner never sees non-release version ids via enumeration fields', () => {
  it('[LOAD-BEARING] BOB describing the (allowed) release version: versions is [release] only, channels.beta is null', async () => {
    const r = await facade.workflowDescribe({ name: NAME }, BOB) as { status?: string; result?: { versions?: string[]; channels?: { release: string | null; beta: string | null } } };
    expect(r.status).toBe('completed');
    expect(r.result?.versions).toEqual([v1]);
    expect(r.result?.channels).toEqual({ release: v1, beta: null });
  });

  it('ALICE (owner) describing the same workflow: sees every version and both channels', async () => {
    const r = await facade.workflowDescribe({ name: NAME }, ALICE) as { status?: string; result?: { versions?: string[]; channels?: { release: string | null; beta: string | null } } };
    expect(r.status).toBe('completed');
    expect(r.result?.versions).toEqual(expect.arrayContaining([v1, v2, v3]));
    expect(r.result?.channels).toEqual({ release: v1, beta: v2 });
  });

  it('ADMIN describing: sees every version and both channels, same bypass as run_start', async () => {
    const r = await facade.workflowDescribe({ name: NAME }, ADMIN) as { status?: string; result?: { versions?: string[]; channels?: { release: string | null; beta: string | null } } };
    expect(r.status).toBe('completed');
    expect(r.result?.versions).toEqual(expect.arrayContaining([v1, v2, v3]));
    expect(r.result?.channels).toEqual({ release: v1, beta: v2 });
  });

  it('a workflow with NO release at all: a non-owner describing it (VERSION_NOT_FOUND) never reaches the masking code, and an owner-only ownerless-legacy row shows versions:[] when unreleased', async () => {
    const legacyName = 'nonowner-gate-legacy-unreleased-wf';
    const script = synthesizeMeta(synthesizePhase('return "L";'));
    const { version } = await catalog.register({ name: legacyName, script, mermaid: synthesizeMermaid(script), principal: null });
    // Ownerless (owner:null) is unrestricted per canMutate's own `!owner` rule — BOB sees everything.
    const r = await facade.workflowDescribe({ name: legacyName, version }, BOB) as { status?: string; result?: { versions?: string[]; channels?: { release: string | null; beta: string | null } } };
    expect(r.status).toBe('completed');
    expect(r.result?.versions).toEqual([version]);
    expect(r.result?.channels).toEqual({ release: null, beta: null });
  });

  it('[LOAD-BEARING] workflow_list: BOB sees only the release version in versions[] and null beta for a workflow he does not own; ALICE sees both', async () => {
    const bobList = await facade.workflowList({}, BOB);
    const bobRow = bobList.result?.find((w) => w.name === NAME);
    expect(bobRow).toBeDefined();
    expect(bobRow?.versions).toEqual([v1]);
    expect(bobRow?.channels).toEqual({ release: v1, beta: null });

    const aliceList = await facade.workflowList({}, ALICE);
    const aliceRow = aliceList.result?.find((w) => w.name === NAME);
    expect(aliceRow).toBeDefined();
    expect(aliceRow?.versions).toEqual(expect.arrayContaining([v1, v2, v3]));
    expect(aliceRow?.channels).toEqual({ release: v1, beta: v2 });
  });

  it('workflow_list: ADMIN sees both channels and every version too', async () => {
    const adminList = await facade.workflowList({}, ADMIN);
    const adminRow = adminList.result?.find((w) => w.name === NAME);
    expect(adminRow?.versions).toEqual(expect.arrayContaining([v1, v2, v3]));
    expect(adminRow?.channels).toEqual({ release: v1, beta: v2 });
  });

  it('[LOAD-BEARING] workflow_source: BOB\'s masked projection shows channels.release but never channels.beta', async () => {
    const bobSource = await facade.workflowSource({ name: NAME }, BOB) as { status?: string; result?: { channels?: { release: string | null; beta: string | null }; scriptWithheld?: boolean } };
    expect(bobSource.status).toBe('completed');
    expect(bobSource.result?.scriptWithheld).toBe(true);
    expect(bobSource.result?.channels).toEqual({ release: v1, beta: null });
  });

  it('ALICE (owner): workflow_source returns the OWNER branch (the real, unwithheld script) — no `channels` key on that branch at all, so nothing to mask', async () => {
    const aliceSource = await facade.workflowSource({ name: NAME }, ALICE) as { status?: string; result?: { channels?: unknown; scriptWithheld?: boolean; script?: string } };
    expect(aliceSource.status).toBe('completed');
    expect(aliceSource.result?.scriptWithheld).toBeUndefined();
    expect(typeof aliceSource.result?.script).toBe('string');
    expect(aliceSource.result?.channels).toBeUndefined();
  });
});

// Independent verification follow-up (2026-09-28): workflow_source had NO `canRunResolved` gate at
// all — a non-owner naming an explicit NON-release version by id got back the MASKED projection
// (scriptWithheld:true) but description/phases/params/channels/versions all came from THAT real
// row, confirming the version exists even though workflow_describe/run_start already refuse the
// identical request VERSION_NOT_FOUND. Gated the SAME way, right after `resolveDetail` succeeds and
// before any of `meta`/`params`/the owner-branch decision is built.
describe('workflow_source (independent-verification follow-up): gated the SAME as workflow_describe/run_start', () => {
  it('[LOAD-BEARING] BOB naming v2 (== beta, not release) by explicit version => VERSION_NOT_FOUND, same envelope shape as workflow_describe, never the masked metadata', async () => {
    const r = await facade.workflowSource({ name: NAME, version: v2 }, BOB) as { status?: string; code?: string; error?: { code?: string; message?: string }; result?: unknown };
    expect(r.status).toBe('failed');
    expect(r.code).toBe('VERSION_NOT_FOUND');
    expect(r.error?.message).not.toContain(ALICE_ID);
    expect(r.result).toBeUndefined();

    const describeEquivalent = await facade.workflowDescribe({ name: NAME, version: v2 }, BOB) as { code?: string };
    expect(describeEquivalent.code).toBe(r.code);
  });

  it('BOB naming v3 (never published) => VERSION_NOT_FOUND, same code as a genuinely unknown version', async () => {
    const r = await facade.workflowSource({ name: NAME, version: v3 }, BOB) as { status?: string; code?: string };
    expect(r.status).toBe('failed');
    expect(r.code).toBe('VERSION_NOT_FOUND');

    const unknown = await facade.workflowSource({ name: NAME, version: 'v999' }, BOB) as { status?: string; code?: string };
    expect(unknown.code).toBe('VERSION_NOT_FOUND');
  });

  it('BOB naming v1 (== release) explicitly still works (masked)', async () => {
    const r = await facade.workflowSource({ name: NAME, version: v1 }, BOB) as { status?: string; result?: { scriptWithheld?: boolean } };
    expect(r.status).toBe('completed');
    expect(r.result?.scriptWithheld).toBe(true);
  });

  it('ALICE (owner) and ADMIN: still fetch v2/v3 by explicit version — the gate never fires for them', async () => {
    for (const principal of [ALICE, ADMIN]) {
      const rV2 = await facade.workflowSource({ name: NAME, version: v2 }, principal);
      expect((rV2 as { status?: string }).status).toBe('completed');
      const rV3 = await facade.workflowSource({ name: NAME, version: v3 }, principal);
      expect((rV3 as { status?: string }).status).toBe('completed');
    }
  });

  it('owner-less legacy row: unrestricted for a non-owner, same as today (canMutate\'s own `!owner` rule — matches run_start/describe)', async () => {
    const legacyName = 'workflow-source-legacy-unowned-wf';
    const { version: legacyV1 } = await registerPublished(catalog, legacyName, 'return "L1";', { principal: null, channel: 'release' });
    const { version: legacyV2 } = await registerPublished(catalog, legacyName, 'return "L2";', { principal: null, channel: 'beta' });
    expect(legacyV1).not.toBe(legacyV2);
    const r = await facade.workflowSource({ name: legacyName, version: legacyV2 }, BOB) as { status?: string; result?: { scriptWithheld?: boolean } };
    expect(r.status).toBe('completed');
    expect(r.result?.scriptWithheld).toBe(true);
  });
});

describe('nested workflow() (#100 Q4): always resolves the target release, never a selector, regardless of principal', () => {
  it('[LOAD-BEARING] a newer, unpublished child version is never reached by a nested workflow() call across principals', async () => {
    const child = 'nested-child-it100';
    await registerPublished(catalog, child, `return 'CHILD_V1';`, { principal: ALICE_ID, channel: 'release' });
    // A newer version alice registered but never released — a nested workflow() call has no
    // version/channel argument at all (run-manager.ts's onWorkflowRequest takes only a name), so
    // this must be structurally unreachable, not merely policy-refused.
    await registerPublished(catalog, child, `return 'CHILD_V2';`, { principal: ALICE_ID, channel: 'beta' });

    // The PARENT run's own principal (bob) is not the child's owner (alice) — the cross-principal
    // case Q4 names explicitly.
    const runId = await startScript(runManager, `const c = await workflow('${child}'); return c;`, { principal: BOB_ID });
    const result = await completedValue(runManager, runId);
    expect(result).toBe('CHILD_V1');
  });
});

describe('triggers (#100 Q6): a fired run is always pinned to the workflow\'s release, independent of ownership', () => {
  it('[LOAD-BEARING] a webhook fires the RELEASE version even though a newer beta version exists', async () => {
    const target = 'trigger-release-pin-it100';
    const webhooks = new WebhookRegistry({ clock: CLOCK, catalog, runManager, dbPath: join(dir, 'webhooks-it100.db') });
    const created = await webhooks.create({});
    if ('error' in created) throw new Error('unreachable: webhook create failed');
    const { webhookId, secret } = created;

    // Register the RELEASE version declaring the webhook id (the catalog's own `triggers` column
    // — `WorkflowCatalog.register`'s claim-ownership check lives one layer up, in
    // `McpFacade.workflowRegister`, and is already pinned by
    // tests/integration/register-trigger-ownership.test.ts; this file calls the catalog directly,
    // the same shortcut `registerPublished` itself uses, to isolate the FIRE-time release pin).
    const relScript = synthesizeMeta(synthesizePhase(`return 'REL';`));
    const { version: relV } = await catalog.register({ name: target, script: relScript, mermaid: synthesizeMermaid(relScript), triggers: [webhookId], principal: ALICE_ID });
    await catalog.publish(target, relV, 'release', ALICE_ID);
    // The webhook row itself is CLAIMED by the target workflow — same effect
    // `McpFacade.workflowRegister`'s `_storeFor(id).claim(id, a.name)` has in production.
    expect(webhooks.claim(webhookId, target)).toBe('claimed');

    // A newer BETA exists — must never be what fires.
    await registerPublished(catalog, target, `return 'BETA';`, { principal: ALICE_ID, channel: 'beta' });

    const body = JSON.stringify({ n: 1 });
    const delivered = await webhooks.deliver(webhookId, {
      signature: 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
      timestamp: CLOCK.isoNow(),
      deliveryId: 'd-it100-1',
      rawBody: body,
      parsedBody: {},
    });
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) throw new Error('unreachable');
    const runId = (delivered as { runId: string }).runId;
    const result = await completedValue(runManager, runId);
    expect(result).toBe('REL');
  });
});

// ── local helpers (mirrors tests/integration/nested-workflow-n-level.test.ts) ──────────────────
async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 300 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view;
}
async function completedValue(mgr: RunManager, runId: string): Promise<unknown> {
  const view = await pollUntilSettled(mgr, runId);
  expect(view.status).toBe('completed');
  const result = await mgr.result(runId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}
