// pi harness v1, slice (c): PiGatewayClient.invoke() — model routing, auth, and the JSONL child
// protocol, exercised against a FAKE child process (no real spawn, no real pi/ollama) via the
// `spawnChild` test seam. The real end-to-end call against local ollama is covered separately
// (tests/acceptance/pi-harness-ollama-real.test.ts, gated on ollama being reachable).
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
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
