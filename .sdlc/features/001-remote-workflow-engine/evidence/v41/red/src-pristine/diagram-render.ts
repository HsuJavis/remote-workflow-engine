// diagram-render.ts (v25, REQ-119, DES-166, TASK-166) — the server-side Mermaid→SVG renderer and
// the cache that stands in front of it.
//
// The cache is not an optimization, it is a defence. `GET /api/workflows/:name/describe` — and the
// `/diagram.svg` route beside it — are ANONYMOUS (adjudication #8 H-1 removed the auth gate so a
// token-less browser could read the diagram at all), while rendering spawns a ~300MB headless
// Chrome. Lazy render + anonymous route = an unauthenticated caller can spawn browsers, so REQ-119
// writes three properties as ACCEPTANCE clauses, all of them here (UT-167 pins each):
//   (a) cache-first  — a hit runs no render at all;
//   (b) single-flight — N concurrent requests for one (name, version) render ONCE;
//   (c) cap + hard timeout — over the cap the answer is RENDER_BUSY (the route degrades to source),
//       and a render that hangs is abandoned AND its process group killed, never held forever.
//
// The cache never needs invalidating for an EDIT: REQ-111/ADR-025 make a version's `mermaid`
// immutable (`insertVersion` only ever INSERTs a fresh `v<max+1>` row; no UPDATE of the column
// exists). It does need invalidating for a DELETE — see `invalidate()`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type RenderFailReason = 'RENDERER_MISSING' | 'RENDER_TIMEOUT' | 'RENDER_FAILED' | 'RENDER_BUSY';

export type RenderOutcome = { ok: true; svg: string } | { ok: false; reason: RenderFailReason; detail?: string };

export type RenderFn = (mermaid: string, signal: AbortSignal) => Promise<RenderOutcome>;

export type CacheOutcome = { ok: true; svg: string; cached: boolean } | { ok: false; reason: RenderFailReason; detail?: string };

/** Hard per-render deadline. A cold Chrome renders a full-vocabulary diagram in ~1.2s measured on
 *  this host; 20s is an outage, not a slow render. */
export const RENDER_TIMEOUT_MS = 20_000;
/** Simultaneous renders across the whole engine. Each is a browser process; two bounds the anonymous
 *  route's worst case at ~600MB while still letting a second viewer through. */
export const MAX_CONCURRENT_RENDERS = 2;
/** Bounded cache — a rendered diagram is ~55-65KB, so an unbounded Map is itself a memory sink. */
export const MAX_CACHED_DIAGRAMS = 128;

export interface DiagramRendererOpts {
  render?: RenderFn;
  timeoutMs?: number;
  maxConcurrent?: number;
  maxEntries?: number;
}

/** Cache key separator: a NUL can appear in neither a workflow name nor a version, so
 *  `(name, version)` cannot be spoofed by a name containing the separator. */
const KEY_SEP = '\u0000';

export class DiagramRenderer {
  private readonly render: RenderFn;
  private readonly maxEntries: number;
  private readonly maxConcurrent: number;
  private readonly timeoutMs: number;
  private active = 0;
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<CacheOutcome>>();

  constructor(opts: DiagramRendererOpts = {}) {
    this.render = opts.render ?? (() => Promise.resolve<RenderOutcome>({ ok: false, reason: 'RENDERER_MISSING' }));
    this.maxEntries = opts.maxEntries ?? MAX_CACHED_DIAGRAMS;
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT_RENDERS;
    this.timeoutMs = opts.timeoutMs ?? RENDER_TIMEOUT_MS;
  }

  size(): number { return this.cache.size; }

  invalidate(name: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(name + KEY_SEP)) this.cache.delete(key);
    }
  }

  get(name: string, version: string, mermaid: string): Promise<CacheOutcome> {
    const key = name + KEY_SEP + version;
    const hit = this.cache.get(key);
    if (hit !== undefined) return Promise.resolve({ ok: true, svg: hit, cached: true });

    // Single-flight: N concurrent viewers of the same (name, version) attach to ONE render. The
    // lookup and the insertion are synchronous — a get() that awaited before registering would let
    // a second caller slip past this check and spawn a second browser.
    const running = this.inFlight.get(key);
    if (running) return running; // a follower consumes no slot — it is already paid for

    // Concurrency cap: over it, refuse IMMEDIATELY rather than queue. An unbounded queue in front
    // of an anonymous route is the same exhaustion with a longer fuse, and REQ-119 accepts a
    // fall-back to source as the alternative to queueing.
    if (this.active >= this.maxConcurrent) return Promise.resolve({ ok: false, reason: 'RENDER_BUSY' });

    this.active++;
    const started = this.startRender(key, mermaid).finally(() => {
      this.active--;
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, started);
    return started;
  }

  private async startRender(key: string, mermaid: string): Promise<CacheOutcome> {
    // Hard timeout: the deadline lives HERE, not only in the spawn wrapper, so it also bounds an
    // injected renderer — and `abort()` is what tells the wrapper to kill mmdc's whole process
    // group (abandoning the promise alone would leak the Chrome it started).
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<RenderOutcome>((resolve) => {
      timer = setTimeout(() => { ac.abort(); resolve({ ok: false, reason: 'RENDER_TIMEOUT' }); }, this.timeoutMs);
      timer.unref?.();
    });
    const out = await Promise.race([
      this.render(mermaid, ac.signal).catch(() => ({ ok: false as const, reason: 'RENDER_FAILED' as const })),
      deadline,
    ]);
    clearTimeout(timer);
    if (!out.ok) return out; // failures are NOT negative-cached (UT-167)
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, out.svg);
    return { ok: true, svg: out.svg, cached: false };
  }
}

