// UT-087 (DES-086, ARCH-054, TASK-080): `CasStore.putBlobStream` fake-Readable battery.
// Tests the streaming blob ingest seam with an injectable fake opts.timer so the idle-timeout
// case is deterministic (no real 120s wait). Every unhappy path verifies the temp file is unlinked.
//
// Cases:
//   1. Happy: good stream → stored under computed sha, namespace ref recorded, {sha256, bytes} returned
//   2. maxBytes+1 mid-stream → rejects BLOB_TOO_LARGE; temp file unlinked; ref NOT recorded
//   3. Stall + fake opts.timer fired synchronously → rejects BLOB_UPLOAD_TIMEOUT; temp unlinked; ref NOT recorded
//   4. Computed sha != declared sha → rejects BLOB_SHA_MISMATCH; nothing stored, ref NOT recorded
//   5. Blob already exists (no-exists-shortcut): still fully consumes + verifies the stream;
//      mismatch AFTER the blob exists still → BLOB_SHA_MISMATCH, ref NOT recorded
//   6. 0-byte body with correct sha256(empty) → succeeds (maxBytes is an upper bound)
//
// Red reason: `CasStore.putBlobStream` method does not exist yet →
//   `TypeError: cas.putBlobStream is not a function` at the first `await` in every test →
//   all tests fail for the correct unimplemented reason.
//
// Mock policy (unit — DES-091): real `CasStore` on a temp dir (real fs);
//   fake `Readable` (emits controlled chunks); fake `opts.timer` (no real wall-clock).
//   No HTTP, no gateway, no RunManager.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CasStore } from '../../src/cas-store.js';

const sha256 = (b: Buffer | string): string =>
  createHash('sha256').update(b).digest('hex');
const EMPTY_SHA = sha256(Buffer.alloc(0));

