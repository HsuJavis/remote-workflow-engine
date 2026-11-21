// The pi gateway's warm pool: children started ahead of demand, so a dispatch does not wait for pi's
// import. Real children (entry.ts) against a scripted fake OpenRouter server — no real key, no real
// provider.
//
// What must hold for a warm child, which was spawned before its dispatch existed (different cwd,
// its own agentDir): the dispatch still answers, its file tools still resolve paths against the run
// workspace (not the child's spawn cwd), the event line says it was warm, its agentDir is gone once
// the dispatch ends, and stop() leaves no child behind.
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import type { EngineEvent } from '../../src/event-log.js';
import type { TranscriptEvent } from '../../src/types.js';

/** Turn 1 of each dispatch calls `read note.txt` when `readFirst`, then the next turn answers DONE. */
function startServer(readFirst: boolean): Promise<{ server: HttpServer; port: number; requests: number }> {
  const state = { server: undefined as unknown as HttpServer, port: 0, requests: 0 };
  let expectTool = readFirst;
  return new Promise((resolve) => {
    state.server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        state.requests++;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (o: object): void => { res.write(`data: ${JSON.stringify(o)}\n\n`); };
        if (expectTool) {
          expectTool = false;
          chunk({ id: 't', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: 'note.txt' }) } }] }, finish_reason: null }] });
          chunk({ id: 't', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } });
        } else {
          expectTool = readFirst;
          chunk({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'DONE' }, finish_reason: null }] });
          chunk({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } });
        }
        res.end('data: [DONE]\n\n');
      });
    });
    state.server.listen(0, '127.0.0.1', () => {
      const addr = state.server.address();
      state.port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve(state);
    });
  });
}

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

describe('pi gateway warm pool', () => {
  it('a later dispatch gets a warm child, reads the run workspace, and leaves no agentDir behind', async () => {
    const fake = await startServer(true);
    cleanup.push(() => new Promise((r) => fake.server.close(() => r())));
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-warm-'));
    cleanup.push(() => rmSync(ws, { recursive: true, force: true }));
    writeFileSync(join(ws, 'note.txt'), 'warm-pool-marker-42');

    const events: EngineEvent[] = [];
    const spawned: Array<{ pid?: number; cwd?: string; agentDir?: string }> = [];
    const spawnSpy = ((cmd: string, args: readonly string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
      const child = spawn(cmd, args, opts as never);
      spawned.push({ pid: child.pid, cwd: opts.cwd, agentDir: opts.env?.['PI_CODING_AGENT_DIR'] });
      return child;
    }) as unknown as typeof spawn;
    const gw = new PiGatewayClient({
      secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0,
      openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`, warmPool: 1, spawnChild: spawnSpy,
    });
    gw.bindEventSink((e) => events.push(e));
    cleanup.push(() => gw.stop());

    const call = async (n: number): Promise<{ ok: boolean; content?: string; toolResult: string }> => {
      let toolResult = '';
      const r = await gw.invoke({
        prompt: 'read the note', opts: { model: 'openrouter/openai/gpt-4.1', allowedTools: ['Read'] },
        runId: `warm-${n}`, agentId: 'a1', workspace: ws,
        caps: { reasoning: false, tools: true, source: 'upstream' },
        onEvent: (ev: TranscriptEvent) => { if (ev.kind === 'tool_result') toolResult = JSON.stringify(ev.data); },
      });
      return { ok: r.ok, ...(r.ok && typeof r.content === 'string' ? { content: r.content } : {}), toolResult };
    };

    const first = await call(1);
    expect(first.ok).toBe(true);
    // Give the refilled child a moment to finish its import, as real traffic would.
    await new Promise((r) => setTimeout(r, 2500));
    const second = await call(2);
    expect(second.ok).toBe(true);
    expect(second.content).toBe('DONE');
    // The warm child resolved `note.txt` against the run workspace although it was spawned elsewhere.
    expect(second.toolResult).toContain('warm-pool-marker-42');

    const childLines = events.filter((e): e is Extract<EngineEvent, { kind: 'agent.pi_child' }> => e.kind === 'agent.pi_child');
    expect(childLines.map((e) => e.warm)).toEqual([false, true]);

    // spawn #1: the first dispatch's own child (cwd = workspace); #2: the warm child it refilled,
    // born in its own agentDir — used by the second dispatch and removed when that dispatch ended.
    expect(spawned[0]!.cwd).toBe(ws);
    const warm = spawned[1]!;
    expect(warm.cwd).toBe(warm.agentDir);
    expect(existsSync(warm.agentDir!)).toBe(false);
  }, 60_000);

  it('stop() kills the idle warm children and removes their agentDirs', async () => {
    const fake = await startServer(false);
    cleanup.push(() => new Promise((r) => fake.server.close(() => r())));
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-warm-'));
    cleanup.push(() => rmSync(ws, { recursive: true, force: true }));
    const spawned: Array<{ pid?: number; agentDir?: string }> = [];
    const spawnSpy = ((cmd: string, args: readonly string[], opts: { env?: NodeJS.ProcessEnv }) => {
      const child = spawn(cmd, args, opts as never);
      spawned.push({ pid: child.pid, agentDir: opts.env?.['PI_CODING_AGENT_DIR'] });
      return child;
    }) as unknown as typeof spawn;
    const gw = new PiGatewayClient({
      secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0,
      openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`, warmPool: 2, spawnChild: spawnSpy,
    });
    const r = await gw.invoke({
      prompt: 'hi', opts: { model: 'openrouter/openai/gpt-4.1', allowedTools: [] },
      runId: 'warm-stop', agentId: 'a1', workspace: ws, caps: { reasoning: false, tools: true, source: 'upstream' },
    });
    expect(r.ok).toBe(true);
    const idle = spawned.slice(1);
    expect(idle).toHaveLength(2);
    await gw.stop();
    await new Promise((r2) => setTimeout(r2, 500));
    for (const c of idle) {
      expect(() => process.kill(c.pid!, 0)).toThrow();
      expect(existsSync(c.agentDir!)).toBe(false);
    }
  }, 60_000);
});
