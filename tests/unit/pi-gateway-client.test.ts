// pi harness v1, slice (c): PiGatewayClient.invoke() — model routing, auth, and the JSONL child
// protocol, exercised against a FAKE child process (no real spawn, no real pi/ollama) via the
// `spawnChild` test seam. The real end-to-end call against local ollama is covered separately
// (tests/acceptance/pi-harness-ollama-real.test.ts, gated on ollama being reachable).
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import type { AgentOpts } from '../../src/types.js';

/** A fake detached child process: captures everything written to stdin, lets the test push JSONL
 *  lines onto stdout, and exits when the test calls `exit()` — mirrors exactly the surface
 *  PiGatewayClient's `_dispatchOnce` touches (stdin/stdout/stderr/pid/kill/on/once). */
function fakeChild() {
  const emitter = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number; kill: ReturnType<typeof vi.fn> };
  emitter.stdin = new PassThrough();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.pid = 4242;
  emitter.kill = vi.fn();
  const stdinWritten: string[] = [];
  emitter.stdin.on('data', (d: Buffer) => stdinWritten.push(d.toString()));
  return {
    child: emitter,
    stdinWritten,
    sendLine: (obj: unknown) => emitter.stdout.write(JSON.stringify(obj) + '\n'),
    exit: (code: number | null = 0) => emitter.emit('exit', code, null),
  };
}

function req(overrides: Partial<Parameters<PiGatewayClient['invoke']>[0]> = {}) {
  return {
    prompt: 'hi',
    opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts,
    runId: 'r1',
    agentId: 'a1',
    workspace: '/tmp/pi-gw-unit-ws',
    ...overrides,
  };
}

describe('PiGatewayClient — model routing and auth (slice a/c)', () => {
  it('an omitted model is refused as an internal error, never silently dispatched', async () => {
    const gw = new PiGatewayClient({});
    const result = await gw.invoke(req({ opts: {} as AgentOpts }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/INTERNAL_ERROR/);
  });

  it('refuses anthropic/* defensively even if admission somehow let it through (owner decision 2)', async () => {
    const gw = new PiGatewayClient({});
    const result = await gw.invoke(req({ opts: { model: 'anthropic/claude-haiku-4-5-20251001' } as AgentOpts }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toMatch(/PROVIDER_UNSUPPORTED_BY_HARNESS/);
      expect(result.retryable).toBe(false);
    }
  });

  it('refuses an openrouter dispatch with no API key in the secret store (OPENROUTER_AUTH_MISSING)', async () => {
    const gw = new PiGatewayClient({ secretSource: { resolve: () => undefined } });
    const result = await gw.invoke(req({ opts: { model: 'openrouter/openai/gpt-4.1' } as AgentOpts }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/OPENROUTER_AUTH_MISSING/);
  });

  it('refuses a dispatch whose signal is already aborted before spawning anything', async () => {
    const gw = new PiGatewayClient({});
    const controller = new AbortController();
    controller.abort();
    const result = await gw.invoke(req({ signal: controller.signal }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/aborted by caller/);
  });
});

describe('PiGatewayClient — JSONL child protocol (slice c)', () => {
  it('writes the child its config as ONE JSON line on stdin (never argv, never env)', async () => {
    const f = fakeChild();
    const spawnChild = vi.fn(() => f.child as never);
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req());
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(f.stdinWritten.length).toBeGreaterThan(0);
    const sent = JSON.parse(f.stdinWritten.join(''));
    expect(sent.prompt).toBe('hi');
    expect(sent.model).toEqual({ provider: 'ollama', model: 'qwen2.5:7b', baseUrl: 'http://localhost:11434' });
    expect(spawnChild).toHaveBeenCalledWith('node', expect.arrayContaining(['--experimental-transform-types', '/fake/entry.ts']), expect.objectContaining({ detached: true }));
  });

  it('never puts the OpenRouter API key into the spawned child\'s env (only onto childConfig.apiKey, read off stdin)', async () => {
    const f = fakeChild();
    const spawnChild = vi.fn((_cmd: string, _args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
      expect(opts.env?.['OPENROUTER_API_KEY']).toBeUndefined();
      expect(JSON.stringify(opts.env)).not.toContain('sk-or-super-secret');
      return f.child as never;
    });
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', secretSource: { resolve: () => 'sk-or-super-secret' } });
    const promise = gw.invoke(req({ opts: { model: 'openrouter/openai/gpt-4.1' } as AgentOpts }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    await promise;
    expect(spawnChild).toHaveBeenCalled();
    const sent = JSON.parse(f.stdinWritten.join(''));
    expect(sent.apiKey).toBe('sk-or-super-secret'); // present on the wire TO THE CHILD, never in its env
  });

  it('sums usage across every assistant message_end and streams it live via onUsage', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const usages: unknown[] = [];
    const promise = gw.invoke(req({ onUsage: (u) => usages.push({ ...u }) }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'message_end', seq: 1, text: 'a', usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.sendLine({ t: 'final', seq: 1, text: 'a', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tokens).toEqual({ input: 10, output: 2, cacheRead: 0, cacheWrite: 0 });
    expect(usages).toEqual([{ input: 10, output: 2, cacheRead: 0, cacheWrite: 0 }]);
  });

  it('an error event becomes a terminal GatewayResult carrying any usage accrued so far, marked partial', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req());
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'message_end', seq: 1, text: 'partial', usage: { input: 5, output: 1, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.sendLine({ t: 'error', message: 'MODEL_REGISTRATION_FAILED: boom' });
    f.exit(1);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toMatch(/MODEL_REGISTRATION_FAILED/);
      expect(result.partial).toBe(true);
      expect(result.tokens).toEqual({ input: 5, output: 1, cacheRead: 0, cacheWrite: 0 });
    }
  });

  it('a child that exits with no final/error event is a terminal, non-retryable failure naming the exit code', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req());
    await new Promise((r) => setTimeout(r, 10));
    f.exit(1);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.detail).toMatch(/exited before reporting a result/);
      expect(result.detail).toMatch(/code 1/);
    }
  });

  it('every result is stamped transport:"pi"', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req());
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    const result = await promise;
    expect(result.transport).toBe('pi');
  });
});

