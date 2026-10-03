// pi harness v1, residual hardening (coordinator review, 2026-10-03): `agentDir` used to live at
// `<workspace>/.pi-agent-dir` — INSIDE the file-tool jail root and (when confined) inside bash's
// allowRead/allowWrite — so a Read/Write/Edit tool call, or an unconfined Bash, could plant pi
// config/extensions/mcp.json there for a LATER dispatch to load, and `workspace_pull` could read
// `mcp.log` back out. Fixed: agentDir is now a per-dispatch directory OUTSIDE the workspace
// (os.tmpdir(), mode 0700), explicitly denied for confined-bash reads, and removed when the dispatch
// ends. `.pi`/`.pi-agent-dir`/`.agents` are also swept from the workspace itself before every
// dispatch (defense in depth against a planted one), mirroring the sdk gateway's own
// sweepPlantedConfig wiring.
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, existsSync, statSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isPathContained } from '../../src/path-containment.js';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import type { AgentOpts } from '../../src/types.js';
import type { EngineEvent } from '../../src/event-log.js';

function fakeChild() {
  const emitter = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number; kill: () => void };
  emitter.stdin = new PassThrough();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.pid = 80000 + Math.floor(Math.random() * 10000);
  emitter.kill = () => {};
  return {
    child: emitter,
    stdinWritten: [] as string[],
    sendLine(obj: unknown) { emitter.stdout.write(JSON.stringify(obj) + '\n'); },
    exit(code: number | null = 0) { emitter.emit('exit', code, null); },
  };
}

