// IT-028: tools/list serves real descriptions and real JSON inputSchemas for every tool
// (Gate 8 review D-G8-3, quality-dimensions.md finding C-1, HIGH — ARCH-001 consumability).
//
// Bug (review evidence, src/server.ts:147-149):
//   const tools = TOOL_NAMES.map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));
// Every tool's `description` is literally its own name, and every `inputSchema` is an empty
// `{type:'object'}` with no `properties`/`required` — an MCP client cannot learn from the served
// schema what fields any tool takes (e.g. that `workflow_run` takes `script`/`args`, or that
// `workflow_agent_log` needs both `runId` and `agentId`).
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

  it("workflow_run's inputSchema documents its real parameters (script/args), not an opaque object", async () => {
    const tools = await fetchTools();
    const workflowRun = tools.find((t) => t.name === 'workflow_run');
    expect(workflowRun).toBeDefined();
    const props = workflowRun!.inputSchema?.properties ?? {};
    expect(props).toHaveProperty('script');
    expect(props).toHaveProperty('args');
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

  it("workflow_agent_log's inputSchema documents both required parameters (runId, agentId)", async () => {
    const tools = await fetchTools();
    const agentLog = tools.find((t) => t.name === 'workflow_agent_log');
    expect(agentLog).toBeDefined();
    const props = agentLog!.inputSchema?.properties ?? {};
    expect(props).toHaveProperty('runId');
    expect(props).toHaveProperty('agentId');
  });
});
