// Issue #73 over real MCP HTTP: the admin-only `models_probe` tool, the probe-backed fields on
// `models_list` / `GET /api/models`, persistence across an engine restart, and the non-fatal
// run_start warning (d). The gateway is a fake GatewayClient standing in for a model that answers
// prose but never uses a tool — no network (the catalog's live fetchers are stubbed down too).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { authorize, type Principal } from '../../src/authz.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
const ALIASES = { default: { provider: 'ollama' as const, model: 'qwen2.5:7b' } };

let invocations = 0;
const proseOnly: GatewayClient = {
  async invoke() {
    invocations++;
    return { ok: true, provider: 'fake', model: 'qwen2.5:7b', tokens: { input: 1, output: 1 }, content: 'PONG', events: [] };
  },
};

let workRoot: string;
let server: Server;

async function boot(): Promise<Server> {
  return createServer({
    port: 0, bind: '127.0.0.1', workRoot, aliases: ALIASES, gateway: proseOnly,
    modelCatalogFetchers: { ollamaFetch: down, openrouterFetch: down },
  });
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it-probe-'));
  server = await boot();
});
afterAll(async () => {
  await server?.close();
  rmSync(workRoot, { recursive: true, force: true });
});

describe('models_probe (#73) — admin-only, listed, gated like every admin row', () => {
  const spec = TOOL_SPECS.find((s) => s.name === 'models_probe')!;
  const lookup = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };
  it('exists with minRole admin', () => {
    expect(spec).toBeDefined();
    expect(spec.authz).toEqual({ minRole: 'admin', ownership: 'none' });
  });
  it.each<[Principal, boolean, string | undefined]>([
    [{ kind: 'user', id: 'u' }, false, 'FORBIDDEN_ROLE'],
    [{ kind: 'author', id: 'a' }, false, 'FORBIDDEN_ROLE'],
    [{ kind: 'loopback-exempt' }, false, 'PRINCIPAL_REQUIRED'],
    [{ kind: 'admin', id: 'root' }, true, undefined],
    [{ kind: 'auth-disabled' }, true, undefined],
  ])('%o -> ok=%s', (principal, allowed, code) => {
    const v = authorize(principal, spec, {}, lookup);
    expect(v.ok).toBe(allowed);
    expect(v.code).toBe(code);
  });
});

describe('probe -> models_list -> restart -> run_start warning (#73)', () => {
  it('models_list before any probe: verified fields null, stabilitySource rule', async () => {
    const rows = (await call('models_list', { provider: 'ollama' })).result as any[];
    const row = rows.find((r) => r.model === 'qwen2.5:7b');
    expect(row).toMatchObject({ toolUseVerified: null, proseVerified: null, lastProbedAt: null, stabilitySource: 'rule', stability: 'variable' });
  });

  it('models_probe runs one prose + one Bash call per configured model and returns the results', async () => {
    const before = invocations;
    const out = await call('models_probe', {});
    expect(out.result).toHaveLength(1);
    expect(out.result[0]).toMatchObject({ alias: 'default', provider: 'ollama', model: 'qwen2.5:7b', proseVerified: true, toolUseVerified: false });
    expect(invocations - before).toBe(2);
  });

  it('an unknown alias is refused UNKNOWN_ALIAS', async () => {
    const out = await call('models_probe', { alias: 'nope' });
    expect(out.error?.code ?? out.code).toBe('UNKNOWN_ALIAS');
  });

  it('models_list and GET /api/models carry the probe outcome (degraded, source probe)', async () => {
    const rows = (await call('models_list', { provider: 'ollama' })).result as any[];
    const row = rows.find((r) => r.model === 'qwen2.5:7b');
    expect(row).toMatchObject({ toolUseVerified: false, proseVerified: true, stability: 'degraded', stabilitySource: 'probe' });
    expect(typeof row.lastProbedAt).toBe('string');
    const api = await (await fetch(`http://127.0.0.1:${server.port}/api/models`)).json() as any[];
    expect(api.find((r) => r.model === 'qwen2.5:7b')).toMatchObject({ toolUseVerified: false, stabilitySource: 'probe' });
  });

  it('the probe result survives an engine restart on the same workRoot', async () => {
    await server.close();
    server = await boot();
    const rows = (await call('models_list', { provider: 'ollama' })).result as any[];
    expect(rows.find((r) => r.model === 'qwen2.5:7b')).toMatchObject({ toolUseVerified: false, stabilitySource: 'probe' });
  });

  it('run_start of an agent with tools on that model is ADMITTED with a MODEL_TOOL_USE_UNVERIFIED warning', async () => {
    const name = `probe-warn-${Date.now()}`; // det:allow — unique fixture name
    await registerPublishedVia(call, name, "phase('Work');\nreturn await agent('coder', { prompt: 'list files', allowedTools: ['Bash'] });", {
      mermaid: 'graph LR\nsubgraph "Work"\nn0(["coder<br/>default · low · 60000<br/>tools: Bash"])\nend',
    });
    const out = await call('run_start', { name });
    expect(out.status).not.toBe('failed');
    expect(out.result.runId).toBe(out.runId);
    expect(out.result.warnings).toEqual([expect.objectContaining({ code: 'MODEL_TOOL_USE_UNVERIFIED', label: 'coder', model: 'default' })]);
    await call('run_stop', { runId: out.runId }).catch(() => undefined);
  });

  it('a prose-only agent (allowedTools: []) on the same model gets no warning', async () => {
    const name = `probe-nowarn-${Date.now()}`; // det:allow — unique fixture name
    await registerPublishedVia(call, name, "phase('Work');\nreturn await agent('writer', { prompt: 'say hi', allowedTools: [] });", {
      mermaid: 'graph LR\nsubgraph "Work"\nn0(["writer<br/>default · low · 60000<br/>tools: none"])\nend',
    });
    const out = await call('run_start', { name });
    expect(out.status).not.toBe('failed');
    expect(out.result.warnings).toBeUndefined();
    await call('run_stop', { runId: out.runId }).catch(() => undefined);
  });
});
