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

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val117-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
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

  // 2026-09-26 (alias mechanism removed): the deployment no longer resolves a private alias table,
  // so there is nothing deployment-specific for the guide to name — the model rule is now STATIC
  // text (the three closed providers + the `<provider>/<model-id>` shape), reachable from the guide
  // alone with no client plugin/skill to fall back on. This replaces the old "the guide names THIS
  // deployment's aliases" case with its full-ref successor, and folds in the 2026-09-26 owner
  // requirement that the tool schemas THEMSELVES (not only the guide) state the rule, since a cold
  // client now has only `tools/list` + the guide to go on.
  it('the guide states the full-ref rule (three static providers, no aliases), and a caller can write a full ref straight into model.default', async () => {
    const body = await rpc('tools/call', { name: 'workflow_authoring_guide', arguments: {} });
    const payload = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as { result?: unknown };
    const guide = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result ?? '');
    expect(guide).toContain('anthropic');
    expect(guide).toContain('openrouter');
    expect(guide).toContain('ollama');
    expect(guide).toMatch(/<provider>\/<model-id>/);
    expect(guide).toContain('UNKNOWN_MODEL');
    expect(guide.toLowerCase()).toContain('models_list');
    expect(guide.toLowerCase()).toContain('no aliases');

    // The rule it prints is the one registration actually enforces — the point of printing it.
    const script = [
      "export const meta = { params: { agents: { go: { model: { type: 'string', default: 'anthropic/claude-sonnet-5' },",
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };",
      // v26 (REQ-128): rule L2 plus the LR swimlane — the `if (false)` guard keeps this a
      // registration-only case (nothing dispatches), which makes the lane dynamic, so the node
      // lives in the lane with no predicted slot.
      "phase('Go');",
      "if (false) { await agent('go', {}); }",
      "return 'ok';",
    ].join('\n');
    const reg = await rpc('tools/call', { name: 'workflow_register', arguments: { name: 'val117-fullref-check', script, mermaid: 'graph LR\nsubgraph "Go"\ngo(["go"])\nend' } });
    const regPayload = JSON.parse(reg.result?.content?.[0]?.text ?? '{}') as { error?: { code?: string } };
    expect(regPayload.error).toBeUndefined();
  });

  // 2026-09-26 owner requirement: since the client plugin is being removed, the full-ref rule must
  // be discoverable from `tools/list` schemas alone, not only from calling the guide tool — a cold
  // client that only lists tools (never calls workflow_authoring_guide) must still see it on every
  // tool that takes a model.
  it('tools/list descriptions themselves (not just the guide) state the full-ref rule on every tool that takes a model', async () => {
    const body = await rpc('tools/list', {});
    const tools = body.result?.tools ?? [];
    const byName = (n: string) => tools.find((t) => t.name === n);

    const register = byName('workflow_register');
    expect(register?.description ?? '').toMatch(/anthropic/);
    expect(register?.description ?? '').toMatch(/openrouter/);
    expect(register?.description ?? '').toMatch(/ollama/);
    expect(register?.description ?? '').toMatch(/<provider>\/<model-id>/);

    const runStart = byName('run_start');
    expect(runStart?.description ?? '').toMatch(/<provider>\/<model-id>/);

    const modelsList = byName('models_list');
    expect(modelsList?.description ?? '', 'models_list must say ref IS the string to paste').toMatch(/\bref\b/);
    expect(modelsList?.description ?? '').toMatch(/<provider>\/<model-id>/);

    const modelsProbe = byName('models_probe');
    expect(modelsProbe?.description ?? '').toMatch(/<provider>\/<model-id>|models_list/);

    // Nothing on the model-bearing tools may point a now-plugin-less cold client at the removed
    // client plugin for model/alias information — the surface must be self-contained. (`skill` is
    // deliberately not checked here: it is a legitimate, unrelated vocabulary word elsewhere on the
    // tool surface — e.g. workspace_push's `skill/mcp` asset kind.)
    for (const name of ['workflow_register', 'run_start', 'models_list', 'models_probe']) {
      const d = (byName(name)?.description ?? '').toLowerCase();
      expect(d, `${name}'s description points at a plugin instead of being self-contained`).not.toMatch(/\bplugin\b/);
    }
  });
});
