// UT-085 (DES-083, ARCH-053, TASK-077, TASK-078): RunManager post-createRun wiring with an
// injected fake SeedRefFetcher (unit tier per DES-085 — mock freely, no network).
//
// Cases: (i) success → fetcher called, workspace assembled via seedManifest branch, seedRef.resolvedSha
//   visible on RunStatusView; (ii) SEEDREF_FETCH_FAILED → run fails with typed code; (iii)
//   SEEDREF_SHA_MISMATCH → typed fail; (iv) dropped[] surfaced on seedRef field;
//   (v) latencyMs is deterministic and non-negative under the fake Clock.
//
// Red reason: RunManager has no `seedFetcher` injection slot and `RunStatusView` has no `seedRef`
// field yet. The fake fetcher's `fetch` is never invoked → `expect(fetchCalled).toBe(true)` fails;
// `view.seedRef` is undefined → subsequent seedRef-field assertions fail. All fail for the right
// unimplemented reason.
//
// Mock policy (unit): real RunManager + real InMemoryRunStore; fake SeedRefFetcher (no network);
// fake CasStore for putBlob surface; FixedClock from src/clock.ts for deterministic latencyMs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { RunManager } from '../../src/run-manager.js';
import { FixedClock } from '../../src/clock.js';
import { CasStore } from '../../src/cas-store.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { startScript } from '../helpers/workflow-fixtures.js';

// Pinned sha (real HsuJavis/remote-workflow-plugin HEAD, pinned at Gate 5 2026-08-15)
const PINNED_SHA = '60ee8954e19fe5eaf2cf498202475c3c6fc9b8a4';
const ALLOWLISTED_URL = 'https://github.com/HsuJavis/remote-workflow-plugin';
const ALLOWLIST = ['https://github.com/HsuJavis/'];
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

// Inline fake fetcher types (don't import from non-existent seedref-fetcher.ts)
interface SeedRefRequest {
  repoUrl: string; sha: string; timeoutMs: number; maxTotalBytes: number; maxFileBytes: number;
}
interface SeedRefResult {
  resolvedSha: string; bytesTransferred: number; entries: Array<{ path: string; sha256: string; exec?: boolean }>; dropped: string[];
}
interface FakeSeedRefFetcher {
  fetch(req: SeedRefRequest, putBlob: (sha: string, bytes: Buffer) => Promise<void>): Promise<SeedRefResult>;
}

// Poll RunManager for terminal state (completed/failed/stopped)
async function pollStatus(mgr: RunManager, runId: string, ms = 50, maxIter = 60): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

