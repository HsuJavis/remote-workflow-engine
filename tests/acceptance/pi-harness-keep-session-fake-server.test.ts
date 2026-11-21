// `keepSession`: a run + label's pi conversation stays open between calls, and a later call continues
// it with the earlier turns in context. Real children (entry.ts) against a scripted fake OpenRouter
// server that records every request body — no real key, no real provider.
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import type { EngineEvent } from '../../src/event-log.js';
import type { AgentOpts, HarnessDescriptor } from '../../src/types.js';

interface Fake { server: HttpServer; port: number; bodies: string[] }

/** Answers `ANSWER-<n>` (n = request number). A request whose last user message says SLOW waits 5 s. */
function startServer(): Promise<Fake> {
  const fake: Fake = { server: undefined as unknown as HttpServer, port: 0, bodies: [] };
  return new Promise((resolve) => {
    fake.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        fake.bodies.push(body);
        const n = fake.bodies.length;
        const messages = (JSON.parse(body) as { messages?: Array<{ role: string; content: unknown }> }).messages ?? [];
        const lastUser = JSON.stringify([...messages].reverse().find((m) => m.role === 'user')?.content ?? '');
        const answer = (): void => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          const chunk = (o: object): void => { res.write(`data: ${JSON.stringify(o)}\n\n`); };
          chunk({ id: `r${n}`, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: `ANSWER-${n}` }, finish_reason: null }] });
          chunk({ id: `r${n}`, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } });
          res.end('data: [DONE]\n\n');
        };
        if (lastUser.includes('SLOW')) setTimeout(answer, 5000); else answer();
      });
    });
    fake.server.listen(0, '127.0.0.1', () => {
      const addr = fake.server.address();
      fake.port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve(fake);
    });
  });
}

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

