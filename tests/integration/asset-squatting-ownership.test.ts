// Issue #102 (high, asset squatting): workspace_push({workflow: X, kind:'skill'|'mcp', ...}) for a
// workflow name X that is NOT registered used to store the asset with no ownership check at all —
// when anyone later registered X, they silently INHERITED it (prompt injection via SKILL.md).
// Pushing to an EXISTING workflow owned by someone else was already correctly refused
// NOT_WORKFLOW_OWNER; the gap was the workflow not existing yet.
//
// Owner decision: workflow-scoped asset push/delete requires the workflow to EXIST and the caller
// to be its owner (or admin); otherwise WORKFLOW_NOT_FOUND (message must not reveal owner).
// The supported order is workflow_register FIRST, then workspace_push its assets.
//
// Root cause (confirmed by reading src/authz.ts): `authorize()`'s ownership check answers
// `ok:true` when `OwnerLookup.workflowOwner(name)` returns `undefined` ("does not exist") — by
// design (DES-139's tri-state: authz never leaks existence, the HANDLER answers `*_NOT_FOUND`
// downstream). `workspaceList` already implements that downstream check (`catalog.exists`);
// `workspacePush`/`workspaceDelete` (mcp-facade.ts) did not — this file pins that they now do.
//
// Mock policy (integration, DES-119): real `createServer()` over real HTTP, real SQLite catalog +
// asset store, real `TokenStore` bearers (IT-080/IT-124's own pattern) — two genuinely different
// authenticated principals, never a self-asserted `args.principal`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

const ALICE = 'alice@it102.example';
const BOB = 'bob@it102.example';
const ROOT = 'root@it102.example';

let server: Server;
let tmpDir: string;
let aliceToken: string;
let bobToken: string;
let rootToken: string;

function mintBearer(email: string): string {
  const db = new Database(join(tmpDir, 'auth-tokens.db'));
  try {
    return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) })
      .issue(email, 7 * 24 * 3600_000).token;
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it102-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1', // NOT D-BIND-exempt — resolvePrincipal really runs (IT-080/IT-124's pattern)
    workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it102-cid', googleClientSecret: 'it102-cs' },
    principals: { [ALICE]: { role: 'author' }, [BOB]: { role: 'author' }, [ROOT]: { role: 'admin' } },
  } as never);
  aliceToken = mintBearer(ALICE);
  bobToken = mintBearer(BOB);
  rootToken = mintBearer(ROOT);
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(name: string, args: Record<string, unknown>, bearer: string): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}
const codeOf = (r: Record<string, unknown>) => (r['code'] ?? (r['error'] as { code?: string } | undefined)?.code) as string | undefined;

function skillPush(workflow: string, name: string, body: string) {
  return { workflow, kind: 'skill', name, files: [{ path: 'SKILL.md', contentB64: Buffer.from(body).toString('base64') }] };
}

