// v12 (REQ-076, REQ-077): SystemProbe port + lazy-TTL SystemInfoSampler + pure buildSystemInfo shaper.
// DES-073: host CPU/mem/disk observability. DES-074: process metrics (engine-self + Top-N + system).
// Architecture: three layers:
//   (1) SystemProbe — untestable OS boundary (raw counters only, no shaping)
//   (2) SystemInfoSampler — lazy-TTL cache; caches raw + prev snapshot + per-pid jiffie prev-cache
//   (3) buildSystemInfo — pure shaper (all delta math + degrade logic, no I/O)

import { readdir, readFile, stat } from 'node:fs/promises';
import { statfs } from 'node:fs/promises';
import * as os from 'node:os';
import type { Clock } from './clock.js';

// ──────────────────────────────────────────────
// UTIL_PCT_CONVENTION — single source of truth
// ──────────────────────────────────────────────

/** DES-073: host aggregate utilization convention — 0–100, never per-core. */
export const UTIL_PCT_CONVENTION = 'host-aggregate-0-100';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type Reason =
  | 'awaiting-second-sample'
  | 'sample-window-too-short'
  | 'timeout'
  | 'unsupported-platform'
  | 'probe-error';

export interface Degraded {
  reason: Reason;
  detail?: string;
}

/** Raw host observables from the OS boundary — no shaping, no math, no I/O beyond the probe call. */
export interface RawHostSnapshot {
  cpu: { perCore: Array<{ idleMs: number; totalMs: number }> } | null;
  loadAvg: [number, number, number];
  cores: number;
  mem: { totalBytes: number; freeBytes: number } | null;
  disk: { path: string; blockSize: number; blocks: number; bfree: number; bavail: number } | null;
}

/** Raw process observables — engine-self + top-level proc list (comm only, no argv). */
export interface RawProcSnapshot {
  self: { threads: number | null; fdCount: number | null };
  procs: Array<{
    pid: number;
    comm: string;
    utimeJiffies: number;
    stimeJiffies: number;
    state: string;
    rssBytes: number;
  }> | null;
  procsDegraded?: Degraded;
}

/** Shaped, client-ready process view (part of SystemInfoView). */
export interface ProcessInfoView {
  self: {
    pid: number;
    uptimeSec: number;
    rssBytes: number;
    cpuPct: number | null;
    threads: number | null;
    fdCount: number | null;
  };
  /** Top-N processes sorted by cpuPct desc, memBytes tiebreak; null cpuPct sorts last. */
  topN: Array<{
    pid: number;
    name: string;
    cpuPct: number | null;
    memBytes: number;
  }>;
  system: { total: number; byState: Record<string, number> } | Degraded;
}

/** Fully shaped system info view returned by the sampler and served on the MCP tool + HTTP route. */
export interface SystemInfoView {
  cpu: {
    cores: number;
    loadAvg: [number, number, number];
    utilizationPct: number | null;
    utilizationDegraded?: Degraded;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPct: number;
  } | Degraded;
  disk: {
    path: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPct: number;
  } | Degraded;
  process: ProcessInfoView;
  sampledAt: string;
  windowMs: number | null;
}

/** Injectable OS boundary — untestable in unit tests; StubSystemProbe replaces it. */
export interface SystemProbe {
  sampleHost(): Promise<RawHostSnapshot>;
  sampleProcesses(deadlineMs: number): Promise<RawProcSnapshot>;
}

// ──────────────────────────────────────────────
// buildSystemInfo — pure shaper, no I/O
// ──────────────────────────────────────────────

/**
 * Pure shaper: takes already-sampled raw snapshots + pre-shaped process view, applies all
 * delta math and degrade logic. No I/O, no wall-clock reads.
 *
 * @param cur   — current raw host snapshot
 * @param prev  — previous raw host snapshot (null on the first call)
 * @param ctx   — { sampledAt: ISO string, windowMs: number|null } derived from the injected clock
 * @param opts  — { topN: number } — clamped to [1,50] by this function (clamp-not-reject)
 * @param procShape — pre-shaped ProcessInfoView built by the sampler from the RawProcSnapshot
 */
