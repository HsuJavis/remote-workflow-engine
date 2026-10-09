// issue #162 reverify-3: commit 9c2e443 (boot-time PID sweep) was proven so far only by calling
// `sweepOrphanSandboxChildren` directly inside the SAME OS process as the test
// (tests/integration/sandbox-child-boot-sweep.test.ts) — it never actually killed a real ENGINE
// process and watched a SECOND, independently-booted engine process reap the orphan via its own
// main.ts boot path. This file closes that gap: it spawns a REAL engine (`node --import tsx
// src/main.ts`, the exact production entrypoint, not `createServer()` in-process), submits a real
// `while (true) {}` run over real HTTP/MCP, SIGKILLs the engine process itself (never a graceful
// SIGINT/SIGTERM — that path is tested elsewhere), confirms the orphaned sandbox child survives,
// boots a SECOND real engine process on the SAME workRoot, and confirms ITS boot sweep reaps the
// orphan. A third case proves the sweep is workRoot-scoped: a sibling engine booting on a DIFFERENT
// workRoot must never touch another, still-LIVE engine's children on the same host.
//
// Mock policy (acceptance): no mock at all. Two/three real OS processes, a real fork()ed sandbox
// child, real signals, real HTTP.
//
// `node --import tsx src/main.ts`, spawned directly (no shell, no `timeout`/`npx` wrapper in
// between), is a SINGLE real OS process — measured directly: its own pid is already the one
// running main.ts, no separate tsx loader child to resolve. (A `timeout`/`npx`-wrapped invocation
// DOES interpose an extra layer; this file avoids both, so `proc.pid` IS the engine.)
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxChildRegistryDir } from '../../src/sandbox/host.js';
import { runScriptVia, type ToolCaller } from '../helpers/workflow-fixtures.js';

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 15000, stepMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

interface Engine {
  realPid: number;
  port: number;
  proc: ChildProcess;
}

function writeConfig(dir: string, workRoot: string): string {
  const configPath = join(dir, 'rwe.config.json');
  writeFileSync(configPath, JSON.stringify({ workRoot, gateway: 'direct-fetch', diskFloor: { bytes: 0, percent: 0 } }));
  return configPath;
}

/** Spawns a real engine process (the production `node --import tsx src/main.ts` entrypoint, not
 *  `createServer()` in-process) against `configPath`, and resolves once its own "ready" log line
 *  has printed, with the real bound port. `proc.pid` is already the process actually running
 *  main.ts — see this file's header note. */
async function spawnEngine(configPath: string): Promise<Engine> {
  const proc = spawn('node', ['--import', 'tsx', 'src/main.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, RWE_CONFIG_PATH: configPath, RWE_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const realPid = proc.pid!;
  let log = '';
  proc.stdout.on('data', (d) => { log += d.toString(); });
  proc.stderr.on('data', (d) => { log += d.toString(); });
  await waitFor(() => (log.includes('[remote-workflow-engine] ready') ? true : undefined), 20000);
  const portMatch = /listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp/.exec(log);
  if (!portMatch) throw new Error(`engine did not log its port — log so far:\n${log}`);
  return { realPid, port: Number(portMatch[1]), proc };
}

function killIfAlive(pid: number | undefined): void {
  if (pid === undefined) return;
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

function makeCallTool(port: number): ToolCaller {
  return async (tool, args) => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  };
}

/** Starts a real `while (true) {}` run on `engine` and returns the sandbox child's real OS pid,
 *  read straight off the on-disk registry (the same bookkeeping the boot sweep itself reads) once
 *  the fork has actually happened. */
async function startInfiniteLoopRun(engine: Engine, workRoot: string): Promise<number> {
  const call = makeCallTool(engine.port);
  const run = await runScriptVia(call, 'while (true) {}') as { runId?: string; status?: string; error?: unknown };
  if (run.runId === undefined) throw new Error(`run_start did not return a runId: ${JSON.stringify(run)}`);
  const dir = sandboxChildRegistryDir(workRoot);
  const pid = await waitFor(() => {
    if (!existsSync(dir)) return undefined;
    const entries = readdirSync(dir).filter((n) => n.endsWith('.json'));
    const p = entries[0]?.replace(/\.json$/, '');
    return p ? Number(p) : undefined;
  }, 10000);
  expect(isAlive(pid)).toBe(true);
  return pid;
}

describe('issue #162 reverify-3: real multi-process boot sweep (no mock)', () => {
  const liveEngines: Engine[] = [];
  const liveStrayPids: number[] = [];
  const liveDirs: string[] = [];

  afterEach(() => {
    for (const e of liveEngines) killIfAlive(e.realPid);
    liveEngines.length = 0;
    for (const pid of liveStrayPids) killIfAlive(pid);
    liveStrayPids.length = 0;
    for (const d of liveDirs) rmSync(d, { recursive: true, force: true });
    liveDirs.length = 0;
  });

  it('a hard-killed engine orphans its sandbox child; the NEXT real engine boot on the same workRoot reaps it', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'bsw1-'));
    liveDirs.push(workRoot);
    const configPath = writeConfig(workRoot, workRoot);

    const engine1 = await spawnEngine(configPath);
    liveEngines.push(engine1);
    const childPid = await startInfiniteLoopRun(engine1, workRoot);
    liveStrayPids.push(childPid);

    // SIGKILL the ENGINE itself — never server.close()/SIGINT/SIGTERM (that path is the
    // pre-existing shutdown-hook test's job, not this one's).
    process.kill(engine1.realPid, 'SIGKILL');
    liveEngines.length = 0; // already killed above
    await waitFor(() => (isAlive(engine1.realPid) ? undefined : true), 5000);

    // The orphan survives the engine's own death — exactly the reported incident's shape.
    expect(isAlive(childPid)).toBe(true);
    expect(existsSync(join(sandboxChildRegistryDir(workRoot), `${childPid}.json`))).toBe(true);

    const engine2 = await spawnEngine(configPath);
    liveEngines.push(engine2);

    await waitFor(() => (isAlive(childPid) ? undefined : true), 10000);
    expect(isAlive(childPid)).toBe(false);
    expect(existsSync(join(sandboxChildRegistryDir(workRoot), `${childPid}.json`))).toBe(false);
    liveStrayPids.length = 0; // reaped — nothing left to force-kill in afterEach
  }, 60000);

  it('a sibling engine booting on a DIFFERENT workRoot never reaps another LIVE engine\'s sandbox child', async () => {
    const workRootA = mkdtempSync(join(tmpdir(), 'bsw2a-'));
    const workRootB = mkdtempSync(join(tmpdir(), 'bsw2b-'));
    liveDirs.push(workRootA, workRootB);

    const engineA = await spawnEngine(writeConfig(workRootA, workRootA));
    liveEngines.push(engineA);
    const childPidA = await startInfiniteLoopRun(engineA, workRootA);
    liveStrayPids.push(childPidA);

    // engineA is still alive and well — engineB's boot sweep must only ever read workRootB's own
    // registry directory, never workRootA's, however it is implemented.
    const engineB = await spawnEngine(writeConfig(workRootB, workRootB));
    liveEngines.push(engineB);

    // Give engineB's boot sweep every chance to run before asserting the negative.
    await new Promise((r) => setTimeout(r, 500));
    expect(isAlive(childPidA)).toBe(true);
    expect(existsSync(join(sandboxChildRegistryDir(workRootA), `${childPidA}.json`))).toBe(true);
  }, 60000);
});
