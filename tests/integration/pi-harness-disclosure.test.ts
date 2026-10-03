// pi harness v1 (spec "Disclosure") — the system_info MCP tool and GET /api/system both carry a
// `harness` field, sourced from harness-info.ts, so the MCP surface is self-describing: a deployment
// running gateway:"pi" never looks identical to one running the default "sdk" to a client calling
// system_info. Real createServer, real HTTP — only ServerConfig.harnessProviders is hand-set (the
// same shape composeConfig() derives from gateway:"pi", without spawning a real pi child/probe).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { PI_HARNESS_VERSION, PI_UNSUPPORTED_TOOLS } from '../../src/harness-info.js';

async function callToolRpc(server: Server, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : body;
}

async function callSystemInfo(server: Server): Promise<any> {
  return callToolRpc(server, 'system_info');
}

describe('pi harness v1 — self-describing system_info / /api/system', () => {
  let sdkServer: Server;
  let piServer: Server;
  let sdkDir: string;
  let piDir: string;

  beforeAll(async () => {
    sdkDir = mkdtempSync(join(tmpdir(), 'rwe-disclosure-sdk-'));
    piDir = mkdtempSync(join(tmpdir(), 'rwe-disclosure-pi-'));
    sdkServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: sdkDir });
    piServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: piDir, harnessProviders: ['openrouter', 'ollama'] });
  });

  afterAll(async () => {
    await sdkServer?.close();
    await piServer?.close();
    rmSync(sdkDir, { recursive: true, force: true });
    rmSync(piDir, { recursive: true, force: true });
  });

  it('system_info discloses the sdk harness with all three providers when harnessProviders is unset', async () => {
    const view = await callSystemInfo(sdkServer);
    expect(view.result.harness.name).toBe('sdk');
    expect([...view.result.harness.providers].sort()).toEqual(['anthropic', 'ollama', 'openrouter']);
  });

  it('system_info discloses the pi harness, version, providers and unsupported tools under gateway:"pi"', async () => {
    const view = await callSystemInfo(piServer);
    expect(view.result.harness.name).toBe('pi');
    expect(view.result.harness.version).toBe(PI_HARNESS_VERSION);
    expect([...view.result.harness.providers].sort()).toEqual(['ollama', 'openrouter']);
    expect(view.result.harness.providers).not.toContain('anthropic');
    expect(view.result.harness.unsupportedTools).toEqual(PI_UNSUPPORTED_TOOLS);
    expect(typeof view.result.harness.effort).toBe('string');
    expect(typeof view.result.harness.usage).toBe('string');
  });

  it('GET /api/system carries the same harness field', async () => {
    const res = await fetch(`http://127.0.0.1:${piServer.port}/api/system`);
    const body = (await res.json()) as any;
    expect(body.harness.name).toBe('pi');
  });
});

// review M7: `models_probe` must never probe — or report capable of probing — an anthropic model
// under gateway:"pi", the same gate `models_list` already applies (call-tool.ts's own "owner
// decision 2" comment, right above the models_list filter). `piServer` here has no `gateway`
// configured (no real model dispatch wired), so `deps.modelProber` is undefined either way — this
// checks that an anthropic ref is refused BEFORE that "no gateway configured" door, by its own
// provider-mismatch reason, not folded into / masked by it.
describe('pi harness v1 — models_probe refuses an anthropic ref under gateway:"pi" (review M7)', () => {
  let piServer: Server;
  let piDir: string;

  beforeAll(async () => {
    piDir = mkdtempSync(join(tmpdir(), 'rwe-disclosure-pi-probe-'));
    piServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: piDir, harnessProviders: ['openrouter', 'ollama'] });
  });

  afterAll(async () => {
    await piServer?.close();
    rmSync(piDir, { recursive: true, force: true });
  });

  it('refuses an explicit anthropic/* ref with PROVIDER_UNSUPPORTED_BY_HARNESS, never UNKNOWN_MODEL or the generic no-gateway refusal', async () => {
    const out = await callToolRpc(piServer, 'models_probe', { model: 'anthropic/claude-haiku-4-5-20251001' });
    expect(out.code).toBe('PROVIDER_UNSUPPORTED_BY_HARNESS');
  });

  it('a well-formed openrouter/ollama ref still reaches the ordinary "no gateway configured" door — unaffected by the new check', async () => {
    const out = await callToolRpc(piServer, 'models_probe', { model: 'ollama/qwen2.5:7b' });
    expect(out.code).not.toBe('PROVIDER_UNSUPPORTED_BY_HARNESS');
  });
});