// ── the real renderer: mmdc in a child process ────────────────────────────────────────────────

/** Mermaid config handed to every render. `htmlLabels:false` is a SECURITY decision, not cosmetics:
 *  with mermaid's default HTML labels the node text becomes real HTML inside a `<foreignObject>`,
 *  and a label of `<img src="http://attacker/x">` is then FETCHED by the engine's own Chrome at
 *  render time (measured: the render log shows the load attempt; with this flag it does not). With
 *  SVG text labels the same author text is emitted entity-escaped inside a `<tspan>` — and the
 *  REQ-112 triple still breaks across two rows (`writer` / `default · low · 120000`, measured), which
 *  is the display REQ-119 requires. */
const MERMAID_CONFIG = { htmlLabels: false, flowchart: { htmlLabels: false }, securityLevel: 'strict' };
/** Puppeteer launch args. `--proxy-server=127.0.0.1:9` (discard port) is a blanket egress blackhole:
 *  even if a future mermaid feature or a bundled icon pack tries to fetch a URL, the engine host
 *  makes no outbound connection while rendering an author's document. */
const PUPPETEER_CONFIG = { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--proxy-server=127.0.0.1:9'] };
/** SIGTERM → SIGKILL grace for the render process group (same escalation as `cli-lifecycle.ts`). */
const KILL_ESCALATION_MS = 2000;

export interface MmdcOpts {
  /** Absolute path to mmdc's CLI entry. `undefined` ⇒ resolve the optionalDependency; `null` ⇒ it
   *  could not be resolved (the deliberate RENDERER_MISSING case). */
  cliPath?: string | null;
  /** Extra environment for the child (merged over the engine's own). */
  env?: NodeJS.ProcessEnv;
}

/** The `@mermaid-js/mermaid-cli` CLI entry, or null when the optionalDependency is not installed.
 *  Resolved through node's own algorithm (never a hand-built `node_modules/.bin` path, which is an
 *  install artefact), and never via `npx`: `npx` would turn an anonymous request into a package
 *  DOWNLOAD on the engine host. */
export function resolveMmdcCli(): string | null {
  try {
    const entry = createRequire(import.meta.url).resolve('@mermaid-js/mermaid-cli');
    const cli = join(dirname(entry), 'cli.js');
    return existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

/** Render one diagram in a child process. Returns a typed failure for every degradation REQ-119
 *  names — a missing renderer, a missing/failed Chrome, a malformed or absent output file — so the
 *  route can fall back to the source display with an observable reason. Never throws. */
export function renderWithMmdc(mermaid: string, signal: AbortSignal, opts: MmdcOpts = {}): Promise<RenderOutcome> {
  const cliPath = opts.cliPath === undefined ? resolveMmdcCli() : opts.cliPath;
  if (!cliPath || !existsSync(cliPath)) {
    return Promise.resolve({ ok: false, reason: 'RENDERER_MISSING', detail: '@mermaid-js/mermaid-cli is not installed (optionalDependency)' });
  }
  const dir = mkdtempSync(join(tmpdir(), 'rwe-diagram-'));
  const inPath = join(dir, 'in.mmd');
  const outPath = join(dir, 'out.svg');
  const confPath = join(dir, 'mermaid.json');
  const pptrPath = join(dir, 'puppeteer.json');
  writeFileSync(inPath, mermaid, 'utf-8');
  writeFileSync(confPath, JSON.stringify(MERMAID_CONFIG), 'utf-8');
  writeFileSync(pptrPath, JSON.stringify(PUPPETEER_CONFIG), 'utf-8');

  return new Promise<RenderOutcome>((resolve) => {
    // `detached` makes the child a process-GROUP leader, which is the only way to reap the Chrome
    // it spawns: killing the mmdc pid alone orphans a ~300MB browser (UT-168 proves the group kill).
    const child = spawn(process.execPath, [cliPath, '-i', inPath, '-o', outPath, '-c', confPath, '-p', pptrPath], {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ...opts.env },
    });
    let stderr = '';
    child.stderr?.on('data', (b: Buffer) => { if (stderr.length < 2000) stderr += b.toString('utf-8'); });

    const killGroup = (): void => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
      const escalate = setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
      }, KILL_ESCALATION_MS);
      escalate.unref?.();
    };
    const onAbort = (): void => killGroup();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) killGroup();

    const settle = (out: RenderOutcome): void => {
      signal.removeEventListener('abort', onAbort);
      rmSync(dir, { recursive: true, force: true });
      resolve(out);
    };

    child.on('error', (err) => {
      settle({ ok: false, reason: 'RENDERER_MISSING', detail: err.message });
    });
    child.on('close', (code) => {
      if (signal.aborted) { settle({ ok: false, reason: 'RENDER_TIMEOUT' }); return; }
      if (!existsSync(outPath)) {
        settle({ ok: false, reason: 'RENDER_FAILED', detail: `mmdc exit ${code} wrote no output; ${stderr.trim().slice(-400)}` });
        return;
      }
      const svg = readFileSync(outPath, 'utf-8');
      // Never serve output that is not an SVG document: mmdc can exit 0 having written a message.
      if (!svg.trimStart().startsWith('<svg')) {
        settle({ ok: false, reason: 'RENDER_FAILED', detail: `mmdc exit ${code} produced non-SVG output; ${stderr.trim().slice(-400)}` });
        return;
      }
      settle({ ok: true, svg });
    });
  });
}
