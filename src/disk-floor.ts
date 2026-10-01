// Owner decision 2026-10-02 (disk floor): while the filesystem holding the workRoot/CAS has less
// free space than max(percent% of that filesystem, bytes), new uploads (every CAS write) and new
// run admissions (start / resume / nested workflow()) are refused DISK_LOW {freeBytes, floorBytes}.
// Runs already in flight are not touched. statfs is read through a short cache so a burst of
// uploads/admissions costs one syscall per path per window.
import { statfsSync } from 'node:fs';
import { codedError } from './errors.js';
import { formatBytes } from './cas-quota.js';

export interface StatfsLike { bsize: number; blocks: number; bavail: number }
export interface DiskFloorStatus { ok: boolean; freeBytes: number; floorBytes: number }

const CACHE_MS = 5_000;

export class DiskFloor {
  private readonly _paths: string[];
  private readonly _percent: number;
  private readonly _bytes: number;
  private readonly _statfs: (path: string) => StatfsLike;
  private readonly _clock: () => number;
  private _cached: { at: number; status: DiskFloorStatus } | undefined;

  constructor(opts: { paths: string[]; percent: number; bytes: number; statfs?: (path: string) => StatfsLike; clock?: () => number }) {
    this._paths = [...new Set(opts.paths)];
    this._percent = opts.percent;
    this._bytes = opts.bytes;
    this._statfs = opts.statfs ?? ((p) => statfsSync(p));
    this._clock = opts.clock ?? (() => Date.now()); // det:allow — cache freshness only, never a decision input
  }

  /** The worst filesystem among the configured paths (largest shortfall below its floor; with none
   *  below, the one with the least headroom). A path statfs cannot read is skipped. */
  status(): DiskFloorStatus {
    if (this._percent === 0 && this._bytes === 0) return { ok: true, freeBytes: 0, floorBytes: 0 };
    const now = this._clock();
    if (this._cached && now - this._cached.at < CACHE_MS) return this._cached.status;
    let worst: DiskFloorStatus | undefined;
    for (const p of this._paths) {
      let s: StatfsLike;
      try { s = this._statfs(p); } catch { continue; }
      const total = s.blocks * s.bsize;
      const freeBytes = s.bavail * s.bsize;
      const floorBytes = Math.max(Math.floor((this._percent / 100) * total), this._bytes);
      const cand = { ok: freeBytes >= floorBytes, freeBytes, floorBytes };
      if (!worst || cand.freeBytes - cand.floorBytes < worst.freeBytes - worst.floorBytes) worst = cand;
    }
    const status = worst ?? { ok: true, freeBytes: 0, floorBytes: 0 };
    this._cached = { at: now, status };
    return status;
  }

  /** Throws DISK_LOW {freeBytes, floorBytes} when below the floor. */
  assert(): void {
    const s = this.status();
    if (s.ok) return;
    throw codedError(
      'DISK_LOW',
      `DISK_LOW: the engine's disk has ${formatBytes(s.freeBytes)} free, below its floor of ${formatBytes(s.floorBytes)} — new uploads and new runs are refused until space is freed (runs already in flight continue); retry later`,
      { freeBytes: s.freeBytes, floorBytes: s.floorBytes },
    );
  }
}
