// IT (issue #164 reverify): the 2026-10-09 re-verification could exercise neither `issue_reopen`
// nor `issue_list`'s `labels` filter end to end — its MCP session's cached `tools/list` predated
// `issue_reopen` (a stale client, never refreshed after connecting) and its cached `issue_list`
// input schema predated the `labels` property, so the array it sent went out as a string instead.
// Both gaps are the CLIENT's own cache, not a server defect — `tools/list` already advertises
// `issue_reopen` (tests/integration/issue-ops-http.test.ts's own `tools/list` assertion didn't
// check for it explicitly; this file locks that in) and `issue_list`'s schema already declares
// `labels` as `array of strings` (tests/unit/issue-list-filters-advertised.test.ts). What neither
// of those pins down is the ACTUAL filtering semantics end to end over the real MCP HTTP surface,
// against a fake GithubIssueClient that genuinely filters (not a pass-through mock returning a
// fixed array regardless of the filter it was given) — and `issue_reopen`'s real reporter-vs-admin
// authorization through real bearer tokens (mintBearer), not a directly-injected `reopen()` mock.
//
// Mock policy (integration, mirrors global-asset-discovery.test.ts): real createServer() with auth
// ENABLED and real bearers; a hand-rolled in-memory FAKE GithubIssueClient that stores issues with
// real labels/state/reporter-marker bodies and applies GitHub's own AND-of-labels filtering
// semantics itself (no real GitHub call).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { IssueReporter, type GithubIssueClient, type IssueView, type IssueSummary } from '../../src/github/issue-reporter.js';
import type { SecretSource } from '../../src/secret-resolver.js';
import { TokenStore } from '../../src/auth/token-store.js';

const srcWith = (m: Record<string, string>): SecretSource => ({ resolve: (h) => m[h], names: () => Object.keys(m) });

const ADMIN_EMAIL = 'g164-admin@example.com';
const ALICE_EMAIL = 'g164-alice@example.com';
const BOB_EMAIL = 'g164-bob@example.com';

function mintBearer(workRoot: string, email: string): string {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  try {
    return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) }).issue(email, 7 * 24 * 3600_000).token;
  } finally {
    db.close();
  }
}

function callToolFactory(server: () => Server) {
  return async (name: string, args: Record<string, unknown>, bearer?: string) => {
    const res = await fetch(`http://127.0.0.1:${server().port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { code: number; message: string } };
    if (body.error) return { error: body.error };
    return JSON.parse(body.result!.content![0].text!) as Record<string, unknown>;
  };
}

/** A minimal in-memory GitHub stand-in that applies the SAME AND-of-labels, state, and
 *  reporter-marker semantics the real GitHub API / IssueReporter.reopen() rely on — proves the
 *  filter/authorization logic, not just that a fixed array passed through unfiltered. */
function makeFakeStore() {
  const issues = new Map<number, { title: string; state: 'open' | 'closed'; labels: string[]; body: string }>([
    [1, { title: 'Needs triage', state: 'open', labels: ['bug'], body: 'b' }],
    [2, { title: 'Hot fire', state: 'open', labels: ['bug', 'urgent'], body: 'b' }],
    [3, { title: 'Docs typo', state: 'open', labels: ['docs'], body: 'b' }],
    [4, { title: 'Fixed already', state: 'closed', labels: ['bug'], body: `b\n<!-- rwe-reporter:${ALICE_EMAIL} -->` }],
    [5, { title: 'Pre-existing, no marker', state: 'closed', labels: ['bug'], body: 'b, filed before issue_reopen existed' }],
  ]);
  const client: GithubIssueClient = {
    async createIssue() { throw new Error('not used'); },
    async getIssue(n) {
      const i = issues.get(n);
      if (!i) return null;
      return { number: n, title: i.title, state: i.state, labels: i.labels, body: i.body, url: `https://x/${n}`, commentCount: 0 } satisfies IssueView;
    },
    async listIssues(filter) {
      const wantState = filter.state ?? 'open';
      const wantLabels = filter.labels ?? [];
      const out: IssueSummary[] = [];
      for (const [n, i] of issues) {
        if (wantState !== 'all' && i.state !== wantState) continue;
        // GitHub's own semantics: a comma-joined `labels` param is an AND — every requested label
        // must be present.
        if (!wantLabels.every((l) => i.labels.includes(l))) continue;
        out.push({ number: n, title: i.title, state: i.state, labels: i.labels, url: `https://x/${n}` });
      }
      return out;
    },
    async getComments() { return []; },
    async createComment(n, body) { if (!issues.has(n)) return null; return { commentId: n * 100, url: `https://x/${n}#c` }; },
    async findOpenByFingerprint() { return null; },
    async reopenIssue(n, reason) {
      const i = issues.get(n);
      if (!i) return null;
      i.state = 'open';
      return { commentId: n * 100 + 1, url: `https://x/${n}#c${reason.length}` };
    },
  };
  return { client, issues };
}

