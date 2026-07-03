// IT-014: workflow_artifacts registered on the real MCP JSON-RPC/HTTP surface (server.ts
// TOOL_NAMES + callTool dispatcher), not just the in-process McpFacade (D-R4). IT-010
// (tests/integration/workspace-artifacts.test.ts) already pins the facade-level method directly
// (now green — McpFacade.workflow_artifacts genuinely exists and works); this test pins the
// actual delivery interface a real MCP client uses, mirroring VAL-005/mcp-tools.test.ts's
// HTTP-level pattern (tools/list must advertise it, tools/call must dispatch it).
//
// Red reason (2026-07-03, before Gate 6 rework): src/server.ts's TOOL_NAMES const and callTool()
// switch have no 'workflow_artifacts' case — tools/list omits it, and tools/call for it falls
// through to `default: throw new Error('Unknown tool: workflow_artifacts')`, returned as a
// JSON-RPC error envelope, even though McpFacade.workflow_artifacts itself works correctly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

interface RpcResponse {
  result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }> };
  error?: { code: number; message: string };
}

async function rpc(baseUrl: string, method: string, params: unknown): Promise<RpcResponse> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json() as Promise<RpcResponse>;
}

/** Unwraps a tools/call response into the tool's own JSON result, or surfaces the JSON-RPC-level
 *  error (e.g. "Unknown tool: ...") as `.error` so callers can assert on it either way. */
async function toolCall(baseUrl: string, name: string, args: Record<string, unknown>): Promise<any> {
  const body = await rpc(baseUrl, 'tools/call', { name, arguments: args });
  if (body.error) return { error: body.error };
  return JSON.parse(body.result!.content![0].text);
}

describe('workflow_artifacts over the real MCP HTTP surface (IT-014, D-R4)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => { await server?.close(); });

  it('tools/list advertises workflow_artifacts', async () => {
    const body = await rpc(baseUrl, 'tools/list', {});
    const names = (body.result!.tools ?? []).map((t) => t.name);
    expect(names).toContain('workflow_artifacts');
  });

  it("tools/call workflow_artifacts lists a file written into a completed run's workspace", async () => {
    const run = await toolCall(baseUrl, 'workflow_run', { script: `return 'done';` });
    const runId = run.runId as string;

    let status = await toolCall(baseUrl, 'workflow_status', { runId });
    for (let i = 0; i < 60 && (status.status === 'running' || status.status === 'queued'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = await toolCall(baseUrl, 'workflow_status', { runId });
    }
    expect(status.status).toBe('completed');

    // Simulate an agent's SDK-session tool call writing a file into the run's workspace
    // (parent-side; the sandboxed script itself has no fs access — DES-005), mirroring IT-010's
    // own path (workRoot/workflows/_adhoc/runs/<runId>, per WorkflowCatalog.runWorkspace).
    const workspace = join(server.workRoot, 'workflows', '_adhoc', 'runs', runId);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'output.txt'), 'artifact content');

    const artifacts = await toolCall(baseUrl, 'workflow_artifacts', { runId });

    expect(artifacts.error).toBeUndefined();
    expect(artifacts.result).toContain('output.txt');
  }, 15000);
});