describe('PiGatewayClient — tool mapping + bash readonly (slices d/e)', () => {
  it('refuses an unmapped tool (WebFetch) with TOOL_UNSUPPORTED_BY_HARNESS, never spawning a child', async () => {
    const spawnChild = vi.fn();
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts' });
    const result = await gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Read', 'WebFetch'] } as AgentOpts }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toMatch(/TOOL_UNSUPPORTED_BY_HARNESS/);
      expect(result.detail).toMatch(/WebFetch/);
      expect(result.retryable).toBe(false);
    }
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it('maps every supported engine tool name to its pi name and sends it on childConfig.tools', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'LS'] } as AgentOpts }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    await promise;
    const sent = JSON.parse(f.stdinWritten.join(''));
    expect(sent.tools.sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write'].sort());
  });

  it('review M2: accepts an mcp__<server>__<tool> entry in allowedTools (docs/AUTHORING.md:50\'s documented pre-approval pattern), never refusing it', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Read', 'mcp__everything__echo'] } as AgentOpts }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    const sent = JSON.parse(f.stdinWritten.join(''));
    expect(sent.tools.sort()).toEqual(['mcp__everything__echo', 'read'].sort());
  });

  it("refuses bash:'readonly' as BASH_READONLY_UNENFORCEABLE on an unconfined posture, never spawning a child", async () => {
    const spawnChild = vi.fn();
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', confinementPosture: 'unconfined' });
    const result = await gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'], bash: 'readonly' } as AgentOpts }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/BASH_READONLY_UNENFORCEABLE/);
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it("refuses bash:'readonly' beside a write tool as BASH_READONLY_CONFLICT", async () => {
    // review R2-1: a real per-test workRoot, never the old literal `/tmp/pi-gw-unit-ws` — that
    // string drove `confinement.workRoot`, which `piAgentDirParent()` now actually `mkdirSync`s
    // under (review R2-1's own fix), so a shared fixed literal across tests/files is exactly the
    // "never a fixed /tmp path" hazard the review calls out, even though this call is refused for
    // an unrelated reason before a child is ever spawned.
    const root = mkdtempSync(join(tmpdir(), 'rwe-pi-unit-readonly-conflict-'));
    try {
      const spawnChild = vi.fn();
      const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', confinementPosture: 'confined', confinement: { allowHostPaths: [], protectedFiles: [], workRoot: root } });
      const result = await gw.invoke(req({ workspace: root, opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash', 'Write'], bash: 'readonly' } as AgentOpts }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/BASH_READONLY_CONFLICT/);
      expect(spawnChild).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds a sandbox config (with a resolved ripgrep override) onto childConfig when posture is confined and bash is requested', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rwe-pi-unit-sandbox-cfg-')); // review R2-1: real per-test workRoot
    try {
      const f = fakeChild();
      const gw = new PiGatewayClient({
        spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: ['/home/x/.creds'], workRoot: root },
        resolveRipgrepOverride: () => ({ command: '/fake/claude', argv0: 'rg' }),
      });
      const promise = gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] } as AgentOpts }));
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      await promise;
      const sent = JSON.parse(f.stdinWritten.join(''));
      expect(sent.sandbox.ripgrepOverride).toEqual({ command: '/fake/claude', argv0: 'rg' });
      expect(sent.sandbox.filesystem).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never builds a sandbox config when posture is unconfined — bash runs unwrapped, never a false confinement claim', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts', confinementPosture: 'unconfined' });
    const promise = gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] } as AgentOpts }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    await promise;
    const sent = JSON.parse(f.stdinWritten.join(''));
    expect(sent.sandbox).toBeUndefined();
  });

  it('slice (g): resolves a declared MCP server (with a ${secret:} substitution) and sends it to the child, never refusing', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({
      spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
      secretSource: { resolve: (name) => (name === 'EVERYTHING_TOKEN' ? 'sk-real-value' : undefined) },
      resolveMcp: async (_wf, names) => ({
        configs: Object.fromEntries(names.map((n) => [n, { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], env: { TOKEN: '${secret:EVERYTHING_TOKEN}' } }])),
        missing: [],
      }),
    });
    const promise = gw.invoke(req({
      opts: { model: 'ollama/qwen2.5:7b', mcp: ['everything'] } as AgentOpts,
      assets: { roots: { workflow: '/wf', global: '/gl' }, declared: { skills: [], mcp: ['everything'] }, workflow: 'wf' },
    }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    const sent = JSON.parse(f.stdinWritten.join(''));
    expect(sent.mcp.everything).toEqual({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], env: { TOKEN: 'sk-real-value' } });
  });

  it('slice (g): a declared MCP name with no resolveMcp bound lands in materialized.missing and the run PROCEEDS (owner decision 19.5.3, no refusal)', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    let harness: { materialized?: { missing: string[] } } | undefined;
    const promise = gw.invoke(req({
      opts: { model: 'ollama/qwen2.5:7b', mcp: ['everything'] } as AgentOpts,
      assets: { roots: { workflow: '/wf', global: '/gl' }, declared: { skills: [], mcp: ['everything'] }, workflow: 'wf' },
      onHarness: async (h) => { harness = h as never; },
    }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(harness?.materialized?.missing).toEqual(['everything']);
    const sent = JSON.parse(f.stdinWritten.join(''));
    expect(sent.mcp).toBeUndefined();
  });

  it('slice (h): materializes a declared skill and sends its path to the child when read is in the tool set', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rwe-pi-skill-unit-'));
    try {
      const ws = join(root, 'ws');
      mkdirSync(ws, { recursive: true });
      mkdirSync(join(root, 'wf', 'skill', 'my-skill'), { recursive: true });
      writeFileSync(join(root, 'wf', 'skill', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\nBody');
      const f = fakeChild();
      const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
      const promise = gw.invoke(req({
        workspace: ws,
        opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Read'] } as AgentOpts,
        assets: { roots: { workflow: join(root, 'wf'), global: join(root, 'gl') }, declared: { skills: ['my-skill'], mcp: [] }, workflow: 'wf' },
      }));
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      const result = await promise;
      expect(result.ok).toBe(true);
      const sent = JSON.parse(f.stdinWritten.join(''));
      // Issue #144: the skill materializes into THIS dispatch's own private `tmpDir`, never under
      // the run workspace — `skillPaths` points outside `ws` entirely, and `ws/.claude/skills` is
      // never created at all.
      expect(sent.skillPaths).toHaveLength(1);
      expect(sent.skillPaths[0].startsWith(ws)).toBe(false);
      expect(sent.skillPaths[0].endsWith(join('skills', 'my-skill'))).toBe(true);
      expect(existsSync(join(ws, '.claude', 'skills'))).toBe(false);
      // `skillReadRoots` widens the pi file-jail (session-runner.ts's `assertJailed`) so the model's
      // own read/grep/find/ls can follow the absolute path pi's skill-prompt listing gives it.
      expect(sent.skillReadRoots).toEqual([dirname(dirname(sent.skillPaths[0]))]);
      // The private per-dispatch directory (`tmpDir`, which `skill-assets` lives under) is removed
      // once the call settles — `invoke()`'s own `removePiAgentDir(tmpDir)` finally, unconditional
      // regardless of outcome. Checked here via the very path the child was told about.
      expect(existsSync(sent.skillReadRoots[0])).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('slice (h): materializes a declared skill and sends its path to the child when ONLY bash (no read) is in the tool set — pi\'s own system-prompt.js accepts bash as a skill-file-read tool too', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rwe-pi-skill-unit-bashonly-'));
    try {
      const ws = join(root, 'ws');
      mkdirSync(ws, { recursive: true });
      mkdirSync(join(root, 'wf', 'skill', 'my-skill'), { recursive: true });
      writeFileSync(join(root, 'wf', 'skill', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\nBody');
      const f = fakeChild();
      const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
      const promise = gw.invoke(req({
        workspace: ws,
        opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] } as AgentOpts,
        assets: { roots: { workflow: join(root, 'wf'), global: join(root, 'gl') }, declared: { skills: ['my-skill'], mcp: [] }, workflow: 'wf' },
      }));
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      const result = await promise;
      expect(result.ok).toBe(true);
      const sent = JSON.parse(f.stdinWritten.join(''));
      expect(sent.skillPaths).toHaveLength(1);
      expect(sent.skillPaths[0].startsWith(ws)).toBe(false);
      expect(sent.skillPaths[0].endsWith(join('skills', 'my-skill'))).toBe(true);
      expect(existsSync(join(ws, '.claude', 'skills'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Issue #144: the private skill directory (`skillDir`, a sibling of `tmpDir`/`agentDir`) is
  // removed in `invoke()`'s own `finally` regardless of outcome — proven here on the ERROR path
  // (success is already proven by the two tests above).
  it("slice (h)/issue #144: the private skill directory is removed even when the child reports an error (not only on success)", async () => {
    const root = mkdtempSync(join(tmpdir(), 'rwe-pi-skill-unit-errcleanup-'));
    try {
      const ws = join(root, 'ws');
      mkdirSync(ws, { recursive: true });
      mkdirSync(join(root, 'wf', 'skill', 'my-skill'), { recursive: true });
      writeFileSync(join(root, 'wf', 'skill', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\nBody');
      const f = fakeChild();
      const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
      const promise = gw.invoke(req({
        workspace: ws,
        opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Read'] } as AgentOpts,
        assets: { roots: { workflow: join(root, 'wf'), global: join(root, 'gl') }, declared: { skills: ['my-skill'], mcp: [] }, workflow: 'wf' },
      }));
      await new Promise((r) => setTimeout(r, 10));
      const sentBeforeExit = JSON.parse(f.stdinWritten.join(''));
      const skillDir = sentBeforeExit.skillReadRoots[0] as string;
      f.sendLine({ t: 'error', message: 'MODEL_REGISTRATION_FAILED: boom' });
      f.exit(1);
      const result = await promise;
      expect(result.ok).toBe(false);
      expect(existsSync(skillDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('slice (h): refuses SKILL_REQUIRES_READ_TOOL when a skill is declared but NEITHER read NOR bash is in the tool set (decided+documented policy)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rwe-pi-skill-unit-norread-'));
    try {
      const ws = join(root, 'ws');
      mkdirSync(ws, { recursive: true });
      mkdirSync(join(root, 'wf', 'skill', 'my-skill'), { recursive: true });
      writeFileSync(join(root, 'wf', 'skill', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\nBody');
      const spawnChild = vi.fn();
      const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts' });
      const result = await gw.invoke(req({
        workspace: ws,
        opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Grep'] } as AgentOpts,
        assets: { roots: { workflow: join(root, 'wf'), global: join(root, 'gl') }, declared: { skills: ['my-skill'], mcp: [] }, workflow: 'wf' },
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/SKILL_REQUIRES_READ_TOOL/);
      expect(spawnChild).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('maps tool_call/tool_result child events onto TranscriptEvent kind:tool_call/tool_result (slice f)', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const events: unknown[] = [];
    const promise = gw.invoke(req({ onEvent: (ev) => { events.push(ev); } }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'tool_call', toolCallId: 'tc1', toolName: 'bash', argsJson: JSON.stringify({ command: 'echo hi' }) });
    f.sendLine({ t: 'tool_result', toolCallId: 'tc1', toolName: 'bash', resultJson: JSON.stringify({ exitCode: 0 }), isError: false });
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    await promise;
    const call = events.find((e: any) => e.kind === 'tool_call') as any;
    const result = events.find((e: any) => e.kind === 'tool_result') as any;
    expect(call.data).toEqual({ toolCallId: 'tc1', toolName: 'bash', args: { command: 'echo hi' } });
    expect(result.data).toEqual({ toolCallId: 'tc1', toolName: 'bash', result: { exitCode: 0 }, isError: false });
  });

  it('claims effortApplied:true for openrouter (verified on the real wire) and false for ollama (no dial)', async () => {
    const f1 = fakeChild();
    const gw1 = new PiGatewayClient({ spawnChild: (() => f1.child) as never, entryPath: '/fake/entry.ts', secretSource: { resolve: () => 'fake-key' } });
    let harness1: any;
    const p1 = gw1.invoke(req({ opts: { model: 'openrouter/openai/gpt-4.1', effort: 'high' } as AgentOpts, onHarness: async (h, applied) => { harness1 = { h, applied }; } }));
    await new Promise((r) => setTimeout(r, 10));
    f1.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f1.exit(0);
    await p1;
    expect(harness1.applied).toEqual({ applied: true, param: 'thinkingLevel', restPath: ['reasoning', 'effort'], value: 'high' });
    expect(harness1.h.effortApplied).toEqual({ param: 'thinkingLevel', value: 'high' });

    const f2 = fakeChild();
    const gw2 = new PiGatewayClient({ spawnChild: (() => f2.child) as never, entryPath: '/fake/entry.ts' });
    let harness2: any;
    const p2 = gw2.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', effort: 'high' } as AgentOpts, onHarness: async (h, applied) => { harness2 = { h, applied }; } }));
    await new Promise((r) => setTimeout(r, 10));
    f2.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f2.exit(0);
    await p2;
    expect(harness2.applied).toEqual({ applied: false, reason: 'ollama has no reasoning dial' });
    expect(harness2.h.effortApplied).toEqual({ reason: 'ollama has no reasoning dial' });
  });

  it('the eager harness descriptor reports bash.enforced honestly from the measured posture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rwe-pi-unit-harness-bash-')); // review R2-1: real per-test workRoot
    try {
      const f = fakeChild();
      const gw = new PiGatewayClient({
        spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot: root },
        resolveRipgrepOverride: () => ({ command: '/fake/claude', argv0: 'rg' }),
      });
      let harness: { bash?: { mode: string; enforced: boolean } } | undefined;
      const promise = gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] } as AgentOpts, onHarness: async (h) => { harness = h as never; } }));
      await new Promise((r) => setTimeout(r, 10));
      f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
      f.exit(0);
      await promise;
      expect(harness?.bash).toEqual({ mode: 'full', enforced: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
