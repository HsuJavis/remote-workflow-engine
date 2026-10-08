// MAJOR (security, 2026-10-07 reverify of #154): `opts.label` selected ANOTHER agent's
// model/effort/timeout/appendPrompt override/skills/MCP at dispatch. `_handleAgentRequest`
// (run-manager.ts) resolved both the per-label admission slice (`baseParams.agents?.[label]`) and
// the per-label declared asset scope (`assetScope.declared[label]`) by `key.opts.label` — the
// caller's own cosmetic, run-tracking name (`rawOpts.label ?? positional`) — instead of
// `positional`, the agent() call's literal first argument the HOST already treats as authoritative
// for the dispatch-tamper check (20cff09). `agent('a', { label: 'b', ... })` — the single most
// common agent() shape in this codebase's own fixtures — therefore dispatched with 'a's declared
// tools (correctly tamper-checked against 'a') but 'b's model/effort/timeoutMs/appendPrompt/skills/
// mcp. Fix: both lookups now key by `positional`, with `Object.hasOwn` guards so a label value that
// happens to collide with `Object.prototype` ('constructor'/'__proto__'/'toString') can never
// resolve to anything on the prototype chain — it simply finds no entry, same as any other
// non-existent label, and falls back to this call's OWN label's resolved params.
//
// Every variant still declares AND positionally calls both 'a' and 'b' (AGENT_DECLARED_NOT_IN_SCRIPT
// otherwise refuses registration outright — a declared agent with no agent() call using it
// positionally is a separate, pre-existing rule, not a repro helper) — the 'b' call is simply never
// the one under test unless named.
//
// Mock policy (integration, mirrors nested-agent-child-params.test.ts/openrouter-passthrough-pricing.
// test.ts): real createServer()/RunManager/AgentExecutor/real sandbox child process (the opts object
// genuinely crosses the real child->host IPC JSON round-trip — load-bearing for the
// Object.prototype.toJSON case below); only the GatewayClient (the wire boundary AgentExecutor
// itself dispatches to) is faked, recording every field of the request it receives.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { parseModelRef } from '../../src/providers.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';
import { registerPublishedVia, uniqueWorkflowName, type ToolCaller } from '../helpers/workflow-fixtures.js';

interface Seen {
  prompt: string;
  model?: string;
  effort?: unknown;
  timeoutMs?: unknown;
  declaredSkills: string[];
  declaredMcp: string[];
}
let seen: Seen[] = [];
const GATEWAY: GatewayClient = {
  async invoke(req: any) {
    seen.push({
      prompt: req.prompt,
      model: req.opts?.model,
      effort: req.opts?.effort,
      timeoutMs: req.opts?.timeoutMs,
      declaredSkills: req.assets?.declared?.skills ?? [],
      declaredMcp: req.assets?.declared?.mcp ?? [],
    });
    const target = parseModelRef(req.opts?.model) ?? { provider: 'x', model: 'x' };
    return { ok: true, provider: target.provider, model: target.model, tokens: { input: 10, output: 5 }, content: 'OK' };
  },
} as GatewayClient;

const priced = (model: string) => ({
  provider: 'anthropic', model, description: 'test-priced', modalities: { in: ['text'], out: ['text'] },
  contextWindow: 200_000, price: { in: '$1/1M', out: '$2/1M' }, toolUse: true, location: 'remote',
  ratesPerM: { in: 1, out: 2, cacheRead: 0, cacheWrite: 0 },
});
const MODEL_A = 'anthropic/claude-haiku-4-5-20251001';
const MODEL_B = 'anthropic/claude-opus-4-8';
const CATALOG = async (): Promise<any[]> => [priced(parseModelRef(MODEL_A)!.model), priced(parseModelRef(MODEL_B)!.model)];

let server: Server;
let baseUrl: string;
let dir: string;

