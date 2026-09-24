// v37 Gate-8 round-2 (finding B1, INV-V37-5(d)) — the hop this repo's own bug class (v11
// `updateFlagPath`, v15 auth, v37 A5) has broken three times: does `createServer({confinementPosture})`
// actually WIRE that value into the RunManager instance the server's own webhook/schedule routes
// dispatch through, or does the field just sit on `ServerConfig` unread? Every existing regression
// only exercised the predicate at `confinementPosture:'confined'` — the one value it never gates on
// (a vacuous boot, ARCH-182's own words). This test boots the REAL `createServer`, seeds a webhook
// row with `createdRemote:true` directly against the store file `webhookDbPath` points at (no fake
// RunManagerPort — the server's own, real one), and proves the origin:'remote' RunSpec it produces
// is refused end to end.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import type { Clock } from '../../src/clock.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const ANCHOR = new Date('2024-06-01T12:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };

function sign(secret: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

let server: Server;
let tmpDir: string;
let webhookDbPath: string;
let webhookId: string;
let secret: string;
const base = () => `http://127.0.0.1:${server.port}`;

async function callTool(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-confinement-wiring-'));
  webhookDbPath = join(tmpDir, 'webhooks.db');
  // Seed the row OUT OF PROCESS, before the server (and its own WebhookRegistry) ever opens this
  // file — same idiom `scheduler-migration.test.ts` uses to hand-write a pre-existing shape. The
  // seeding registry's fake catalog/runManager are never exercised: `create()` touches neither.
  const seed = new WebhookRegistry({
    clock: CLOCK,
    runManager: { async start() { throw new Error('unreachable: seeding never delivers'); } },
    catalog: { async resolve() { return { script: '', version: 'v1' }; }, declaresTrigger: () => false },
    dbPath: webhookDbPath,
  });
  const created = await seed.create({ workflow: 'confinement-wiring-check', createdRemote: true });
  if ('error' in created) throw new Error('unreachable: seed create failed');
  webhookId = created.webhookId;
  secret = created.secret;

  // The REAL server, wired with the SAME confinementPosture main.ts's real boot probe would set on
  // a host with no working nested user namespace, and the SAME webhookDbPath the seed above wrote.
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, webhookDbPath, confinementPosture: 'unconfined' });

  // Registering claims the ALREADY-webhook-bound name (claim()'s 'held' branch — the row's own
  // `workflow` already equals this name), over loopback (isRemoteSubmission:false) — this is
  // therefore a LOCAL re-registration of a REMOTELY-created row, and `claim()`'s re-stamp is
  // monotonic (local→remote only, INV-V37-6): it must NOT downgrade `createdRemote` back to
  // false. This is the no-downgrade direction, not an absence of any re-stamp — `claim()` DOES
  // re-stamp on a REMOTE 'held'/'claimed' registration (ADR-086's second ruling, `3e3c331`).
  await registerPublishedVia(callTool, 'confinement-wiring-check', `return { hooked: args.event };`, {
    triggers: [webhookId],
  });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createServer({confinementPosture:"unconfined"}) wires the posture into the real RunManager (B1/INV-V37-5(d))', () => {
  it('[LOAD-BEARING] a webhook delivery whose trigger was createdRemote:true is refused CONFINEMENT_UNAVAILABLE end to end', async () => {
    const body = JSON.stringify({ ping: 'pong' });
    const res = await fetch(`${base()}/hooks/${webhookId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RWE-Signature': sign(secret, body),
        'X-RWE-Timestamp': new Date().toISOString(),
        'X-RWE-Delivery': 'd-wiring-check',
      },
      body,
    });
    expect(res.status).toBe(403);
    const json = await res.json() as { error?: string; code?: string };
    // The machine-readable code, not just the status — a pre-existing "webhook disabled" 403
    // (no code at all) would pass a bare `status===403` check identically; this is what actually
    // proves the REFUSAL THIS TEST EXISTS TO LOCK, not merely "some 403 happened".
    expect(json.code).toBe('CONFINEMENT_UNAVAILABLE');
    // The static catalog hint, never the raw err.message (finding B4) — asserted loosely (no
    // literal posture/limit numbers) so this test does not pin wording owned by errors.ts.
    expect(json.error).toBeTruthy();
    expect(json.error).not.toMatch(/maxConcurrentRuns/);
  });
});
