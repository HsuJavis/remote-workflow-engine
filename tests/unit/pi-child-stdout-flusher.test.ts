// Issue #158 F4 latency fix (2026-10-08 reverify): `flushStdout()` (src/gateway/pi-child/entry.ts)
// used to wait for stdout's own 'drain' event whenever `writableLength > 0`. 'drain' fires ONLY
// when a `write()` call itself returned `false` (the stream crossed its highWaterMark, >=16KiB by
// default) — a small final line queued behind an already-full OS pipe buffer leaves
// `writableLength > 0` with NO 'drain' ever coming, so a child holding any other live handle (MCP,
// srt) sat out the full 60s bound even though the data had already reached the OS. Reproduced
// directly in the verifier's own `scratchpad/rv2-conc/drain-test3.mjs` (1038 bytes queued,
// `needDrain=false`, no 'drain' event). Fixed in `stdout-flusher.ts`: track the LATEST write()'s
// own completion callback (the deterministic "reached the OS" signal) instead of 'drain'.
//
// Mock policy (unit): a bare fake `WritableLike` whose `write()` callback is held by the test (never
// auto-fired), so the test controls exactly when (or whether) the write "completes" — no real pipe,
// no real process needed to pin this behavior.
import { describe, it, expect, vi } from 'vitest';
import { createStdoutFlusher, type WritableLike } from '../../src/gateway/pi-child/stdout-flusher.js';

/** A fake stdout whose write() queues its callback instead of firing it — the exact shape of a
 *  write that reached the OS buffer but has not yet been acknowledged ('drain' never fires for it,
 *  since it never caused write() to return false). `fire()` lets the test complete it on demand. */
function fakeStream(): WritableLike & { fire(): void; pending: number } {
  const callbacks: Array<() => void> = [];
  return {
    pending: 0,
    write(_chunk: string, callback: () => void): boolean {
      this.pending++;
      callbacks.push(callback);
      return true; // never reports backpressure — exactly the case 'drain' cannot help with
    },
    once(): unknown { return this; }, // no 'error'/'close' in this fixture
    fire(): void {
      const cb = callbacks.shift();
      this.pending--;
      cb?.();
    },
  };
}

describe('createStdoutFlusher (#158 F4 latency fix)', () => {
  it('flush() resolves as soon as the write callback fires, not at the bound', async () => {
    const stream = fakeStream();
    const flusher = createStdoutFlusher(stream, 60_000);
    flusher.write('line\n');

    let resolved = false;
    const p = flusher.flush().then(() => { resolved = true; });

    // The write's own callback has not fired yet — flush() must still be pending (this is the exact
    // defect: the old 'drain'-based flushStdout would have resolved HERE, immediately, since
    // writableLength checks never apply to this fake and no backpressure was ever reported).
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);

    stream.fire();
    await p;
    expect(resolved).toBe(true);
  });

  it('[LOAD-BEARING] flush() does not wait for a drain event that never comes — only for the write callback', async () => {
    const stream = fakeStream();
    const flusher = createStdoutFlusher(stream, 60_000);
    flusher.write('a small final line\n');
    // No 'drain' event exists on this fake at all — if flush() depended on one (the bug), it would
    // never resolve inside this test's bound.
    stream.fire();
    await expect(flusher.flush()).resolves.toBeUndefined();
  });

  it('flush() still resolves at the bound when the write callback never fires (dead-parent fallback)', async () => {
    vi.useFakeTimers();
    try {
      const stream = fakeStream();
      const flusher = createStdoutFlusher(stream, 5_000);
      flusher.write('line\n'); // deliberately never fired — simulates a truly dead parent
      let resolved = false;
      const p = flusher.flush().then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await p;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flush() tracks the LATEST write, not an earlier one already in flight', async () => {
    const stream = fakeStream();
    const flusher = createStdoutFlusher(stream, 60_000);
    flusher.write('first\n');
    flusher.write('second\n');
    expect(stream.pending).toBe(2);

    let resolved = false;
    const p = flusher.flush().then(() => { resolved = true; });

    // Firing only the FIRST (earlier) write's callback must not resolve flush() — it is tracking
    // the second (latest) write's own callback.
    stream.fire();
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);

    stream.fire();
    await p;
    expect(resolved).toBe(true);
  });
});
