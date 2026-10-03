// pi harness v1, independent review B3/B4/M5: a REAL PiGatewayClient dispatch, through a REAL
// spawned pi child, driven by a deterministic SCRIPTED fake OpenRouter SSE server (no Ollama, no
// npm registry, no bwrap/socat needed — this exercises the file-tool jail directly, independent of
// bash confinement) — ported from the reviewer's own scratch driver (piv/jail-drive.mts) into a
// committed, always-on (never host-gated) test, per the coordinator's "reuse them" instruction.
// Each tool call is scripted by the fake server rather than hoping a real model cooperates, so this
// is fully deterministic and needs no RWE_PI_REAL_TESTS opt-in.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';

interface ToolCall { name: string; args: Record<string, unknown> }

/** Drives a scripted sequence of tool calls through a real PiGatewayClient dispatch via a recording/
 *  responding fake SSE server — each request gets the NEXT tool call in `script`, and the final
 *  request gets a plain text reply. Returns the tool_result payload for each step (by result event
 *  order) plus the raw gateway result. */
async function driveScript(gw: PiGatewayClient, workspace: string, allowedTools: string[]): Promise<{ results: Array<{ name: string; result: unknown; isError: boolean }>; ok: boolean }> {
  const results: Array<{ name: string; result: unknown; isError: boolean }> = [];
  const r = await gw.invoke({
    prompt: 'go',
    opts: { model: 'openrouter/fake/model', allowedTools },
    runId: 'jail-real-' + Math.random().toString(36).slice(2),
    agentId: 'a1',
    workspace,
    onEvent: (ev) => {
      if (ev.kind === 'tool_result') {
        const d = ev.data as { toolName: string; result: unknown; isError: boolean };
        results.push({ name: d.toolName, result: d.result, isError: d.isError });
      }
    },
  });
  return { results, ok: r.ok };
}

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

describe('pi harness v1 — file-tool jail, driven deterministically (review B3/B4/M5, ported from piv/jail-drive.mts)', () => {
  let base: string, ws: string, out: string, outdir: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'rwe-pi-jail-real-'));
    ws = join(base, 'ws'); mkdirSync(ws);
    out = join(base, 'out'); mkdirSync(out);
    outdir = join(base, 'outdir'); mkdirSync(outdir);
    writeFileSync(join(outdir, 'secret.txt'), 'OUTSIDE_SECRET\n');
    writeFileSync(join(ws, 'inside.txt'), 'INSIDE_TEXT\n');
    symlinkSync(join(out, 'created.txt'), join(ws, 'dangle')); // dangling, target outside
    symlinkSync(outdir, join(ws, 'linkdir')); // existing dir, outside
  });
  afterAll(() => { rmSync(base, { recursive: true, force: true }); });

  it('B3: write through a dangling symlink is refused, and the outside target is never created', async () => {
    const fake = await startScriptedServer([{ name: 'write', args: { path: 'dangle', content: 'PWNED_VIA_DANGLING' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Write']);
      expect(results[0]?.isError).toBe(true);
      expect(JSON.stringify(results[0]?.result)).toMatch(/PATH_ESCAPES_WORKSPACE/);
      expect(existsSync(join(out, 'created.txt'))).toBe(false);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('B3: write through a nested dangling symlink (link -> link -> outside) is also refused', async () => {
    const mid = join(ws, 'mid2'); symlinkSync(join(out, 'final2.txt'), mid);
    const dangle2 = join(ws, 'dangle2'); symlinkSync(mid, dangle2);
    const fake = await startScriptedServer([{ name: 'write', args: { path: 'dangle2', content: 'PWNED2' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Write']);
      expect(results[0]?.isError).toBe(true);
      expect(existsSync(join(out, 'final2.txt'))).toBe(false);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('B4: grep actually works over the workspace (the rg shim resolves)', async () => {
    const fake = await startScriptedServer([{ name: 'grep', args: { pattern: 'INSIDE', path: '.' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Grep']);
      expect(results[0]?.isError).toBe(false);
      expect(JSON.stringify(results[0]?.result)).not.toMatch(/ripgrep .rg. is not available/);
      expect(JSON.stringify(results[0]?.result)).toMatch(/inside\.txt/);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('B4/jail: grep of an outside path (/etc) is refused, never reaches rg', async () => {
    const fake = await startScriptedServer([{ name: 'grep', args: { pattern: 'root', path: '/etc' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Grep']);
      expect(results[0]?.isError).toBe(true);
      // grep.js's own try/catch around `ops.isDirectory` collapses any thrown error (including our
      // PATH_ESCAPES_WORKSPACE) into a generic "Path not found" message — the SECURITY property this
      // test actually cares about is that /etc's real contents are never reached (no root/passwd-
      // shaped match text ever appears), which the refusal-before-rg-runs guarantees regardless of
      // which exact string surfaces.
      const text = JSON.stringify(results[0]?.result);
      expect(text).toMatch(/not found|escapes|outside/i);
      expect(text).not.toMatch(/root:/); // would appear only if grep actually searched real /etc files
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('M5: find never lists names behind a symlinked directory that points outside the workspace', async () => {
    const fake = await startScriptedServer([{ name: 'find', args: { pattern: '**', path: '.' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Glob']);
      expect(results[0]?.isError).toBe(false);
      const text = JSON.stringify(results[0]?.result);
      expect(text).not.toMatch(/linkdir\//);
      expect(text).not.toMatch(/secret\.txt/);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('jail/M5-parity: ls of a symlinked outside directory is refused', async () => {
    const fake = await startScriptedServer([{ name: 'ls', args: { path: 'linkdir' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['LS']);
      expect(results[0]?.isError).toBe(true);
      expect(JSON.stringify(results[0]?.result)).toMatch(/PATH_ESCAPES_WORKSPACE/);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);
});
