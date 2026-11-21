// A warm pi child (started before its dispatch, in its own agentDir) running CONFINED Bash — the
// production path on a confined engine (`bash: 'readonly'` agents). Deterministic: a scripted fake
// OpenRouter server issues the bash tool call, so no local model is involved. Needs the real
// sandbox runtime (bwrap + socat + the ripgrep override) and the RWE_PI_REAL_TESTS=1 opt-in.
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import { resolveRipgrepOverride } from '../../src/gateway/pi-child/ripgrep-override.js';
import type { EngineEvent } from '../../src/event-log.js';
import type { TranscriptEvent } from '../../src/types.js';
import { piRealTestsEnabled, hasBinary } from '../helpers/pi-real-gate.js';

const HAS_SANDBOX = piRealTestsEnabled() && hasBinary('bwrap') && hasBinary('socat') && resolveRipgrepOverride() !== null;
const WHY_NOT = ' [UNVERIFIED here: needs RWE_PI_REAL_TESTS=1, bwrap + socat + a bundled ripgrep-override CLI binary]';

const COMMAND = 'pwd; cat own.txt; echo SEP; cat ../sibling/secret.txt 2>&1; echo SEP; echo written > out.txt 2>&1 && echo WROTE || echo NOWRITE';

/** Each dispatch: turn 1 calls bash with COMMAND, turn 2 answers DONE. */
function startServer(): Promise<{ server: HttpServer; port: number }> {
  let toolNext = true;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (o: object): void => { res.write(`data: ${JSON.stringify(o)}\n\n`); };
        if (toolNext) {
          chunk({ id: 't', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: COMMAND }) } }] }, finish_reason: null }] });
          chunk({ id: 't', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } });
        } else {
          chunk({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'DONE' }, finish_reason: null }] });
          chunk({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } });
        }
        toolNext = !toolNext;
        res.end('data: [DONE]\n\n');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr !== null ? addr.port : 0 });
    });
  });
}

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

describe('pi warm pool under real bash confinement', () => {
  it.skipIf(!HAS_SANDBOX)('a warm child runs confined readonly Bash in the run workspace: own file read, sibling hidden, no write' + WHY_NOT, async () => {
    const fake = await startServer();
    cleanup.push(() => new Promise((r) => fake.server.close(() => r())));
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-pi-warm-confined-'));
    cleanup.push(() => rmSync(workRoot, { recursive: true, force: true }));
    const ws = join(workRoot, 'ws');
    const sibling = join(workRoot, 'sibling');
    mkdirSync(ws, { recursive: true });
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(ws, 'own.txt'), 'own-file-content');
    writeFileSync(join(sibling, 'secret.txt'), 'sibling-secret-should-be-invisible');

    const events: EngineEvent[] = [];
    const gw = new PiGatewayClient({
      secretSource: { resolve: () => 'fake-key' }, timeoutMs: 60_000, retries: 0,
      openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`, warmPool: 1,
      confinementPosture: 'confined',
      confinement: { allowHostPaths: [], protectedFiles: [], workRoot },
    });
    gw.bindEventSink((e) => events.push(e));
    cleanup.push(() => gw.stop());

    const call = async (n: number) => {
      let output = '';
      const r = await gw.invoke({
        prompt: 'run it', opts: { model: 'openrouter/openai/gpt-4.1', allowedTools: ['Bash'], bash: 'readonly' },
        runId: `warm-confined-${n}`, agentId: 'a1', workspace: ws,
        caps: { reasoning: false, tools: true, source: 'upstream' },
        onEvent: (ev: TranscriptEvent) => { if (ev.kind === 'tool_result') output = JSON.stringify(ev.data); },
      });
      return { r, output };
    };

    const cold = await call(1);
    expect(cold.r.ok, JSON.stringify(cold.r).slice(0, 400)).toBe(true);
    await new Promise((r) => setTimeout(r, 3000));
    const warm = await call(2);
    expect(warm.r.ok, JSON.stringify(warm.r).slice(0, 400)).toBe(true);
    const warmLines = events.filter((e): e is Extract<EngineEvent, { kind: 'agent.pi_child' }> => e.kind === 'agent.pi_child');
    expect(warmLines.map((e) => e.warm)).toEqual([false, true]);

    // Same answers from the cold child and the warm one.
    for (const { output } of [cold, warm]) {
      expect(output).toContain(ws);
      expect(output).toContain('own-file-content');
      expect(output).not.toContain('sibling-secret-should-be-invisible');
      expect(output).toContain('NOWRITE');
      expect(output).not.toContain('WROTE');
    }
  }, 120_000);
});
