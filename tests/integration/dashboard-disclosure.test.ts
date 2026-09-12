// IT-165 (DES-192, ADR-054, TASK-197, REQ-140/141/136): what the dashboard discloses is pinned by
// ONE golden key-set test per (endpoint x outcome), not by per-route review every iteration
// (ADR-054's decision (b)). `keys ⊆ ALLOWED` catches an undeclared addition; `REQUIRED ⊆ keys`
// keeps it honest about optionality (a field omitted-together is not a violation).
//
// This file ALSO carries REQ-136's three-conjunct oracle (DES-192's own placement: "so disclosure
// and confidentiality cannot drift apart") — asserted against the REAL response BODY of both
// transports (HTTP + MCP `run_agent_log`), never against the decorator's return value. This is the
// v27 real-tier path for REQ-136 (04-design.md's own table names no separate browser file for it)
// and doubles as VAL-203.
//
// Mock policy (integration, DES-192/per-tier v27): real createServer() + real MCP HTTP + real
// agentType composition root (agents/*.md frontmatter) + a real local HTTP stub standing in for the
// one genuinely un-runnable third-party network boundary (the model provider) — same technique as
// IT-016/agent-type-composition-root.test.ts.
//
// Red reason (measured): `AgentLogView` does not exist in src/types.ts (whole-file import failure —
// `tests/fixtures/dashboard-wire.ts` fails `tsc --noEmit` on the missing export, which is DES-192's
// own "first test"); vitest/esbuild does not type-check so the runtime table below still executes,
// and fails behaviourally — today's `run_agent_log`/HTTP response carries no `record` key
// (REQUIRED_AGENT_LOG_OK_KEYS asserts it present) and RunSummary carries no `costUSD`/`lanes` etc.
// REQ-136's oracle is behaviourally red today: `agent-executor.ts` composes the agentType
// systemPrompt as segment 1 and puts it verbatim on `HarnessDescriptor.prompt`, which both
// transports return unchanged.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server, ServerConfig } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { runScriptVia, registerPublishedVia } from '../helpers/workflow-fixtures.js';
import { DISCLOSURE_TABLE } from '../fixtures/dashboard-wire.js';

// v27c AC-1 repair (Gate 8 send-back): the pre-repair version of this test asserted
// `Object.keys(row.body)` against the FIXTURE'S OWN hand-written literal — no served body was ever
// checked, so an undeclared leak on any route would pass silently forever. This describe boots the
// SAME kind of real server the REQ-136 describe below already does, drives it through real MCP/HTTP
// calls, and asserts each row's ALLOWED/REQUIRED sets (still the fixture's — "keep the fixture as
// the allow-list") against the JSON the server actually served. `FAKE_GATEWAY` stands in only for
// the third-party model provider (same convention as usage-live-equals-fold.test.ts / IT-167); every
// other participant (server, store, MCP, HTTP) is real.
const FAKE_GATEWAY: GatewayClient = {
  invoke: async () => ({ ok: true, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { input: 10, output: 4 }, content: 'x' }),
};

describe('dashboard disclosure key-set table (IT-165, ADR-054, DES-192)', () => {
  let discServer: Server;
  let discTmpDir: string;
  const realBodies: Record<string, Record<string, unknown>> = {};

  async function discMcpCall(name: string, args: unknown): Promise<any> {
    const res = await fetch(`http://127.0.0.1:${discServer.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  }

  async function runAndWait(name: string, script: string): Promise<string> {
    await registerPublishedVia(discMcpCall, name, script);
    const started = await discMcpCall('run_start', { name });
    const runId = started.runId as string;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const s = await discMcpCall('run_status', { runId });
      if (['completed', 'failed'].includes(s.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return runId;
  }

  beforeAll(async () => {
    discTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it165-disclosure-'));
    discServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: discTmpDir, gateway: FAKE_GATEWAY });
    const base = `http://127.0.0.1:${discServer.port}`;

    // ---- run with ONE agent() call: feeds run_agent_log (ok/facade-error), the HTTP agent-detail
    // row, the "priced" RunSummary row (ADR-052's four usage fields appear TOGETHER once ≥1 record
    // exists — the row's name is about key PRESENCE, not the dollar value) and the DAG row.
    const withAgentRunId = await runAndWait('it165-with-agent', `
      await agent('withagent', { prompt: 'p' });
      return 'ok';
    `);
    const withAgentStatus = await discMcpCall('run_status', { runId: withAgentRunId });
    const agentId = (withAgentStatus.result.agents as Array<{ agentId: string }>)[0]!.agentId;

    realBodies['run_agent_log (ok)'] = await discMcpCall('run_agent_log', { runId: withAgentRunId, label: 'withagent' });
    realBodies['run_agent_log (facade-error)'] = await discMcpCall('run_agent_log', { runId: withAgentRunId, label: 'does-not-exist' });
    const httpAgentRes = await fetch(`${base}/api/runs/${withAgentRunId}/agents/${agentId}`);
    realBodies['GET /api/runs/:id/agents/:agentId (http, ok)'] = await httpAgentRes.json();
    const dagRes = await fetch(`${base}/api/runs/${withAgentRunId}/dag`);
    realBodies['GET /api/runs/:id/dag'] = await dagRes.json();

    // ---- run with ZERO agent() calls: feeds the "no records" RunSummary row.
    const zeroRunId = await runAndWait('it165-zero-agents', `return 'no agents here';`);

    const runsRes = await fetch(`${base}/api/runs`);
    const runsList = (await runsRes.json()) as Array<Record<string, unknown>>;
    realBodies['GET /api/runs[i] (ok, priced)'] = runsList.find((r) => r['runId'] === withAgentRunId)!;
    realBodies['GET /api/runs[i] (ok, no records)'] = runsList.find((r) => r['runId'] === zeroRunId)!;

    const homeRes = await fetch(`${base}/api/home`);
    realBodies['GET /api/home'] = await homeRes.json();

    // Reachable-producer for the shared degrade path (server.ts:342-356/611-617): a malformed
    // %-encoded describe segment throws `URIError` inside handleDashboardRequest's own try, caught
    // by its own catch — the SAME "any /api/*" degrade shape every route falls back to on a fault
    // (DES-018: never a 500). Precedent: dashboard-http.test.ts's identical recipe.
    const degradedRes = await fetch(`${base}/api/workflows/%/describe`);
    realBodies['any /api/* (degraded)'] = await degradedRes.json();
  }, 30000);

  afterAll(async () => {
    await discServer?.close();
    rmSync(discTmpDir, { recursive: true, force: true });
  });

  it('every (endpoint x outcome) row satisfies keys ⊆ ALLOWED and REQUIRED ⊆ keys against the REAL SERVED BODY', () => {
    for (const row of DISCLOSURE_TABLE) {
      const body = realBodies[row.route];
      expect(body, `${row.route}/${row.outcome}: no real body was captured for this row`).toBeDefined();
      const keys = Object.keys(body!);
      const notAllowed = keys.filter((k) => !row.allowed.includes(k));
      expect(notAllowed, `${row.route}/${row.outcome}: undeclared key(s)`).toEqual([]);
      const missingRequired = row.required.filter((k) => !keys.includes(k));
      expect(missingRequired, `${row.route}/${row.outcome}: missing required key(s)`).toEqual([]);
    }
  });
});

