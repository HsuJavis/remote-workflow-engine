// E2E-007: Hooks are rejected by construction + a hung SDK-gateway provider call is bounded and
// never smuggled as fake success (REQ-019, REQ-020 cross-cutting journey).
// RED: (a) today's asset-push tool materializes a hook asset instead of rejecting it; (b) GET
// /api/status (the D-DOS gauge surface) does not exist yet — always 404 regardless of provider.
// v24 (TASK-152, DES-153): the asset-push tool this file used to call is renamed workspace_push.
// Mock policy (E2E — never mocks the SUT's own boundaries): the ONLY fake is the third-party
// network endpoint the real SDK CLI subprocess dials (ANTHROPIC_BASE_URL → a local stub HTTP
// server that never responds) — same fault-injection technique as IT-015's stub /v1/messages
// server, legitimate per DES-030's own "real (or fault-injected) hung provider" real-tier wording.
// Everything else is the real spawned `claude` CLI + real ClaudeAgentSdkGatewayClient.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

const HUNG_PROVIDER_PORT = 38199;
// 2026-09-26 (alias mechanism removed): `ClaudeAgentSdkGatewayClient` routes `anthropic` straight to
// the REAL Anthropic API regardless of `config.baseUrl` (REQ-037's provider-aware env) — only a
// non-anthropic provider's traffic goes through `config.baseUrl`, which is what this file's hung
// stub actually intercepts. A bare `'default'` alias used to resolve to an anthropic model and still
// hit the stub because the OLD alias-resolution layer sat in front of that provider check; the
// full-ref successor has to name a non-anthropic provider directly. Fetchers stubbed down so this
// openrouter ref is always in the "listing unavailable -> warn, never refuse" branch.
const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
const HUNG_MODEL_REF = 'openrouter/some-vendor/some-model';

let server: Server;
let tmpDir: string;
let hungStub: HttpServer;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-e2e-hookstimeout-'));
  // A real HTTP server that accepts the connection but NEVER responds — a real fault-injected
  // hung provider, not a mock of anything this product owns.
  hungStub = createHttpServer(() => { /* never calls res.end() */ });
  await new Promise<void>((resolve) => hungStub.listen(HUNG_PROVIDER_PORT, '127.0.0.1', resolve));

  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir, assetRoot: join(tmpDir, 'assets'),
    gateway: new ClaudeAgentSdkGatewayClient({
      baseUrl: `http://127.0.0.1:${HUNG_PROVIDER_PORT}`,
      timeoutMs: 5000,
      retries: 0,
    }),
    modelCatalogFetchers: { ollamaFetch: down, openrouterFetch: down },
  });
});

afterAll(async () => {
  await server?.close();
  // Same fix as val-023-sdk-gateway-timeout.test.ts: the deliberately-hung stub still holds every
  // socket it never answered, so `close()` waits forever and this hook times out (10s) with all
  // assertions green. Drop them first (Gate 6.5+7 verifier, 2026-09-03).
  hungStub.closeAllConnections();
  await new Promise<void>((resolve) => hungStub.close(() => resolve()));
  rmSync(tmpDir, { recursive: true, force: true });
});

async function mcpCall(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  // NOTE: workflow_* tools return their own flat envelope directly; workspace_push wraps its
  // payload under `.result` (mcp-facade.ts's `{ result: await assetSync.push(...) }` shape) —
  // dereferenced explicitly at the workspace_push call site below, not auto-unwrapped here
  // (auto-unwrapping broke run_result's own `.result` field, which is the SCRIPT'S return value,
  // not a wrapper).
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

function b64(s: string) { return Buffer.from(s, 'utf-8').toString('base64'); }

describe('REQ-019: a hook-kind asset is rejected by construction, the internal PreToolUse boundary hook is unaffected', () => {
  it('workspace_push of a hook is rejected — nothing materialized on disk', async () => {
    const out = await mcpCall('workspace_push', { kind: 'hook', name: 'e2e-evil-hook', files: [{ path: 'h.sh', contentB64: b64('rm -rf /') }] });
    const payload = (out['result'] as { stored?: string[] } | undefined) ?? {};
    expect(payload.stored ?? []).toEqual([]);
    expect(existsSync(join(tmpDir, 'assets', 'hook', 'e2e-evil-hook'))).toBe(false);
  });
});

describe('REQ-020: a hung SDK-gateway provider call is bounded by timeoutMs — agent() resolves null, run continues, never fake success', () => {
  it('a workflow whose agent() call hits the hung provider completes (not hangs forever) with a null agent() result', async () => {
    // v22 (adjudication #1 K-1/K-2): inline script is closed at every ingress, so the hung-provider
    // script is registered+published and run by name. The bounded-timeout subject is unchanged —
    // only how the script reaches the engine.
    // v24 (DES-143/DES-144, TASK-152): agent() now takes a literal label as its first arg
    // (registration scans it) plus a literal options object — the old single-arg `agent(prompt)`
    // form is refused AGENT_LABEL_REQUIRED — and registration requires a matching
    // `meta.params.agents.hang` declaration (AGENT_UNDECLARED otherwise). `HUNG_MODEL_REF` (a
    // non-anthropic full ref, 2026-09-26: alias mechanism removed) hits the SAME real-provider dial
    // the hung stub intercepts (`baseUrl` override, `beforeAll` above).
    const run = await runScriptVia(
      mcpCall,
      [
        "export const meta = { params: { agents: { hang: {",
        `  model: { type: 'string', default: ${JSON.stringify(HUNG_MODEL_REF)} },`,
        "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
        // The declared per-agent timeoutMs is DELIBERATELY the 5000ms this file's `beforeAll`
        // configures on the gateway: a per-call `opts.timeoutMs` OVERRIDES the client's configured
        // default (claude-agent-sdk-client.ts:443/457), so a declared 30000 here would have made the
        // fixture measure a bound nothing in this test set up.
        "  timeoutMs: { type: 'number', default: 5000 },",
        "} } } };",
        "const r = await agent('hang', {}); return r === null ? 'bounded-null' : 'unexpected-value';",
      ].join('\n'),
    );
    const runId = run['runId'] as string;
    let finalStatus: Record<string, unknown> | undefined;
    for (let i = 0; i < 30; i++) {
      const s = await mcpCall('run_status', { runId });
      if (s['status'] === 'completed' || s['status'] === 'failed') { finalStatus = s; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(finalStatus).toBeDefined();
    expect(finalStatus?.['status']).toBe('completed');
    const result = await mcpCall('run_result', { runId });
    expect(result['result']).toBe('bounded-null');
  }, 60000);

  it('the D-DOS agent-slot gauge (GET /api/status) is observable and returns to baseline after the bounded failure', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as { agentSemaphore?: { total: number; inUse: number; queued: number } };
    expect(body.agentSemaphore?.inUse).toBe(0);
  });
});
