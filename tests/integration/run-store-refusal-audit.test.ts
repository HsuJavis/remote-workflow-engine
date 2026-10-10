// Issue #116 (OWNER DECISION b): appendRefusal/queryRefusals over BOTH real RunStore
// implementations (InMemoryRunStore, SqliteRunStore) — same parity convention as
// tests/integration/run-store-audit.test.ts (DES-151's appendAudit/auditFor). Written test-first
// (RED): neither store has appendRefusal/queryRefusals yet at the time this file is first run.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RefusalAuditEvent } from '../../src/types.js';

const CLOCK = new FixedClock(new Date('2026-01-01T00:00:00Z'));

const row = (over: Partial<RefusalAuditEvent> = {}): RefusalAuditEvent => ({
  ts: CLOCK.isoNow(), requestId: 'req-1', actor: 'bob@example.com', tool: 'run_status',
  targetKind: 'run', targetId: 'r1', realReason: 'NOT_RUN_OWNER', returnedCode: 'RUN_NOT_FOUND',
  ...over,
});

describe.each([
  ['InMemoryRunStore', () => new InMemoryRunStore(CLOCK)],
  ['SqliteRunStore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-refusal-audit-'));
    return new SqliteRunStore(dir, CLOCK);
  }],
])('RunStore.appendRefusal/queryRefusals parity (issue #116) — %s', (_name, factory) => {
  it('appendRefusal then queryRefusals() returns the row with every field intact', () => {
    const store = factory();
    store.appendRefusal(row({ authMethod: 'service-account' }));
    const rows = store.queryRefusals();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      requestId: 'req-1', actor: 'bob@example.com', authMethod: 'service-account', tool: 'run_status',
      targetKind: 'run', targetId: 'r1', realReason: 'NOT_RUN_OWNER', returnedCode: 'RUN_NOT_FOUND',
    });
  });

  it('a null actor (auth-disabled/loopback-exempt) round-trips as null, and authMethod is absent (not null) when not supplied', () => {
    const store = factory();
    store.appendRefusal(row({ actor: null }));
    const rows = store.queryRefusals();
    expect(rows[0]!.actor).toBeNull();
    expect('authMethod' in rows[0]!).toBe(false);
  });

  it('queryRefusals() is newest-first, not insertion order', () => {
    const store = factory();
    store.appendRefusal(row({ requestId: 'req-1' }));
    store.appendRefusal(row({ requestId: 'req-2' }));
    store.appendRefusal(row({ requestId: 'req-3' }));
    const rows = store.queryRefusals();
    expect(rows.map((r) => r.requestId)).toEqual(['req-3', 'req-2', 'req-1']);
  });

  it('filters by actor and by tool (exact match), independently', () => {
    const store = factory();
    store.appendRefusal(row({ requestId: 'a1', actor: 'alice@x.com', tool: 'run_status' }));
    store.appendRefusal(row({ requestId: 'a2', actor: 'bob@x.com', tool: 'run_status' }));
    store.appendRefusal(row({ requestId: 'a3', actor: 'alice@x.com', tool: 'workflow_publish' }));
    expect(store.queryRefusals({ actor: 'alice@x.com' }).map((r) => r.requestId).sort()).toEqual(['a1', 'a3']);
    expect(store.queryRefusals({ tool: 'run_status' }).map((r) => r.requestId).sort()).toEqual(['a1', 'a2']);
    expect(store.queryRefusals({ actor: 'alice@x.com', tool: 'workflow_publish' }).map((r) => r.requestId)).toEqual(['a3']);
  });

  it('filters by since (inclusive) and caps at the supplied limit', () => {
    const store = factory();
    store.appendRefusal(row({ requestId: 'old', ts: '2025-01-01T00:00:00.000Z' }));
    store.appendRefusal(row({ requestId: 'new', ts: '2026-06-01T00:00:00.000Z' }));
    expect(store.queryRefusals({ since: '2026-01-01T00:00:00.000Z' }).map((r) => r.requestId)).toEqual(['new']);
    for (let i = 0; i < 5; i++) store.appendRefusal(row({ requestId: `extra-${i}` }));
    expect(store.queryRefusals({ limit: 3 }).length).toBe(3);
  });

  it('an unrelated actor/tool returns [] (never throws)', () => {
    const store = factory();
    store.appendRefusal(row());
    expect(store.queryRefusals({ actor: 'nobody@x.com' })).toEqual([]);
    expect(store.queryRefusals({ tool: 'no_such_tool' })).toEqual([]);
  });
});
