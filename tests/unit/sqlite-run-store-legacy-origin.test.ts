// UT-331 (DES-263, ARCH-182, TASK-258, REQ-218) — SqliteRunStore.getSpec() synthesizes
// `origin:'local'` on EVERY read-back: the `runs` table never gained an `origin` column at all (the
// admission predicate needs the fact only transiently, at RunManager.start(); a resume is gated by
// DES-262's isLoopbackPeer door, not by admissionRefusal — ARCH-182's own note). RunSpec doubles as
// the persisted-spec read-back type, so this is the ONE place a rehydrated spec's `origin` is filled.
// Written test-first (RED): getSpec()'s return object literal has no `origin` field, and RunSpec.origin
// is REQUIRED — this file fails to type-check today (`tsc --noEmit`), not just fails at runtime.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';

describe('UT-331 SqliteRunStore.getSpec() always reads back origin:local (DES-263)', () => {
  it('[LOAD-BEARING] a run admitted with origin:"remote" still reads back origin:"local" on getSpec()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-store-origin-'));
    try {
      const store = new SqliteRunStore(dir, new FixedClock(new Date('2024-01-01T00:00:00.000Z')));
      const runId = await store.createRun({ name: 'wf', origin: 'remote' });
      const spec = await store.getSpec(runId);
      expect(spec?.origin).toBe('local');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a run admitted with origin:"local" also reads back origin:"local" (not merely echoed — synthesized)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-store-origin-'));
    try {
      const store = new SqliteRunStore(dir, new FixedClock(new Date('2024-01-01T00:00:00.000Z')));
      const runId = await store.createRun({ name: 'wf', origin: 'local' });
      const spec = await store.getSpec(runId);
      expect(spec?.origin).toBe('local');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