/** Fake injectable timer. Call fire() to synchronously invoke the registered callback. */
function makeFakeTimer() {
  let pendingFn: (() => void) | undefined;
  const timer = {
    set(fn: () => void, _ms: number): ReturnType<typeof setTimeout> {
      pendingFn = fn;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clear(_t: ReturnType<typeof setTimeout>): void {
      pendingFn = undefined;
    },
  };
  return { timer, fire: () => { if (pendingFn) pendingFn(); } };
}

/** Lists .tmp files anywhere under a directory tree (checks temp cleanup). */
function tmpFiles(dir: string): string[] {
  try {
    return (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.tmp'));
  } catch {
    return [];
  }
}

let tmpDir: string;
let casDir: string;
let cas: CasStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-ut087-'));
  casDir = join(tmpDir, 'cas');
  cas = new CasStore(casDir);
});
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('CasStore.putBlobStream — streaming ingest seam (DES-086, ARCH-054)', () => {
  it('happy path: good stream stored under computed sha, ref recorded, {sha256,bytes} returned', async () => {
    const data = Buffer.from('hello streaming world');
    const h = sha256(data);
    const body = Readable.from([data]);
    const { timer } = makeFakeTimer();

    const result = await (cas as any).putBlobStream('ns1', h, body, {
      maxBytes: 1024,
      readTimeoutMs: 5000,
      timer,
    });

    expect(result.sha256).toBe(h);
    expect(result.bytes).toBe(data.length);
    expect(await cas.hasRef('ns1', h)).toBe(true);
    expect(tmpFiles(casDir)).toHaveLength(0);
  });

  it('maxBytes+1 mid-stream → BLOB_TOO_LARGE; temp unlinked; ref NOT recorded', async () => {
    const maxBytes = 64;
    const data = Buffer.alloc(maxBytes + 1, 0x41); // 1 byte over limit
    const h = sha256(data); // correct sha — but stream should abort before hash check
    const body = Readable.from([data]);
    const { timer } = makeFakeTimer();

    await expect(
      (cas as any).putBlobStream('ns1', h, body, { maxBytes, readTimeoutMs: 5000, timer }),
    ).rejects.toMatchObject({ code: 'BLOB_TOO_LARGE' });

    expect(await cas.hasRef('ns1', h)).toBe(false);
    expect(tmpFiles(casDir)).toHaveLength(0);
  });

  it('stall + fake timer fired synchronously → BLOB_UPLOAD_TIMEOUT; temp unlinked; ref NOT recorded', async () => {
    const { timer, fire } = makeFakeTimer();
    const stall = new Readable({ read() {} }); // never emits data
    // Fire the timer synchronously — simulates an idle timeout without waiting real time
    const stallSha = sha256(Buffer.from('whatever')); // sha doesn't matter; aborts before hash check
    const p = (cas as any).putBlobStream('ns1', stallSha, stall, {
      maxBytes: 1024,
      readTimeoutMs: 100, // real timer is bypassed by fake
      timer,
    });
    // Give the stream a microtask tick so putBlobStream has attached the timer
    await Promise.resolve();
    fire(); // fire idle timer synchronously

    await expect(p).rejects.toMatchObject({ code: 'BLOB_UPLOAD_TIMEOUT' });
    expect(await cas.hasRef('ns1', stallSha)).toBe(false);
    expect(tmpFiles(casDir)).toHaveLength(0);
  });

  it('computed sha != declared sha → BLOB_SHA_MISMATCH; nothing stored; ref NOT recorded', async () => {
    const data = Buffer.from('real content');
    const wrongSha = sha256(Buffer.from('different content'));
    const body = Readable.from([data]);
    const { timer } = makeFakeTimer();

    await expect(
      (cas as any).putBlobStream('ns1', wrongSha, body, { maxBytes: 1024, readTimeoutMs: 5000, timer }),
    ).rejects.toMatchObject({ code: 'BLOB_SHA_MISMATCH' });

    // Nothing stored under wrong sha
    expect(await cas.hasRef('ns1', wrongSha)).toBe(false);
    // Nothing stored under computed sha either (no store-anything on mismatch)
    expect(await cas.hasRef('ns1', sha256(data))).toBe(false);
    expect(tmpFiles(casDir)).toHaveLength(0);
  });

  it('no-exists-shortcut: blob exists but stream still fully verified; mismatch still → BLOB_SHA_MISMATCH', async () => {
    // Pre-populate blob via putBlob
    const data = Buffer.from('existing blob');
    const h = sha256(data);
    await cas.putBlob('ns1', h, data);
    expect(await cas.hasRef('ns1', h)).toBe(true);

    // Now upload with a wrong declared sha — even though blob exists, must verify
    const wrongSha = sha256(Buffer.from('not the same'));
    const body = Readable.from([data]);
    const { timer } = makeFakeTimer();

    await expect(
      (cas as any).putBlobStream('ns1', wrongSha, body, { maxBytes: 1024, readTimeoutMs: 5000, timer }),
    ).rejects.toMatchObject({ code: 'BLOB_SHA_MISMATCH' });

    // ref for wrongSha is NOT recorded (only the original correct upload is)
    expect(await cas.hasRef('ns1', wrongSha)).toBe(false);
    expect(tmpFiles(casDir)).toHaveLength(0);
  });

  it('0-byte body with correct sha256(empty) succeeds (maxBytes is an upper bound, not a lower)', async () => {
    const body = Readable.from([]); // no chunks → 0 bytes
    const { timer } = makeFakeTimer();

    const result = await (cas as any).putBlobStream('ns1', EMPTY_SHA, body, {
      maxBytes: 1024,
      readTimeoutMs: 5000,
      timer,
    });

    expect(result.sha256).toBe(EMPTY_SHA);
    expect(result.bytes).toBe(0);
    expect(await cas.hasRef('ns1', EMPTY_SHA)).toBe(true);
    expect(tmpFiles(casDir)).toHaveLength(0);
  });

  it('multi-chunk stream: ref is only in the correct namespace, not a different one', async () => {
    const chunks = [Buffer.from('part1'), Buffer.from('part2'), Buffer.from('part3')];
    const all = Buffer.concat(chunks);
    const h = sha256(all);
    const body = Readable.from(chunks);
    const { timer } = makeFakeTimer();

    await (cas as any).putBlobStream('nsA', h, body, { maxBytes: 1024, readTimeoutMs: 5000, timer });

    expect(await cas.hasRef('nsA', h)).toBe(true);
    expect(await cas.hasRef('nsB', h)).toBe(false); // per-namespace, not global
  });
});
