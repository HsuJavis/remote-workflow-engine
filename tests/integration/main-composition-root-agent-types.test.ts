// IT-022: D-F10(b) route-back — agentDefinitionsDir reaches the agentType composition-root loader
// end-to-end THROUGH src/main.ts's own composition path (not just via a hand-built ServerConfig, the
// way IT-016 proves the loader itself works).
//
// Gate 7.5 round 4 real defect (state.yaml pending[], 08-validation.md): "src/main.ts never reads or
// forwards agentDefinitionsDir into the ServerConfig it constructs, so D-F2's real, tested agentType
// composition-root loader is permanently unreachable via the documented product entrypoint — every
// real agentType value resolves to 'Unknown agentType' in production regardless of any agents/*.md
// directory." IT-016 already proves `loadAgentDefinitions()`/`createServer({agentDefinitionsDir})`
// work correctly in isolation; this test proves the SAME thing reachable specifically through
// main.ts's own `FileConfig` -> `ServerConfig` translation (the documented entrypoint, per D-F10's
// structural rule: composition-root gaps must be caught by a test that boots the way main.ts does).
//
// Intended contract: same `composeConfig(fileConfig, deps)` export as IT-021 (main-composition-root
// test) — see that file's header for the full contract. This file additionally requires
// `composeConfig` to forward `fileConfig.agentDefinitionsDir` into the returned `ServerConfig`
// unchanged (today's main.ts's literal `config` object omits the field entirely).
//
// Mock policy (DES-015, integration tier): real `composeConfig` + real `createServer()` +
// real `McpFacade`/`RunManager`/`AgentExecutor`/sandbox child process + a real on-disk frontmatter
// file (real fs, matching IT-016's own convention); only the third-party SDK `query()` call (via the
// injected `queryImpl` deps seam) and the LiteLLMProxyManager subprocess (injected `proxyManager`
// deps seam) are faked.
//
// Red reason: `src/main.ts` does not export `composeConfig` today — `typeof composeConfig ===
// 'function'` is the forcing red (same as IT-021). Once the export exists but `agentDefinitionsDir`
// still isn't forwarded, the red instead moves to `status.status` never reaching `'completed'` (the
// in-script `agent('respond', {agentType:'helper'})` call rejects with "Unknown agentType: helper",
// matching IT-016's own documented pre-D-F2 failure mode) or to the captured prompt/model never
// reflecting the definition's frontmatter.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import type { AliasMap } from '../../src/gateway/client.js';
import type { Server, ServerConfig } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

// Same import-safety harness as main-composition-root.test.ts (IT-021) — see that file's top-of-file
// note for why this exists (src/main.ts has no import-guard yet, so evaluating the module for real
// has a real side effect regardless of what's being tested).
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(() => ({ exitCode: null, kill: vi.fn() }) as unknown as ChildProcess) };
});

const ALIASES: AliasMap = {
  default: { provider: 'ollama', model: 'default-model' },
  'helper-alias': { provider: 'ollama', model: 'helper-specific-model' },
};

/** Same fake-proxy pattern as IT-021 / claude-agent-sdk-gateway-timeout.test.ts. */
function makeFakeProxyManager(): LiteLLMProxyManager {
  const fakeSpawn = vi.fn(() => ({ exitCode: null, kill: vi.fn() }) as unknown as ChildProcess);
  const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
  return new LiteLLMProxyManager(ALIASES, {
    spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
    fetchImpl: fakeHealthFetch as unknown as typeof fetch,
  });
}

