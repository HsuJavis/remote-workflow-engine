// IT-127 (v24 Gate 7.5 defect D-10, REQ-113): `workflow_deregister` must take the workflow's
// on-disk asset tree with it, not only its `assets` rows.
//
// The defect this pins, reproduced live in 08-validation.md: deregister deleted the rows inside the
// catalog transaction and left `<assetRoot>/<name>/` untouched, so ANOTHER principal could
// re-register the same name, DECLARE a skill it had never pushed (`workspace_list` shows `[]` for
// it), and get the previous owner's `SKILL.md` materialized into its own agent workspace,
// byte-identical. The ownership model held in the database and not on the filesystem.
//
// Mock policy (DES-015, integration tier): real `composeConfig()` + real `createServer()` with auth
// ENABLED and real `TokenStore` bearers, real MCP HTTP round trips, real on-disk inspection; only
// the third-party SDK `query()` export and the managed LiteLLM proxy subprocess are faked (the same
// two seams IT-036 uses) — no real network/process I/O and no model.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { composeConfig } from '../../src/main.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import { TokenStore } from '../../src/auth/token-store.js';
import type { AliasMap } from '../../src/gateway/client.js';

const ALIASES: AliasMap = {
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
};
const OWNER = 'owner@it127.example';
const OTHER = 'other@it127.example';
const WF = 'it127-wf';
const SKILL = 'declared-skill';
const SKILL_MD = '# Owner-only skill\n\nThe previous owner\'s private instructions.\n';

function makeFakeProxyManager(): LiteLLMProxyManager {
  const fakeSpawn = vi.fn(() => (Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn() })) as unknown as ChildProcess);
  const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
  return new LiteLLMProxyManager(ALIASES, {
    spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
    fetchImpl: fakeHealthFetch as unknown as typeof fetch,
  });
}

function fakeSuccessSession() {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

const AGENT_BLOCK = (skills: string[]) =>
  `{ model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 }, skills: ${JSON.stringify(skills)} }`;

const SCRIPT = (skills: string[]) =>
  `export const meta = { params: { agents: { worker: ${AGENT_BLOCK(skills)} } } };\n` +
  `return await agent('worker', { prompt: 'go' });`;
const MERMAID = 'graph TD;\nworker(["worker"])';

describe('deregister removes the workflow\'s asset tree from disk, not only its rows (IT-127, D-10, REQ-113)', () => {
  let server: Server;
  let workRoot: string;
  let baseUrl: string;
  let ownerToken: string;
  let otherToken: string;

  function mintBearer(email: string): string {
    const db = new Database(join(workRoot, 'auth-tokens.db'));
    try {
      return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) })
        .issue(email, 7 * 24 * 3600_000).token;
    } finally {
      db.close();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function mcpCall(name: string, args: Record<string, unknown>, bearer: string): Promise<any> {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  }

  async function registerRunAndWait(skills: string[], bearer: string): Promise<string> {
    const reg = await mcpCall('workflow_register', { name: WF, script: SCRIPT(skills), mermaid: MERMAID }, bearer);
    expect(reg.error, `register: ${JSON.stringify(reg.error)}`).toBeUndefined();
    const pub = await mcpCall('workflow_publish', { name: WF, version: reg.result.version as string, channel: 'release' }, bearer);
    expect(pub.error, `publish: ${JSON.stringify(pub.error)}`).toBeUndefined();
    const run = await mcpCall('run_start', { name: WF }, bearer);
    expect(run.error, `run_start: ${JSON.stringify(run.error)}`).toBeUndefined();
    const runId = run.runId as string;
    for (let i = 0; i < 100; i++) {
      const status = await mcpCall('run_status', { runId }, bearer);
      if (status.status === 'completed' || status.status === 'failed') return runId;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('run never reached a terminal state');
  }

  const assetTree = () => join(workRoot, 'assets', WF);
  const workspaceOf = (runId: string) => join(workRoot, 'workflows', WF, 'runs', runId);

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it127-'));
    const config = await composeConfig(
      {
        bind: '127.0.0.1', port: 0, workRoot, aliases: ALIASES, gateway: 'sdk', assetRoot: join(workRoot, 'assets'),
        auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it127-cid', googleClientSecret: 'it127-cs' },
        principals: { [OWNER]: { role: 'author' }, [OTHER]: { role: 'author' } },
      } as never,
      { queryImpl: vi.fn(() => fakeSuccessSession()) as unknown as never, proxyManager: makeFakeProxyManager() },
    );
    server = await createServer(config);
    baseUrl = `http://127.0.0.1:${server.port}`;
    ownerToken = mintBearer(OWNER);
    otherToken = mintBearer(OTHER);
  });

  afterAll(async () => {
    await server?.close();
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('the previous owner\'s skill is neither on disk nor materialized for the next registrant of the same name', async () => {
    // 1. The owner pushes a skill, registers, publishes and runs — the skill really materializes.
    const push = await mcpCall(
      'workspace_push',
      { workflow: WF, kind: 'skill', name: SKILL, files: [{ path: 'SKILL.md', contentB64: Buffer.from(SKILL_MD).toString('base64') }] },
      ownerToken,
    );
    expect(push.error, `push: ${JSON.stringify(push.error)}`).toBeUndefined();
    const ownerRun = await registerRunAndWait([SKILL], ownerToken);
    expect(readFileSync(join(workspaceOf(ownerRun), '.claude', 'skills', SKILL, 'SKILL.md'), 'utf-8')).toBe(SKILL_MD);
    expect(existsSync(join(assetTree(), 'skill', SKILL, 'SKILL.md'))).toBe(true);

    // 2. The owner deregisters the name.
    const dereg = await mcpCall('workflow_deregister', { name: WF }, ownerToken);
    expect(dereg.error, `deregister: ${JSON.stringify(dereg.error)}`).toBeUndefined();

    // THE pin, half one: the tree is gone from disk, not just from the `assets` rows.
    expect(existsSync(assetTree()), 'deregister left the workflow asset tree on disk').toBe(false);

    // 3. A DIFFERENT principal takes the freed name and declares a skill it never pushed.
    const list = await mcpCall('workspace_list', { workflow: WF, kind: 'skill' }, otherToken);
    expect((list.result ?? []) as unknown[]).toHaveLength(0);
    const otherRun = await registerRunAndWait([SKILL], otherToken);

    // THE pin, half two: nothing of the previous owner's reaches the new principal's workspace.
    expect(existsSync(join(workspaceOf(otherRun), '.claude', 'skills', SKILL)), "the previous owner's skill was materialized for another principal").toBe(false);
    const log = await mcpCall('run_agent_log', { runId: otherRun, label: 'worker' }, otherToken);
    expect(log.harness?.materialized?.missing ?? []).toContain(SKILL);
    expect(log.harness?.materialized?.skills ?? []).not.toContain(SKILL);
  }, 40000);
});
