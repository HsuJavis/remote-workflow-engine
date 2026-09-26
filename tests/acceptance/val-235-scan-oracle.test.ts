// VAL-235 (REQ-208): a real cold-caller registration of a script whose `prompt` string embeds
// "...verifier agent (mode A)..." (the DEPLOY.md role-prompt recipe's exact shape) must register
// clean over real MCP HTTP; a genuinely unlabeled `agent(` must still be refused SCAN_VIOLATION
// with its own real line. Written test-first (Gate 5, RED) — today's registration mis-scans the
// string literal and refuses AGENT_LABEL_REQUIRED. The five other non-code UT cases and the full
// six-case matrix are IT-tier (`register-scan-spans.test.ts`/`workflow-meta-scan.test.ts`, DES-237's
// own `tests:` bullet); this file is the single real MCP HTTP action REQ-208 names.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let baseUrl: string;

async function register(name: string, script: string, mermaid: string): Promise<{ ok: boolean; body: unknown }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow_register', arguments: { name, script, mermaid } } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  const parsed = JSON.parse(body.result!.content[0]!.text) as { result?: { version?: unknown }; error?: unknown };
  return { ok: parsed.result?.version !== undefined, body: parsed };
}

beforeAll(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); baseUrl = `http://127.0.0.1:${server.port}`; });
afterAll(async () => { await server?.close(); });

describe('VAL-235 — a role-prompt string containing "agent (" registers clean over real MCP HTTP (REQ-208)', () => {
  it('the DEPLOY.md role-prompt recipe shape registers clean (real workflow_register)', async () => {
    // The `meta` block declares the `verifier` agent (DES-144, AGENT_UNDECLARED) so the ONLY way
    // this case can fail is the SCAN_VIOLATION this test targets — a bare script with no meta at
    // all legitimately hits AGENT_UNDECLARED first (scanAgentCalls runs before parseParamContract,
    // workflow-catalog.ts:464), which is a different, pre-existing (v24) rule, not this scanner.
    const script =
      "export const meta = { params: { agents: { verifier: {\n" +
      "  model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' },\n" +
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },\n" +
      "  timeoutMs: { type: 'number', default: 120000 },\n" +
      "} } } };\n" +
      "phase('main');\nawait agent('verifier', { prompt: \"...sdlc-verifier agent (mode A)...\" });";
    const { ok, body } = await register('val235-role-prompt', script, 'graph LR\nsubgraph "main"\nverifier(["verifier"])\nend');
    expect(ok, `expected a version, got ${JSON.stringify(body)}`).toBe(true);
  });

  it('a genuinely unlabeled agent( is still refused SCAN_VIOLATION with its own real line', async () => {
    const script = "const a = \"agent (fake, not a call)\";\nphase('main');\nagent(\"only-one-arg\");";
    const { ok, body } = await register('val235-genuine-violation', script, 'graph LR\nsubgraph "main"\na(["only-one-arg"])\nend');
    expect(ok).toBe(false);
    expect(JSON.stringify(body)).toContain('SCAN_VIOLATION');
    expect((body as { error?: { detail?: { line?: number } } }).error?.detail?.line).toBe(3);
  });
});