describe('src/main.ts composition-root: agentDefinitionsDir end-to-end (IT-022, D-F10b)', () => {
  const originalFetch = globalThis.fetch;
  const originalExit = process.exit;
  const originalPort = process.env['RWE_PORT'];
  const originalConfigPath = process.env['RWE_CONFIG_PATH'];
  let realFetch: typeof fetch;
  let definitionsDir: string;
  let server: Server | undefined;

  beforeAll(() => {
    realFetch = globalThis.fetch.bind(globalThis);
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it022-'));
    definitionsDir = join(workRoot, 'agents');
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(
      join(definitionsDir, 'helper.md'),
      ['---', 'name: helper', 'model: helper-alias', 'tools: Read', '---', 'You are a terse helper. Always answer in one word.', ''].join('\n'),
      'utf8',
    );

    // Same import-safety harness as IT-021 — see that file for the rationale. Note `realFetch`
    // (captured above) is what the actual MCP calls below use — only the background real main()
    // import side effect's OWN health-check fetch needs faking here.
    process.env['RWE_PORT'] = '0';
    process.env['RWE_CONFIG_PATH'] = join(tmpdir(), 'rwe-it022-no-such-config.json');
    process.exit = ((_code?: number) => undefined) as unknown as typeof process.exit;
    globalThis.fetch = (async () => ({ ok: true }) as unknown as Response) as typeof fetch;
  });

  afterAll(async () => {
    await server?.close();
    globalThis.fetch = originalFetch;
    process.exit = originalExit;
    if (originalPort === undefined) delete process.env['RWE_PORT'];
    else process.env['RWE_PORT'] = originalPort;
    if (originalConfigPath === undefined) delete process.env['RWE_CONFIG_PATH'];
    else process.env['RWE_CONFIG_PATH'] = originalConfigPath;
  });

  async function mcpCall(baseUrl: string, name: string, args: Record<string, unknown>): Promise<any> {
    const res = await realFetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  }

  async function pollUntilSettled(baseUrl: string, runId: string, maxMs = 20000): Promise<any> {
    const deadline = Date.now() + maxMs;
    let status = await mcpCall(baseUrl, 'workflow_status', { runId });
    while (Date.now() < deadline && (status.status === 'running' || status.status === 'queued')) {
      await new Promise((r) => setTimeout(r, 200));
      status = await mcpCall(baseUrl, 'workflow_status', { runId });
    }
    return status;
  }

  it(
    "a known agentType (loaded from agents/*.md) resolves through composeConfig()+createServer() — main.ts's own real translation path, not a hand-built ServerConfig",
    async () => {
      const mod = (await import('../../src/main.js')) as Record<string, unknown>;
      const composeConfig = mod['composeConfig'];
      // Forcing red today: main.ts exports no such helper at all.
      expect(typeof composeConfig).toBe('function');

      const requests: Array<{ prompt: string; model?: string }> = [];
      const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it022-run-'));
      const config = await (composeConfig as (fc: unknown, deps: unknown) => Promise<ServerConfig>)(
        {
          bind: '127.0.0.1',
          port: 0,
          workRoot,
          aliases: ALIASES,
          agentDefinitionsDir: definitionsDir,
          gateway: 'sdk',
          // v23 (REQ-102, TASK-126): `requests` below counts the script's OWN agent() calls —
          // unrelated to the graph analyzer, which now also fires a real request through the SAME
          // queryImpl stub on registration. Disabled here so the count stays what this test is about.
          graphAnalyzer: { enabled: false },
        },
        {
          queryImpl: vi.fn((opts: { prompt: string; options?: { model?: string } }) => {
            requests.push({ prompt: opts.prompt, model: opts.options?.model });
            return (async function* () {
              yield { type: 'result', subtype: 'success', is_error: false, result: 'ack', usage: { input_tokens: 1, output_tokens: 1 } };
            })();
          }),
          proxyManager: makeFakeProxyManager(),
        },
      );

      const { createServer } = await import('../../src/server.js');
      server = await createServer(config);
      const baseUrl = `http://127.0.0.1:${server.port}`;

      const run = await runScriptVia((tool, args) => mcpCall(baseUrl, tool, args), `return agent('respond', { agentType: 'helper' });`);
      const status = await pollUntilSettled(baseUrl, run.runId as string);

      // Forcing red (once the export exists but agentDefinitionsDir still isn't forwarded): the run
      // never completes — `agent('respond', {agentType:'helper'})` rejects with "Unknown agentType:
      // helper" because config.agentDefinitionsDir was never threaded into ServerConfig, so
      // createServer() never populates the agentTypes registry at all (same failure mode IT-016
      // documents pre-D-F2).
      expect(status.status).toBe('completed');
      expect(requests.length).toBe(1);
      // The definition's systemPrompt was prepended to the outbound prompt.
      expect(requests[0]!.prompt).toContain('You are a terse helper');
      // The definition's own `model:` (an alias name) routed the call — not the run's unrelated
      // 'default' alias. It reaches the stub as its proxy-facing name (proxyModelName): the prefix
      // keeps the alias verbatim past the CLI's shorthand expansion so the LiteLLM proxy matches it.
      expect(requests[0]!.model).toBe('rwe-proxy-helper-alias');
    },
    30000,
  );
});