const STUB_PORT = 38199;
const MARKER = 'RWE-V27-SYSTEMPROMPT-MARKER-DO-NOT-LEAK';
const SCRIPT_PROMPT = 'summarize the ticket, script-supplied prompt';

function startStubOllamaServer(): { server: HttpServer; requests: Array<{ prompt: string }> } {
  const requests: Array<{ prompt: string }> = [];
  const server = createHttpServer((req, res) => {
    if ((req.url ?? '').startsWith('/api/tags')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as { prompt?: string };
      requests.push({ prompt: body.prompt ?? '' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ response: 'ack', prompt_eval_count: 1, eval_count: 1 }));
    });
  });
  return { server, requests };
}

describe('REQ-136 (real run, both transports): the online agent-detail response never carries the agentType systemPrompt', () => {
  let server: Server | undefined;
  let stub: ReturnType<typeof startStubOllamaServer>;
  let definitionsDir: string;
  const ORIGINAL_OLLAMA_BASE_URL = process.env['OLLAMA_BASE_URL'];

  beforeAll(async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it165-'));
    definitionsDir = join(workRoot, 'agents');
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(
      join(definitionsDir, 'marked.md'),
      ['---', 'name: marked', 'model: marked-alias', '---', MARKER, ''].join('\n'),
      'utf8',
    );
    stub = startStubOllamaServer();
    await new Promise<void>((resolve) => stub.server.listen(STUB_PORT, '127.0.0.1', resolve));
    process.env['OLLAMA_BASE_URL'] = `http://127.0.0.1:${STUB_PORT}`;
    server = await createServer({
      port: 0, bind: '127.0.0.1',
      aliases: { default: { provider: 'ollama', model: 'default-model' }, 'marked-alias': { provider: 'ollama', model: 'marked-model' } },
      useLiteLLMProxy: false,
      agentDefinitionsDir: definitionsDir,
      graphAnalyzer: { enabled: false },
    } as ServerConfig & { agentDefinitionsDir: string });
  });

  afterAll(async () => {
    await server?.close();
    await new Promise<void>((resolve) => stub.server.close(() => resolve()));
    if (ORIGINAL_OLLAMA_BASE_URL === undefined) delete process.env['OLLAMA_BASE_URL'];
    else process.env['OLLAMA_BASE_URL'] = ORIGINAL_OLLAMA_BASE_URL;
  });

  async function mcpCall(name: string, args: Record<string, unknown>) {
    const res = await fetch(`http://127.0.0.1:${server!.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  }

  it('neither the HTTP nor the MCP agent-detail body contains the systemPrompt, and BOTH still contain the script prompt', async () => {
    const run = await runScriptVia((tool, args) => mcpCall(tool, args as Record<string, unknown>), `return agent('r', { agentType: 'marked', prompt: '${SCRIPT_PROMPT}' });`);
    const runId = run.runId as string;
    const deadline = Date.now() + 20000;
    let status = await mcpCall('run_status', { runId });
    while (Date.now() < deadline && ['running', 'queued'].includes(status.status)) {
      await new Promise((r) => setTimeout(r, 200));
      status = await mcpCall('run_status', { runId });
    }
    expect(status.status).toBe('completed');
    const agentId = (status.result.agents as Array<{ agentId: string }>)[0]!.agentId;

    // run_agent_log's ADVERTISED schema takes {runId, label} (a cold model has no way to learn an
    // engine-minted agentId) — 'r' is the script's own agent() label.
    const mcpBody = JSON.stringify(await mcpCall('run_agent_log', { runId, label: 'r' }));
    const httpRes = await fetch(`http://127.0.0.1:${server!.port}/api/runs/${runId}/agents/${agentId}`);
    const httpBody = JSON.stringify(await httpRes.json());

    for (const [label, body] of [['MCP run_agent_log', mcpBody], ['HTTP agent detail', httpBody]] as const) {
      expect(body, `${label}: must not carry the systemPrompt bytes`).not.toContain(MARKER);
      expect(body, `${label}: must still carry the script-supplied prompt`).toContain(SCRIPT_PROMPT);
    }
  }, 30000);
});
