import { monitorEventLoopDelay } from 'node:perf_hooks';
import { appendFileSync } from 'node:fs';
const OUT = process.env.RWE_EVLOOP_OUT;
if (OUT) {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const line = (o) => { try { appendFileSync(OUT, JSON.stringify(o) + '\n'); } catch {} };
  line({ event: 'preload-install', pid: process.pid, argv: process.argv });
  const tick = setInterval(() => {
    line({ event: 'tick', pid: process.pid, t: Date.now(), p99ms: h.percentile(99) / 1e6, maxMs: h.max / 1e6, meanMs: h.mean / 1e6 });
  }, 2000);
  tick.unref();
  process.on('exit', () => {
    line({ event: 'exit', pid: process.pid, p99ms: h.percentile(99) / 1e6, maxMs: h.max / 1e6, meanMs: h.mean / 1e6 });
  });
}
// tsx's cli.mjs wrapper respawns a child (which re-reads NODE_OPTIONS from its inherited env to
// install ITS OWN loader) — that child is the real HTTP listener and the one we actually want
// instrumented. Keep NODE_OPTIONS alive through the wrapper hop so the child inherits it, but once
// WE are that child (argv no longer names tsx/dist/cli.mjs), strip it so a later-spawned `claude`
// CLI subprocess (or the LiteLLM proxy) never inherits this diagnostic import.
const isTsxWrapper = process.argv.some((a) => a.includes('tsx/dist/cli.mjs'));
if (!isTsxWrapper) delete process.env.NODE_OPTIONS;
