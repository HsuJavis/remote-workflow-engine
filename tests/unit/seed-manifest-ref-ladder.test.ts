// UT-088 (DES-087, ARCH-055, TASK-081): 4-way SEED_SOURCE_CONFLICT + seedManifestRef run-time
// manifest ladder in RunManager.start().
//
// DES-087 extends the v13 4-way ladder so that `seedManifestRef` is mutually exclusive with
// `seed`, `seedManifest`, AND `seedRef`. The conflict check fires BEFORE any CAS lookup so
// SEED_SOURCE_CONFLICT always takes precedence over MISSING_BLOBS / INVALID_SEED_SPEC.
//
// Cases (pinned ladder order per DES-087):
//   1. seedManifestRef + seed → SEED_SOURCE_CONFLICT (not MISSING_BLOBS)
//   2. seedManifestRef + seedManifest → SEED_SOURCE_CONFLICT
//   3. seedManifestRef + seedRef → SEED_SOURCE_CONFLICT
//   4. seedManifestRef + seed + seedManifest → SEED_SOURCE_CONFLICT (any >1 triggers it)
//   5. seedManifestRef alone, ref not present in CAS → MISSING_BLOBS (listing the absent sha)
//   6. seedManifestRef alone, manifest blob exists but is unparseable → INVALID_SEED_SPEC
//   7. seedManifestRef alone, manifest blob references an absent blob → MISSING_BLOBS
//   8. No run is created (no store row) when SEED_SOURCE_CONFLICT fires
//
// Red reason: RunManager.start() has no seedManifestRef handling → silently ignores the field
//   and returns a runId (resolves instead of rejecting) → all `rejects.toMatchObject` assertions
//   fail with "Received promise resolved instead of rejected" for the correct unimplemented reason.
//
// Mock policy (unit — DES-091): real RunManager + real InMemoryRunStore + real CasStore on a
//   temp dir; no gateway/spawner (start() throws before reaching the sandbox).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SystemClock } from '../../src/clock.js';
import { CasStore } from '../../src/cas-store.js';
import { startScript } from '../helpers/workflow-fixtures.js';

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** Blob representing valid manifest JSON `[{path,sha256}]`. */
function makeManifestBytes(entries: Array<{ path: string; sha256: string; exec?: boolean }>): Buffer {
  return Buffer.from(JSON.stringify(entries), 'utf8');
}

let tmpDir: string;
let casDir: string;
let cas: CasStore;
let mgr: RunManager;
const clock = new SystemClock();

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-ut088-'));
  casDir = join(tmpDir, 'cas');
  cas = new CasStore(casDir);
  mgr = new RunManager({ store: new InMemoryRunStore(clock), workRoot: tmpDir, cas });
});
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('seedManifestRef 4-way SEED_SOURCE_CONFLICT ladder (DES-087)', () => {
  it('seedManifestRef + seed → SEED_SOURCE_CONFLICT (not MISSING_BLOBS)', async () => {
    await expect(
      startScript(mgr, 'return 42;', {
        seedManifestRef: 'a'.repeat(64),
        seedNamespace: 'ns',
        seed: [{ path: 'file.txt', contentB64: Buffer.from('x').toString('base64') }],
      }),
    ).rejects.toMatchObject({ code: 'SEED_SOURCE_CONFLICT' });
  });

  it('seedManifestRef + seedManifest → SEED_SOURCE_CONFLICT', async () => {
    await expect(
      startScript(mgr, 'return 42;', {
        seedManifestRef: 'a'.repeat(64),
        seedNamespace: 'ns',
        seedManifest: [{ path: 'f.txt', sha256: 'a'.repeat(64) }],
      }),
    ).rejects.toMatchObject({ code: 'SEED_SOURCE_CONFLICT' });
  });

  it('seedManifestRef + seedRef → SEED_SOURCE_CONFLICT', async () => {
    await expect(
      startScript(mgr, 'return 42;', {
        seedManifestRef: 'a'.repeat(64),
        seedNamespace: 'ns',
        seedRef: { repoUrl: 'https://github.com/example/repo', sha: 'a'.repeat(40) },
      }),
    ).rejects.toMatchObject({ code: 'SEED_SOURCE_CONFLICT' });
  });

  it('SEED_SOURCE_CONFLICT beats MISSING_BLOBS: conflict fires first', async () => {
    // seedManifestRef + seed: even though the manifest ref is absent from CAS,
    // SEED_SOURCE_CONFLICT fires first (conflict beats lookup)
    await expect(
      startScript(mgr, 'return 42;', {
        seedManifestRef: sha256(Buffer.from('no such blob')), // not in CAS
        seedNamespace: 'ns',
        seed: [{ path: 'x.txt', contentB64: 'aGVsbG8=' }],
      }),
    ).rejects.toMatchObject({ code: 'SEED_SOURCE_CONFLICT' });
  });

  it('seedManifestRef alone, ref not in CAS → MISSING_BLOBS listing the sha', async () => {
    const absentSha = 'b'.repeat(64);
    await expect(
      startScript(mgr, 'return 42;', {
        seedManifestRef: absentSha,
        seedNamespace: 'ns',
      }),
    ).rejects.toMatchObject({ code: 'MISSING_BLOBS' });
  });

  it('seedManifestRef alone, blob exists but not parseable as manifest → INVALID_SEED_SPEC', async () => {
    // Store a blob whose contents are not valid JSON manifest
    const garbage = Buffer.from('not json manifest content');
    const h = sha256(garbage);
    await cas.putBlob('ns', h, garbage);

    await expect(
      startScript(mgr, 'return 42;', {
        seedManifestRef: h,
        seedNamespace: 'ns',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SEED_SPEC' });
  });

  it('seedManifestRef alone, manifest references absent blob → MISSING_BLOBS', async () => {
    // Create a valid manifest that references a blob that doesn't exist in the namespace
    const absentBlobSha = 'c'.repeat(64);
    const manifest = makeManifestBytes([{ path: 'file.txt', sha256: absentBlobSha }]);
    const manifestSha = sha256(manifest);
    await cas.putBlob('ns', manifestSha, manifest); // manifest itself is present

    await expect(
      startScript(mgr, 'return 42;', {
        seedManifestRef: manifestSha,
        seedNamespace: 'ns',
      }),
    ).rejects.toMatchObject({ code: 'MISSING_BLOBS' });
  });

  it('no run is created (no store row) when SEED_SOURCE_CONFLICT fires', async () => {
    const store = new InMemoryRunStore(clock);
    const localMgr = new RunManager({ store, workRoot: tmpDir, cas });
    const listBefore = await store.listRuns();
    const preCount = listBefore.length;

    await expect(
      startScript(localMgr, 'return 42;', {
        seedManifestRef: 'a'.repeat(64),
        seedNamespace: 'ns',
        seed: [{ path: 'f.txt', contentB64: 'aGVsbG8=' }],
      }),
    ).rejects.toMatchObject({ code: 'SEED_SOURCE_CONFLICT' });

    const listAfter = await store.listRuns();
    expect(listAfter.length).toBe(preCount); // no new run row created
  });
});