export function buildSystemInfo(
  cur: RawHostSnapshot,
  prev: RawHostSnapshot | null,
  ctx: { sampledAt: string; windowMs: number | null },
  opts: { topN: number },
  procShape: ProcessInfoView,
): SystemInfoView {
  // ── CPU ────────────────────────────────────────────────────────────────────────────
  let utilizationPct: number | null = null;
  let utilizationDegraded: Degraded | undefined;

  if (prev === null) {
    // First call — no delta available.
    utilizationDegraded = { reason: 'awaiting-second-sample' };
  } else if (!cur.cpu) {
    // Current snapshot has no CPU data — probe failed for this section.
    utilizationDegraded = { reason: 'probe-error' };
  } else if (!prev.cpu) {
    // Previous snapshot had no CPU data — can't compute delta.
    utilizationDegraded = { reason: 'awaiting-second-sample' };
  } else {
    const curCores = cur.cpu.perCore;
    const prevCores = prev.cpu.perCore;
    const len = Math.min(curCores.length, prevCores.length);
    let sumIdleDelta = 0;
    let sumTotalDelta = 0;
    for (let i = 0; i < len; i++) {
      sumIdleDelta += curCores[i]!.idleMs - prevCores[i]!.idleMs;
      sumTotalDelta += curCores[i]!.totalMs - prevCores[i]!.totalMs;
    }
    if (sumTotalDelta === 0) {
      // Identical jiffie timestamps — division by zero guard.
      utilizationDegraded = { reason: 'sample-window-too-short' };
    } else {
      // utilizationPct = (1 - idleDelta/totalDelta) * 100, host-aggregate-0-100 (UTIL_PCT_CONVENTION).
      const pct = (1 - sumIdleDelta / sumTotalDelta) * 100;
      utilizationPct = Math.min(100, Math.max(0, pct));
    }
  }

  // ── Memory ─────────────────────────────────────────────────────────────────────────
  let memory: SystemInfoView['memory'];
  if (!cur.mem) {
    memory = { reason: 'probe-error' };
  } else {
    const { totalBytes, freeBytes } = cur.mem;
    const usedBytes = totalBytes - freeBytes;
    memory = {
      totalBytes,
      usedBytes,
      freeBytes,
      usedPct: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
    };
  }

  // ── Disk (df convention) ────────────────────────────────────────────────────────────
  // used = (blocks − bfree) * blockSize; free = bavail * blockSize; usedPct = used/(used+bavail)
  let disk: SystemInfoView['disk'];
  if (!cur.disk) {
    disk = { reason: 'probe-error' };
  } else {
    const { path, blockSize, blocks, bfree, bavail } = cur.disk;
    const usedBytes = (blocks - bfree) * blockSize;
    const freeBytes = bavail * blockSize;
    const totalBytes = usedBytes + freeBytes;
    disk = {
      path,
      totalBytes,
      usedBytes,
      freeBytes,
      usedPct: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
    };
  }

  // ── Process — sort + clamp topN (clamp-not-reject, DES-077) ───────────────────────
  const clampedN = Math.min(50, Math.max(1, Math.floor(opts.topN)));
  const sortedTopN = [...procShape.topN].sort((a, b) => {
    // null cpuPct sorts last (treated as -1 in the comparator)
    if (a.cpuPct === null && b.cpuPct === null) return b.memBytes - a.memBytes;
    if (a.cpuPct === null) return 1;
    if (b.cpuPct === null) return -1;
    if (b.cpuPct !== a.cpuPct) return b.cpuPct - a.cpuPct; // desc
    return b.memBytes - a.memBytes; // tiebreak
  });

  return {
    cpu: {
      cores: cur.cores,
      loadAvg: cur.loadAvg,
      utilizationPct,
      ...(utilizationDegraded !== undefined ? { utilizationDegraded } : {}),
    },
    memory,
    disk,
    process: {
      self: procShape.self,
      topN: sortedTopN.slice(0, clampedN),
      system: procShape.system,
    },
    sampledAt: ctx.sampledAt,
    windowMs: ctx.windowMs,
  };
}

// ──────────────────────────────────────────────
// SystemInfoSampler — lazy-TTL cache
// ──────────────────────────────────────────────

/** DES-073: lazy-TTL cache; one instance feeds both the system_info MCP tool and GET /api/system.
 *  Caches raw host snapshots + per-pid jiffie prev; re-runs the pure shaper on every get() with
 *  the caller's topN so concurrent calls with different topN get the right slice (never poisoned). */
