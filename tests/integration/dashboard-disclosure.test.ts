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
import { runScriptVia } from '../helpers/workflow-fixtures.js';
import { DISCLOSURE_TABLE } from '../fixtures/dashboard-wire.js';

describe('dashboard disclosure key-set table (IT-165, ADR-054, DES-192)', () => {
  it('every (endpoint x outcome) row satisfies keys ⊆ ALLOWED and REQUIRED ⊆ keys against the fixture itself', () => {
    for (const row of DISCLOSURE_TABLE) {
      const keys = Object.keys(row.body);
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
