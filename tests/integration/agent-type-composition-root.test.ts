// IT-016: the agentType composition-root loader (D-F2) — a server-side agent-definitions directory
// of frontmatter `agents/*.md` files (compat-spec §5: "frontmatter single-sources model/tools/
// prompt") is loaded ONCE at the composition root (`createServer()`) and populates the
// `agentTypes` registry that `AgentExecutor` already knows how to resolve against (DES-007's
// existing `agentTypes?: Record<string, AgentTypeDef>` seam, proven at the AgentExecutor level by
// UT-017 — this test proves the registry is actually POPULATED from real files at startup, which
// nothing does today per 04-design.md's DES-007 Gate-6 route-back note: "no caller currently
// populates agentTypes from an actual on-disk registry ... every agentType is 'unknown' ... until
// that loader is built").
//
// Tier / mock policy (DES-015): integration — real `createServer()` + real McpFacade/RunManager/
// AgentExecutor/sandbox child process + a real on-disk frontmatter file (real fs, no fs mock,
// matching the WorkflowCatalog/UT-011 precedent); only the third-party LLM provider network is
// faked (a real local HTTP server standing in for Ollama's `/api/generate`, reached via
// `OLLAMA_BASE_URL` — same technique already used elsewhere for hermetic provider tests).
//
// Red reason: `ServerConfig` has no `agentDefinitionsDir` field and `createServer()` never loads
// or forwards an `agentTypes` registry into `RunManager`/`AgentExecutor` at all (confirmed by
// reading `src/server.ts`/`src/run-manager.ts` — `RunManagerDeps` has no `agentTypes` field either,
// and `AgentExecutor` is always constructed as `new AgentExecutor({ gateway, guard, store, clock })`
// with no `agentTypes`). Every `opts.agentType`, known or not, currently resolves as "unknown" and
// rejects — the "known type applies its prompt/model" case below is RED for that reason today.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server, ServerConfig } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

const STUB_PORT = 38125;

const ALIASES = {
  default: { provider: 'ollama' as const, model: 'default-model' },
  'helper-alias': { provider: 'ollama' as const, model: 'helper-specific-model' },
};

// v26 (DES-178, TASK-178): `RunManager.start()` now takes an admission-time price pin from the
// `ModelBook`, whose production source federates the live model catalog — which probes THIS same
// stub at `GET /api/tags` (`model-catalog.ts`'s `fetchOllama`). That probe is not an LLM dispatch,
// so the stub answers it with an empty model list and does NOT record it: `requests` stays the
// count of real `/api/generate` calls, which is exactly what this item's oracle has always meant.
function startStubOllamaServer(): { server: HttpServer; requests: Array<{ prompt: string; model: string }> } {
  const requests: Array<{ prompt: string; model: string }> = [];
  const server = createHttpServer((req, res) => {
    if ((req.url ?? '').startsWith('/api/tags')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as { prompt?: string; model?: string };
      requests.push({ prompt: body.prompt ?? '', model: body.model ?? '' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ response: 'ack', prompt_eval_count: 1, eval_count: 1 }));
    });
  });
  return { server, requests };
}

