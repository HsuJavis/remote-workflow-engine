// UT-335 (v37, DES-263 amendment 2026-09-24, ADR-086's second owner ruling):
// trigger provenance must reflect THE REGISTRATION THAT CURRENTLY OWNS the trigger,
// not whoever first created the row.
//
// The defect this pins: `createdRemote` was stamped once at creation and never revisited, so
// (a) every pre-existing row read as local — the control had zero coverage on the live population;
// (b) a remote actor could `workflow_register` + `workflow_publish` onto a workflow name that
// ALREADY owned a trigger, and the next cron tick started that remote script with nobody pressing
// anything. Outcome `'held'` IS path (b), so re-stamping only `'claimed'` does not close it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import type { Clock } from '../../src/clock.js';

const ANCHOR = new Date('2026-09-24T00:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };
const fakeCatalog = () => ({ async resolve() { return { script: '', version: 'v1' }; } });
const fakeRunManager = () => ({ async start() { return 'run-1'; } });

describe('claim() re-stamps trigger provenance (UT-335, DES-263 amendment)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-restamp-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const mk = () => new SqliteSchedulerPort({
    clock: CLOCK, catalog: fakeCatalog() as never, runManager: fakeRunManager() as never,
    dbPath: join(dir, 's.db'),
  });

  it('[LOAD-BEARING] created locally, then claimed by a REMOTE registration → reads remote', async () => {
    const st = mk();
    const made = await st.create({ kind: 'cron', cron: '* * * * *', enabled: true, createdBy: 'op@example.com', createdRemote: false } as never);
    const id = (made as { result?: { id: string } }).result!.id;
    expect(st.get(id)?.createdRemote).toBe(false);

    expect(st.claim(id, 'wf-a', true)).toBe('claimed');
    expect(st.get(id)?.createdRemote).toBe(true);
  });

  it("[LOAD-BEARING] 'held' re-stamps too — that outcome IS the re-registration path", async () => {
    const st = mk();
    const made = await st.create({ kind: 'cron', cron: '* * * * *', enabled: true, createdBy: 'op@example.com', createdRemote: false } as never);
    const id = (made as { result?: { id: string } }).result!.id;
    expect(st.claim(id, 'wf-a', false)).toBe('claimed');
    expect(st.get(id)?.createdRemote).toBe(false);

    expect(st.claim(id, 'wf-a', true)).toBe('held');
    expect(st.get(id)?.createdRemote).toBe(true);
  });

  it("'ALREADY_CLAIMED' never re-stamps — one workflow must not rewrite another's trigger", async () => {
    const st = mk();
    const made = await st.create({ kind: 'cron', cron: '* * * * *', enabled: true, createdBy: 'op@example.com', createdRemote: false } as never);
    const id = (made as { result?: { id: string } }).result!.id;
    expect(st.claim(id, 'wf-a', false)).toBe('claimed');

    expect(st.claim(id, 'wf-b', true)).toBe('ALREADY_CLAIMED');
    expect(st.get(id)?.createdRemote).toBe(false);
  });
});
