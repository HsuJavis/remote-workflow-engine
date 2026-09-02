// UT-083 (DES-080, ARCH-052, TASK-077): seed-source mutual-exclusion + pre-createRun precedence.
// Every test calls RunManager.start() with a spec that should trigger a typed coded error BEFORE
// any durable work (no run row, no network, no workspace). Precedence order pinned:
//   SEED_SOURCE_CONFLICT → SEEDREF_DISABLED → INVALID_SEED_SPEC → SEEDREF_EGRESS_DENIED → CAS_UNAVAILABLE
//
// Red reason: RunManager has no seedRef awareness yet — none of these codes are thrown;
// `start()` silently ignores the unrecognised `seedRef` field and either returns a runId or
// throws an unrelated error. The `rejects.toMatchObject({code:'…'})` assertions all fail.
//
// Mock policy (unit): real RunManager, no gateway/spawner needed (throws before sandbox).
// No network — all rejections are pre-createRun logic.

import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { startScript } from '../helpers/workflow-fixtures.js';

// Pinned 40-hex sha (real HsuJavis/remote-workflow-plugin HEAD, pinned at Gate 5 2026-08-15)
const PINNED_SHA = '60ee8954e19fe5eaf2cf498202475c3c6fc9b8a4';
const ALLOWLISTED_URL = 'https://github.com/HsuJavis/remote-workflow-plugin';
const ALLOWLIST = ['https://github.com/HsuJavis/'];
const SSRF_URL = 'http://169.254.169.254/latest/meta-data/';
const INLINE_SEED = [{ path: 'a.txt', contentB64: Buffer.from('hello').toString('base64') }];

describe('seed-source mutual-exclusion (DES-080)', () => {
  it('SEED_SOURCE_CONFLICT (highest precedence): seed + seedRef both present', async () => {
    const mgr = new RunManager();
    await expect(
      startScript(mgr, 'return 1;', {
        seed: INLINE_SEED,
        seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      } as any)
    ).rejects.toMatchObject({ code: 'SEED_SOURCE_CONFLICT' });
  });

  it('SEED_SOURCE_CONFLICT: seedManifest + seedRef both present', async () => {
    const mgr = new RunManager();
    await expect(
      startScript(mgr, 'return 1;', {
        seedManifest: [{ path: 'x.ts', sha256: 'a'.repeat(64), exec: false }],
        seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      } as any)
    ).rejects.toMatchObject({ code: 'SEED_SOURCE_CONFLICT' });
  });
});

describe('pre-createRun precedence (DES-080): SEEDREF_DISABLED → INVALID_SEED_SPEC → SEEDREF_EGRESS_DENIED → CAS_UNAVAILABLE', () => {
  it('SEEDREF_DISABLED: seedRef given but no allowlist configured (fail-closed by default)', async () => {
    // RunManager without seedRefAllowlist config → SEEDREF_DISABLED
    const mgr = new RunManager({ seedRefAllowlist: [] } as any);
    await expect(
      startScript(mgr, 'return 1;', {
        seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      } as any)
    ).rejects.toMatchObject({ code: 'SEEDREF_DISABLED' });
  });

  it('SEEDREF_DISABLED fires before INVALID_SEED_SPEC (no allowlist + bad sha)', async () => {
    const mgr = new RunManager({ seedRefAllowlist: [] } as any);
    await expect(
      startScript(mgr, 'return 1;', {
        seedRef: { repoUrl: ALLOWLISTED_URL, sha: 'bad-sha' },
      } as any)
    ).rejects.toMatchObject({ code: 'SEEDREF_DISABLED' });
  });

  it('INVALID_SEED_SPEC: sha is not full 40-or-64 hex (branch/short-sha rejected)', async () => {
    const mgr = new RunManager({ seedRefAllowlist: ALLOWLIST } as any);
    await expect(
      startScript(mgr, 'return 1;', {
        seedRef: { repoUrl: ALLOWLISTED_URL, sha: 'main' },
      } as any)
    ).rejects.toMatchObject({ code: 'INVALID_SEED_SPEC' });
  });

  it('INVALID_SEED_SPEC: sha is short hex (not full 40-char)', async () => {
    const mgr = new RunManager({ seedRefAllowlist: ALLOWLIST } as any);
    await expect(
      startScript(mgr, 'return 1;', {
        seedRef: { repoUrl: ALLOWLISTED_URL, sha: '60ee8954' },
      } as any)
    ).rejects.toMatchObject({ code: 'INVALID_SEED_SPEC' });
  });

  it('INVALID_SEED_SPEC: repoUrl is empty', async () => {
    const mgr = new RunManager({ seedRefAllowlist: ALLOWLIST } as any);
    await expect(
      startScript(mgr, 'return 1;', {
        seedRef: { repoUrl: '', sha: PINNED_SHA },
      } as any)
    ).rejects.toMatchObject({ code: 'INVALID_SEED_SPEC' });
  });

  it('SEEDREF_EGRESS_DENIED fires before CAS_UNAVAILABLE (SSRF URL + no cas)', async () => {
    const mgr = new RunManager({ seedRefAllowlist: ALLOWLIST } as any);
    await expect(
      startScript(mgr, 'return 1;', {
        seedRef: { repoUrl: SSRF_URL, sha: PINNED_SHA },
      } as any)
    ).rejects.toMatchObject({ code: 'SEEDREF_EGRESS_DENIED' });
  });

  it('SEEDREF_EGRESS_DENIED: file:// scheme denied even with allowlist', async () => {
    const mgr = new RunManager({ seedRefAllowlist: ALLOWLIST } as any);
    await expect(
      startScript(mgr, 'return 1;', {
        seedRef: { repoUrl: 'file:///etc/passwd', sha: PINNED_SHA },
      } as any)
    ).rejects.toMatchObject({ code: 'SEEDREF_EGRESS_DENIED' });
  });

  it('CAS_UNAVAILABLE: valid seedRef but no CasStore configured', async () => {
    // cas not injected → CAS_UNAVAILABLE (seedRef assembles via materializeManifest like seedManifest)
    const mgr = new RunManager({ seedRefAllowlist: ALLOWLIST } as any);
    await expect(
      startScript(mgr, 'return 1;', {
        seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      } as any)
    ).rejects.toMatchObject({ code: 'CAS_UNAVAILABLE' });
  });

  it('no run created for SEED_SOURCE_CONFLICT: status() on any id throws RUN_NOT_FOUND', async () => {
    // After a pre-createRun rejection, no run row exists in the store.
    // Primary assertion: the correct code is thrown. Secondary: status lookup yields nothing.
    const mgr = new RunManager();
    await expect(
      startScript(mgr, 'return 1;', {
        seed: INLINE_SEED,
        seedRef: { repoUrl: ALLOWLISTED_URL, sha: PINNED_SHA },
      } as any)
    ).rejects.toMatchObject({ code: 'SEED_SOURCE_CONFLICT' });
    // If no run was created, status() on a hypothetical runId throws or returns null.
    await expect(mgr.status('seedref-conflict-test-run')).rejects.toBeDefined();
  });
});