async function setup(extra: { timeoutMs?: number } = {}) {
  const fake = await startServer();
  cleanup.push(() => new Promise((r) => fake.server.close(() => r())));
  const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-keep-'));
  cleanup.push(() => rmSync(ws, { recursive: true, force: true }));
  const spawned: Array<{ pid?: number; agentDir?: string }> = [];
  const spawnSpy = ((cmd: string, args: readonly string[], opts: { env?: NodeJS.ProcessEnv }) => {
    const child = spawn(cmd, args, opts as never);
    spawned.push({ pid: child.pid, agentDir: opts.env?.['PI_CODING_AGENT_DIR'] });
    return child;
  }) as unknown as typeof spawn;
  const events: EngineEvent[] = [];
  const gw = new PiGatewayClient({
    secretSource: { resolve: () => 'fake-key' }, timeoutMs: extra.timeoutMs ?? 30_000, retries: 0,
    openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`, spawnChild: spawnSpy,
  });
  gw.bindEventSink((e) => events.push(e));
  cleanup.push(() => gw.stop());
  const call = async (prompt: string, o: { runId?: string; label?: string; keep?: boolean; timeoutMs?: number } = {}) => {
    const harness: HarnessDescriptor[] = [];
    const opts: AgentOpts = {
      model: 'openrouter/openai/gpt-4.1', allowedTools: [], label: o.label ?? 'chat',
      ...(o.keep === false ? {} : { keepSession: true }), ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
    };
    const r = await gw.invoke({
      prompt, opts, runId: o.runId ?? 'run-1', agentId: `a-${prompt.slice(0, 12)}`, workspace: ws,
      caps: { reasoning: false, tools: true, source: 'upstream' },
      onHarness: async (h) => { harness.push(h); },
    });
    return { r, harness };
  };
  const sessionEvents = () => events.filter((e): e is Extract<EngineEvent, { kind: 'agent.pi_session' }> => e.kind === 'agent.pi_session');
  return { fake, gw, call, spawned, sessionEvents };
}

const alive = (pid: number | undefined): boolean => {
  if (pid === undefined) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

describe('pi gateway keepSession', () => {
  it('a later call of the same run + label continues the conversation in the same child', async () => {
    const t = await setup();
    const first = await t.call('FIRST-PROMPT remember the word teapot');
    expect(first.r.ok).toBe(true);
    const second = await t.call('SECOND-PROMPT which word?');
    expect(second.r.ok).toBe(true);
    expect(second.r.ok && second.r.content).toBe('ANSWER-2');

    // The second request carries the first turn: its prompt AND the answer the model gave.
    expect(t.fake.bodies[1]).toContain('FIRST-PROMPT');
    expect(t.fake.bodies[1]).toContain('ANSWER-1');
    expect(t.fake.bodies[1]).toContain('SECOND-PROMPT');
    // One child for both turns; the harness record says which turn each was.
    expect(t.spawned).toHaveLength(1);
    expect(first.harness[0]?.keptSession).toEqual({ turn: 1 });
    expect(second.harness[0]?.keptSession).toEqual({ turn: 2 });
    expect(t.sessionEvents().map((e) => e.outcome)).toEqual(['opened', 'continued']);
  }, 60_000);

  it('another label, another run, or no keepSession never sees the conversation', async () => {
    const t = await setup();
    await t.call('FIRST-PROMPT secret');
    await t.call('OTHER-LABEL', { label: 'other' });
    await t.call('OTHER-RUN', { runId: 'run-2' });
    await t.call('NOT-KEPT', { keep: false });
    for (const body of t.fake.bodies.slice(1)) expect(body).not.toContain('FIRST-PROMPT');
    expect(t.spawned).toHaveLength(4);
  }, 60_000);

  it('endRun closes the run\'s conversations: the child exits and its directories go', async () => {
    const t = await setup();
    await t.call('FIRST-PROMPT');
    const child = t.spawned[0]!;
    expect(alive(child.pid)).toBe(true);
    t.gw.endRun('run-other'); // another run's end leaves it alone
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(child.pid)).toBe(true);
    t.gw.endRun('run-1');
    for (let i = 0; i < 40 && alive(child.pid); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(child.pid)).toBe(false);
    expect(existsSync(child.agentDir!)).toBe(false);
    expect(t.sessionEvents().at(-1)).toMatchObject({ outcome: 'closed', turn: 1 });
    // The next call of that label starts afresh.
    await t.call('AFTER-END');
    expect(t.fake.bodies.at(-1)).not.toContain('FIRST-PROMPT');
  }, 60_000);

  it('a call made while the conversation is busy runs on its own and sees nothing of it', async () => {
    const t = await setup();
    await t.call('FIRST-PROMPT');
    const [slow, parallel] = await Promise.all([t.call('SLOW-TURN'), new Promise<Awaited<ReturnType<typeof t.call>>>((resolve) => setTimeout(() => resolve(t.call('PARALLEL-CALL')), 1000))]);
    expect(slow.r.ok).toBe(true);
    expect(parallel.r.ok).toBe(true);
    const parallelBody = t.fake.bodies.find((b) => b.includes('PARALLEL-CALL'))!;
    expect(parallelBody).not.toContain('FIRST-PROMPT');
    expect(parallel.harness[0]?.keptSession).toBeUndefined();
    expect(t.sessionEvents().map((e) => e.outcome)).toContain('bypassed');
    // The kept conversation itself carried on.
    await t.call('THIRD-PROMPT');
    const third = t.fake.bodies.at(-1)!;
    expect(third).toContain('FIRST-PROMPT');
    expect(third).toContain('SLOW-TURN');
    expect(third).not.toContain('PARALLEL-CALL');
  }, 60_000);

  it('a continued turn that times out drops the conversation; the next call starts afresh', async () => {
    const t = await setup();
    await t.call('FIRST-PROMPT');
    const child = t.spawned[0]!;
    const timedOut = await t.call('SLOW-TURN', { timeoutMs: 1500 });
    expect(timedOut.r.ok).toBe(false);
    expect(!timedOut.r.ok && timedOut.r.reason).toBe('timeout');
    for (let i = 0; i < 40 && alive(child.pid); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(child.pid)).toBe(false);
    expect(t.sessionEvents().at(-1)).toMatchObject({ outcome: 'dropped' });
    const after = await t.call('AFTER-TIMEOUT');
    expect(after.r.ok).toBe(true);
    expect(t.fake.bodies.at(-1)).not.toContain('FIRST-PROMPT');
    expect(after.harness[0]?.keptSession).toEqual({ turn: 1 });
  }, 60_000);

  it('the direct gateway refuses keepSession instead of answering without the earlier turns', async () => {
    const gw = new LiteLLMGatewayClient({ baseUrl: 'http://127.0.0.1:9/never', apiKey: 'x' } as never);
    const r = await gw.invoke({ prompt: 'x', opts: { model: 'openrouter/openai/gpt-4.1', keepSession: true }, runId: 'r', agentId: 'a' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toMatch(/^SESSION_KEEP_UNSUPPORTED_BY_HARNESS/);
  });
});