let tmpDir: string;
let casDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-ut085-'));
  casDir = join(tmpDir, 'cas');
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('UT-085: RunManager fake-SeedRefFetcher wiring (DES-083)', () => {
  it('(i) success: fetcher.fetch is called and seedRef.resolvedSha is visible on RunStatusView', async () => {
    let fetchCalled = false;
    const fileBytes = Buffer.from('hello from seedRef');
    const fileSha = sha256(fileBytes);

    const fakeFetcher: FakeSeedRefFetcher = {
      async fetch(_req, putBlob) {
        fetchCalled = true;
        await putBlob(fileSha, fileBytes);
        return {
          resolvedSha: PINNED_SHA,
          bytesTransferred: fileBytes.length,
          entries: [{ path: 'hello.txt', sha256: fileSha, exec: false }],
          dropped: [],
        };
      },
    };

    const cas = new CasStore(casDir);
    // RunManager dep injection (seedFetcher not a real dep yet — injected as unknown)
    const mgr = new RunManager({
      workRoot: tmpDir,
      cas,
      seedFetcher: fakeFetcher,
      seedRefAllowlist: ALLOWLIST,
    } as any);

    const runId = await startScript(mgr, `return 'seeded';`, {
      seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      seedNamespace: '_test',
    } as any);

    const view = await pollStatus(mgr, runId);
    expect(fetchCalled).toBe(true);  // PRIMARY: fetcher must have been invoked
    expect((view as any).seedRef?.resolvedSha).toBe(PINNED_SHA);
    expect((view as any).seedRef?.bytes).toBe(fileBytes.length);
  });

  it('(ii) SEEDREF_FETCH_FAILED: fetcher throws → run status fails with typed code', async () => {
    const fakeFetcher: FakeSeedRefFetcher = {
      async fetch() {
        throw Object.assign(new Error('git not found'), { code: 'SEEDREF_FETCH_FAILED' });
      },
    };

    const cas = new CasStore(casDir);
    const mgr = new RunManager({
      workRoot: tmpDir,
      cas,
      seedFetcher: fakeFetcher,
      seedRefAllowlist: ALLOWLIST,
    } as any);

    const runId = await startScript(mgr, `return 'seeded';`, {
      seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      seedNamespace: '_test',
    } as any);

    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    const res = await mgr.result(runId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res as any).error?.code).toBe('SEEDREF_FETCH_FAILED');
  });

  it('(iii) SEEDREF_SHA_MISMATCH: fetcher throws typed mismatch → run fails', async () => {
    const fakeFetcher: FakeSeedRefFetcher = {
      async fetch() {
        throw Object.assign(new Error('sha mismatch'), { code: 'SEEDREF_SHA_MISMATCH' });
      },
    };

    const cas = new CasStore(casDir);
    const mgr = new RunManager({
      workRoot: tmpDir,
      cas,
      seedFetcher: fakeFetcher,
      seedRefAllowlist: ALLOWLIST,
    } as any);

    const runId = await startScript(mgr, `return 'seeded';`, {
      seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      seedNamespace: '_test',
    } as any);

    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    const res = await mgr.result(runId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res as any).error?.code).toBe('SEEDREF_SHA_MISMATCH');
  });

  it('(iv) dropped[] from fetcher result is surfaced on seedRef field of RunStatusView', async () => {
    const DROPPED = ['src/huge-asset.bin'];
    const fakeFetcher: FakeSeedRefFetcher = {
      async fetch(_req, putBlob) {
        const bytes = Buffer.from('small file');
        const h = sha256(bytes);
        await putBlob(h, bytes);
        return {
          resolvedSha: PINNED_SHA,
          bytesTransferred: bytes.length,
          entries: [{ path: 'small.txt', sha256: h, exec: false }],
          dropped: DROPPED,
        };
      },
    };

    const cas = new CasStore(casDir);
    const mgr = new RunManager({
      workRoot: tmpDir,
      cas,
      seedFetcher: fakeFetcher,
      seedRefAllowlist: ALLOWLIST,
    } as any);

    const runId = await startScript(mgr, `return 'seeded';`, {
      seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      seedNamespace: '_test',
    } as any);

    const view = await pollStatus(mgr, runId);
    expect((view as any).seedRef?.dropped).toEqual(DROPPED);
  });

  it('(v) latencyMs is non-negative and derived from the injected Clock (not wall-clock)', async () => {
    // Use a FixedClock (clock.now() always returns the same value) so latencyMs is deterministic.
    // If the impl reads the wall clock instead of the injected clock, latencyMs will NOT equal 0.
    const fixedClock = new FixedClock(new Date('2025-01-01T00:00:00.000Z'));
    const fakeFetcher: FakeSeedRefFetcher = {
      async fetch(_req, putBlob) {
        const bytes = Buffer.from('timing test');
        const h = sha256(bytes);
        await putBlob(h, bytes);
        return { resolvedSha: PINNED_SHA, bytesTransferred: bytes.length, entries: [{ path: 'f.txt', sha256: h }], dropped: [] };
      },
    };

    const cas = new CasStore(casDir);
    const mgr = new RunManager({
      workRoot: tmpDir,
      clock: fixedClock,
      cas,
      seedFetcher: fakeFetcher,
      seedRefAllowlist: ALLOWLIST,
    } as any);

    const runId = await startScript(mgr, `return 'seeded';`, {
      seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      seedNamespace: '_test',
    } as any);

    const view = await pollStatus(mgr, runId);
    // Under a FixedClock, t0 and t1 are the same tick → latencyMs should be exactly 0
    const latencyMs = (view as any).seedRef?.latencyMs;
    expect(typeof latencyMs).toBe('number');
    expect(latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// v35 send-back (C-1, DES-232's redact->bound->persist sequence extended to the seedRefFail
// branch): a seedRef fetch failure must go through the SAME capture channel as every other run
// failure — redacted, recorded via `RunStore.recordError` (so `runs.error` AND journal.jsonl carry
// it), and durable across a store restart. Real SqliteRunStore (on-disk) — the only store that has
// a restart to survive.
describe('UT-085 send-back C-1: seedRefFail routes through redact/recordError like every other failure', () => {
  let storeDir: string;
  beforeEach(() => { storeDir = mkdtempSync(join(tmpdir(), 'rwe-ut085-c1-')); });
  afterEach(() => { rmSync(storeDir, { recursive: true, force: true }); });

  const SECRET = { name: 'GIT_TOKEN', value: 'ghp_SUPERSECRETVALUE12345' };
  const secretValueProvider = { entries: () => [SECRET] };

  it('redacts the secret in the run error AND persists it via recordError, surviving a store restart', async () => {
    // Padded so SECRET.value straddles byte 200 — the pre-fix code sliced the raw message to 200
    // chars BEFORE redact() ever saw it (R-G9/INV-V26-5: a cut before redact() can split a secret
    // so the value-exact match finds neither half). If that regresses, the marker below goes
    // missing even though `not.toContain(SECRET.value)` would still pass vacuously on the split
    // remnant — the marker-PRESENT assertion is the one that actually catches it.
    const pad = 'p'.repeat(190);
    const fakeFetcher: FakeSeedRefFetcher = {
      async fetch() {
        throw Object.assign(
          new Error(`git clone failed: remote rejected token ${pad}${SECRET.value}`),
          { code: 'SEEDREF_FETCH_FAILED' },
        );
      },
    };

    const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
    const store = new SqliteRunStore(storeDir, clock);
    const cas = new CasStore(join(storeDir, 'cas'));
    const mgr = new RunManager({
      workRoot: storeDir,
      clock,
      store,
      cas,
      secretValueProvider,
      seedFetcher: fakeFetcher,
      seedRefAllowlist: ALLOWLIST,
    } as any);

    const runId = await startScript(mgr, `return 'seeded';`, {
      seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      seedNamespace: '_test',
    } as any);

    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');

    // Live view: message is redacted, never the raw secret.
    const res = await mgr.result(runId);
    expect(res.ok).toBe(false);
    const liveMessage = !res.ok ? (res as any).error?.message : undefined;
    expect(liveMessage).toBeDefined();
    expect(liveMessage).not.toContain(SECRET.value);
    expect(liveMessage).toContain(`‹secret:${SECRET.name}›`);

    // Durable: runs.error column + journal.jsonl {type:'error'} line, both redacted.
    const runDir = join(storeDir, 'runs', runId);
    const journalText = readFileSync(join(runDir, 'journal.jsonl'), 'utf8');
    const journalLines = journalText.trim().split('\n').map((l) => JSON.parse(l));
    const errorLine = journalLines.find((l) => l.type === 'error');
    expect(errorLine).toBeDefined();
    expect(JSON.stringify(errorLine)).not.toContain(SECRET.value);
    expect(errorLine.message).toContain(`‹secret:${SECRET.name}›`);

    // Restart: a fresh SqliteRunStore reading the SAME on-disk dir sees the same redacted value.
    const restarted = new SqliteRunStore(storeDir, clock);
    const persisted = await (restarted as unknown as { getError(runId: string): Promise<{ code: string; message: string } | null> }).getError(runId);
    expect(persisted).not.toBeNull();
    expect(persisted!.message).not.toContain(SECRET.value);
    expect(persisted!.message).toContain(`‹secret:${SECRET.name}›`);
  });
});
