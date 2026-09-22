// VAL-253: REQ-218 — an agent's Bash cannot write outside the run workspace, or the path is a
// declared operator grant. Real entrypoint: a real server + ClaudeAgentSdkGatewayClient + a real
// local Ollama model + a real spawned `claude` CLI under the OS sandbox (same convention as
// VAL-019/VAL-023 — it.skipIf gated on the provider/host being present so a bare `npm test` stays
// fast/hermetic; Gate 7.5 sets it up for real on the TASK-250 spike host).
// Value import of the pure builder guarantees this file is RED at collection regardless of gating
// (module-not-found) — same technique as VAL-019/VAL-023's own import-time RED guard.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { buildBashConfinement } from '../../src/gateway/bash-confinement.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

const HAS_PROVIDER = !!process.env['OLLAMA_BASE_URL'];
function hasBubblewrap(): boolean {
  try {
    execSync('which bwrap', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAS_SANDBOX_RUNTIME = HAS_PROVIDER && hasBubblewrap();
const NO_RUNTIME = " [UNVERIFIED here: needs OLLAMA_BASE_URL + a real bubblewrap-capable host — see TASK-250's spike]";

const QWEN_ALIAS = { 'local-qwen': { provider: 'ollama' as const, model: 'qwen2.5:7b' } };

let server: Server;
let workRoot: string;

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val253-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot,
    aliases: QWEN_ALIAS,
    gateway: new ClaudeAgentSdkGatewayClient({
      baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:4000',
      aliases: QWEN_ALIAS,
      timeoutMs: 60000,
      confinement: { allowHostPaths: [], protectedFiles: [join(workRoot, 'auth-tokens.db')], workRoot },
    } as any),
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(workRoot, { recursive: true, force: true });
});

const mcpCall = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> }; error?: { code: number; message: string } };
  if (body.error) return { error: body.error };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
};

describe("VAL-253: REQ-218 — an agent's Bash cannot write outside the run workspace, or the path is a declared grant", () => {
  it.skipIf(!HAS_SANDBOX_RUNTIME)(
    "a real spawned agent's Bash write to an UNDECLARED $HOME path does not land on disk" + NO_RUNTIME,
    async () => {
      const probe = join(process.env['HOME'] ?? '/root', `rwe-val253-leak-${Date.now()}.txt`);
      const run = await runScriptVia(
        mcpCall,
        [
          "export const meta = { params: { agents: { escape: {",
          "  model: { type: 'string', default: 'local-qwen' },",
          "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
          "  timeoutMs: { type: 'number', default: 60000 },",
          '} } } };',
          `const r = await agent('escape', { prompt: 'run this exact shell command via a tool call: echo leak > ${probe}', allowedTools: ['Bash'] });`,
          "return 'done';",
        ].join('\n'),
      );
      const runId = run['runId'] as string;
      let finalStatus: string | undefined;
      for (let i = 0; i < 90; i++) {
        const s = await mcpCall('run_status', { runId });
        finalStatus = s['status'] as string;
        if (finalStatus === 'completed' || finalStatus === 'failed') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      expect(existsSync(probe)).toBe(false);
    },
    120000,
  );

  it("a granted host path appears verbatim in the posture handed to the kernel (REQ-218 clause 2b — the declared-grant proof)", () => {
    const grant = mkdtempSync(join(tmpdir(), 'rwe-val253-grant-'));
    const posture = buildBashConfinement({
      root: join(workRoot, 'workflows', 'wf', 'runs', 'run-1'),
      grantedHostPaths: [grant],
      protectedFiles: [],
      workRoot,
      denyReadMode: 'enumerated',
    });
    expect(posture.filesystem?.allowWrite).toContain(grant);
    rmSync(grant, { recursive: true, force: true });
  });
});