describe('workspace_push/workspace_delete refuse an UNREGISTERED workflow name (issue #102, asset squatting)', () => {
  it('a non-owner (indeed, anyone) pushing a skill to an unregistered name is refused WORKFLOW_NOT_FOUND, and nothing is stored', async () => {
    const wf = 'it102-unclaimed-1';
    const push = await callTool('workspace_push', skillPush(wf, 'codeword', '# SQUATTED-BY-BOB\n'), bobToken);
    expect(codeOf(push)).toBe('WORKFLOW_NOT_FOUND');
    expect(push['result']).toBeUndefined();
    // The refusal message must not exist to name an owner (there is none) — asserted directly for
    // the "must not reveal owner" clause: no owner identity substring in the refusal text.
    const message = (push['error'] as { message?: string } | undefined)?.message ?? '';
    expect(message).not.toContain(ALICE);
    expect(message).not.toContain(BOB);

    // ...and nothing landed on disk at all — not even an orphaned tree under the freed name.
    expect(existsSync(join(tmpDir, 'assets', wf))).toBe(false);
  });

  it('workspace_delete against an unregistered workflow name is likewise refused WORKFLOW_NOT_FOUND, not a false-y {deleted:false}', async () => {
    const del = await callTool('workspace_delete', { workflow: 'it102-unclaimed-2', kind: 'skill', name: 'whatever' }, bobToken);
    expect(codeOf(del)).toBe('WORKFLOW_NOT_FOUND');
  });

  it('the OWNER (after registering) can push their own skill — the check is existence, not a blanket refusal', async () => {
    const wf = 'it102-owned';
    const reg = await callTool('workflow_register', { name: wf, script: 'export const meta = { phases: [] };\nreturn "hello";', mermaid: 'graph LR' }, aliceToken);
    expect(codeOf(reg)).toBeUndefined();

    const push = await callTool('workspace_push', skillPush(wf, 'alice-skill', "# Alice's own skill\n"), aliceToken);
    expect(codeOf(push)).toBeUndefined();
    expect((push['result'] as { stored?: string } | undefined)?.stored).toBe('alice-skill');

    const del = await callTool('workspace_delete', { workflow: wf, kind: 'skill', name: 'alice-skill' }, aliceToken);
    expect(codeOf(del)).toBeUndefined();
    expect((del['result'] as { deleted?: boolean } | undefined)?.deleted).toBe(true);
  });

  it('pushing to an EXISTING workflow owned by someone else is masked to WORKFLOW_NOT_FOUND (reverify round-6 finding 5: contrast case now masked, same as a genuinely unregistered name)', async () => {
    const wf = 'it102-owned-by-alice-2';
    const reg = await callTool('workflow_register', { name: wf, script: 'export const meta = { phases: [] };\nreturn "hello";', mermaid: 'graph LR' }, aliceToken);
    expect(codeOf(reg)).toBeUndefined();

    const push = await callTool('workspace_push', skillPush(wf, 'bob-tries', '# Bob is not the owner\n'), bobToken);
    expect(codeOf(push)).toBe('WORKFLOW_NOT_FOUND');
  });

  it("ADMIN behaviour: even an admin cannot push/delete an asset for a workflow that does not exist (WORKFLOW_NOT_FOUND, no admin ownership bypass over non-existence)", async () => {
    const push = await callTool('workspace_push', skillPush('it102-admin-phantom', 'x', '# x\n'), rootToken);
    expect(codeOf(push)).toBe('WORKFLOW_NOT_FOUND');
    const del = await callTool('workspace_delete', { workflow: 'it102-admin-phantom', kind: 'skill', name: 'x' }, rootToken);
    expect(codeOf(del)).toBe('WORKFLOW_NOT_FOUND');

    // ...but a REGISTERED workflow's asset is reachable by admin regardless of who owns it —
    // authz's admin ownership bypass still applies once the workflow genuinely exists.
    const wf = 'it102-admin-existing';
    const reg = await callTool('workflow_register', { name: wf, script: 'export const meta = { phases: [] };\nreturn 1;', mermaid: 'graph LR' }, aliceToken);
    expect(codeOf(reg)).toBeUndefined();
    const adminPush = await callTool('workspace_push', skillPush(wf, 'admin-pushed', '# admin\n'), rootToken);
    expect(codeOf(adminPush)).toBeUndefined();
  });

  it('THE full squatting repro (issue #102 reproduction steps, both principals over real MCP HTTP): bob squats an unclaimed name, alice later registers it, alice inherits NOTHING of bob\'s', async () => {
    const wf = 'it102-unclaimed-full-repro';

    // 1) Bob (principal B) tries to push a skill under a name nobody has registered.
    const squat = await callTool('workspace_push', skillPush(wf, 'codeword', '# SQUATTED-BY-RWE2\n'), bobToken);
    expect(codeOf(squat)).toBe('WORKFLOW_NOT_FOUND');

    // 2) Alice (principal A) registers the name and becomes its owner.
    const reg = await callTool('workflow_register', { name: wf, script: 'export const meta = { phases: [] };\nreturn "hello";', mermaid: 'graph LR' }, aliceToken);
    expect(codeOf(reg)).toBeUndefined();

    // 3) workspace_list shows NO asset at all — bob's push never landed, so there is nothing to
    // inherit (the pre-fix repro's `pushedBy: bob@...` / SQUATTED-BY-RWE2 content is absent).
    const list = await callTool('workspace_list', { workflow: wf, kind: 'skill' }, aliceToken);
    expect((list['result'] ?? []) as unknown[]).toHaveLength(0);

    // 4) Bob still cannot push now that alice owns it — masked to WORKFLOW_NOT_FOUND since reverify
    // round-6 finding 5 (byte-identical to step 1's genuinely-unregistered-name refusal above).
    const stillRefused = await callTool('workspace_push', skillPush(wf, 'codeword', '# still squatting\n'), bobToken);
    expect(codeOf(stillRefused)).toBe('WORKFLOW_NOT_FOUND');
  });
});

describe('deregister then re-register by ANOTHER principal inherits nothing pushed during the unregistered gap (issue #102)', () => {
  it('a squatter\'s push attempt during the window between deregister and re-register is refused, and the eventual re-registrant sees no asset', async () => {
    const wf = 'it102-deregister-gap';

    // Alice registers, then immediately deregisters — the name is now unclaimed again.
    const reg = await callTool('workflow_register', { name: wf, script: 'export const meta = { phases: [] };\nreturn 1;', mermaid: 'graph LR' }, aliceToken);
    expect(codeOf(reg)).toBeUndefined();
    const dereg = await callTool('workflow_deregister', { name: wf }, aliceToken);
    expect(codeOf(dereg)).toBeUndefined();

    // Bob tries to squat the freed name while it is unregistered.
    const squat = await callTool('workspace_push', skillPush(wf, 'freed-name-skill', '# squatted during the gap\n'), bobToken);
    expect(codeOf(squat)).toBe('WORKFLOW_NOT_FOUND');

    // Someone else (bob himself, or any principal) later re-registers the SAME name.
    const rereg = await callTool('workflow_register', { name: wf, script: 'export const meta = { phases: [] };\nreturn 2;', mermaid: 'graph LR' }, bobToken);
    expect(codeOf(rereg)).toBeUndefined();

    // Nothing of the squat attempt is visible — it was refused, never stored.
    const list = await callTool('workspace_list', { workflow: wf, kind: 'skill' }, bobToken);
    expect((list['result'] ?? []) as unknown[]).toHaveLength(0);
  });
});