function callerFor(url: () => string): ToolCaller {
  return async (name, args) => {
    const res = await fetch(`${url()}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> }; error?: unknown };
    if (!body.result) throw new Error(`tool call ${name} failed: ${JSON.stringify(body.error)}`);
    return JSON.parse(body.result.content[0]!.text);
  };
}
const call = callerFor(() => baseUrl);

async function settleVia(caller: ToolCaller, runId: string): Promise<any> {
  for (let i = 0; i < 150; i++) {
    const s = await caller('run_status', { runId });
    if (['completed', 'failed'].includes(s.status)) return s;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`run ${runId} never settled`);
}

// The two agents' meta.params.agents — a declares MODEL_A/low/60000; b declares MODEL_B/high/45000/
// a non-empty appendPrompt default. A dispatch correctly scoped to 'a' must NEVER show
// MODEL_B/high/45000/the appendPrompt text. No skills/mcp here (a run_start that DISPATCHES a label
// declaring either refuses MCP_NOT_PROVISIONED/SKILL_NOT_PROVISIONED unless actually provisioned via
// workspace_push first) — the skills/mcp half of this bug is covered separately, once, by
// META_WITH_ASSETS below (provisioned in its own dedicated test), so the rest of this file's variant
// battery (which exists to prove the LABEL mechanism is inert regardless of HOW the string is
// produced, not to re-prove asset provisioning) stays simple.
const META = `export const meta = { phases: [{ title: 'p1' }], params: { agents: {
  a: { model: { type: 'string', default: '${MODEL_A}' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
  b: { model: { type: 'string', default: '${MODEL_B}' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'high' }, timeoutMs: { type: 'number', default: 45000 }, appendPrompt: { type: 'string', default: 'MK_B_OWN_APPENDPROMPT' } },
} } };\n`;
const META_WITH_ASSETS = `export const meta = { phases: [{ title: 'p1' }], params: { agents: {
  a: { model: { type: 'string', default: '${MODEL_A}' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
  b: { model: { type: 'string', default: '${MODEL_B}' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'high' }, timeoutMs: { type: 'number', default: 45000 }, skills: ['sk-b'], mcp: ['mcp-b'], appendPrompt: { type: 'string', default: 'MK_B_OWN_APPENDPROMPT' } },
} } };\n`;
// Every call below declares `allowedTools: []` for both 'a' and 'b' — the diagram must carry the
// matching value-triple + `tools: none` segment for each (check-mermaid.ts's TOOLS_MISMATCH/
// value-triple rules), same convention as agent-opts-dispatch-tamper.test.ts's own TAMPER_MERMAID.
const TRI_A = `${MODEL_A} · low · 60000`;
const TRI_B = `${MODEL_B} · high · 45000`;
const TWO_AGENT_DIAGRAM = `graph LR\nsubgraph "p1"\nn0(["a<br/>${TRI_A}<br/>tools: none"])\nn1(["b<br/>${TRI_B}<br/>tools: none"])\nend\nn0 --> n1`;

/** Registers+publishes a one-phase, two-agent-declared script (always calling BOTH 'a' and 'b'
 *  positionally — see this file's header), runs it, and returns the fake gateway's recording of
 *  whichever agent() call(s) actually dispatched. `bBody` defaults to an honest b call so a variant
 *  that only cares about 'a' doesn't have to repeat it. */
async function runAndRecord(name: string, aStmt: string, bStmt = `y = await agent('b', { prompt: 'MK_CONTROL_B', allowedTools: [] });`, metaBlock = META): Promise<Seen[]> {
  const before = seen.length;
  const script = metaBlock + `phase('p1');\nlet x, y;\n${aStmt}\n${bStmt}\nreturn { x, y };`;
  await registerPublishedVia(call, name, script, { mermaid: TWO_AGENT_DIAGRAM });
  const started = await call('run_start', { name });
  expect(started.runId, JSON.stringify(started)).toBeTruthy();
  const status = await settleVia(call, started.runId);
  expect(status.status).toBe('completed');
  return seen.slice(before);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-label-config-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: dir, gateway: GATEWAY, modelCatalog: CATALOG, diskFloor: { bytes: 0, percent: 0 },
    mcpEgressAllowlist: ['https://example.com/'], mcpProbe: new FakeMcpProbe(true),
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
  // Provisioned ONCE, globally — only META_WITH_ASSETS's dedicated test declares these names, so
  // every other variant (which uses plain META) never touches a provisioning door at all.
  const pushMcp = await call('workspace_push', { scope: 'global', kind: 'mcp', name: 'mcp-b', config: { url: 'https://example.com/mcp-b' } });
  expect(pushMcp.error ?? pushMcp.code).toBeUndefined();
  const pushSkill = await call('workspace_push', {
    scope: 'global', kind: 'skill', name: 'sk-b',
    files: [{ path: 'SKILL.md', contentB64: Buffer.from('---\nname: sk-b\ndescription: test skill.\n---\n\nbody').toString('base64') }],
  });
  expect(pushSkill.error ?? pushSkill.code).toBeUndefined();
});
afterAll(async () => {
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("agent('a', { label: 'b', ... }) dispatches with 'a's OWN config, never 'b's (MAJOR #154 reverify)", () => {
  it('[LOAD-BEARING] a literal label swap: model/effort/timeoutMs/appendPrompt/skills/mcp all stay a\'s own', async () => {
    const name = uniqueWorkflowName('lbl-literal');
    const results = await runAndRecord(
      name,
      `x = await agent('a', { prompt: 'MK_LIT_A', label: 'b', allowedTools: [] });`,
      `y = await agent('b', { prompt: 'MK_LIT_B', allowedTools: [] });`,
      META_WITH_ASSETS,
    );
    const aCall = results.find((r) => r.prompt.includes('MK_LIT_A'))!;
    const bCall = results.find((r) => r.prompt.includes('MK_LIT_B'))!;
    expect(aCall).toBeDefined();
    expect(aCall.model).toBe(MODEL_A);
    expect(aCall.effort).toBe('low');
    expect(aCall.timeoutMs).toBe(60000);
    expect(aCall.declaredSkills).toEqual([]);
    expect(aCall.declaredMcp).toEqual([]);
    expect(aCall.prompt).not.toContain('MK_B_OWN_APPENDPROMPT');
    // control: b's own call legitimately gets b's own config.
    expect(bCall.model).toBe(MODEL_B);
    expect(bCall.effort).toBe('high');
    expect(bCall.timeoutMs).toBe(45000);
    expect(bCall.declaredSkills).toEqual(['sk-b']);
    expect(bCall.declaredMcp).toEqual(['mcp-b']);
    expect(bCall.prompt).toContain('MK_B_OWN_APPENDPROMPT');
  }, 30000);

  it('a label read from a variable behaves identically', async () => {
    const name = uniqueWorkflowName('lbl-variable');
    const results = await runAndRecord(name, `const L = ['b'][0];\nx = await agent('a', { prompt: 'MK_VAR_A', label: L, allowedTools: [] });`);
    const aCall = results.find((r) => r.prompt.includes('MK_VAR_A'))!;
    expect(aCall.model).toBe(MODEL_A);
    expect(aCall.timeoutMs).toBe(60000);
    expect(aCall.declaredSkills).toEqual([]);
  }, 30000);

  it('a label produced via JSON.parse behaves identically', async () => {
    const name = uniqueWorkflowName('lbl-jsonparse');
    const results = await runAndRecord(name, `x = await agent('a', { prompt: 'MK_JSON_A', label: JSON.parse('"b"'), allowedTools: [] });`);
    const aCall = results.find((r) => r.prompt.includes('MK_JSON_A'))!;
    expect(aCall.model).toBe(MODEL_A);
    expect(aCall.timeoutMs).toBe(60000);
  }, 30000);

  it('a label produced via String.raw behaves identically', async () => {
    const name = uniqueWorkflowName('lbl-stringraw');
    const results = await runAndRecord(name, "x = await agent('a', { prompt: 'MK_RAW_A', label: String.raw`b`, allowedTools: [] });");
    const aCall = results.find((r) => r.prompt.includes('MK_RAW_A'))!;
    expect(aCall.model).toBe(MODEL_A);
    expect(aCall.timeoutMs).toBe(60000);
  }, 30000);

  // A label that is itself a non-string (coerces to 'b' only via Symbol.toPrimitive, which
  // JSON.stringify never consults) must be INERT — `typeof rawOpts.label === 'string'` is false, so
  // it is treated exactly like no label at all (falls back to the positional). Proves the host never
  // widens its notion of "a label" to include coercible objects.
  it("a label value that only coerces to 'b' via Symbol.toPrimitive is inert (never redirects)", async () => {
    const name = uniqueWorkflowName('lbl-toprimitive');
    const results = await runAndRecord(name, "x = await agent('a', { prompt: 'MK_PRIM_A', label: { [Symbol.toPrimitive]() { return 'b'; } }, allowedTools: [] });");
    const aCall = results.find((r) => r.prompt.includes('MK_PRIM_A'))!;
    expect(aCall.model).toBe(MODEL_A);
    expect(aCall.timeoutMs).toBe(60000);
  }, 30000);

  // Object.prototype.toJSON injection at the REAL child->host IPC JSON-serialization boundary (the
  // same mechanism 20cff09/the scan-tamper test already proves is caught for allowedTools) — here it
  // injects a WHOLE new `label` key (plus bogus model/effort/timeoutMs/mcp) onto an opts object that
  // never declared one. allowedTools stays honestly `[]` (matching 'a's own scanned literal) so the
  // AGENT_OPTS_TAMPERED check does not fire — this call must still dispatch, with 'a's own config.
  // `Object.assign` (not a `this[k]` computed loop) — a computed member access on `this` is itself
  // refused at registration (script-checks.ts's sandbox-API-aliasing guard fails closed on ANY
  // `this[nonLiteralKey]`, unrelated to this test's subject).
  it('[LOAD-BEARING] an Object.prototype.toJSON injection of label (+ bogus model/effort/timeoutMs/mcp) at the real IPC boundary cannot redirect config', async () => {
    const name = uniqueWorkflowName('lbl-objproto-tojson');
    const results = await runAndRecord(
      name,
      "Object.prototype.toJSON = function () { if (this && this.prompt === 'MK_TOJSON_A') { return Object.assign({}, this, { label: 'b', model: 'openrouter/openai/o3', effort: 'max', timeoutMs: 1, mcp: ['zz-injected'] }); } return this; };\n"
      + "x = await agent('a', { prompt: 'MK_TOJSON_A', allowedTools: [] });",
    );
    const aCall = results.find((r) => r.prompt.includes('MK_TOJSON_A'))!;
    expect(aCall.model).toBe(MODEL_A);
    expect(aCall.effort).toBe('low');
    expect(aCall.timeoutMs).toBe(60000);
    expect(aCall.declaredMcp).toEqual([]);
  }, 30000);

  // label values that collide with the Object prototype chain: must neither crash nor redirect to
  // anything on Object.prototype — Object.hasOwn means "no entry found", which falls back to this
  // call's own positional ('a's) resolved params, same as any other non-existent label.
  for (const lab of ['constructor', '__proto__', 'toString']) {
    it(`a label of '${lab}' (prototype chain) neither crashes nor redirects — falls back to 'a's own config`, async () => {
      const name = uniqueWorkflowName('lbl-proto-' + lab.replace(/\W+/g, ''));
      const results = await runAndRecord(name, `x = await agent('a', { prompt: 'MK_PROTO_A', label: '${lab}', allowedTools: [] });`);
      const aCall = results.find((r) => r.prompt.includes('MK_PROTO_A'))!;
      expect(aCall).toBeDefined();
      expect(aCall.model).toBe(MODEL_A);
      expect(aCall.timeoutMs).toBe(60000);
    }, 30000);
  }

  // A failed run must never leave an agent record stuck at 'running' — general safety net, not tied
  // to any one crash cause (the label/hasOwn fix above already removes the one KNOWN trigger for
  // this; this proves the catch-all holds for an UNRELATED synchronous dispatch failure too).
  it("a dispatch that fails unexpectedly after markRunning still finalizes the agent record (never stuck 'running')", async () => {
    const throwingGateway: GatewayClient = { invoke() { throw new Error('boom: unexpected synchronous gateway failure'); } } as unknown as GatewayClient;
    const throwDir = mkdtempSync(join(tmpdir(), 'rwe-label-config-throw-'));
    const throwServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: throwDir, gateway: throwingGateway, modelCatalog: CATALOG, diskFloor: { bytes: 0, percent: 0 } });
    try {
      const throwBaseUrl = `http://127.0.0.1:${throwServer.port}`;
      const throwCall = callerFor(() => throwBaseUrl);
      const name = uniqueWorkflowName('lbl-stuck-running');
      const script = META + `phase('p1');\nconst x = await agent('a', { prompt: 'MK_THROW_A', allowedTools: [] });\nconst y = await agent('b', { prompt: 'MK_THROW_B', allowedTools: [] });\nreturn { x, y };`;
      await registerPublishedVia(throwCall, name, script, { mermaid: TWO_AGENT_DIAGRAM });
      const started = await throwCall('run_start', { name });
      expect(started.runId).toBeTruthy();
      for (let i = 0; i < 100; i++) {
        const s = await throwCall('run_status', { runId: started.runId });
        if (s.status === 'completed' || s.status === 'failed') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const finalStatus = await throwCall('run_status', { runId: started.runId });
      const agents = finalStatus.result?.agents ?? finalStatus.agents ?? [];
      const stuckRunning = agents.filter((a: any) => a.state === 'running');
      expect(stuckRunning).toEqual([]);
    } finally {
      await throwServer.close();
      rmSync(throwDir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("a nested workflow() frame's agent('a', { label: 'b', ... }) also dispatches with the CHILD's OWN 'a' config (MAJOR #154 reverify, nested-frame variant)", () => {
  it("[LOAD-BEARING] nested frame: label swap inside a child workflow() still resolves to the CHILD contract's own a, never its b", async () => {
    const childName = uniqueWorkflowName('lbl-nested-child');
    const parentName = uniqueWorkflowName('lbl-nested-parent');
    const childScript = META + `phase('p1');\nconst x = await agent('a', { prompt: 'MK_NEST_A', label: 'b', allowedTools: [] });\nconst y = await agent('b', { prompt: 'MK_NEST_B', allowedTools: [] });\nreturn { x, y };`;
    await registerPublishedVia(call, childName, childScript, { mermaid: TWO_AGENT_DIAGRAM });
    const before = seen.length;
    // No explicit mermaid for the parent — it has no agent() calls of its own (only a workflow()
    // call), so the auto-synthesized minimal LR diagram (registerPublishedVia's default) applies.
    await registerPublishedVia(call, parentName, `phase('p1');\nreturn await workflow('${childName}', {});`);
    const started = await call('run_start', { name: parentName });
    expect(started.runId, JSON.stringify(started)).toBeTruthy();
    const status = await settleVia(call, started.runId);
    expect(status.status).toBe('completed');

    const results = seen.slice(before);
    const aCall = results.find((r) => r.prompt.includes('MK_NEST_A'))!;
    const bCall = results.find((r) => r.prompt.includes('MK_NEST_B'))!;
    expect(aCall).toBeDefined();
    expect(aCall.model).toBe(MODEL_A);
    expect(aCall.timeoutMs).toBe(60000);
    expect(aCall.declaredSkills).toEqual([]);
    expect(bCall.model).toBe(MODEL_B);
    expect(bCall.timeoutMs).toBe(45000);
  }, 30000);
});
