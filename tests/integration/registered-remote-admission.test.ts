// v37 P1 (ADR-086's THIRD owner ruling, 2026-09-25, DES-263's 第三次修訂) — the admission
// predicate is an OR of two write-once, never-updated facts: the TRIGGER's own `createdRemote`
// (unchanged, this iteration) and the RESOLVED VERSION's new `registeredRemote`
// (`workflow_versions.registeredRemote`, stamped once by `insertVersion` from the SAME
// `isRemoteSubmission` `workflow_register` already threads):
//
//   refuse  <=>  posture === 'unconfined' && (trigger.createdRemote || resolvedVersion.registeredRemote)
//
// Both cases below go through the REAL wiring — `callTool()` (src/call-tool.ts), never a direct
// `catalog.insertVersion()` call — to guard the bug class this repo has hit three times
// (composeConfig-style: a new field lands on a store but nobody forwards it from the facade, so
// the control is structurally dead while every unit test around it stays green).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import type { Clock } from '../../src/clock.js';

const ANCHOR = new Date('2026-09-25T00:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };
const AUTH_DISABLED = { kind: 'auth-disabled' } as const;

// The same minimal register-clean fixture UT-336/UT-337 (call-tool-confinement-door.test.ts)
// already proved passes registration: no agent() calls, so no gateway dispatch needed to prove
// admission — this file's subject is the refusal/admission gate, not run execution.
const SCRIPT = 'return 1;';
const MERMAID = 'graph LR';

function partialDeps(d: Record<string, unknown>): ToolDeps {
  return d as unknown as ToolDeps;
}

function sign(secret: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-registered-remote-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('registeredRemote — run_start route (real callTool -> McpFacade.workflowRegister -> WorkflowCatalog.insertVersion -> RunManager.start)', () => {
  it('[LOAD-BEARING] remote workflow_register + publish, then a LOCAL run_start of that name is refused CONFINEMENT_UNAVAILABLE', async () => {
    const catalog = new WorkflowCatalog(dir, CLOCK);
    const runManager = new RunManager({ clock: CLOCK, workRoot: dir, catalog, confinementPosture: 'unconfined' });
    const facade = new McpFacade({ runManager });
    const name = 'registered-remote-admission-refused';

    // Registration ITSELF is remote — the exact wire flag `call-tool.ts:212` threads into
    // `facade.workflowRegister`.
    const reg = await callTool(partialDeps({ facade, isRemoteSubmission: true }), 'workflow_register', { name, script: SCRIPT, mermaid: MERMAID }, AUTH_DISABLED) as { status?: string; result?: { version?: string } };
    expect(reg.status).toBe('completed');
    const version = reg.result!.version!;

    const pub = await callTool(partialDeps({ facade }), 'workflow_publish', { name, version, channel: 'release' }, AUTH_DISABLED) as { status?: string };
    expect(pub.status).toBe('completed');

    // The RUN submission is LOCAL (isRemoteSubmission omitted/false) — DES-262's door does not
    // gate it, and the TRIGGER-side `origin` (RunSpec.origin) is also 'local'. Only the resolved
    // VERSION's own `registeredRemote` can refuse this — proving the second admission stage inside
    // `RunManager.start()` (immediately after `catalog.resolve()`, before any durable work).
    const run = await callTool(partialDeps({ facade }), 'run_start', { name }, AUTH_DISABLED) as { status?: string; error?: { code?: string } };
    expect(run.status).toBe('failed');
    expect(run.error?.code).toBe('CONFINEMENT_UNAVAILABLE');
  });

  it('mirror: a LOCALLY registered + published version still runs on the same unconfined host', async () => {
    const catalog = new WorkflowCatalog(dir, CLOCK);
    const runManager = new RunManager({ clock: CLOCK, workRoot: dir, catalog, confinementPosture: 'unconfined' });
    const facade = new McpFacade({ runManager });
    const name = 'registered-local-admission-ok';

    const reg = await callTool(partialDeps({ facade }), 'workflow_register', { name, script: SCRIPT, mermaid: MERMAID }, AUTH_DISABLED) as { status?: string; result?: { version?: string } };
    expect(reg.status).toBe('completed');
    const version = reg.result!.version!;
    const pub = await callTool(partialDeps({ facade }), 'workflow_publish', { name, version, channel: 'release' }, AUTH_DISABLED) as { status?: string };
    expect(pub.status).toBe('completed');

    const run = await callTool(partialDeps({ facade }), 'run_start', { name }, AUTH_DISABLED) as { status?: string; error?: { code?: string }; result?: { runId?: string } };
    expect(run.error).toBeUndefined();
    expect(run.result?.runId).toBeTruthy();
  });
});

describe('registeredRemote — recovery is TWO calls, not one, and never touches the webhook id/secret (DES-263 第三次修訂)', () => {
  it('[LOAD-BEARING] remote register+publish -> webhook delivery refused 403; LOCAL re-register(same triggers)+publish -> the SAME webhook id/secret now delivers 202', async () => {
    const catalog = new WorkflowCatalog(dir, CLOCK);
    const runManager = new RunManager({ clock: CLOCK, workRoot: dir, catalog, confinementPosture: 'unconfined' });
    const webhooks = new WebhookRegistry({ clock: CLOCK, catalog, runManager, dbPath: join(dir, 'webhooks.db') });
    const facade = new McpFacade({ runManager, webhookClaims: webhooks });
    const name = 'registered-remote-recovery';

    // The trigger itself is created LOCALLY (unclaimed) — this scenario isolates the VERSION-side
    // arm of the OR: the webhook row's own `createdRemote` stays false throughout, and the refusal
    // (and its later recovery) is driven entirely by `registeredRemote`.
    const created = await webhooks.create({});
    if ('error' in created) throw new Error('unreachable: webhook create failed');
    const { webhookId, secret } = created;
    expect(webhooks.get(webhookId)?.createdRemote).toBe(false);

    // vN: REMOTE register (claims the trigger) + publish.
    const regN = await callTool(partialDeps({ facade, webhooks, isRemoteSubmission: true }), 'workflow_register', { name, script: SCRIPT, mermaid: MERMAID, triggers: [webhookId] }, AUTH_DISABLED) as { status?: string; result?: { version?: string } };
    expect(regN.status).toBe('completed');
    const versionN = regN.result!.version!;
    const pubN = await callTool(partialDeps({ facade }), 'workflow_publish', { name, version: versionN, channel: 'release' }, AUTH_DISABLED) as { status?: string };
    expect(pubN.status).toBe('completed');
    // The trigger row itself is untouched by the remote registration that claimed it — this is
    // the P1 invariant `created-remote-immutable.test.ts` pins directly.
    expect(webhooks.get(webhookId)?.createdRemote).toBe(false);

    const body1 = JSON.stringify({ n: 1 });
    const refused = await webhooks.deliver(webhookId, { signature: sign(secret, body1), timestamp: CLOCK.isoNow(), deliveryId: 'd-recovery-1', rawBody: body1, parsedBody: {} });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('unreachable: expected refusal');
    expect(refused.httpStatus).toBe(403);
    expect((refused as { code?: string }).code).toBe('CONFINEMENT_UNAVAILABLE');

    // Recovery, exactly the two calls DES-263 pins — LOOPBACK (isRemoteSubmission:false),
    // re-listing the SAME trigger id (dropping it would flip `declaresTrigger()` false and
    // NOT_IN_RELEASE would refuse instead, pinning the working shape per the design note).
    const regN1 = await callTool(partialDeps({ facade, webhooks, isRemoteSubmission: false }), 'workflow_register', { name, script: SCRIPT, mermaid: MERMAID, triggers: [webhookId] }, AUTH_DISABLED) as { status?: string; result?: { version?: string } };
    expect(regN1.status).toBe('completed');
    const versionN1 = regN1.result!.version!;
    expect(versionN1).not.toBe(versionN);
    const pubN1 = await callTool(partialDeps({ facade }), 'workflow_publish', { name, version: versionN1, channel: 'release' }, AUTH_DISABLED) as { status?: string };
    expect(pubN1.status).toBe('completed');

    // The SAME id and secret — never rotated by recovery. Re-using `secret` to sign this second
    // delivery and getting a 202 IS the proof: a rotated secret would fail HMAC verification (401).
    const body2 = JSON.stringify({ n: 2 });
    const recovered = await webhooks.deliver(webhookId, { signature: sign(secret, body2), timestamp: CLOCK.isoNow(), deliveryId: 'd-recovery-2', rawBody: body2, parsedBody: {} });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) throw new Error('unreachable: expected admission');
    expect(recovered.httpStatus).toBe(202);
    expect(webhooks.get(webhookId)?.id).toBe(webhookId);
  });
});