describe('agentType composition-root loader (IT-016, D-F2)', () => {
  let definitionsDir: string;
  let stub: ReturnType<typeof startStubOllamaServer>;
  let server: Server | undefined;
  const ORIGINAL_OLLAMA_BASE_URL = process.env['OLLAMA_BASE_URL'];

  async function mcpCall(baseUrl: string, name: string, args: Record<string, unknown>) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  }

  async function pollUntilSettled(baseUrl: string, runId: string, maxMs = 20000) {
    const deadline = Date.now() + maxMs;
    let status = await mcpCall(baseUrl, 'run_status', { runId });
    while (Date.now() < deadline && (status.status === 'running' || status.status === 'queued')) {
      await new Promise((r) => setTimeout(r, 200));
      status = await mcpCall(baseUrl, 'run_status', { runId });
    }
    return status;
  }

  beforeAll(async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it016-'));
    definitionsDir = join(workRoot, 'agents');
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(
      join(definitionsDir, 'helper.md'),
      [
        '---',
        'name: helper',
        'model: helper-alias',
        'tools: Read',
        '---',
        'You are a terse helper. Always answer in one word.',
        '',
      ].join('\n'),
      'utf8',
    );

    stub = startStubOllamaServer();
    await new Promise<void>((resolve) => stub.server.listen(STUB_PORT, '127.0.0.1', resolve));
    process.env['OLLAMA_BASE_URL'] = `http://127.0.0.1:${STUB_PORT}`;
  });

  afterAll(async () => {
    await server?.close();
    await new Promise<void>((resolve) => stub.server.close(() => resolve()));
    if (ORIGINAL_OLLAMA_BASE_URL === undefined) delete process.env['OLLAMA_BASE_URL'];
    else process.env['OLLAMA_BASE_URL'] = ORIGINAL_OLLAMA_BASE_URL;
  });

  it(
    "a known agentType (loaded from agents/*.md frontmatter) applies its definition's systemPrompt; its retired `model:` rung does NOT route the call (v24 ARCH-095)",
    async () => {
      server = await createServer({
        port: 0,
        bind: '127.0.0.1',
        aliases: ALIASES,
        useLiteLLMProxy: false,
        agentDefinitionsDir: definitionsDir,
        // v23 (REQ-102, TASK-126): this file counts `stub.requests` as a proxy for the script's
        // OWN agent() calls — unrelated to the graph analyzer, which now also fires a real request
        // through the same stub on registration (REQ-102's own "registration sends the script to
        // the configured LLM provider"). Disabled here so that count stays exactly what this test
        // is about.
        graphAnalyzer: { enabled: false },
      } as ServerConfig & { agentDefinitionsDir: string });
      const baseUrl = `http://127.0.0.1:${server.port}`;

      const run = await runScriptVia((tool, args) => mcpCall(baseUrl, tool, args), `return agent('respond', { agentType: 'helper' });`);
      const status = await pollUntilSettled(baseUrl, run.runId as string);
      expect(status.status).toBe('completed');

      expect(stub.requests.length).toBe(1);
      // The definition's systemPrompt was prepended to the outbound prompt (still live in v24 —
      // agent-executor.ts composes `def.systemPrompt` into the five-segment prompt).
      expect(stub.requests[0]!.prompt).toContain('You are a terse helper');
      expect(stub.requests[0]!.prompt).toContain('respond');
      // v24 MIGRATION (ARCH-095/DES-146, TASK-145 — the 'agentType' RESOLUTION RUNG IS RETIRED):
      // `agent-executor.ts` no longer reads `def.model` at all; the model is whatever the run's
      // admission snapshot resolved from the three surviving rungs (override › the label's declared
      // `params.agents.<label>.model.default` › engine), and every declared label's `model.default`
      // is REQUIRED at registration — so the agent-type registry's `model:` can never win. The
      // fixture's synthesized contract declares `model.default: 'default'` -> alias 'default' ->
      // 'default-model'. This assertion is NOT weakened: the frontmatter above still says
      // `model: helper-alias`, so if the retired rung were ever re-wired this reads
      // 'helper-specific-model' and goes red. The oracle is now "the contract default routes the
      // call, the agentType definition does not" — direction-sensitive in both directions.
      expect(stub.requests[0]!.model).toBe('default-model');
    },
    30000,
  );

  it(
    'an unknown agentType still fails fast (catchable in-script rejection, never a silent no-op, never dispatched to the gateway)',
    async () => {
      server = server ?? (await createServer({
        port: 0,
        bind: '127.0.0.1',
        aliases: ALIASES,
        useLiteLLMProxy: false,
        agentDefinitionsDir: definitionsDir,
        graphAnalyzer: { enabled: false },
      } as ServerConfig & { agentDefinitionsDir: string }));
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const requestsBefore = stub.requests.length;

      const run = await runScriptVia((tool, args) => mcpCall(baseUrl, tool, args), `
          try { return await agent('respond', { agentType: 'does-not-exist' }); }
          catch (e) { return 'caught:' + e.message; }
        `);
      const status = await pollUntilSettled(baseUrl, run.runId as string);
      expect(status.status).toBe('completed');

      const result = await mcpCall(baseUrl, 'run_result', { runId: run.runId });
      expect(String(result.result)).toContain('caught:');
      // Never reached the gateway for the unknown-type call.
      expect(stub.requests.length).toBe(requestsBefore);
    },
    30000,
  );
});
