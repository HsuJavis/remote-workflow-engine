// UT-298 (DES-241, ARCH-170, TASK-239, REQ-216/K2 — the highest-priority item this slice): the
// UNREDACTED TWIN dies. `RunStatusView.seedRef.failDetail` was `rawMessage.slice(0,200)` off the
// SAME raw caught message C-1 already redacts into `runs.error` — one variable, three lines apart,
// one redacted and one not. This file proves the fix with a REAL injected SecretValueProvider (an
// absence-only assertion passes VACUOUSLY when redact() has no secrets configured — see
// 04-design.md's "vacuity trap" — so every case here asserts the marker is PRESENT, not merely
// that the raw value is gone) whose value legitimately appears in a fetch error message (the
// documented scenario: a provisioned `${secret:...}` value embedded in a seedRef.repoUrl echoed
// back by a failed fetch).
//
// Red reason: today `seedRefView.failDetail` is `rawMessage.slice(0, 200)` — no `captureFailure`
// call, no redaction at all on this field. The marker-present assertion fails (raw secret value is
// exactly what appears), and `failCode` regression (case 2) currently already passes but is pinned
// here so a careless envelope substitution during GREEN cannot silently regress it.
//
// Mock policy (unit): real RunManager + real InMemoryRunStore (seedFetcher is the one injected
// fake — no network); a REAL SecretValueProvider (not a mock of the redaction path itself).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { CasStore } from '../../src/cas-store.js';
import { MARKER_PREFIX } from '../../src/secret-resolver.js';
import { startScript } from '../helpers/workflow-fixtures.js';

const ALLOWLISTED_URL = 'https://github.com/HsuJavis/remote-workflow-plugin';
const ALLOWLIST = ['https://github.com/HsuJavis/'];
const PINNED_SHA = '60ee8954e19fe5eaf2cf498202475c3c6fc9b8a4';
const SECRET_VALUE = 'sekrit-repo-credential-abcdef123456';

async function pollStatus(mgr: RunManager, runId: string, ms = 25, maxIter = 120): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

let tmpDir: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'rwe-ut298-seedref-redact-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('UT-298: seedRef.failDetail is redacted THEN bounded to 200 bytes (K2)', () => {
  it('a real SecretValueProvider redacts the secret out of failDetail — marker PRESENT, raw value absent', async () => {
    const fakeFetcher = {
      async fetch() {
        throw Object.assign(new Error(`fetch failed against ${ALLOWLISTED_URL} using token ${SECRET_VALUE} — connection refused`), { code: 'SEEDREF_FETCH_FAILED' });
      },
    };
    const cas = new CasStore(join(tmpDir, 'cas'));
    const mgr = new RunManager({
      workRoot: tmpDir,
      cas,
      seedFetcher: fakeFetcher,
      seedRefAllowlist: ALLOWLIST,
      secretValueProvider: { entries: () => [{ name: 'REPO_TOKEN', value: SECRET_VALUE }] },
    } as any);

    const runId = await startScript(mgr, `return 'seeded';`, {
      seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      seedNamespace: '_test',
    } as any);

    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    const failDetail = (view as any).seedRef?.failDetail as string;
    expect(failDetail).toContain(`${MARKER_PREFIX}REPO_TOKEN›`);
    expect(failDetail).not.toContain(SECRET_VALUE);
  });

  it('the 200-byte bound actually cuts on a long redacted message', async () => {
    const longTail = 'z'.repeat(500);
    const fakeFetcher = {
      async fetch() {
        throw Object.assign(new Error(`fetch failed, token ${SECRET_VALUE}, ${longTail}`), { code: 'SEEDREF_FETCH_FAILED' });
      },
    };
    const cas = new CasStore(join(tmpDir, 'cas'));
    const mgr = new RunManager({
      workRoot: tmpDir,
      cas,
      seedFetcher: fakeFetcher,
      seedRefAllowlist: ALLOWLIST,
      secretValueProvider: { entries: () => [{ name: 'REPO_TOKEN', value: SECRET_VALUE }] },
    } as any);
    const runId = await startScript(mgr, `return 'seeded';`, {
      seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      seedNamespace: '_test',
    } as any);
    const view = await pollStatus(mgr, runId);
    const failDetail = (view as any).seedRef?.failDetail as string;
    // bounded to 200 bytes plus at most the marker-completion extension — strictly less than the
    // unbounded raw message (500+ bytes), proving the cut actually fired.
    expect(Buffer.byteLength(failDetail, 'utf8')).toBeLessThan(300);
    expect(failDetail.length).toBeLessThan(longTail.length);
  });

  it('failCode keeps its three-value domain: a TypeError off the fetch path still yields SEEDREF_FETCH_FAILED, never "TypeError"', async () => {
    const fakeFetcher = {
      async fetch() {
        throw new TypeError('some unrelated coding error, not a fetch code');
      },
    };
    const cas = new CasStore(join(tmpDir, 'cas'));
    const mgr = new RunManager({
      workRoot: tmpDir,
      cas,
      seedFetcher: fakeFetcher,
      seedRefAllowlist: ALLOWLIST,
      secretValueProvider: { entries: () => [{ name: 'REPO_TOKEN', value: SECRET_VALUE }] },
    } as any);
    const runId = await startScript(mgr, `return 'seeded';`, {
      seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      seedNamespace: '_test',
    } as any);
    const view = await pollStatus(mgr, runId);
    expect((view as any).seedRef?.failCode).toBe('SEEDREF_FETCH_FAILED');
  });
});
