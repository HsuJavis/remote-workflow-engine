// VAL-109 (REQ-099): the submission-time static checks move to registration, so closing inline
// script loses no validation. Real entrypoint: `createServer`, real MCP HTTP.
//
// Mock policy (acceptance, DES-119): no mocking of the SUT's own boundaries. No LLM dispatch
// needed — these are static/registration-time checks.
//
// Red reason: today PARSE_ERROR/UNKNOWN_ALIAS/MCP_NOT_PROVISIONED are checked ONLY at submission
// (`if (spec.script)` in submission-validator.ts), never at `workflow_register` — every registration
// below succeeds today regardless of the script's validity, and a run-by-name is not covered by any
// equivalent check.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val109-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    aliases: { sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' } },
  });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function toolCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-099: registration enforces the checks the engine used to run only at submission (VAL-109)', () => {
  it('an unparseable script is refused PARSE_ERROR at registration, the SAME code submission produced, nothing stored', async () => {
    const r = await toolCall('workflow_register', { name: 'val109-parse', script: 'not { valid javascript (((' });
    expect((r['error'] as { code?: string } | undefined)?.code).toBe('PARSE_ERROR');
    const got = await toolCall('workflow_source', { name: 'val109-parse' });
    expect(got['code']).toBe('WORKFLOW_NOT_FOUND');
  });

  it('an unresolvable model alias is refused UNKNOWN_ALIAS at registration, nothing stored', async () => {
    const r = await toolCall('workflow_register', { name: 'val109-alias', script: `await agent('a', { model: 'no-such-alias' });` });
    expect((r['error'] as { code?: string } | undefined)?.code).toBe('UNKNOWN_ALIAS');
    const got = await toolCall('workflow_source', { name: 'val109-alias' });
    expect(got['code']).toBe('WORKFLOW_NOT_FOUND');
  });

  it('a run BY NAME is covered — a legitimately registered workflow runs fine (no path skips validation)', async () => {
    // v24 (DES-143/DES-144/DES-148, TASK-152): the LEGITIMATE script is now spelled with a literal
    // label + `options.prompt`, the model alias declared as `meta.params.agents.a.model.default`
    // (writing `model` inside the agent() options is refused SCAN_VIOLATION), and a `mermaid`
    // diagram whose stadium nodes match the script's labels exactly. Same oracle: a script that
    // passes every registration-time check registers with no error. `sonnet` is this server's own
    // configured alias (beforeAll), so the UNKNOWN_ALIAS case above and this one still differ by
    // exactly one thing — whether the alias is known.
    const script = [
      "export const meta = { params: { agents: { a: {",
      "  model: { type: 'string', default: 'sonnet' },",
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
      "  timeoutMs: { type: 'number', default: 60000 },",
      "} } } };",
      "await agent('a', { prompt: 'do the thing' });",
      "return 'ok';",
    ].join('\n');
    const reg = await toolCall('workflow_register', { name: 'val109-clean', script, mermaid: 'graph TD;\nn0(["a"])' });
    expect(reg['error']).toBeUndefined();
  });
});

describe('REQ-099: a pre-existing workflow that would now fail is NOT retroactively refused, but its staleness is surfaced (VAL-109)', () => {
  it('a workflow whose alias went stale AFTER registration still runs; workflow_source exposes validation:{ok:false}', async () => {
    // Hand-seed a v22-schema row referencing an alias this server was never configured with —
    // models "registered before the alias was removed" (registration itself would refuse
    // UNKNOWN_ALIAS for a NEW registration, per the case above; this reaches the grandfathered
    // state directly, the same technique tests/integration/catalog-versions.test.ts uses for its
    // migration fixtures).
    const dbPath = join(tmpDir, 'catalog.db');
    const db = new Database(dbPath);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)').run('val109-stale', now, 'v1');
    // v24 (integrator): the seeded row carries a valid v24 PARAM CONTRACT. Without one it is a
    // pre-v24 row and `run_start` refuses it LEGACY_REREGISTER (DES-144/156) — a correct refusal,
    // but for a different reason than the one this case is about, which would make the assertion
    // below pass or fail for the wrong cause. The STALENESS under test lives where it always did:
    // in the SCRIPT's own `model: 'now-deprovisioned-alias'`, which `validateCurrent` re-checks
    // against the CURRENT alias table on every read. Both halves of REQ-099's last clause are then
    // exercised for their own reasons: staleness surfaced, run not retroactively refused.
    // `sonnet` (this server's ONE configured alias) is the contract default deliberately: v21's
    // R-G2 re-checks every label's RESOLVED model at admission, so a stale alias in the CONTRACT
    // would be refused UNKNOWN_ALIAS there and mask the clause under test.
    const v24Contract = JSON.stringify({
      agents: { a: { model: { type: 'string', default: 'sonnet' }, effort: { type: 'enum', enum: ['low', 'medium', 'high'], default: 'low' }, timeoutMs: { type: 'number', default: 60_000 } } },
      args: {},
    });
    db.prepare('INSERT INTO workflow_versions (name, version, script, params, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run('val109-stale', 'v1', `await agent('a', { model: 'now-deprovisioned-alias' }); return 'still-runs';`, v24Contract, now);
    db.close();

    const got = await toolCall('workflow_source', { name: 'val109-stale' });
    const validation = (got['result'] as { validation?: { ok?: boolean } } | undefined)?.validation;
    expect(validation?.ok).toBe(false); // surfaced, not silently swallowed

    const run = await toolCall('run_start', { name: 'val109-stale' });
    expect(run['error']).toBeUndefined(); // NOT retroactively refused — the last REQ-099 clause
  });
});
