// VAL-117 (REQ-106, REQ-117, DES-157, ARCH-107): on a real `tools/list` over `/mcp`, a cold
// schema-only client can reach the authoring rules from the MCP surface alone — it discovers
// `workflow_authoring_guide`, `workflow_register`'s own description tells it to call that first,
// and the guide it gets back carries the rules.
//
// Mock policy (acceptance, DES-119): real `createServer`, real `/mcp` `tools/list`. No LLM needed.
//
// v24 MIGRATION (TASK-152). Same oracle — "the rules are reachable from the MCP surface itself"
// (REQ-106's acceptance says, verbatim, "the `workflow_register.script` description **or an
// equivalent discoverable reference**") — new spelling. REQ-117 makes that reference concrete:
// "Given `tools/list` alone Then a cold client discovers `workflow_authoring_guide` and
// `workflow_register`'s description tells it to call that first". The rules themselves moved out of
// a property description and into `buildAuthoringGuide()` (ADR-032, DES-157), which is ALSO the
// generator for `docs/AUTHORING.md` — so the file path is no longer the pointer a cold client
// needs, the tool name is. `tool-specs.ts` gives `script` no `description` at all, so the pre-v24
// assertions ran against an empty string.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let workRoot: string;

// v24 Gate 7.5 (D-12): a DEPLOYMENT-SPECIFIC alias table, deliberately not the default one — the
// guide must render what THIS engine accepts, so a hard-coded list cannot pass.
const ALIASES = {
  'val117-fast': { provider: 'anthropic' as const, model: 'claude-3-5-haiku-20241022' },
  'val117-deep': { provider: 'anthropic' as const, model: 'claude-opus-4-5' },
  default: { provider: 'anthropic' as const, model: 'claude-3-5-sonnet-20241022' },
};

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val117-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot, aliases: ALIASES });
});
afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

describe('REQ-106/REQ-117: the authoring rules are discoverable from the MCP surface alone (VAL-117)', () => {
  async function rpc(method: string, params: unknown) {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return await res.json() as { result?: { tools?: Array<{ name: string; description?: string }>; content?: Array<{ text?: string }> } };
  }

  it('the real tools/list advertises workflow_authoring_guide, and workflow_register points a cold client at it', async () => {
    const body = await rpc('tools/list', {});
    const tools = body.result?.tools ?? [];
    expect(tools.map((t) => t.name)).toContain('workflow_authoring_guide');
    // REQ-117 clause 1: discovery must not depend on the client guessing — the register tool's own
    // advertised text has to name the guide.
    const registerTool = tools.find((t) => t.name === 'workflow_register');
    expect(registerTool?.description ?? '').toMatch(/workflow_authoring_guide/);
  });

  it('the guide that tools/list points at carries the authoring rules a cold client needs', async () => {
    const body = await rpc('tools/call', { name: 'workflow_authoring_guide', arguments: {} });
    const payload = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as { result?: unknown };
    const guide = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result ?? '');
    // The same four things the pre-v24 `script` description was asserted to carry, at their v24
    // home: declare knobs in `meta.params`, the locked/tunable split, and the phase-title
    // convention. (The fourth, the `docs/AUTHORING.md` pointer, IS this text — ADR-032 generates
    // that file from this builder — so the pointer a schema-only client follows is the tool.)
    expect(guide).toMatch(/meta\.params/);
    expect(guide.toLowerCase()).toContain('locked');
    expect(guide.toLowerCase()).toContain('phase title');
  });

  // v24 Gate 7.5 (D-12, REQ-117): the cold subject's FIRST registration was refused because it put
  // a model ID from `models_list` in `model.default` — nothing on the tool surface named the alias
  // names this deployment accepts. This is the wiring half: the names must reach the guide THROUGH
  // THE BOOTED SERVER's own resolved alias table, not merely be renderable by the builder.
  it("the guide names THIS deployment's model aliases, and a caller can write one straight into model.default", async () => {
    const body = await rpc('tools/call', { name: 'workflow_authoring_guide', arguments: {} });
    const payload = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as { result?: unknown };
    const guide = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result ?? '');
    for (const alias of Object.keys(ALIASES)) expect(guide, `the guide never names the '${alias}' alias`).toContain(alias);

    // The names it prints are the ones registration actually accepts — the point of printing them.
    const script = [
      "export const meta = { params: { agents: { go: { model: { type: 'string', default: 'val117-fast' },",
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };",
      "if (false) { await agent('go', {}); }",
      "return 'ok';",
    ].join('\n');
    const reg = await rpc('tools/call', { name: 'workflow_register', arguments: { name: 'val117-alias-check', script, mermaid: 'graph TD;\ngo(["go"])' } });
    const regPayload = JSON.parse(reg.result?.content?.[0]?.text ?? '{}') as { error?: { code?: string } };
    expect(regPayload.error).toBeUndefined();
  });
});