export class SystemInfoSampler {
  private _cachedCur: RawHostSnapshot | null = null;
  private _cachedPrev: RawHostSnapshot | null = null;
  private _cachedCtx: { sampledAt: string; windowMs: number | null } | null = null;
  private _cachedProcView: ProcessInfoView | null = null;
  /** clock.now() value at the last sample — used for TTL freshness check and windowMs delta. */
  private _cachedAtMs: number | null = null;
  /** clock.now() value at the sample BEFORE the last — used to compute windowMs of the latest sample. */
  private _prevSampledAtMs: number | null = null;
  /** Per-pid CPU jiffies from the PREVIOUS proc sample — used to compute per-proc cpuPct delta. */
  private _prevPidJiffies: Map<number, number> = new Map();
  /** Total CPU microseconds (user+sys) from the PREVIOUS self-sample — for cpuPct delta. */
  private _prevSelfCpuUs: number | null = null;

  constructor(
    private readonly probe: SystemProbe,
    private readonly clock: Clock,
    private readonly ttlMs: number = 1500,
  ) {}

  async get(opts: { topN?: number } = {}): Promise<SystemInfoView> {
    const topN = opts.topN ?? 5;
    const nowMs = this.clock.now();

    const stale = this._cachedAtMs === null || nowMs - this._cachedAtMs >= this.ttlMs;

    if (stale) {
      const [rawHost, rawProc] = await Promise.all([
        this.probe.sampleHost(),
        this.probe.sampleProcesses(150),
      ]);

      const sampledAt = this.clock.isoNow();
      // Update _prevSampledAtMs BEFORE computing windowMs so the delta is: now - prev-sample-time.
      this._prevSampledAtMs = this._cachedAtMs;
      const windowMs = this._prevSampledAtMs !== null ? nowMs - this._prevSampledAtMs : null;

      // Build ProcessInfoView from raw proc data + engine-self node API.
      const procView = this._buildProcView(rawProc, windowMs);

      // Rotate snapshots
      this._cachedPrev = this._cachedCur;
      this._cachedCur = rawHost;
      this._cachedCtx = { sampledAt, windowMs };
      this._cachedProcView = procView;
      this._cachedAtMs = nowMs;
    }

    return buildSystemInfo(
      this._cachedCur!,
      this._cachedPrev,
      this._cachedCtx!,
      { topN },
      this._cachedProcView!,
    );
  }

  /** Build ProcessInfoView from RawProcSnapshot + Node.js engine-self APIs.
   *  Per-pid cpuPct is computed from _prevPidJiffies (updated after each sample). */
  private _buildProcView(rawProc: RawProcSnapshot, windowMs: number | null): ProcessInfoView {
    // Engine-self cpuPct: delta of cumulative CPU µs over windowMs.
    const cpuUsageNow = process.cpuUsage();
    const totalCpuUs = cpuUsageNow.user + cpuUsageNow.system;
    const deltaCpuUs = this._prevSelfCpuUs !== null ? totalCpuUs - this._prevSelfCpuUs : null;
    const selfCpuPct =
      deltaCpuUs !== null && windowMs !== null && windowMs > 0
        ? Math.min(100, Math.max(0, (deltaCpuUs / 1000 / windowMs) * 100))
        : null;
    this._prevSelfCpuUs = totalCpuUs;

    const self: ProcessInfoView['self'] = {
      pid: process.pid,
      uptimeSec: process.uptime(),
      rssBytes: process.memoryUsage().rss,
      cpuPct: selfCpuPct,
      threads: rawProc.self.threads,
      fdCount: rawProc.self.fdCount,
    };

    let topN: ProcessInfoView['topN'] = [];
    let system: ProcessInfoView['system'];

    if (rawProc.procsDegraded) {
      system = rawProc.procsDegraded;
    } else if (rawProc.procs === null) {
      system = { reason: 'probe-error' as const };
    } else {
      const byState: Record<string, number> = {};
      const newPidJiffies: Map<number, number> = new Map();
      for (const p of rawProc.procs) {
        byState[p.state] = (byState[p.state] ?? 0) + 1;
        const totalJiffies = p.utimeJiffies + p.stimeJiffies;
        newPidJiffies.set(p.pid, totalJiffies);
        const prevJiffies = this._prevPidJiffies.get(p.pid);
        const deltaJiffies = prevJiffies !== undefined ? totalJiffies - prevJiffies : null;
        // cpuPct = deltaJiffies / (windowMs / 10) — CLK_TCK = 100 jiffies/sec = 10 ms/jiffie
        const cpuPct = deltaJiffies !== null && windowMs !== null && windowMs > 0
          ? Math.min(100, Math.max(0, (deltaJiffies / (windowMs / 10)) * 100))
          : null;
        topN.push({ pid: p.pid, name: p.comm, cpuPct, memBytes: p.rssBytes });
      }
      this._prevPidJiffies = newPidJiffies;
      system = { total: rawProc.procs.length, byState };
    }

    return { self, topN, system };
  }
}

