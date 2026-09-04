// VAL-004: Multi-model routing via LiteLLM alias (REQ-004)
// Requires a running LiteLLM proxy configured with aliases.
//
// v24 MIGRATION (TASK-152), two separate defects fixed here:
//  1. FALSE GREEN. All four cases began `if (!HAS_PROVIDER) return;`, so with no provider they
//     passed having asserted nothing. The three that genuinely need a live provider are now
//     `it.skipIf(!HAS_PROVIDER)` with the reason in the NAME; the UNKNOWN_ALIAS case needs no
//     provider at all once migrated (it is a registration-time refusal) and is now unconditional —
//     a real green replacing a fake one.
//  2. Pre-v24 fixtures: inline `run_start({script})` is closed (REQ-098); `model` inside an agent()
//     options literal is refused PARAM_IN_SCRIPT and belongs in
//     `meta.params.agents.<label>.model.default` (DES-143/DES-144); `run_status`'s agent rows live
//     under `.result` (the envelope is `{runId,status,result}`), which the never-executed bodies
//     had never had to face.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia, type ToolCaller } from '../helpers/workflow-fixtures.js';

const HAS_PROVIDER = !!(process.env['LITELLM_BASE_URL'] || process.env['ANTHROPIC_API_KEY']);
const NO_PROVIDER = ' [UNVERIFIED here: no provider configured — set LITELLM_BASE_URL or ANTHROPIC_API_KEY]';

/** One declared agent label routed at `alias`, the shape DES-144 requires. */
function routedScript(label: string, alias: string, prompt: string): string {
  return [
    `export const meta = { params: { agents: { ${label}: {`,
    `  model: { type: 'string', default: '${alias}' },`,
    "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
    "  timeoutMs: { type: 'number', default: 120000 },",
    '} } } };',
    `return agent('${label}', { prompt: ${JSON.stringify(prompt)} });`,
  ].join('\n');
}

/** `run_status`'s agent rows: the tool envelope is `{runId, status, result}` (mcp-facade.ts
 *  runStatus), so the rows are `.result.agents` — the flat `.agents` read the pre-v24 fixtures used
 *  is kept as a fallback rather than assumed away. */
function agentsOf(statusView: unknown): Array<{ provider?: string; model?: string; label?: string }> {
  const v = statusView as { result?: { agents?: Array<{ provider?: string; model?: string; label?: string }> }; agents?: Array<{ provider?: string; model?: string; label?: string }> };
  return v.result?.agents ?? v.agents ?? [];
}

describe('VAL-004: multi-model routing (REQ-004)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Always attempt to start — throws "not implemented" at Gate 5.
    server = await createServer({
      port: 0,
      aliases: {
        sonnet:  { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        haiku:   { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
        default: { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => { await server?.close(); });

  const callTool: ToolCaller<any> = async (name, args) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  };

  // v22 (REQ-098) / v24 (TASK-152): inline script is closed, so the routed script reaches the
  // engine through register → publish → run-by-name. The routing SUBJECT is untouched.
  async function runAndWait(script: string) {
    const run = await runScriptVia(callTool, script);
    const runId = run.runId as string;
    for (let i = 0; i < 90; i++) {
      const s = await callTool('run_status', { runId });
      if (s.status === 'completed' || s.status === 'failed') return { ...s, runId };
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('timed out');
  }

  it.skipIf(!HAS_PROVIDER)('a label declaring model.default:"haiku" routes to the haiku alias provider+model' + NO_PROVIDER, async () => {
    const r = await runAndWait(routedScript('route', 'haiku', 'say yes'));
    expect(r.status).toBe('completed');
    const agents = agentsOf(await callTool('run_status', { runId: r.runId }));
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]!.provider).toBe('anthropic');
    expect(agents[0]!.model).toBe('claude-3-5-haiku-20241022');
  }, 120000);

  it.skipIf(!HAS_PROVIDER)('declaring the "default" alias routes through this server\'s default entry' + NO_PROVIDER, async () => {
    const r = await runAndWait(routedScript('plain', 'default', 'say yes'));
    expect(r.status).toBe('completed');
    const agents = agentsOf(await callTool('run_status', { runId: r.runId }));
    expect(agents[0]!.model).toBe('claude-3-5-haiku-20241022');
  }, 120000);

  // v24 (ADR-013, DES-148): the alias check moved from submission to REGISTRATION — the ingress a
  // script now enters through. Same oracle, and it is STRONGER at the new ingress: nothing is
  // stored, so no run can ever reach the bad alias mid-flight. No provider is needed to observe it,
  // so this case is unconditional rather than provider-gated (it used to be gated and therefore
  // never ran).
  it('unknown alias rejected at REGISTRATION with UNKNOWN_ALIAS (never mid-run)', async () => {
    const env = await callTool('workflow_register', {
      name: 'val004-bad-alias',
      script: `return agent('x',{model:'nonexistent-alias'});`,
      mermaid: 'graph TD;\nn0(["x"])',
    });
    expect(env.status).toBe('failed');
    expect(env.error?.code).toBe('UNKNOWN_ALIAS');
    const got = await callTool('workflow_source', { name: 'val004-bad-alias' });
    expect(got.error?.code ?? got.code).toBe('WORKFLOW_NOT_FOUND'); // nothing stored
  }, 10000);

  it.skipIf(!HAS_PROVIDER)('provider down: agent() resolves null, run continues (D-G breaker)' + NO_PROVIDER, async () => {
    // Configure a bad-provider alias by creating a second server instance
    const badServer = await createServer({
      port: 0,
      aliases: { default: { provider: 'ollama', model: 'nonexistent:99b' } },
    });
    const badBase = `http://127.0.0.1:${badServer.port}`;
    try {
      const badCall: ToolCaller<any> = async (name, args) => {
        const res = await fetch(`${badBase}/mcp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        });
        const body = await res.json() as { result?: { content: Array<{ text: string }> } };
        return JSON.parse(body.result!.content[0].text);
      };
      const downScript = [
        "export const meta = { params: { agents: { down: {",
        "  model: { type: 'string', default: 'default' },",
        "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
        "  timeoutMs: { type: 'number', default: 120000 },",
        "} } } };",
        "const r = await agent('down', { prompt: 'x' });",
        "return r === null ? 'null-ok' : 'unexpected';",
      ].join('\n');
      const run = await runScriptVia(badCall, downScript);
      const runId = run.runId as string;
      for (let i = 0; i < 60; i++) {
        const res = await fetch(`${badBase}/mcp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_status', arguments: { runId } } }),
        });
        const body = await res.json() as { result?: { content: Array<{ text: string }> } };
        const s = JSON.parse(body.result!.content[0].text);
        if (s.status === 'completed') {
          const r2 = await fetch(`${badBase}/mcp`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_result', arguments: { runId } } }),
          });
          const rb = await r2.json() as { result?: { content: Array<{ text: string }> } };
          const result = JSON.parse(rb.result!.content[0].text);
          expect(result.result).toBe('null-ok');
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error('timed out');
    } finally {
      await badServer.close();
    }
  }, 120000);
});
