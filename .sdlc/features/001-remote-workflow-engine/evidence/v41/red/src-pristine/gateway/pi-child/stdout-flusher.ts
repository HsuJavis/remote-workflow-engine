// issue #158 F4 latency fix (2026-10-08 reverify): extracted out of entry.ts so the flush-before-exit
// logic is unit-testable without executing entry.ts's own `void main()` (which reads real stdin and
// calls `process.exit`). Zero local imports of its own — like `bash-env.ts`/`path-containment.ts`,
// safe to load directly by raw node (`node --experimental-transform-types`, no bundler .js->.ts
// rewriting — see the "rwe sandbox child .ts imports" memory note) via entry.ts's own explicit `.ts`
// import, and equally safe to import straight into a vitest unit test (vitest resolves TS natively,
// and importing THIS file alone never touches entry.ts's `main()`).
//
// The bug this replaces: `flushStdout()` used to wait for stdout's own 'drain' event when
// `writableLength > 0`. 'drain' fires ONLY when a `write()` call itself returned `false` (the
// stream's internal buffer crossed its highWaterMark, >=16KiB by default) — a SMALL final line
// (well under that) queued behind an already-full OS pipe buffer leaves `writableLength > 0` with
// no 'drain' ever coming, so a child with any other live handle (MCP, srt) sat out the full 60s
// bound even though its data had already reached the OS. Fixed exactly the way `child-entry.ts`'s
// `rawSend` already fixed the analogous IPC case (same bug class: #158 F4 / #162 B / #163 B1): track
// the LATEST `write()`'s own completion callback — the one deterministic "this data reached the OS"
// signal — and wait on THAT, never on 'drain'. `boundMs` stays as a dead-parent fallback only: it
// never fires under ordinary contention (the write callback already resolves by then), only when
// the stream is a live handle to a parent that will never read again.
export interface WritableLike {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
  once(event: 'error' | 'close', listener: () => void): unknown;
}

export interface StdoutFlusher {
  /** Writes one line (the caller supplies its own trailing newline) and starts tracking ITS OWN
   *  completion callback — overwriting whichever earlier write's callback `flush()` was tracking,
   *  since the latest write is always the last one that must reach the OS before exit. */
  write(line: string): void;
  /** Resolves once the latest `write()`'s own callback has fired (or the stream errored/closed, or
   *  `boundMs` elapsed with the stream still alive and silent). Never rejects. */
  flush(): Promise<void>;
}

export function createStdoutFlusher(stream: WritableLike, boundMs: number): StdoutFlusher {
  let lastWrite: Promise<void> = Promise.resolve();
  return {
    write(line: string): void {
      lastWrite = new Promise((resolve) => {
        stream.write(line, () => resolve());
      });
    },
    flush(): Promise<void> {
      return new Promise((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        const bound = setTimeout(finish, boundMs);
        (bound as { unref?: () => void }).unref?.();
        // A parent that actually died (EPIPE) resolves immediately rather than waiting out the
        // bound — mirrors the original flushStdout()'s own 'error'/'close' fast paths.
        stream.once('error', () => { clearTimeout(bound); finish(); });
        stream.once('close', () => { clearTimeout(bound); finish(); });
        void lastWrite.then(() => { clearTimeout(bound); finish(); });
      });
    },
  };
}
