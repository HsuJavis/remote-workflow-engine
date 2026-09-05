// IT (v6 slice, REQ-031..034): the read/reply issue tools over the real MCP HTTP surface. A real
// IssueReporter with a FAKE GithubIssueClient (no real GitHub call) is injected via ServerConfig; a
// second server with NO token exercises the real composition-root default wiring (GITHUB_TOKEN_MISSING).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { IssueReporter, type GithubIssueClient, type IssueView, type CommentView } from '../../src/github/issue-reporter.js';
import type { SecretSource } from '../../src/secret-resolver.js';

interface RpcResponse { result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }> }; error?: { code: number; message: string }; }
async function rpc(baseUrl: string, method: string, params: unknown): Promise<RpcResponse> {
  const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return res.json() as Promise<RpcResponse>;
}
async function toolCall(baseUrl: string, name: string, args: Record<string, unknown>): Promise<any> {
  const body = await rpc(baseUrl, 'tools/call', { name, arguments: args });
  if (body.error) return { error: body.error };
  return JSON.parse(body.result!.content![0].text);
}
const srcWith = (m: Record<string, string>): SecretSource => ({ resolve: (h) => m[h], names: () => Object.keys(m) });

const ISSUE: IssueView = { number: 3, title: 'T', state: 'open', labels: ['agent-reported'], body: 'B', url: 'https://x/3', commentCount: 1 };
const COMMENTS: CommentView[] = [{ id: 9, author: 'me', body: 'attempt 1', createdAt: '2026-01-01T00:00:00Z' }];

describe('issue read/reply tools over the real MCP HTTP surface (REQ-031..034)', () => {
  let server: Server; let baseUrl: string;
  const posted: Array<{ number: number; body: string }> = [];
  const fakeClient: GithubIssueClient = {
    async createIssue() { return { number: 1, url: 'https://x/1' }; },
    async getIssue(number) { return number === 3 ? ISSUE : null; },
    async listIssues() { return [{ number: 3, title: 'T', state: 'open', labels: ['agent-reported'], url: 'https://x/3' }]; },
    async getComments(number) { return number === 3 ? COMMENTS : null; },
    async createComment(number, body) { if (number !== 3) return null; posted.push({ number, body }); return { commentId: 77, url: 'https://x/3#c77' }; },
    async findOpenByFingerprint() { return null; },
  };

  beforeAll(async () => {
    const issueReporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 'tkn' }), clientImpl: fakeClient });
    server = await createServer({ port: 0, bind: '127.0.0.1', issueReporter });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => { await server?.close(); });

  it('tools/list advertises the four v6 tools', async () => {
    const body = await rpc(baseUrl, 'tools/list', {});
    const names = (body.result!.tools ?? []).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['issue_get', 'issue_list', 'issue_get_comments', 'issue_comment_post']));
  });

  it('issue_get returns the issue view; unknown → ISSUE_NOT_FOUND', async () => {
    const ok = await toolCall(baseUrl, 'issue_get', { number: 3 });
    expect(ok.result).toEqual(ISSUE);
    const gone = await toolCall(baseUrl, 'issue_get', { number: 404 });
    expect(gone.error?.code).toBe('ISSUE_NOT_FOUND');
  });

  it('issue_list returns a bounded summary array', async () => {
    const res = await toolCall(baseUrl, 'issue_list', { labels: ['agent-reported'] });
    expect(res.result).toEqual([{ number: 3, title: 'T', state: 'open', labels: ['agent-reported'], url: 'https://x/3' }]);
  });

  it('issue_get_comments returns the thread; unknown → ISSUE_NOT_FOUND', async () => {
    const ok = await toolCall(baseUrl, 'issue_get_comments', { number: 3 });
    expect(ok.result).toEqual(COMMENTS);
    const gone = await toolCall(baseUrl, 'issue_get_comments', { number: 500 });
    expect(gone.error?.code).toBe('ISSUE_NOT_FOUND');
  });

  it('issue_comment_post posts a reply and returns {commentId, url}; empty body → ISSUE_COMMENT_INVALID', async () => {
    const ok = await toolCall(baseUrl, 'issue_comment_post', { number: 3, body: 'on it' });
    expect(ok.result).toEqual({ commentId: 77, url: 'https://x/3#c77' });
    expect(posted).toEqual([{ number: 3, body: 'on it' }]);
    const bad = await toolCall(baseUrl, 'issue_comment_post', { number: 3, body: '  ' });
    expect(bad.error?.code).toBe('ISSUE_COMMENT_INVALID');
  });
});

describe('issue read/reply default wiring: no token → GITHUB_TOKEN_MISSING (REQ-031..034)', () => {
  it('a server with no RWE_SECRET_GITHUB_TOKEN returns a typed token-missing envelope', async () => {
    const saved = process.env.RWE_SECRET_GITHUB_TOKEN;
    delete process.env.RWE_SECRET_GITHUB_TOKEN;
    const server = await createServer({ port: 0, bind: '127.0.0.1' }); // real default IssueReporter
    try {
      const base = `http://127.0.0.1:${server.port}`;
      expect((await toolCall(base, 'issue_get', { number: 1 })).error?.code).toBe('GITHUB_TOKEN_MISSING');
      expect((await toolCall(base, 'issue_list', {})).error?.code).toBe('GITHUB_TOKEN_MISSING');
      expect((await toolCall(base, 'issue_get_comments', { number: 1 })).error?.code).toBe('GITHUB_TOKEN_MISSING');
      expect((await toolCall(base, 'issue_comment_post', { number: 1, body: 'x' })).error?.code).toBe('GITHUB_TOKEN_MISSING');
    } finally {
      await server.close();
      if (saved !== undefined) process.env.RWE_SECRET_GITHUB_TOKEN = saved;
    }
  });
});

