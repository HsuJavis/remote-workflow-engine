// IT-028: tools/list serves real descriptions and real JSON inputSchemas for every tool
// (Gate 8 review D-G8-3, quality-dimensions.md finding C-1, HIGH — ARCH-001 consumability).
//
// Bug (review evidence, src/server.ts:147-149):
//   const tools = TOOL_NAMES.map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));
// Every tool's `description` is literally its own name, and every `inputSchema` is an empty
// `{type:'object'}` with no `properties`/`required` — an MCP client cannot learn from the served
// schema what fields any tool takes (e.g. that `workflow_run` takes `name`/`args`, or that
// `workflow_agent_log` needs both `runId` and `agentId`).
//
// v22 adjudication #3 (M-6): two cases below moved with their subject — REQ-098 removed `script`
// (and `scriptSha256`) from `workflow_run`'s advertised schema, so the consumability drift-lock now
// pins their ABSENCE there and pins the DSL authoring contract on `workflow_register.script`, the
// authoring surface that replaced them.
//
// Mock policy (DES-015, integration/acceptance-adjacent tier): real HTTP MCP server, real
// tools/list JSON-RPC round trip — no mock of the SUT's own boundary at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: { type?: string; properties?: Record<string, unknown>; required?: string[] };
}

const REQUIRED_TOOLS = [
  'workflow_run',
  'workflow_status',
  'workflow_result',
  'workflow_suspend',
  'workflow_resume',
  'workflow_stop',
  'workflow_list',
  'workflow_agent_log',
  'workflow_register',
  'workflow_artifacts',
];

describe('MCP tools/list serves real, non-placeholder tool metadata (IT-028, D-G8-3)', () => {
  let server: Server;

  beforeEach(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
  });

  afterEach(async () => {
    await server?.close();
  });

  async function fetchTools(): Promise<ToolDescriptor[]> {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body = (await res.json()) as { result?: { tools: ToolDescriptor[] } };
    return body.result!.tools;
  }

  it('every tool has a non-placeholder description (not just its own name)', async () => {
    const tools = await fetchTools();
    expect(tools.length).toBeGreaterThanOrEqual(REQUIRED_TOOLS.length);
    for (const tool of tools) {
      // Forcing red today: server.ts sets `description: name` for every tool.
      expect(tool.description).not.toBe(tool.name);
      expect(tool.description.length).toBeGreaterThan(tool.name.length);
    }
  });

  // workflow_list, schedule_list, asset_list, and chain_list are genuinely zero-argument tools
  // per DES-001 (`workflow_list(a?: {})`, `list(): Promise<ScheduleStatus[]>`, `asset_list()`,
  // and v8 Slice 4 `chain_list(): Promise<ChainView[]>`) — their correctly-empty `properties: {}`
  // is real, not a placeholder, so they are exempt from the non-empty-properties check below.
  const ZERO_ARG_TOOLS = ['workflow_list', 'schedule_list', 'asset_list', 'chain_list', 'webhook_list'];

  it('every tool has an inputSchema with real (non-empty) properties, or is a genuine zero-arg tool', async () => {
    const tools = await fetchTools();
    for (const tool of tools) {
      expect(tool.inputSchema?.type).toBe('object');
      // Forcing red today: every tool's inputSchema is `{type:'object'}` with no properties at all.
      expect(tool.inputSchema?.properties).toBeDefined();
      if (ZERO_ARG_TOOLS.includes(tool.name)) {
        expect(Object.keys(tool.inputSchema?.properties ?? {}).length).toBe(0);
      } else {
        expect(Object.keys(tool.inputSchema?.properties ?? {}).length).toBeGreaterThan(0);
      }
    }
  });

  it("workflow_run's inputSchema documents its real parameters (name/args) and no longer advertises script", async () => {
    // v22 adjudication #3 (M-6): this case pinned `script` + `args` when inline script was how a run
    // was submitted. REQ-098 closed inline script and removed `script`/`scriptSha256` from the
    // advertised schema precisely so a schema-reading client never learns they exist — so the
    // drift-lock inverts for `script` and follows the parameter that replaced it (`name`). The
    // consumability property is identical: what the tool really takes must be readable from
    // tools/list alone.
    const tools = await fetchTools();
    const workflowRun = tools.find((t) => t.name === 'workflow_run');
    expect(workflowRun).toBeDefined();
    const props = workflowRun!.inputSchema?.properties ?? {};
    expect(props).toHaveProperty('name');
    expect(props).toHaveProperty('args');
    expect(props).not.toHaveProperty('script');
    expect(props).not.toHaveProperty('scriptSha256');
  });

  it("workflow_run's inputSchema declares the seed params as arrays (issue #21 schema-drift lock)", async () => {
    // The handler accepts seed/seedManifest/seedNamespace; if the advertised schema omits them, a
    // schema-validating MCP client stringifies the array and the engine throws
    // `TypeError: spec.seedManifest.map is not a function`. Pin their presence + array types so the
    // schema can't silently drift away from the handler again.
    const tools = await fetchTools();
    const props = (tools.find((t) => t.name === 'workflow_run')!.inputSchema?.properties ?? {}) as Record<string, { type?: string }>;
    expect(props.seed?.type).toBe('array');
    expect(props.seedManifest?.type).toBe('array');
    expect(props.seedNamespace?.type).toBe('string');
  });

  it("workflow_register's script description carries the DSL authoring contract; workflow_run's budget/return-shape stay honest (issue #24)", async () => {
    // A schema-only consumer must be able to author a workflow from the tool schema alone. Pin the
    // load-bearing pieces so the description can't silently drift back to an opaque "Inline JS script".
    // v22 adjudication #3 (M-6): `workflow_register.script` is now the ONLY authoring surface
    // (REQ-098 removed `script` from workflow_run's schema), so the DSL-contract needles are pinned
    // there — same needles, same reason, on the parameter that still exists.
    const tools = await fetchTools();
    const run = tools.find((t) => t.name === 'workflow_run')!;
    const props = run.inputSchema?.properties as Record<string, { description?: string }>;
    const reg = tools.find((t) => t.name === 'workflow_register')!;
    const script = (reg.inputSchema?.properties as Record<string, { description?: string }>).script?.description ?? '';
    // injected globals + agent() option surface + model-string rule + return + optional-meta + example
    for (const needle of ['agent(', 'parallel(', 'pipeline(', 'phase(', 'workflow(', 'effort', 'schema', 'models_list', 'return', 'meta']) {
      expect(script).toContain(needle);
    }
    // meta must be documented as OPTIONAL in this engine (a bare agent() script runs) — never "required".
    expect(script.toLowerCase()).toContain('optional');
    // budget semantics: shared pool, between-call enforcement.
    expect(props.budget?.description ?? '').toMatch(/between agent\(\) calls|shared pool|next agent/i);
    // return-shape honesty: workflow_run returns the envelope, not a bare runId.
    expect(run.description).toContain('runId, status, result');
  });

  it("workflow_agent_log's inputSchema documents both required parameters (runId, agentId)", async () => {
    const tools = await fetchTools();
    const agentLog = tools.find((t) => t.name === 'workflow_agent_log');
    expect(agentLog).toBeDefined();
    const props = agentLog!.inputSchema?.properties ?? {};
    expect(props).toHaveProperty('runId');
    expect(props).toHaveProperty('agentId');
  });
});
