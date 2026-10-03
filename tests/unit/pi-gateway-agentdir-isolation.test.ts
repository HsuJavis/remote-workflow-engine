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
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
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
      // Not the dir itself — its PARENT (join(tmpdir(), 'rwe-pi-agentdirs')), the directory EVERY
      // dispatch's own agentDir is created under, so one shared denyRead entry hides every sibling
      // dispatch's agentDir (and its mcp.log) from this dispatch's confined Bash, not just this one.
      const expectedParent = join(tmpdir(), 'rwe-pi-agentdirs');
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
      const parent = join(tmpdir(), 'rwe-pi-agentdirs');
      for (const dir of agentDirs) expect(dir.startsWith(parent + '/')).toBe(true); // ... under ONE shared parent
      for (const denyRead of capturedDenyReads) expect(denyRead).toContain(parent); // ... denied as one entry, covering both
    } finally {
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
