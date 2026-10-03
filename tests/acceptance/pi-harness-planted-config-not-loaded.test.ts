// pi harness v1, review round 2 owner ruling, LOW-2 (round 3): "keep a regression test that a
// planted .pi/settings.json with extensions is not LOADED" — a stronger property than "not swept"
// (pi-gateway-agentdir-isolation.test.ts's own M1/B1 describe block already covers that the file
// survives on disk untouched, which is a different, weaker check). Split out of
// pi-harness-jail-real.test.ts into its OWN ungated file: the coordinator asked for this
// specifically so the regression guard is unambiguously discoverable as always-on (needs no Ollama,
// no bwrap/socat, no RWE_PI_REAL_TESTS opt-in) — the round-3 review read the original home's "-real"
// filename as a signal it might be gated, even though pi-harness-jail-real.test.ts was never
// actually behind any opt-in var (confirmed: it ran in every full-suite pass this whole engagement,
// including every run with RWE_PI_REAL_TESTS unset). Moving it here removes that ambiguity for good,
// independent of whether the filename of its old home was ever actually misleading in practice.
//
// A REAL PiGatewayClient dispatch, through a REAL spawned pi child, driven by a deterministic
// SCRIPTED fake OpenRouter SSE server — no Ollama, no npm registry, no bwrap/socat needed.
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';

interface ToolCall { name: string; args: Record<string, unknown> }

/** Same minimal scripted fake SSE server pi-harness-jail-real.test.ts's own helper provides — copied
 *  rather than imported across test files (no shared test-helper module for it exists yet, and this
 *  is the only OTHER caller), trimmed to exactly what this one test needs: an empty `script` (no tool
 *  calls — only `buildResourceLoader()`'s own behavior, which runs BEFORE any model call, matters
 *  here) always takes the "final reply" branch below. */
function startScriptedServer(script: ToolCall[]): Promise<{ server: HttpServer; port: number }> {
  let step = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const id = 'c' + step;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (step < script.length) {
          const s = script[step++]!;
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + step, type: 'function', function: { name: s.name, arguments: JSON.stringify(s.args) } }] }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } })}\n\n`);
        } else {
          step++;
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'ALL_DONE' }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 2, total_tokens: 52 } })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr !== null ? addr.port : 0 });
    });
  });
}

describe('pi harness v1 — a planted .pi/settings.json extension is never LOADED (review round 2 owner ruling)', () => {
  // This exercises the REAL DefaultResourceLoader branch (session-runner.ts's buildResourceLoader):
  // that branch is used ONLY when a dispatch declares an MCP server or skill (a bare dispatch uses
  // the "empty" loader, which trivially never discovers anything, by construction, and would prove
  // nothing here) — a fake, never-connecting stdio MCP server (`command:'false'`) is declared via
  // `resolveMcp` purely to take that branch; buildResourceLoader() runs and completes BEFORE any
  // model call, so the dispatch's own eventual ok/error outcome is irrelevant to what this checks.
  it("a planted .pi/settings.json declaring an extension is not LOADED (noExtensions holds under the real DefaultResourceLoader branch)", async () => {
    const plantedWs = mkdtempSync(join(tmpdir(), 'rwe-pi-jail-planted-pi-'));
    const marker = join(plantedWs, 'EXTENSION_WAS_LOADED');
    try {
      const plantedPi = join(plantedWs, '.pi');
      mkdirSync(join(plantedPi, 'extensions'), { recursive: true });
      writeFileSync(join(plantedPi, 'settings.json'), JSON.stringify({ extensions: ['./extensions/evil.ts'] }));
      // Writes its marker at MODULE EVALUATION time (a bare top-level side effect) — detects any
      // attempt to load/require/import this file at all, independent of whether it would otherwise
      // satisfy pi's own extension-module shape.
      writeFileSync(join(plantedPi, 'extensions', 'evil.ts'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'LOADED');\nexport default {};\n`);

      const fake = await startScriptedServer([]); // no tool calls needed — only buildResourceLoader() matters
      try {
        const gw = new PiGatewayClient({
          secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0,
          openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
          resolveMcp: async (_wf, names) => ({ configs: Object.fromEntries(names.map((n) => [n, { command: 'false' }])), missing: [] }),
        });
        await gw.invoke({
          prompt: 'go', opts: { model: 'openrouter/fake/model', allowedTools: [], mcp: ['neverconnects'] },
          runId: 'jail-real-planted-pi', agentId: 'a1', workspace: plantedWs,
          assets: { roots: { workflow: '/wf', global: '/gl' }, declared: { skills: [], mcp: ['neverconnects'] }, workflow: 'wf' },
        });
      } finally {
        await new Promise((r) => fake.server.close(() => r(undefined)));
      }
      expect(existsSync(marker)).toBe(false);
      // The planted file itself is left untouched (M1/B1: no pi-specific sweep) — distinct from, and
      // in addition to, the "never loaded" property this test's own name is about.
      expect(existsSync(join(plantedPi, 'settings.json'))).toBe(true);
    } finally {
      rmSync(plantedWs, { recursive: true, force: true });
    }
  }, 30_000);
});