// ──────────────────────────────────────────────
// RealSystemProbe — real OS boundary
// ──────────────────────────────────────────────

/** Real OS probe for production use. Injected via ServerConfig.systemInfo (a SystemInfoSampler
 *  built on top of this). Tests replace it with StubSystemProbe — never mock in unit/integration. */
export class RealSystemProbe implements SystemProbe {
  constructor(private readonly workRoot: string) {}

  async sampleHost(): Promise<RawHostSnapshot> {
    const cpuInfo = os.cpus();
    const perCore = cpuInfo.map((c) => ({
      // Node.js os.cpus() times are in ms
      idleMs: c.times.idle,
      totalMs: c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
    }));

    let disk: RawHostSnapshot['disk'] = null;
    try {
      const sf = await statfs(this.workRoot);
      disk = {
        path: this.workRoot,
        blockSize: sf.bsize,
        blocks: sf.blocks,
        bfree: sf.bfree,
        bavail: sf.bavail,
      };
    } catch {
      // statfs can fail (e.g. path doesn't exist yet) — degrade disk section gracefully.
    }

    return {
      cpu: { perCore },
      loadAvg: os.loadavg() as [number, number, number],
      cores: os.cpus().length,
      mem: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
      disk,
    };
  }

  async sampleProcesses(deadlineMs: number): Promise<RawProcSnapshot> {
    // Self observables from /proc (Linux only)
    let selfThreads: number | null = null;
    let selfFdCount: number | null = null;
    try {
      const statusText = await readFile('/proc/self/status', 'utf8');
      const match = /^Threads:\s*(\d+)/m.exec(statusText);
      if (match) selfThreads = Number(match[1]);
    } catch { /* non-Linux */ }
    try {
      const fdEntries = await readdir('/proc/self/fd');
      selfFdCount = fdEntries.length;
    } catch { /* non-Linux */ }

    // Check for /proc (Linux check)
    try {
      await stat('/proc');
    } catch {
      return {
        self: { threads: selfThreads, fdCount: selfFdCount },
        procs: null,
        procsDegraded: { reason: 'unsupported-platform' },
      };
    }

    // Enumerate /proc with bounded timeout (~deadlineMs)
    const enumerate = async (): Promise<RawProcSnapshot['procs']> => {
      const entries = await readdir('/proc');
      const numericPids = entries.filter((e) => /^\d+$/.test(e)).map(Number);
      const results: NonNullable<RawProcSnapshot['procs']> = [];
      await Promise.all(numericPids.map(async (pid) => {
        try {
          const [statText, commText] = await Promise.all([
            readFile(`/proc/${pid}/stat`, 'utf8'),
            readFile(`/proc/${pid}/comm`, 'utf8'),
          ]);
          // /proc/<pid>/stat: "pid (comm) state ppid ... utime stime ... rss"
          // comm may contain spaces or parens (e.g. "tmux: server"), so locate the last ')'.
          const closeIdx = statText.lastIndexOf(')');
          const rest = statText.slice(closeIdx + 2).split(' ');
          // After the closing ')': [0]=state [1]=ppid ... [11]=utime [12]=stime ... [21]=rss
          const state = rest[0] ?? 'U';
          const utimeJiffies = Number(rest[11]) || 0;
          const stimeJiffies = Number(rest[12]) || 0;
          const rssPages = Number(rest[21]) || 0;
          const PAGE_SIZE = 4096; // standard Linux page size
          results.push({
            pid,
            comm: commText.trim(),
            utimeJiffies,
            stimeJiffies,
            state,
            rssBytes: rssPages * PAGE_SIZE,
          });
        } catch {
          // ENOENT — process exited between readdir and stat/comm. Swallow per-pid (TOCTOU guard).
        }
      }));
      return results;
    };

    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), deadlineMs));
    const result = await Promise.race([enumerate(), timeout]);

    if (result === null) {
      return {
        self: { threads: selfThreads, fdCount: selfFdCount },
        procs: null,
        procsDegraded: { reason: 'timeout' },
      };
    }

    return {
      self: { threads: selfThreads, fdCount: selfFdCount },
      procs: result,
    };
  }
}
