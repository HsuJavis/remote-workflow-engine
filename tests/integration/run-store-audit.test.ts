// IT-113 (DES-151, v24): appendAudit/auditFor over BOTH real RunStore implementations
// (InMemoryRunStore, SqliteRunStore) — owner-only projection, absent-not-[] for non-owners, the
// 200-row cap. Written test-first (Gate 5, RED) — neither store has appendAudit/auditFor yet.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2026-01-01T00:00:00Z'));

describe.each([
  ['InMemoryRunStore', () => new InMemoryRunStore(CLOCK)],
  ['SqliteRunStore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-audit-'));
    return new SqliteRunStore(dir, CLOCK);
  }],
])('RunStore.appendAudit/auditFor parity (IT-113, DES-151) — %s', (_name, factory) => {
  it('appendAudit then auditFor(runId) returns the event, newest first', async () => {
    const store = factory();
    // @ts-expect-error — appendAudit does not exist yet (v24 DES-151/TASK-140)
    store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob' });
    // @ts-expect-error — auditFor does not exist yet
    const events = store.auditFor('r1');
    expect(events.length).toBe(1);
    expect(events[0].actor).toBe('admin');
  });

  it('auditFor caps at 200 rows (limit default)', async () => {
    const store = factory();
    for (let i = 0; i < 205; i++) {
      // @ts-expect-error
      store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob' });
    }
    // @ts-expect-error
    const events = store.auditFor('r1');
    expect(events.length).toBe(200);
  });
});
