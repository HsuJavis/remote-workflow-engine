// VAL-112 (REQ-101, DES-125/126, ARCH-081/082): over the real `/mcp` transport with a real bearer,
// `workflow_describe({name})` as a NON-OWNER returns purpose, resolved `(name, version)` +
// `resolvedBy`, `params`, `lockedKeys`, `versions`, `channels`, `owner`, `reportProblem`, `triggers`,
// `phases`, the `mermaid`/`mermaidNote` pair and `runnable`/`runnableReason` (v24 replaced the
// retired `diagram*` keys — see the in-test note) — and `JSON.stringify` of the response does not contain the registered script's
// secret literal. An unpublished `channel:'beta'` returns `CHANNEL_UNPUBLISHED`.
//
// Mock policy (acceptance, DES-119): real `createServer`, real `/mcp`, real `TokenStore`-minted
// bearer. Diagram-CONTENT assertions (an actually-generated ASCII diagram) are out of THIS file's
// scope — REQ-102/VAL-113 own the analyzer's real-provider path; this file proves the SHAPE and mask
// of the describe surface itself, which needs no live LLM call.
//
// Red reason: `workflow_describe` does not exist as an MCP tool today -> `tools/call` returns a
// JSON-RPC error (`Unknown tool: workflow_describe`, `server.ts`'s `callTool` default case) -> every
// assertion below fails for the genuine unimplemented reason.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let workRoot: string;

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val112-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'c', googleClientSecret: 's', googleBase: 'http://127.0.0.1:0', jwksFetch: async () => [] },
    // v24 (REQ-109 roles, ADR-028): the two owners register+publish (`{minRole:'author'}`). The
    // STRANGER is listed as `author` too, deliberately: `workflow_describe` itself is only
    // `{minRole:'user'}`, so a plain user would pass — but then the case would prove the describe
    // mask against a caller who could not have read the script by ANY route, which is a weaker
    // statement than REQ-101's ("a non-owner AUTHOR sees everything except the script").
    principals: {
      'val112-owner@example.com': { role: 'author' },
      'val112-owner2@example.com': { role: 'author' },
      'val112-stranger@example.com': { role: 'author' },
    },
  } as never);
});
afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

async function mintBearer(email: string): Promise<string> {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  const now = Date.now();
  const store = new TokenStore(db, { clock: () => now, csprng: (n: number) => randomBytes(n) });
  const { token } = store.issue(email, 7 * 24 * 3600_000);
  db.close();
  return token;
}

/** Returns the UNWRAPPED tool payload (`body.result.content[0].text`, JSON-parsed) — NOT the
 *  JSON-RPC envelope. The two payload shapes differ and both are declared here, because an
 *  annotation that omits one is what sent VAL-112's channel case reading `.result.code` on a
 *  response that has no `result` key at all:
 *    success -> { runId, status: 'completed', result: {...} }
 *    failure -> { runId, status: 'failed', code, error: { code, message } }   // no `result` */
async function rpc(name: string, args: Record<string, unknown>, bearer?: string): Promise<{ result?: Record<string, unknown>; code?: string; error?: { code?: string; message?: string } }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
  if (body.error) return { error: { message: body.error.message } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

const SECRET = 'val112-secret-9F2A';

describe('REQ-101: workflow_describe over real /mcp (VAL-112)', () => {
  it('a non-owner sees the full describe field set and never the raw secret literal', async () => {
    const ownerToken = await mintBearer('val112-owner@example.com');
    await registerPublishedVia((n, a) => rpc(n, a, ownerToken).then((r) => r as unknown as Record<string, unknown>), 'val112-flow', `return "${SECRET}";`);

    const otherToken = await mintBearer('val112-stranger@example.com');
    const resp = await rpc('workflow_describe', { name: 'val112-flow' }, otherToken);
    expect(resp.error).toBeUndefined();
    const r = resp.result as Record<string, unknown>;
    // v24 MIGRATION (DES-156/TASK-149, 04-design.md:5055 — "EXPECTED_DESCRIBE_KEYS re-pinned, the
    // four `diagram*` keys DELETED, not left optional"): the analyzer that DREW a diagram is retired
    // (TASK-139), so `diagram`/`diagramStatus`/`diagramNote` are replaced by the author's own stored
    // `mermaid` + `mermaidNote`, and `phases`/`runnable`/`runnableReason` joined the contract. Same
    // oracle — "a non-owner sees the FULL describe field set" — spelled in the v24 contract, and
    // strictly wider than before (16 keys, not 14). Deliberately a LITERAL list, not an import of
    // `EXPECTED_DESCRIBE_KEYS`: an expectation read back off the module under test cannot fail when
    // that module drops a key.
    for (const key of ['name', 'version', 'resolvedBy', 'channels', 'versions', 'description', 'phases',
      'params', 'lockedKeys', 'owner', 'reportProblem', 'triggers',
      'mermaid', 'mermaidNote', 'runnable', 'runnableReason']) {
      expect(key in r).toBe(true);
    }
    expect('script' in r).toBe(false);
    expect(JSON.stringify(resp)).not.toContain(SECRET);
  });

  it('an unpublished beta channel returns CHANNEL_UNPUBLISHED, not a silent fallback', async () => {
    const ownerToken = await mintBearer('val112-owner2@example.com');
    await registerPublishedVia((n, a) => rpc(n, a, ownerToken).then((r) => r as unknown as Record<string, unknown>), 'val112-draft', `return 1;`);

    const resp = await rpc('workflow_describe', { name: 'val112-draft', channel: 'beta' }, ownerToken);
    // The failure payload carries no `result` key — read `code` where the facade actually puts it.
    // The EXPECTED value below is REQ-097/REQ-101's acceptance text ("an unpublished channel is
    // refused with CHANNEL_UNPUBLISHED, never silently resolved"), not something read back off the
    // implementation; only the PATH was wrong here, never the expectation.
    expect(resp.result).toBeUndefined();
    expect(resp.code).toBe('CHANNEL_UNPUBLISHED');
    expect(resp.error?.code).toBe('CHANNEL_UNPUBLISHED');
  });
});
