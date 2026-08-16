// UT-091 (DES-090, ARCH-058, TASK-084): pure `assertScriptIntegrity` + SCRIPT_SHA_MISMATCH ladder.
// DES-090: `assertScriptIntegrity(script: string, sha?: string): void`
//   - sha present and sha256(Buffer.from(script,'utf8')) !== sha → throw SCRIPT_SHA_MISMATCH
//   - sha absent → no-op
//   - sha is 64-char lowercase hex (format validated; uppercase/short hex → reject)
//   Ladder rung: BEFORE admission counter — pure request-shape check.
//
// Cases for the pure function:
//   1. Matching sha → no throw
//   2. One-byte-altered script → SCRIPT_SHA_MISMATCH
//   3. Absent sha (undefined) → no-op, never throws
//   4. Uppercase hex sha → SCRIPT_SHA_MISMATCH (REJECT not normalize — format check)
//   5. 63-char hex sha → SCRIPT_SHA_MISMATCH (wrong length)
//   6. sha computed over UTF-8 bytes (not ascii, not latin1) — emoji script matches correctly
//
// Ladder-level case (via RunManager.start):
//   7. scriptSha256 supplied with a named run (no inline `script`) → SCRIPT_SHA_WITHOUT_SCRIPT
//   8. scriptSha256 fires BEFORE admission counter: no run created, no store row
//
// Red reason: `assertScriptIntegrity` is not exported from `run-manager.ts` (and not yet
//   implemented) → "does not provide an export named 'assertScriptIntegrity'" at import time →
//   all tests fail at collect time for the correct unimplemented reason.
//   RunManager.start() with scriptSha256 → silently ignored → no SCRIPT_SHA_MISMATCH → fails.
//
// Mock policy (unit — DES-091): pure function + real RunManager (no gateway/spawner; ladder
//   fires before sandbox). No clock seam needed (pure SHA check).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertScriptIntegrity } from '../../src/run-manager.js';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SystemClock } from '../../src/clock.js';

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

describe('assertScriptIntegrity — pure function (DES-090)', () => {
  it('matching sha → does not throw', () => {
    const script = 'return 42;';
    expect(() => assertScriptIntegrity(script, sha256(script))).not.toThrow();
  });

  it('one-byte-altered script → SCRIPT_SHA_MISMATCH', () => {
    const script = 'return 42;';
    const sha = sha256(script);
    const altered = script + ' '; // one extra space changes the hash
    expect(() => assertScriptIntegrity(altered, sha)).toThrow(
      expect.objectContaining({ code: 'SCRIPT_SHA_MISMATCH' }),
    );
  });

  it('absent sha (undefined) → no-op, never throws', () => {
    expect(() => assertScriptIntegrity('return 99;', undefined)).not.toThrow();
  });

  it('absent sha (not passed) → no-op', () => {
    expect(() => assertScriptIntegrity('return 99;')).not.toThrow();
  });

  it('uppercase hex sha → SCRIPT_SHA_MISMATCH (REJECT not normalize)', () => {
    const script = 'return 1;';
    const lower = sha256(script);
    const upper = lower.toUpperCase(); // format invalid — 64-char but uppercase
    expect(() => assertScriptIntegrity(script, upper)).toThrow(
      expect.objectContaining({ code: 'SCRIPT_SHA_MISMATCH' }),
    );
  });

  it('63-char hex sha → SCRIPT_SHA_MISMATCH (wrong length)', () => {
    const script = 'return 1;';
    const short = sha256(script).slice(0, 63); // one char short
    expect(() => assertScriptIntegrity(script, short)).toThrow(
      expect.objectContaining({ code: 'SCRIPT_SHA_MISMATCH' }),
    );
  });

  it('sha computed over UTF-8 bytes: emoji script matches correctly', () => {
    const script = 'return "🎉";'; // non-ASCII
    const correctSha = sha256(script); // sha256 over UTF-8 bytes
    expect(() => assertScriptIntegrity(script, correctSha)).not.toThrow();
  });
});

describe('assertScriptIntegrity — RunManager ladder (DES-090)', () => {
  let tmpDir: string;
  let mgr: RunManager;
  const clock = new SystemClock();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-ut091-'));
    mgr = new RunManager({ store: new InMemoryRunStore(clock), workRoot: tmpDir });
  });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('scriptSha256 on a named run (no inline script) → SCRIPT_SHA_WITHOUT_SCRIPT', async () => {
    await expect(
      mgr.start({
        name: 'some-registered-workflow',
        scriptSha256: sha256('some script'), // present but no inline script
      }),
    ).rejects.toMatchObject({ code: 'SCRIPT_SHA_WITHOUT_SCRIPT' });
  });

  it('SCRIPT_SHA_MISMATCH fires BEFORE admission: no run created in store', async () => {
    const store = new InMemoryRunStore(clock);
    const localMgr = new RunManager({ store, workRoot: tmpDir, maxConcurrentRuns: 64 });
    const listBefore = await store.listRuns();
    const preCount = listBefore.length;

    const script = 'return 42;';
    const wrongSha = sha256(script + ' altered');
    await expect(
      localMgr.start({ script, scriptSha256: wrongSha }),
    ).rejects.toMatchObject({ code: 'SCRIPT_SHA_MISMATCH' });

    const listAfter = await store.listRuns();
    expect(listAfter.length).toBe(preCount); // no store row created
  });
});