describe('issue #164 reverify: issue_list labels filtering + issue_reopen, end to end over the real MCP HTTP surface', () => {
  let server: Server;
  let tmpDir: string;
  let adminToken: string;
  let aliceToken: string;
  let bobToken: string;
  const call = callToolFactory(() => server);
  let store: ReturnType<typeof makeFakeStore>;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it164-'));
    store = makeFakeStore();
    const issueReporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 'tkn' }), clientImpl: store.client });
    server = await createServer({
      port: 0,
      bind: '127.0.0.1',
      workRoot: tmpDir,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it164-cid', googleClientSecret: 'it164-cs' },
      principals: {
        [ADMIN_EMAIL]: { role: 'admin' },
        [ALICE_EMAIL]: { role: 'user' },
        [BOB_EMAIL]: { role: 'user' },
      },
      issueReporter,
    } as never);
    adminToken = mintBearer(tmpDir, ADMIN_EMAIL);
    aliceToken = mintBearer(tmpDir, ALICE_EMAIL);
    bobToken = mintBearer(tmpDir, BOB_EMAIL);
  });

  afterAll(async () => {
    await server?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('the server actually advertises issue_reopen in tools/list (the gap was a stale client cache, not this)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body = await res.json() as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name)).toContain('issue_reopen');
  });

  it('issue_list({labels:["bug"]}) returns every OPEN issue carrying that label, never one missing it', async () => {
    const res = await call('issue_list', { labels: ['bug'] }, adminToken);
    const nums = (res.result as IssueSummary[]).map((i) => i.number).sort();
    // #1 and #2 are open+bug; #3 is open but no 'bug' label; #4/#5 are closed (excluded by the
    // default state:'open').
    expect(nums).toEqual([1, 2]);
  });

  it('issue_list({labels:["bug","urgent"]}) is an AND — only the issue carrying BOTH', async () => {
    const res = await call('issue_list', { labels: ['bug', 'urgent'] }, adminToken);
    const nums = (res.result as IssueSummary[]).map((i) => i.number);
    expect(nums).toEqual([2]);
  });

  it('issue_list({state:"closed", labels:["bug"]}) reaches the closed+labeled issues too', async () => {
    const res = await call('issue_list', { state: 'closed', labels: ['bug'] }, adminToken);
    const nums = (res.result as IssueSummary[]).map((i) => i.number).sort();
    expect(nums).toEqual([4, 5]);
  });

  it('issue_reopen: the original reporter (alice) may reopen her own closed issue — state flips to open', async () => {
    const res = await call('issue_reopen', { number: 4, reason: 'still broken, reopening' }, aliceToken);
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ issueNumber: 4 });
    expect(store.issues.get(4)?.state).toBe('open');
  });

  it('issue_reopen: a DIFFERENT non-admin user (bob) is refused NOT_ISSUE_REPORTER — state unchanged', async () => {
    const res = await call('issue_reopen', { number: 5, reason: 'bob tries' }, bobToken);
    expect((res.error as { code: string } | undefined)?.code).toBe('NOT_ISSUE_REPORTER');
    expect(store.issues.get(5)?.state).toBe('closed');
  });

  it('issue_reopen: an admin may reopen an issue with no recorded reporter at all', async () => {
    const res = await call('issue_reopen', { number: 5, reason: 'reopening as admin' }, adminToken);
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ issueNumber: 5 });
    expect(store.issues.get(5)?.state).toBe('open');
  });

  it('a reopened issue is now visible again under the default (open-only) issue_list', async () => {
    const res = await call('issue_list', { labels: ['bug'] }, adminToken);
    const nums = (res.result as IssueSummary[]).map((i) => i.number).sort();
    // #4 and #5, reopened above, now join #1/#2 under the default open filter.
    expect(nums).toEqual([1, 2, 4, 5]);
  });
});
