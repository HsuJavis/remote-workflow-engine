// Issue #122 (owner decision 2026-10-10): "a schedule firing that hits CONFINEMENT_UNAVAILABLE is
// routed into the ticker's generic catch -> scheduler.markFailed (lastError), while a webhook
// delivery special-cases the same code into the lastRefusalReason/refusalCount/lastRefusedAt trio
// ... make schedules record it the same way as webhooks ... not as a generic failure; keep any
// genuine dispatch errors on lastError." This boots the REAL createServer with
// confinementPosture:'unconfined' (the same posture confinement-unconfined-wiring.test.ts uses for
// the webhook half of this same bug class) and seeds a `once` schedule row DIRECTLY against the
// store file `schedulerDbPath` points at, with `createdRemote:true`, BEFORE the server opens it —
// the exact seeding idiom confinement-unconfined-wiring.test.ts's webhook row and
// schedule-firing-mcp-provisioning.test.ts's real-ticker-driver assertion both already use. No fake
// RunManagerPort — the server's own, real ticker actually fires this row.
//
// RED before the fix: the row's `lastError.code` is 'CONFINEMENT_UNAVAILABLE' and
// `lastRefusalReason`/`refusalCount`/`lastRefusedAt` are all absent/zero.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import type { Clock } from '../../src/clock.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const ANCHOR = new Date('2024-06-01T12:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };

let server: Server;
let tmpDir: string;
let schedulerDbPath: string;
let scheduleId: string;
const WORKFLOW_NAME = 'confinement-sched-check';

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-122-sched-confinement-'));
  schedulerDbPath = join(tmpDir, 'schedules.db');
  // Seed the row OUT OF PROCESS, before the server (and its own SqliteSchedulerPort) ever opens
  // this file — same idiom confinement-unconfined-wiring.test.ts's webhook seed uses. The seeding
  // port's fake catalog/runManager are never exercised: `create()` touches neither.
  const seed = new SqliteSchedulerPort({
    clock: CLOCK,
    catalog: { exists: async () => true },
    runManager: { async start() { throw new Error('unreachable: seeding never dispatches'); } },
    dbPath: schedulerDbPath,
  });
  const pastAt = new Date(Date.now() - 5000).toISOString();
  const created = await seed.create({ kind: 'once', workflow: WORKFLOW_NAME, at: pastAt, enabled: true, createdRemote: true });
  if ('error' in created || !created.result) throw new Error('unreachable: seed create failed: ' + JSON.stringify(created.error));
  scheduleId = created.result.id;

  // The REAL server, wired with the SAME confinementPosture main.ts's real boot probe would set on
  // a host with no working nested user namespace, and the SAME schedulerDbPath the seed above wrote.
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, schedulerDbPath, confinementPosture: 'unconfined' });

  // Registering claims the already-schedule-bound name (claim()'s 'held' branch), over loopback
  // (isRemoteSubmission:false — a LOCAL registration). The seeded row's own `createdRemote:true`
  // (the TRIGGER's write-once stamp) is what drives the refusal, not this registration's locality.
  await registerPublishedVia(callTool, WORKFLOW_NAME, `return 'ok';`, { triggers: [scheduleId] });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('a once-schedule firing whose trigger was createdRemote:true, on an unconfined host (#122)', () => {
  it('[LOAD-BEARING] is refused CONFINEMENT_UNAVAILABLE via the refusal trio (lastRefusalReason/refusalCount/lastRefusedAt), NOT lastError', async () => {
    const rowFor = async () => ((await callTool('schedule_list'))['result'] as Array<Record<string, unknown>>).find((x) => x['id'] === scheduleId);
    let row: Record<string, unknown> | undefined;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      row = await rowFor();
      if (row?.['lastRefusalReason'] || row?.['lastError']) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(row?.['lastRefusalReason']).toBe('CONFINEMENT_UNAVAILABLE');
    expect(row?.['refusalCount']).toBe(1);
    expect(row?.['lastRefusedAt']).toBeTruthy();
    // The OLD, now-wrong behaviour this fix replaces — never both for one firing.
    expect(row?.['lastError']).toBeUndefined();
    // `once` is CONSUMED by a refusal exactly like it is by a dispatch failure (markRefused's own
    // `once` branch) — never re-fires.
    expect(row?.['enabled']).toBe(false);
    expect((await callTool('run_list', { workflow: WORKFLOW_NAME }))['result']).toEqual([]);
  }, 15000);
});
