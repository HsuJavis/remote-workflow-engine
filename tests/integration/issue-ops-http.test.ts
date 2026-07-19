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
    expect(names).toEqual(expect.arrayContaining(['issue_get', 'issue_list', 'issue_comments', 'issue_comment']));
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

  it('issue_comments returns the thread; unknown → ISSUE_NOT_FOUND', async () => {
    const ok = await toolCall(baseUrl, 'issue_comments', { number: 3 });
    expect(ok.result).toEqual(COMMENTS);
    const gone = await toolCall(baseUrl, 'issue_comments', { number: 500 });
    expect(gone.error?.code).toBe('ISSUE_NOT_FOUND');
  });

  it('issue_comment posts a reply and returns {commentId, url}; empty body → ISSUE_COMMENT_INVALID', async () => {
    const ok = await toolCall(baseUrl, 'issue_comment', { number: 3, body: 'on it' });
    expect(ok.result).toEqual({ commentId: 77, url: 'https://x/3#c77' });
    expect(posted).toEqual([{ number: 3, body: 'on it' }]);
    const bad = await toolCall(baseUrl, 'issue_comment', { number: 3, body: '  ' });
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
      expect((await toolCall(base, 'issue_comments', { number: 1 })).error?.code).toBe('GITHUB_TOKEN_MISSING');
      expect((await toolCall(base, 'issue_comment', { number: 1, body: 'x' })).error?.code).toBe('GITHUB_TOKEN_MISSING');
    } finally {
      await server.close();
      if (saved !== undefined) process.env.RWE_SECRET_GITHUB_TOKEN = saved;
    }
  });
});
