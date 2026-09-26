// VAL-004: Multi-model routing (REQ-004)
// Requires a running LiteLLM proxy / a live provider to observe end-to-end dispatch.
//
// 2026-09-26 (alias mechanism removed, owner decisions 1/2/6): every model is now a full
// `<provider>/<model-id>` ref, declared REQUIRED at `meta.params.agents.<label>.model.default` —
// there is no more alias table for `ServerConfig`/`createServer` to carry, and no 'default'
// fallback for an agent that declares no model. The "declaring the 'default' alias routes through
// this server's default entry" case is REMOVED (not rewritten): that mechanism does not exist any
// more — every label's model is always the ref it declares, never a server-wide fallback. The
// "unknown alias rejected at REGISTRATION" case is REWRITTEN: the old mechanism scanned a raw
// `agent(label, {model:'x'})` LITERAL for an unknown alias, at a script-check door that ran BEFORE
// the `PARAM_IN_SCRIPT`/`SCAN_VIOLATION` check — that literal-scan door is gone (`model` inside an
// agent() call's OWN options was always refused `PARAM_IN_SCRIPT` regardless, so the script-level
// alias scan was checking something no valid script could ever also trigger the other way). The
// only place a model string is checked now is the declared CONTRACT
// (`meta.params.agents.<label>.model.default`/`enum`), so the rewritten case declares a bad ref
// there instead.
//
// v24 MIGRATION (TASK-152), two separate defects fixed here:
//  1. FALSE GREEN. All four cases began `if (!HAS_PROVIDER) return;`, so with no provider they
//     passed having asserted nothing. The three that genuinely need a live provider are now
//     `it.skipIf(!HAS_PROVIDER)` with the reason in the NAME; the UNKNOWN_MODEL case needs no
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

/** One declared agent label routed at a full `<provider>/<model-id>` ref, the shape DES-144 requires. */
function routedScript(label: string, ref: string, prompt: string): string {
  return [
    `export const meta = { params: { agents: { ${label}: {`,
    `  model: { type: 'string', default: '${ref}' },`,
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
    server = await createServer({ port: 0 });
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

  it.skipIf(!HAS_PROVIDER)('a label declaring model.default:"anthropic/claude-3-5-haiku-20241022" routes to that exact provider+model' + NO_PROVIDER, async () => {
    const r = await runAndWait(routedScript('route', 'anthropic/claude-3-5-haiku-20241022', 'say yes'));
    expect(r.status).toBe('completed');
    const agents = agentsOf(await callTool('run_status', { runId: r.runId }));
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]!.provider).toBe('anthropic');
    expect(agents[0]!.model).toBe('claude-3-5-haiku-20241022');
  }, 120000);

  // 2026-09-26 (owner decisions 1/2/6): rewritten from "unknown alias rejected at REGISTRATION" —
  // the model check now lives ONLY in the declared contract (`meta.params.agents.<label>.model`),
  // never in a raw scan of an agent() call's own options (which is refused PARAM_IN_SCRIPT
  // regardless of content). Registration is still the ingress the check runs at, so nothing is ever
  // stored and no run can reach a bad ref mid-flight — same strength, new door.
  it('a bare (non-full-ref) model.default is rejected at REGISTRATION with UNKNOWN_MODEL (never mid-run)', async () => {
    const env = await callTool('workflow_register', {
      name: 'val004-bad-model',
      script: routedScript('x', 'nonexistent-alias', 'hi'),
      mermaid: 'graph LR\nsubgraph "p"\nn0(["x"])\nend',
    });
    expect(env.status).toBe('failed');
    expect(env.error?.code).toBe('UNKNOWN_MODEL');
    const got = await callTool('workflow_source', { name: 'val004-bad-model' });
    expect(got.error?.code ?? got.code).toBe('WORKFLOW_NOT_FOUND'); // nothing stored
  }, 10000);

  it.skipIf(!HAS_PROVIDER)('provider down: agent() resolves null, run continues (D-G breaker)' + NO_PROVIDER, async () => {
    // A second server instance, still zero-config — the "provider down" shape below routes to a
    // genuinely-nonexistent ollama model id (no alias table needed to make a target unreachable).
    const badServer = await createServer({ port: 0 });
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
        "  model: { type: 'string', default: 'ollama/nonexistent:99b' },",
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