describe('PiGatewayClient — agentDir lives outside the workspace (residual hardening)', () => {
  it('childConfig.agentDir is an absolute path outside the workspace and gets created 0700 before the child is spawned', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-ws2-'));
    try {
      let capturedAgentDir: string | undefined;
      let agentDirExistedAtSpawnTime = false;
      let agentDirModeAtSpawnTime = 0;
      const f = fakeChild();
      const spawnChild = ((_cmd: string, _args: string[], _opts: unknown) => {
        // The real gateway writes childConfig (including agentDir) to stdin AFTER spawning — capture
        // it from the write, same technique other pi-gateway-client tests already use.
        f.child.stdin.on('data', (d: Buffer) => {
          const cfg = JSON.parse(d.toString()) as { agentDir: string };
          capturedAgentDir = cfg.agentDir;
          agentDirExistedAtSpawnTime = existsSync(cfg.agentDir);
          if (agentDirExistedAtSpawnTime) agentDirModeAtSpawnTime = statSync(cfg.agentDir).mode & 0o777;
        });
        return f.child;
      }) as never;
      const gw = new PiGatewayClient({ spawnChild, entryPath: '/fake/entry.ts' });
      const promise = gw.invoke({
        prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts,
        runId: 'r2', agentId: 'a2', workspace: ws,
      });
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      await promise;

      expect(capturedAgentDir).toBeDefined();
      expect(isPathContained(resolve(capturedAgentDir!), resolve(ws))).toBe(false);
      expect(agentDirExistedAtSpawnTime).toBe(true);
      expect(agentDirModeAtSpawnTime).toBe(0o700);
      // Cleaned up after the dispatch settles.
      expect(existsSync(capturedAgentDir!)).toBe(false);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('agentDir is cleaned up after an ABORTED dispatch too', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-ws3-'));
    try {
      let capturedAgentDir: string | undefined;
      const f = fakeChild();
      const spawnChild = ((_cmd: string, _args: string[], _opts: unknown) => {
        f.child.stdin.on('data', (d: Buffer) => { capturedAgentDir = (JSON.parse(d.toString()) as { agentDir: string }).agentDir; });
        return f.child;
      }) as never;
      const gw = new PiGatewayClient({ spawnChild, entryPath: '/fake/entry.ts' });
      const controller = new AbortController();
      const promise = gw.invoke({
        prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts,
        runId: 'r3', agentId: 'a3', workspace: ws, signal: controller.signal,
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(capturedAgentDir).toBeDefined();
      expect(existsSync(capturedAgentDir!)).toBe(true);
      controller.abort();
      f.exit(null);
      await promise;
      expect(existsSync(capturedAgentDir!)).toBe(false);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('when confined + bash is requested, the agentDir PARENT (shared by every dispatch) is denied for Bash reads — review M4', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-ws4-'));
    try {
      let capturedAgentDir: string | undefined;
      let capturedDenyRead: string[] | undefined;
      const f = fakeChild();
      const spawnChild = ((_cmd: string, _args: string[], _opts: unknown) => {
        f.child.stdin.on('data', (d: Buffer) => {
          const cfg = JSON.parse(d.toString()) as { agentDir: string; sandbox?: { filesystem: { denyRead: string[] } } };
          capturedAgentDir = cfg.agentDir;
          capturedDenyRead = cfg.sandbox?.filesystem.denyRead;
        });
        return f.child;
      }) as never;
      const gw = new PiGatewayClient({
        spawnChild, entryPath: '/fake/entry.ts',
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: ws },
        resolveRipgrepOverride: () => ({ command: '/fake/claude', argv0: 'rg' }),
      });
      const promise = gw.invoke({
        prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] } as AgentOpts,
        runId: 'r4', agentId: 'a4', workspace: ws,
      });
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      await promise;
      expect(capturedAgentDir).toBeDefined();
      // Not the dir itself — its PARENT, the directory EVERY dispatch's own agentDir is created
      // under, so one shared denyRead entry hides every sibling dispatch's agentDir (and its
      // mcp.log) from this dispatch's confined Bash, not just this one.
      // review R2-1: the parent is no longer a single FIXED name shared by every uid on the host
      // (`join(tmpdir(), 'rwe-pi-agentdirs')`) — it lives under THIS dispatch's own `workRoot`
      // (`confinement.workRoot`, here == `ws`), which is already engine-owned and already
      // wholesale denyRead for confined Bash.
      const expectedParent = join(ws, 'pi-agentdirs');
      expect(capturedAgentDir).toMatch(new RegExp(`^${expectedParent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));
      expect(capturedDenyRead).toContain(expectedParent);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('two concurrent dispatches cannot read each other\'s agentDir through confined Bash — review M4', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-m4-'));
    try {
      const capturedDenyReads: string[][] = [];
      const agentDirs: string[] = [];
      const makeChild = () => {
        const f = fakeChild();
        f.child.stdin.on('data', (d: Buffer) => {
          const cfg = JSON.parse(d.toString()) as { agentDir: string; sandbox?: { filesystem: { denyRead: string[] } } };
          agentDirs.push(cfg.agentDir);
          if (cfg.sandbox) capturedDenyReads.push(cfg.sandbox.filesystem.denyRead);
        });
        return f;
      };
      const f1 = makeChild();
      const f2 = makeChild();
      let n = 0;
      const spawnChild = (() => (n++ === 0 ? f1.child : f2.child)) as never;
      const gw = new PiGatewayClient({
        spawnChild, entryPath: '/fake/entry.ts',
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: ws },
        resolveRipgrepOverride: () => ({ command: '/fake/claude', argv0: 'rg' }),
      });
      const dispatch = (f: ReturnType<typeof fakeChild>, runId: string) => gw.invoke({
        prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] } as AgentOpts,
        runId, agentId: 'a', workspace: ws,
      }).then(async (r) => { await new Promise((res) => setTimeout(res, 0)); return r; });
      const p1 = dispatch(f1, 'r-m4-1');
      const p2 = dispatch(f2, 'r-m4-2');
      await new Promise((r) => setTimeout(r, 10));
      f1.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f1.exit(0);
      f2.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f2.exit(0);
      await Promise.all([p1, p2]);

      expect(agentDirs.length).toBe(2);
      expect(agentDirs[0]).not.toBe(agentDirs[1]); // two distinct per-dispatch dirs ...
      const parent = join(ws, 'pi-agentdirs'); // review R2-1: under this dispatch's own workRoot, not a fixed /tmp name
      for (const dir of agentDirs) expect(dir.startsWith(parent + '/')).toBe(true); // ... under ONE shared parent
      for (const denyRead of capturedDenyReads) expect(denyRead).toContain(parent); // ... denied as one entry, covering both
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

// review R2-1 (coordinator round 2, HIGH): the parent used to be ONE FIXED, well-known name
// (`join(tmpdir(), 'rwe-pi-agentdirs')`) shared by every uid on the host — a deterministic self-
// update blocker (whichever uid creates it first locks every other uid out via `mkdtempSync` EACCES,
// escaping `invoke()` as a raw exception instead of a GatewayResult) and a privilege-escalation
// surface (another local user can pre-create it world-writable or as a symlink, then race the
// engine's own `bin/rg` shim — executed ON THE HOST, unsandboxed, by pi's Grep tool). Fixed: the
// parent now lives under THIS dispatch's own `confinement.workRoot` (already engine-owned, already
// wholesale denyRead) when one was given, or a private per-PROCESS `mkdtemp`-generated directory
// (never a literal name) otherwise — and every candidate is `lstat`-verified (not a symlink, owned
// by `process.getuid()`, mode 0700) before use, refusing with a typed `AGENTDIR_UNAVAILABLE`
// `GatewayResult` — never an escaping exception — when it is not.
describe('PiGatewayClient — the agentDir PARENT is private, verified, and fails closed (review R2-1)', () => {
  it('refuses with a typed AGENTDIR_UNAVAILABLE result (never throws/rejects) when the parent path is a symlink', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-r2-1-symlink-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-r2-1-elsewhere-'));
    try {
      // The attack this reproduces: another local user (or a leftover from a different uid) left a
      // symlink where the engine's own agentDir parent should be.
      symlinkSync(elsewhere, join(ws, 'pi-agentdirs'));
      const f = fakeChild();
      const gw = new PiGatewayClient({
        spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: ws },
      });
      const result = await gw.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts, runId: 'r-r2-1a', agentId: 'a', workspace: ws });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/AGENTDIR_UNAVAILABLE/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  // review round 3, LOW-1: the symlink test above only proved the FINAL verdict (refused). The
  // review found that the pre-fix code called `chmodSync(parent, 0o700)` BEFORE `verifyPrivateDir`'s
  // lstat check ever ran — `chmodSync` FOLLOWS a symlink, so a symlink pointing at a directory this
  // engine does not even intend to touch had its mode silently flipped to 0700 before the refusal
  // fired. This asserts the SIDE EFFECT never happens, not just the verdict.
  it("review R3 LOW-1: a symlinked parent is refused WITHOUT ever chmod'ing the symlink's target — the target's own mode is untouched", async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-low1-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-low1-elsewhere-'));
    chmodSync(elsewhere, 0o755); // a mode the fix must never touch, let alone "repair" to 0700
    try {
      symlinkSync(elsewhere, join(ws, 'pi-agentdirs'));
      const f = fakeChild();
      const gw = new PiGatewayClient({
        spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: ws },
      });
      const result = await gw.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts, runId: 'r-low1', agentId: 'a', workspace: ws });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/AGENTDIR_UNAVAILABLE/);
      expect(statSync(elsewhere).mode & 0o777).toBe(0o755);
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('repairs the mode (chmod back to 0700) and proceeds when the parent pre-exists too permissive but is still owned by this process', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-r2-1-mode-'));
    try {
      const parent = join(ws, 'pi-agentdirs');
      mkdirSync(parent, { recursive: true });
      chmodSync(parent, 0o755); // too permissive — same uid, so the engine both CAN and MUST fix this
      const f = fakeChild();
      const gw = new PiGatewayClient({
        spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: ws },
      });
      const promise = gw.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts, runId: 'r-r2-1b', agentId: 'a', workspace: ws });
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      const result = await promise;
      expect(result.ok).toBe(true);
      expect(statSync(parent).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('with no confinement.workRoot wired at all, the parent is a private per-process directory, never the old fixed name — shared across two gateways in the same process', async () => {
    const f1 = fakeChild();
    const f2 = fakeChild();
    let capturedParent1: string | undefined;
    let capturedParent2: string | undefined;
    const spawnChild1 = ((_cmd: string, _args: string[], _opts: unknown) => {
      f1.child.stdin.on('data', (d: Buffer) => { capturedParent1 = resolve((JSON.parse(d.toString()) as { agentDir: string }).agentDir, '..'); });
      return f1.child;
    }) as never;
    const spawnChild2 = ((_cmd: string, _args: string[], _opts: unknown) => {
      f2.child.stdin.on('data', (d: Buffer) => { capturedParent2 = resolve((JSON.parse(d.toString()) as { agentDir: string }).agentDir, '..'); });
      return f2.child;
    }) as never;
    const gw1 = new PiGatewayClient({ spawnChild: spawnChild1, entryPath: '/fake/entry.ts' });
    const gw2 = new PiGatewayClient({ spawnChild: spawnChild2, entryPath: '/fake/entry.ts' });
    const ws1 = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-r2-1-noroot1-'));
    const ws2 = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-r2-1-noroot2-'));
    try {
      const p1 = gw1.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts, runId: 'r-r2-1c1', agentId: 'a', workspace: ws1 });
      await new Promise((r) => setTimeout(r, 10));
      f1.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f1.exit(0);
      await p1;
      const p2 = gw2.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts, runId: 'r-r2-1c2', agentId: 'a', workspace: ws2 });
      await new Promise((r) => setTimeout(r, 10));
      f2.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f2.exit(0);
      await p2;

      expect(capturedParent1).toBeDefined();
      expect(capturedParent2).toBeDefined();
      // Same process -> ONE shared private parent (memoized, created once) ...
      expect(capturedParent1).toBe(capturedParent2);
      // ... and it is NEVER the old fixed, cross-uid-shared name.
      expect(capturedParent1).not.toBe(join(tmpdir(), 'rwe-pi-agentdirs'));
    } finally {
      rmSync(ws1, { recursive: true, force: true });
      rmSync(ws2, { recursive: true, force: true });
    }
  });
});

// review round 3 (HIGH, R3-1): srt sets confined bash's `TMPDIR` to its own hardcoded, cross-run-
// shared `/tmp/claude` whenever `CLAUDE_CODE_TMPDIR` is unset — never set by this gateway before this
// fix. This is the ungated unit-level proof of the CONFIG PROJECTION (what `invoke()` puts on
// `childConfig`/`sandbox`) — the real-tier proof that it actually WORKS inside a real bwrap sandbox
// lives in pi-harness-bash-confinement-real.test.ts (needs bwrap/socat, opt-in).
describe("PiGatewayClient — per-dispatch TMPDIR scratch, never srt's shared /tmp/claude (review round 3, R3-1)", () => {
  it('childConfig.tmpDir is a verified per-dispatch directory under <workRoot>/pi-tmp/, removed after the dispatch settles', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-tmpdir-r3-1-'));
    try {
      let capturedTmpDir: string | undefined;
      const f = fakeChild();
      f.child.stdin.on('data', (d: Buffer) => { capturedTmpDir = (JSON.parse(d.toString()) as { tmpDir: string }).tmpDir; });
      const gw = new PiGatewayClient({
        spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: ws },
      });
      const promise = gw.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts, runId: 'r-tmp1', agentId: 'a', workspace: ws });
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      await promise;
      expect(capturedTmpDir).toBeDefined();
      const expectedParent = join(ws, 'pi-tmp');
      expect(capturedTmpDir).toMatch(new RegExp(`^${expectedParent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));
      // Distinct from agentDir's own parent — two independent scratch kinds, never sharing one dir.
      expect(capturedTmpDir).not.toMatch(/pi-agentdirs/);
      expect(existsSync(capturedTmpDir!)).toBe(false);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('when confined + bash is requested, the tmpDir PARENT is denied for read, and the literal /tmp/claude is denied for write (read-deny is a documented no-op there — see hostSharedTmpdirRefusal instead)', async () => {
    // review round 3 owner correction: hostSharedTmpdirRefusal() now refuses the dispatch outright
    // whenever /tmp/claude exists at all (see its own doc) — guard so this test never spuriously fails
    // on a host where it's genuinely present, the same caution the dedicated describe block below uses.
    if (existsSync('/tmp/claude')) return;
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-tmpdir-r3-1-deny-'));
    try {
      let capturedDenyRead: string[] | undefined;
      let capturedDenyWrite: string[] | undefined;
      const f = fakeChild();
      f.child.stdin.on('data', (d: Buffer) => {
        const cfg = JSON.parse(d.toString()) as { sandbox?: { filesystem: { denyRead: string[]; denyWrite: string[] } } };
        capturedDenyRead = cfg.sandbox?.filesystem.denyRead;
        capturedDenyWrite = cfg.sandbox?.filesystem.denyWrite;
      });
      const gw = new PiGatewayClient({
        spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: ws },
        resolveRipgrepOverride: () => ({ command: '/fake/claude', argv0: 'rg' }),
      });
      const promise = gw.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] } as AgentOpts, runId: 'r-tmp2', agentId: 'a', workspace: ws });
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      await promise;
      // Deliberately NOT asserted: `/tmp/claude` in denyRead — it would be a no-op there even combined
      // with denyWrite (srt's own unconditional write-bind wins over a later read-deny mask, confirmed
      // live both ways), so this gateway never puts it there; the real protection against its content
      // being read is `hostSharedTmpdirRefusal()`'s hard refuse-when-present, verified separately.
      expect(capturedDenyWrite).toContain('/tmp/claude');
      expect(capturedDenyRead).toContain(join(ws, 'pi-tmp'));
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('two concurrent dispatches get distinct tmpDir scratch dirs under one shared, verified parent', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-tmpdir-r3-1-concurrent-'));
    try {
      const tmpDirs: string[] = [];
      const makeChild = () => {
        const f = fakeChild();
        f.child.stdin.on('data', (d: Buffer) => { tmpDirs.push((JSON.parse(d.toString()) as { tmpDir: string }).tmpDir); });
        return f;
      };
      const f1 = makeChild();
      const f2 = makeChild();
      let n = 0;
      const spawnChild = (() => (n++ === 0 ? f1.child : f2.child)) as never;
      const gw = new PiGatewayClient({
        spawnChild, entryPath: '/fake/entry.ts',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: ws },
      });
      const dispatch = (f: ReturnType<typeof fakeChild>, runId: string) => gw.invoke({
        prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts, runId, agentId: 'a', workspace: ws,
      });
      const p1 = dispatch(f1, 'r-tmp3-1');
      const p2 = dispatch(f2, 'r-tmp3-2');
      await new Promise((r) => setTimeout(r, 10));
      f1.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f1.exit(0);
      f2.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f2.exit(0);
      await Promise.all([p1, p2]);

      expect(tmpDirs.length).toBe(2);
      expect(tmpDirs[0]).not.toBe(tmpDirs[1]);
      const parent = join(ws, 'pi-tmp');
      for (const dir of tmpDirs) expect(dir.startsWith(parent + '/')).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

// review round 3, R3-1: `hostSharedTmpdirRefusal()`'s hard refuse-when-present — srt's own literal
// `/tmp/claude` is a FIXED, global host path (not test-scoped the way agentDir/tmpDir's own verified
// parents are), so these tests touch it directly. Every case guards with `existsSync` first and
// skips rather than risk clobbering a real pre-existing one in a shared/dev environment — on a clean
// host (the normal case, confirmed earlier via the reviewer's own cmd-drive.mts repro) this always
// runs for real. Neither test ever writes to, nor deletes anything from, a /tmp/claude it did not
// itself create within the test body (review round 3 owner correction — see PI_HOST_SHARED_TMPDIR's
// own doc in pi-gateway-client.ts for the full "why").
describe("PiGatewayClient — hostSharedTmpdirRefusal() verifies /tmp/claude before every confined dispatch (review round 3, R3-1)", () => {
  const HOST_SHARED = '/tmp/claude';

  it('refuses HOST_SHARED_TMPDIR_UNSAFE when /tmp/claude exists but is not a plain directory (a symlink)', async () => {
    if (existsSync(HOST_SHARED)) return; // do not touch a real pre-existing one
    const elsewhere = mkdtempSync(join(tmpdir(), 'rwe-pi-tmp-claude-elsewhere-'));
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-tmp-claude-ws1-'));
    try {
      symlinkSync(elsewhere, HOST_SHARED);
      const f = fakeChild();
      const gw = new PiGatewayClient({
        spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: ws },
        resolveRipgrepOverride: () => ({ command: '/fake/claude', argv0: 'rg' }),
      });
      const result = await gw.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] } as AgentOpts, runId: 'r-hstmp-symlink', agentId: 'a', workspace: ws });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/HOST_SHARED_TMPDIR_UNSAFE/);
    } finally {
      rmSync(HOST_SHARED, { force: true }); // unlinks the symlink itself, never follows it
      rmSync(elsewhere, { recursive: true, force: true });
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('review round 3 owner correction: when /tmp/claude already exists (even a plain directory owned by this very process), the dispatch is REFUSED and its contents are left completely untouched — never emptied, never deleted', async () => {
    if (existsSync(HOST_SHARED)) return; // do not touch a real pre-existing one
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-tmp-claude-ws2-'));
    try {
      mkdirSync(HOST_SHARED, { recursive: true });
      chmodSync(HOST_SHARED, 0o700);
      writeFileSync(join(HOST_SHARED, 'stale-from-a-past-dispatch.txt'), 'STALE_CONTENT');
      const f = fakeChild();
      const gw = new PiGatewayClient({
        spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: ws },
        resolveRipgrepOverride: () => ({ command: '/fake/claude', argv0: 'rg' }),
      });
      const result = await gw.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] } as AgentOpts, runId: 'r-hstmp-refuse', agentId: 'a', workspace: ws });
      // Masking /tmp/claude from inside the sandbox is not achievable through srt's config surface
      // (see PI_HOST_SHARED_TMPDIR's own doc for the live-proven "why"), and this engine must never
      // delete a shared host path's files — even ones it believes it owns, since the ORIGINAL repro
      // (run A's secret read by run B) happens even when both share this same uid. So the only safe
      // behavior is a hard refusal, leaving the host path exactly as it was found.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/HOST_SHARED_TMPDIR_UNSAFE/);
      expect(existsSync(join(HOST_SHARED, 'stale-from-a-past-dispatch.txt'))).toBe(true);
      expect(readFileSync(join(HOST_SHARED, 'stale-from-a-past-dispatch.txt'), 'utf8')).toBe('STALE_CONTENT');
    } finally {
      rmSync(HOST_SHARED, { recursive: true, force: true });
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('PiGatewayClient — sweeps planted SHARED project config (.claude/*, .mcp.json) before dispatch; .pi/.pi-agent-dir/.agents are deliberately NOT swept (review M1/B1)', () => {
  it('a planted .claude/settings.json is removed before the child is spawned, reported on the harness descriptor and as agent.planted_config_removed (same sweepPlantedConfig the sdk gateway uses)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-planted-'));
    try {
      const plantedClaude = join(ws, '.claude');
      mkdirSync(plantedClaude, { recursive: true });
      writeFileSync(join(plantedClaude, 'settings.json'), '{"hooks":{}}');

      const f = fakeChild();
      const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
      const events: EngineEvent[] = [];
      gw.bindEventSink((ev) => events.push(ev));
      const harnessCalls: Array<{ plantedConfigRemoved?: string[] }> = [];
      const promise = gw.invoke({
        prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts,
        runId: 'r5', agentId: 'a5', workspace: ws,
        onHarness: async (h) => { harnessCalls.push(h as never); },
      });
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(existsSync(join(plantedClaude, 'settings.json'))).toBe(false);
      expect(harnessCalls[0]?.plantedConfigRemoved).toEqual(['.claude/settings.json']);
      const removedEvents = events.filter((e): e is Extract<EngineEvent, { kind: 'agent.planted_config_removed' }> => e.kind === 'agent.planted_config_removed');
      expect(removedEvents.length).toBe(1);
      expect(removedEvents[0]!.removed).toEqual(['.claude/settings.json']);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('a planted .pi-agent-dir and .pi are left ALONE (review M1/B1: reverted — pi\'s full-control ResourceLoader never discovers them, so there is nothing to protect against; see bash-confinement.ts\'s PROJECT_CONFIG_PATHS doc comment)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-notswept-'));
    try {
      const plantedDir = join(ws, '.pi-agent-dir');
      mkdirSync(plantedDir, { recursive: true });
      writeFileSync(join(plantedDir, 'mcp.json'), '{"servers":{}}');
      const plantedPi = join(ws, '.pi');
      mkdirSync(plantedPi, { recursive: true });
      writeFileSync(join(plantedPi, 'settings.json'), '{}');
      const plantedAgents = join(ws, '.agents');
      mkdirSync(plantedAgents, { recursive: true });
      writeFileSync(join(plantedAgents, 'README.md'), 'x');

      const f = fakeChild();
      const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
      const harnessCalls: Array<{ plantedConfigRemoved?: string[] }> = [];
      const promise = gw.invoke({
        prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts,
        runId: 'r5b', agentId: 'a5b', workspace: ws,
        onHarness: async (h) => { harnessCalls.push(h as never); },
      });
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      await promise;

      expect(existsSync(plantedDir)).toBe(true);
      expect(existsSync(plantedPi)).toBe(true);
      expect(existsSync(plantedAgents)).toBe(true);
      expect(harnessCalls[0]?.plantedConfigRemoved).toBeUndefined();
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('no planted config at all -> no agent.planted_config_removed event, no plantedConfigRemoved field', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-agentdir-clean-'));
    try {
      const f = fakeChild();
      const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
      const events: EngineEvent[] = [];
      gw.bindEventSink((ev) => events.push(ev));
      const harnessCalls: Array<{ plantedConfigRemoved?: string[] }> = [];
      const promise = gw.invoke({
        prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts,
        runId: 'r6', agentId: 'a6', workspace: ws,
        onHarness: async (h) => { harnessCalls.push(h as never); },
      });
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      await promise;
      expect(harnessCalls[0]?.plantedConfigRemoved).toBeUndefined();
      expect(events.filter((e) => e.kind === 'agent.planted_config_removed')).toEqual([]);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
