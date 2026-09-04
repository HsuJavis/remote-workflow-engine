// IT-166 (v24 Gate 7.5 defect D-11, REQ-109 / REQ-114 / ADR-030): the admin-only gate on a stdio
// MCP config, asserted as an OUTCOME through a real auth-enabled boot.
//
// The defect this pins: `pushMode()` classified a stdio config by `config.transport === 'stdio'`
// while `classifyTransport()` and the materializer read `config.type` — so an author's
// `{type:'stdio', command:'npx', …}` fell through to the `asset` row (`minRole:'author'`), the
// admin-only row never ran, and the engine really spawned the author-supplied command on the host
// (observed live, 08-validation.md D-11). A unit test on `pushMode`'s return value is exactly what
// let it through, which is why this test asserts what the CALLER sees (`FORBIDDEN_ROLE`) and what
// the HOST does (the probe is never invoked) rather than the classifier's answer.
//
// Mock policy: integration tier — real `createServer()` over real HTTP, real SQLite catalog/asset
// store, real `TokenStore` bearers, real `authorize()`. The ONLY seam is the injected `McpProbe`
// (the one process/network dependency, DES-020) — replaced by a recording double so "did the
// engine spawn the author's command" is observable without spawning anything.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import type { McpProbe, McpProbeResult, McpServerConfig } from '../../src/mcp-probe.js';

const AUTHOR = 'author@it166.example';
const ADMIN = 'admin@it166.example';
const WF = 'it166-wf';
const STDIO_CONFIG = { type: 'stdio', command: 'npx', args: ['--version'] };

/** Records every config it is asked to probe — "the probe really ran" is the host-side effect the
 *  admin-only gate exists to prevent, so it must be observable, not inferred. */
class RecordingProbe implements McpProbe {
  readonly seen: McpServerConfig[] = [];
  async probe(cfg: McpServerConfig): Promise<McpProbeResult> {
    this.seen.push(cfg);
    return { ok: true };
  }
}

let server: Server;
let tmpDir: string;
let probe: RecordingProbe;
let authorToken: string;
let adminToken: string;

function mintBearer(workRoot: string, email: string): string {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  try {
    return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) })
      .issue(email, 7 * 24 * 3600_000).token;
  } finally {
    db.close();
  }
}

async function callTool(name: string, args: Record<string, unknown>, bearer: string) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}
const codeOf = (r: Record<string, unknown>) => (r['code'] ?? (r['error'] as { code?: string } | undefined)?.code) as string | undefined;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it166-'));
  probe = new RecordingProbe();
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it166-cid', googleClientSecret: 'it166-cs' },
    principals: { [AUTHOR]: { role: 'author' }, [ADMIN]: { role: 'admin' } },
    mcpProbe: probe,
  } as never);
  authorToken = mintBearer(tmpDir, AUTHOR);
  adminToken = mintBearer(tmpDir, ADMIN);
  const reg = await callTool('workflow_register', { name: WF, script: 'return "hello";', mermaid: 'graph TD;' }, authorToken);
  expect(reg['error']).toBeUndefined();
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('a stdio MCP config is admin-only, whichever key the config spells its transport with (IT-166, D-11)', () => {
  it('an AUTHOR pushing a stdio config is REFUSED and the engine never probes it — even though the author owns the workflow', async () => {
    const res = await callTool(
      'workspace_push',
      { workflow: WF, kind: 'mcp', name: 'it166-stdio', config: STDIO_CONFIG },
      authorToken,
    );
    expect(codeOf(res)).toBe('FORBIDDEN_ROLE');
    expect(probe.seen).toHaveLength(0); // the host never spawned the author-supplied command
    // …and nothing was stored: the workflow's own owner listing shows no such asset.
    const list = await callTool('workspace_list', { workflow: WF, kind: 'mcp' }, authorToken);
    const rows = ((list['result'] ?? []) as Array<{ name?: string }>);
    expect(rows.some((r) => r.name === 'it166-stdio')).toBe(false);
  });

  it('the ADMIN pushing the SAME config is accepted and reaches the probe — the gate refuses the role, not the shape', async () => {
    const res = await callTool(
      'workspace_push',
      { workflow: WF, kind: 'mcp', name: 'it166-stdio', config: STDIO_CONFIG },
      adminToken,
    );
    expect(codeOf(res)).toBeUndefined();
    expect((res['result'] as { stored?: string } | undefined)?.stored).toBe('it166-stdio');
    expect(probe.seen).toEqual([STDIO_CONFIG]);
  });
});
