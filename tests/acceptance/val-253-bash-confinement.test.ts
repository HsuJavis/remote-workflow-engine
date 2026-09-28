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
import { runScriptVia, registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

const HAS_PROVIDER = !!process.env['OLLAMA_BASE_URL'];
function hasBubblewrap(): boolean {
  try {
    execSync('which bwrap', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
function hasSocat(): boolean {
  try {
    execSync('which socat', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAS_SANDBOX_RUNTIME = HAS_PROVIDER && hasBubblewrap();
const NO_RUNTIME = " [UNVERIFIED here: needs OLLAMA_BASE_URL + a real bubblewrap-capable host — see TASK-250's spike]";

// Issue #95: `bash:'readonly'` needs a real kernel sandbox (bwrap + socat, #93) AND a real
// Anthropic credential — a cheap haiku call, not Ollama (bash:'readonly' registration requires a
// literal `allowedTools`, and the mermaid tools-annotation this drives is easiest to keep correct
// against the SAME model the rest of this repo's fixtures default to).
const HAS_ANTHROPIC_CRED = !!(process.env['ANTHROPIC_API_KEY'] || process.env['RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN'] || process.env['CLAUDE_CODE_OAUTH_TOKEN']);
const HAS_READONLY_RUNTIME = hasBubblewrap() && hasSocat() && HAS_ANTHROPIC_CRED;
const NO_READONLY_RUNTIME = ' [UNVERIFIED here: needs bwrap + socat + an Anthropic credential (ANTHROPIC_API_KEY or a CLAUDE_CODE_OAUTH_TOKEN) on the real host]';

// 2026-09-26 (alias mechanism removed): the full ref itself — no alias table any more.
const QWEN_REF = 'ollama/qwen2.5:7b';

let server: Server;
let workRoot: string;

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val253-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot,
    gateway: new ClaudeAgentSdkGatewayClient({
      baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:4000',
      timeoutMs: 60000,
      // v37 Gate-6 amendment (2026-09-22, implementer; ADR-083 owner_decision posture C):
      // `confinementPosture` defaults to 'unconfined' (found by running the real suite — see
      // bash-confinement-wiring.test.ts's own note) — set explicitly here so this real-tier test,
      // when it DOES run on a sandbox-capable host, still exercises the confined arm it is written
      // to prove (a write outside the workspace must not land on disk).
      confinementPosture: 'confined',
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
          `  model: { type: 'string', default: '${QWEN_REF}' },`,
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

  // Issue #95: `bash:'readonly'` real-tier proof. Before this fix, EVERY Bash call in readonly mode
  // failed at sandbox setup ("bwrap: Can't create file at <workspace>/.claude/agents: Read-only
  // file system") before the shell ever started — a refusal-only test would have passed against
  // that broken state too (both `cat` and `touch` failed identically), so this asserts the
  // POSITIVE: a seeded file is actually readable, in the SAME tool call whose write is refused.
  it.skipIf(!HAS_READONLY_RUNTIME)(
    "a real readonly-Bash agent can read a seeded file, cannot write inside the workspace, and never surfaces bwrap's own error text" + NO_READONLY_RUNTIME,
    async () => {
      const name = uniqueWorkflowName('val253-ro');
      const mermaid = ['graph LR', 'subgraph "main"', 'n0(["ro<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: Bash"])', 'end'].join('\n');
      const script = [
        "export const meta = { params: { agents: { ro: {",
        "  model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' },",
        "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
        "  timeoutMs: { type: 'number', default: 60000 },",
        '} } } };',
        "const r = await agent('ro', { prompt: 'run this exact shell command via a tool call: cat note.txt; touch ro-probe.txt; echo touch_exit=$?', allowedTools: ['Bash'], bash: 'readonly' });",
        'return String(r);',
      ].join('\n');
      await registerPublishedVia(mcpCall, name, script, { mermaid });
      const run = await mcpCall('run_start', {
        name,
        seed: [{ path: 'note.txt', contentB64: Buffer.from('hello from inline seed').toString('base64') }],
      });
      const runId = run['runId'] as string;
      let finalStatus: string | undefined;
      for (let i = 0; i < 90; i++) {
        const s = await mcpCall('run_status', { runId });
        finalStatus = s['status'] as string;
        if (finalStatus === 'completed' || finalStatus === 'failed') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      expect(finalStatus).toBe('completed');
      const log = await mcpCall('run_agent_log', { runId, label: 'ro' });
      const events = (log['events'] ?? (log['result'] as { events?: unknown[] } | undefined)?.events ?? []) as Array<{ kind: string; data: { content?: string } }>;
      const toolResults = events.filter((e) => e.kind === 'tool_result').map((e) => e.data.content ?? '');
      const allText = toolResults.join('\n');
      expect(allText).toContain('hello from inline seed');
      expect(allText).toMatch(/read-only file system/i);
      expect(allText).not.toMatch(/bwrap: can't create file/i);
      expect(existsSync(join(workRoot, 'workflows', name, 'runs', runId, 'ro-probe.txt'))).toBe(false);
      const harness = (log['harness'] ?? {}) as { bash?: { mode?: string; enforced?: boolean } };
      expect(harness.bash).toEqual({ mode: 'readonly', enforced: true });
    },
    120000,
  );
});
