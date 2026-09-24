// UT-335 INVERSE (v37, ADR-086's THIRD owner ruling P1, 2026-09-25, DES-263's 第三次修訂):
// this file used to pin the OPPOSITE fact — that claim() re-stamps `createdRemote` monotonically
// (local->remote) when a registration claims a trigger. That rule (`3e3c331`+`2cf5f32`) is
// SUPERSEDED and DELETED: `createdRemote` reverts to write-once-at-creation, never updated by any
// later path, including `claim()`.
//
// What closes the hole the old re-stamp rule was patching (a remote re-registration onto an
// already-claimed trigger) is now `workflow_versions.registeredRemote` — written once per version
// row by `insertVersion`, OR'd against the trigger's own immutable `createdRemote` at admission
// (`admissionRefusal`). That predicate is exercised by the admission-route integration tests, not
// here — this file's job is narrower: prove `claim()` truly never writes `createdRemote`, on
// EITHER outcome that mutates a row (`'claimed'`, `'held'`), on BOTH trigger stores.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import type { Clock } from '../../src/clock.js';

const ANCHOR = new Date('2026-09-25T00:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };
const fakeCatalog = () => ({ async resolve() { return { script: '', version: 'v1' }; }, declaresTrigger: () => false });
const fakeRunManager = () => ({ async start() { return 'run-1'; } });

type ClaimOutcome = 'claimed' | 'held' | 'NOT_FOUND' | 'ALREADY_CLAIMED';
interface TriggerStore {
  claim(id: string, workflow: string): ClaimOutcome;
  get(id: string): { createdRemote?: boolean } | null;
}

// One factory per store: same behaviours, different create()/get() return shapes.
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

describe.each(STORES)('claim() leaves trigger provenance untouched — $label (createdRemote is write-once, ADR-086 third ruling P1)', ({ mk: mkStore, createLocal }) => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-immutable-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("[LOAD-BEARING] created locally, then claimed by a REMOTE registration (outcome 'claimed') → still reads local", async () => {
    const st = mkStore(dir);
    const id = await createLocal(st);
    expect(st.get(id)?.createdRemote).toBe(false);

    // v37 P1: claim() takes no third argument at all — there is no remoteness fact for it to
    // receive, because it no longer writes one. A caller that still passes a third positional
    // (the old `createdRemote` argument) simply has it ignored by JS's own call semantics — the
    // point of this test is that the STORED VALUE never moves, regardless.
    expect(st.claim(id, 'wf-a')).toBe('claimed');
    expect(st.get(id)?.createdRemote).toBe(false);
  });

  it("[LOAD-BEARING] 'held' (re-registration of an already-claimed trigger) ALSO never re-stamps", async () => {
    const st = mkStore(dir);
    const id = await createLocal(st);
    expect(st.claim(id, 'wf-a')).toBe('claimed');
    expect(st.get(id)?.createdRemote).toBe(false);

    expect(st.claim(id, 'wf-a')).toBe('held');
    expect(st.get(id)?.createdRemote).toBe(false); // no local->remote upgrade any more — the version row carries that fact now
  });

  it("'ALREADY_CLAIMED' never re-stamps either — one workflow must not rewrite another's trigger", async () => {
    const st = mkStore(dir);
    const id = await createLocal(st);
    expect(st.claim(id, 'wf-a')).toBe('claimed');

    expect(st.claim(id, 'wf-b')).toBe('ALREADY_CLAIMED');
    expect(st.get(id)?.createdRemote).toBe(false);
  });
});
