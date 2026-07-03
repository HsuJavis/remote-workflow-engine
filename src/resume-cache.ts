// Resume cache (DES-004). Longest-unchanged-prefix replay from journal.
import type { CallKey, JournalEntry } from './types.js';

export const MISS = Symbol('MISS');
export type ReplayResult = unknown | typeof MISS;

export interface ResumePlan {
  cachedThrough: number;
  replay(callSeq: number, key: CallKey): ReplayResult;
}

/** Structural equality over a CallKey (prompt + opts) — the cache-hit test. */
function sameKey(a: CallKey, b: CallKey): boolean {
  return a.prompt === b.prompt && JSON.stringify(a.opts) === JSON.stringify(b.opts);
}

class Plan implements ResumePlan {
  private _missed = false;

  constructor(
    private readonly _byCallSeq: Map<number, JournalEntry>,
    public readonly cachedThrough: number,
  ) {}

  /** Once any callSeq misses (missing entry, changed key, or an D-F13 aborted-null entry), every
   *  later callSeq is MISS too (DES-004) — an aborted call MUST re-run live on resume, and so must
   *  everything after it (the same "longest-unchanged-prefix" contract an ordinary miss already
   *  follows), never replaying the journaled null a suspend/stop interrupted mid-flight. */
  replay(callSeq: number, key: CallKey): ReplayResult {
    if (this._missed) return MISS;
    const entry = this._byCallSeq.get(callSeq);
    if (!entry || !sameKey(entry.key, key) || entry.aborted) {
      this._missed = true;
      return MISS;
    }
    return entry.value;
  }
}

export class ResumeCache {
  /** Build a plan from a completed run's journal entries. cachedThrough is the last journaled callSeq
   *  (upper bound); actual cache hits are determined progressively via replay() as the new script re-runs. */
  static build(entries: JournalEntry[], _newScript: string): ResumePlan {
    const byCallSeq = new Map(entries.map((e) => [e.callSeq, e]));
    // reduce avoids spread-on-large-array; sentinel -1 means "nothing cached" when entries is empty
    const cachedThrough = entries.reduce((m, e) => Math.max(m, e.callSeq), -1);
    return new Plan(byCallSeq, cachedThrough);
  }
}
