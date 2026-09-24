// UT-335 (v37, DES-263 amendment 2026-09-24, ADR-086's second owner ruling):
// trigger provenance must reflect THE REGISTRATION THAT CURRENTLY OWNS the trigger,
// not whoever first created the row.
//
// The defect this pins: `createdRemote` was stamped once at creation and never revisited, so
// (a) every pre-existing row read as local — the control had zero coverage on the live population;
// (b) a remote actor could `workflow_register` + `workflow_publish` onto a workflow name that
// ALREADY owned a trigger, and the next cron tick started that remote script with nobody pressing
// anything. Outcome `'held'` IS path (b), so re-stamping only `'claimed'` does not close it.
//
// v37 Gate-8 round-3 send-back repair (finding 8, INV-V37-7): the original draft of this file
// exercised `SqliteSchedulerPort` only — `WebhookRegistry.claim()`'s own local→remote upgrade had
// no direct unit coverage, so a regression there (e.g. a future refactor dropping its `stamp()`
// call) would have passed the full suite unnoticed. The three cases below are now parametrized
// over BOTH stores (the cheapest form of the conformance lock, per the architecture's own
// prescription) rather than duplicated into a second file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import type { Clock } from '../../src/clock.js';

const ANCHOR = new Date('2026-09-24T00:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };
const fakeCatalog = () => ({ async resolve() { return { script: '', version: 'v1' }; }, declaresTrigger: () => false });
const fakeRunManager = () => ({ async start() { return 'run-1'; } });

type ClaimOutcome = 'claimed' | 'held' | 'NOT_FOUND' | 'ALREADY_CLAIMED';
interface TriggerStore {
  claim(id: string, workflow: string, createdRemote?: boolean): ClaimOutcome;
  get(id: string): { createdRemote?: boolean } | null;
}

// One factory per store: same three behaviours, different `create()`/`get()` return shapes.
const STORES: Array<{ label: string; mk: (dir: string) => TriggerStore; createLocal: (st: TriggerStore) => Promise<string> }> = [
  {
    label: 'SqliteSchedulerPort',
    mk: (dir) => new SqliteSchedulerPort({
      clock: CLOCK, catalog: fakeCatalog() as never, runManager: fakeRunManager() as never,
      dbPath: join(dir, 's.db'),
    }),
    createLocal: async (st) => {
      const made = await (st as SqliteSchedulerPort).create({ kind: 'cron', cron: '* * * * *', enabled: true, createdBy: 'op@example.com', createdRemote: false } as never);
      return (made as { result?: { id: string } }).result!.id;
    },
  },
  {
    label: 'WebhookRegistry',
    mk: (dir) => new WebhookRegistry({
      clock: CLOCK, catalog: fakeCatalog() as never, runManager: fakeRunManager() as never,
      dbPath: join(dir, 'w.db'),
    }),
    createLocal: async (st) => {
      const made = await (st as WebhookRegistry).create({ createdBy: 'op@example.com', createdRemote: false });
      return (made as { webhookId: string }).webhookId;
    },
  },
];

describe.each(STORES)('claim() re-stamps trigger provenance — $label (UT-335, DES-263 amendment, INV-V37-7)', ({ mk: mkStore, createLocal }) => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-restamp-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('[LOAD-BEARING] created locally, then claimed by a REMOTE registration → reads remote', async () => {
    const st = mkStore(dir);
    const id = await createLocal(st);
    expect(st.get(id)?.createdRemote).toBe(false);

    expect(st.claim(id, 'wf-a', true)).toBe('claimed');
    expect(st.get(id)?.createdRemote).toBe(true);
  });

  it("[LOAD-BEARING] 'held' re-stamps too — that outcome IS the re-registration path", async () => {
    const st = mkStore(dir);
    const id = await createLocal(st);
    expect(st.claim(id, 'wf-a', false)).toBe('claimed');
    expect(st.get(id)?.createdRemote).toBe(false);

    expect(st.claim(id, 'wf-a', true)).toBe('held');
    expect(st.get(id)?.createdRemote).toBe(true); // local -> remote: the hole ADR-086 closes
  });

  it("'ALREADY_CLAIMED' never re-stamps — one workflow must not rewrite another's trigger", async () => {
    const st = mkStore(dir);
    const id = await createLocal(st);
    expect(st.claim(id, 'wf-a', false)).toBe('claimed');

    expect(st.claim(id, 'wf-b', true)).toBe('ALREADY_CLAIMED');
    expect(st.get(id)?.createdRemote).toBe(false);
  });
});
