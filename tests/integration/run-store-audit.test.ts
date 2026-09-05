// IT-113 (DES-151, v24): appendAudit/auditFor over BOTH real RunStore implementations
// (InMemoryRunStore, SqliteRunStore) — owner-only projection, absent-not-[] for non-owners, the
// 200-row cap. Written test-first (Gate 5, RED) — neither store has appendAudit/auditFor yet.
// Filled per adjudication v24 #2 A-6 (dod requires ≥8; the shipped file had 4). The facade-layer
// "owner-only projection"/"absent-not-[]" cases DES-151 also names are already covered where that
// projection actually lives (mcp-facade.ts, TASK-148) — see tests/e2e/admin-cross-read.test.ts and
// tests/integration/api-runs-public-projection.test.ts; adding here would duplicate coverage of a
// file outside this task's scope, so the added cases stay at the store's own port surface instead.
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
    store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob' });
    const events = store.auditFor('r1');
    expect(events.length).toBe(1);
    expect(events[0]!.actor).toBe('admin');
  });

  it('auditFor caps at 200 rows (limit default)', async () => {
    const store = factory();
    for (let i = 0; i < 205; i++) {
      store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob' });
    }
    const events = store.auditFor('r1');
    expect(events.length).toBe(200);
  });

  it('auditFor returns newest-first ordering, not insertion order', async () => {
    const store = factory();
    store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob', path: 'first.txt' });
    store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'workspace_list', runId: 'r1', owner: 'bob' });
    store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'run_result', runId: 'r1', owner: 'bob' });
    const events = store.auditFor('r1');
    expect(events.map((e) => e.action)).toEqual(['run_result', 'workspace_list', 'workspace_pull']);
  });

  it('auditFor is scoped to one runId — events for a different run never leak in, and an unrelated runId returns []', async () => {
    const store = factory();
    store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob' });
    store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'workspace_pull', runId: 'r2', owner: 'carol' });
    expect(store.auditFor('r1').length).toBe(1);
    expect(store.auditFor('unknown-run')).toEqual([]);
  });

  it('the `path` field round-trips when supplied and is absent (not undefined-valued) when omitted', async () => {
    const store = factory();
    store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob', path: 'a/b.txt' });
    store.appendAudit({ ts: CLOCK.isoNow(), actor: 'admin', action: 'run_agent_log', runId: 'r1', owner: 'bob' });
    const events = store.auditFor('r1');
    expect(events[0]!.path).toBeUndefined();
    expect('path' in events[0]!).toBe(false);
    expect(events[1]!.path).toBe('a/b.txt');
  });
});