// ── v11 (REQ-067, DES-038): GET /api/issues* — read-only Issues dashboard API ──
// These tests are RED because the router dispatch predicate (server.ts:996) does not yet
// match /api/issues, so requests fall through to /mcp and get a JSON-RPC -32601 error.

describe('GET /api/issues — Issues dashboard list API (REQ-067)', () => {
  let server: Server; let baseUrl: string;

  // Fake client: listIssues returns 2 open + 1 closed; getIssue(10) → full IssueView.
  const OPEN_1 = { number: 10, title: 'Bug A', state: 'open', labels: ['agent-reported', 'severity:high'], url: 'https://x/10' };
  const OPEN_2 = { number: 11, title: 'Bug B', state: 'open', labels: ['agent-reported'], url: 'https://x/11' };
  const CLOSED_1 = { number: 12, title: 'Fixed C', state: 'closed', labels: ['agent-reported'], url: 'https://x/12' };
  const ISSUE_VIEW_10: IssueView = { number: 10, title: 'Bug A', state: 'open', labels: ['agent-reported'], body: 'body text', url: 'https://x/10', commentCount: 3 };

  const dashClient: GithubIssueClient = {
    async createIssue() { return { number: 1, url: 'https://x/1' }; },
    async getIssue(n) { return n === 10 ? ISSUE_VIEW_10 : null; },
    async listIssues(_f) { return [OPEN_1, OPEN_2, CLOSED_1]; },
    async getComments() { return [] as CommentView[]; },
    async createComment() { return { commentId: 1, url: 'https://x/1#c1' }; },
    async findOpenByFingerprint() { return null; },
  };

  beforeAll(async () => {
    const issueReporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 'tkn' }), clientImpl: dashClient });
    server = await createServer({ port: 0, bind: '127.0.0.1', issueReporter });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => { await server?.close(); });

  it('GET /api/issues → HTTP 200 with {open: [2 items], resolved: [1 item]}', async () => {
    // RED: /api/issues falls through to /mcp → JSON-RPC -32601; not a 200 with the partition shape.
    const res = await fetch(`${baseUrl}/api/issues`);
    expect(res.status).toBe(200);
    const body = await res.json() as { open: unknown[]; resolved: unknown[] };
    expect(body.open).toHaveLength(2);
    expect(body.resolved).toHaveLength(1);
    // Each entry must carry its GitHub url.
    expect((body.open[0] as any).url).toMatch(/^https:\/\//);
  });

  it('GET /api/issues/:number → HTTP 200 with the full IssueView (body, labels, commentCount)', async () => {
    // RED: /api/issues/10 falls through to /mcp; not a 200 with IssueView.
    const res = await fetch(`${baseUrl}/api/issues/10`);
    expect(res.status).toBe(200);
    const body = await res.json() as IssueView;
    expect(body.number).toBe(10);
    expect(typeof body.body).toBe('string');
    expect(typeof body.commentCount).toBe('number');
    expect(body.url).toMatch(/^https:\/\//);
  });

  it('GET /api/issues/:number for unknown number → HTTP 404 with an error body', async () => {
    // RED: once the route is live, /api/issues/9999 should return 404 WITH a JSON error body
    // ({error: ...}). Right now the route doesn't exist so the catch-all returns 404 with a
    // plain text/html body, not a JSON object. Assert the JSON shape to stay RED until the real
    // route is wired: the parse below will throw or the 'error' field will be absent.
    const res = await fetch(`${baseUrl}/api/issues/9999`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error?: string };
    // The real implementation returns {error: 'Issue not found: 9999'} or similar.
    // The catch-all 404 returns a plain string or different shape → assertion fails → RED.
    expect(typeof body.error).toBe('string');
    expect(body.error).toMatch(/9999/);
  });
});

describe('GET /api/issues degradation — no GitHub token → HTTP 200 + degraded notice (REQ-067)', () => {
  it('both list and detail endpoints return HTTP 200 + degraded notice when token is absent', async () => {
    // RED: without the /api/issues route, the endpoints fall through to /mcp (wrong status/shape).
    const saved = process.env.RWE_SECRET_GITHUB_TOKEN;
    delete process.env.RWE_SECRET_GITHUB_TOKEN;
    const s = await createServer({ port: 0, bind: '127.0.0.1' }); // real default — no token
    try {
      const base = `http://127.0.0.1:${s.port}`;

      const listRes = await fetch(`${base}/api/issues`);
      expect(listRes.status).toBe(200); // never a 500
      const listBody = await listRes.json() as { degraded?: string; open: unknown[]; resolved: unknown[] };
      expect(typeof listBody.degraded).toBe('string');
      expect(listBody.degraded).toBeTruthy();
      expect(listBody.open).toEqual([]);
      expect(listBody.resolved).toEqual([]);

      const detailRes = await fetch(`${base}/api/issues/1`);
      expect(detailRes.status).toBe(200); // never a 500
      const detailBody = await detailRes.json() as { degraded?: string };
      expect(typeof detailBody.degraded).toBe('string');
      expect(detailBody.degraded).toBeTruthy();
    } finally {
      await s.close();
      if (saved !== undefined) process.env.RWE_SECRET_GITHUB_TOKEN = saved;
    }
  });
});
