// UT (v6 slice, REQ-031..036): the read/reply GitHub-issue primitives + issue_report dedup/enrichment.
// Pure/injected — no real GitHub call (fake fetch for the client, fake GithubIssueClient for the reporter).
import { describe, it, expect, vi } from 'vitest';
import {
  IssueReporter,
  createGithubIssueClient,
  GithubApiError,
  issueFingerprint,
  type GithubIssueClient,
} from '../../src/github/issue-reporter.js';
import type { SecretSource } from '../../src/secret-resolver.js';

const srcWith = (map: Record<string, string>): SecretSource => ({ resolve: (h) => map[h], names: () => Object.keys(map) });
const OK_INPUT = { title: 'Boom on resume', reproSteps: '1. run X\n2. resume', analysis: 'cache replay returns stale null' };

// A minimal Response stand-in for the fake fetch.
const resp = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, async json() { return body; }, async text() { return typeof body === 'string' ? body : JSON.stringify(body); } }) as unknown as Response;

// A full fake client whose methods default to a create-path, with per-test overrides.
function fakeClient(over: Partial<GithubIssueClient> = {}): { client: GithubIssueClient; calls: { createIssue: unknown[]; createComment: Array<{ number: number; body: string }>; findFp: string[] } } {
  const calls = { createIssue: [] as unknown[], createComment: [] as Array<{ number: number; body: string }>, findFp: [] as string[] };
  const client: GithubIssueClient = {
    async createIssue(i) { calls.createIssue.push(i); return { number: 42, url: 'https://github.com/HsuJavis/remote-workflow-engine/issues/42' }; },
    async getIssue() { return null; },
    async listIssues() { return []; },
    async getComments() { return null; },
    async createComment(number, body) { calls.createComment.push({ number, body }); return { commentId: 100, url: 'https://github.com/HsuJavis/remote-workflow-engine/issues/42#issuecomment-100' }; },
    async findOpenByFingerprint(fp) { calls.findFp.push(fp); return null; },
    ...over,
  };
  return { client, calls };
}

describe('createGithubIssueClient read/reply methods (REQ-031..035)', () => {
  const repo = 'HsuJavis/remote-workflow-engine';

  it('REQ-031: getIssue GETs the issue and maps {number,title,state,labels,body,url,commentCount}', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      expect(String(url)).toBe(`https://api.github.com/repos/${repo}/issues/12`);
      return resp(200, { number: 12, title: 'T', state: 'open', labels: [{ name: 'bug' }, 'agent-reported'], body: 'B', html_url: 'https://x/12', comments: 3 });
    });
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await c.getIssue(12)).toEqual({ number: 12, title: 'T', state: 'open', labels: ['bug', 'agent-reported'], body: 'B', url: 'https://x/12', commentCount: 3 });
  });

  it('REQ-031: getIssue returns null on 404 (never a throw)', async () => {
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: (async () => resp(404, 'Not Found')) as unknown as typeof fetch });
    expect(await c.getIssue(999)).toBeNull();
  });

  it('REQ-031: getIssue maps a non-404 non-2xx to GithubApiError', async () => {
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: (async () => resp(403, 'Forbidden')) as unknown as typeof fetch });
    await expect(c.getIssue(1)).rejects.toBeInstanceOf(GithubApiError);
  });

  it('REQ-032: listIssues applies the filter, drops PRs, and maps summaries', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      const u = String(url);
      expect(u).toContain('state=closed');
      expect(u).toContain('labels=agent-reported%2Cbug');
      expect(u).toContain('per_page=5');
      return resp(200, [
        { number: 1, title: 'A', state: 'closed', labels: [{ name: 'bug' }], html_url: 'https://x/1' },
        { number: 2, title: 'PR', state: 'closed', labels: [], html_url: 'https://x/2', pull_request: { url: 'p' } },
      ]);
    });
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await c.listIssues({ labels: ['agent-reported', 'bug'], state: 'closed', limit: 5 });
    expect(out).toEqual([{ number: 1, title: 'A', state: 'closed', labels: ['bug'], url: 'https://x/1' }]);
  });

  it('REQ-032: listIssues caps the limit at the hard ceiling (100)', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => { expect(String(url)).toContain('per_page=100'); return resp(200, []); });
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: fetchImpl as unknown as typeof fetch });
    await c.listIssues({ limit: 9999 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('REQ-033: getComments maps {id,author,body,createdAt}; 404 → null', async () => {
    const ok = createGithubIssueClient({ token: 't', repo, fetchImpl: (async () => resp(200, [{ id: 5, user: { login: 'me' }, body: 'hi', created_at: '2026-01-01T00:00:00Z' }])) as unknown as typeof fetch });
    expect(await ok.getComments(3)).toEqual([{ id: 5, author: 'me', body: 'hi', createdAt: '2026-01-01T00:00:00Z' }]);
    const gone = createGithubIssueClient({ token: 't', repo, fetchImpl: (async () => resp(404, 'nope')) as unknown as typeof fetch });
    expect(await gone.getComments(3)).toBeNull();
  });

  it('REQ-034: createComment POSTs and maps {commentId,url}; 404 → null', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init: unknown) => {
      expect(String(url)).toBe(`https://api.github.com/repos/${repo}/issues/7/comments`);
      expect((init as { method: string }).method).toBe('POST');
      return resp(201, { id: 88, html_url: 'https://x/7#c88' });
    });
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await c.createComment(7, 'reply')).toEqual({ commentId: 88, url: 'https://x/7#c88' });
    const gone = createGithubIssueClient({ token: 't', repo, fetchImpl: (async () => resp(404, 'x')) as unknown as typeof fetch });
    expect(await gone.createComment(7, 'r')).toBeNull();
  });

  it('REQ-035: findOpenByFingerprint queries the search API and returns the first match number', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      const u = String(url);
      expect(u).toContain('/search/issues?q=');
      expect(decodeURIComponent(u)).toContain(`repo:${repo} is:issue is:open in:body "rwe-fp:abc123"`);
      return resp(200, { items: [{ number: 55 }, { number: 56 }] });
    });
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await c.findOpenByFingerprint('abc123')).toBe(55);
  });

  it('REQ-035: findOpenByFingerprint returns null on no match', async () => {
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: (async () => resp(200, { items: [] })) as unknown as typeof fetch });
    expect(await c.findOpenByFingerprint('zzz')).toBeNull();
  });

  it('REQ-030: a read retries on a 5xx then surfaces GithubApiError when it persists', async () => {
    const fetchImpl = vi.fn(async () => resp(500, 'boom'));
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: fetchImpl as unknown as typeof fetch, retries: 1 });
    await expect(c.getIssue(1)).rejects.toBeInstanceOf(GithubApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // initial + 1 retry on the 5xx
  });
});

describe('IssueReporter read/reply methods (REQ-031..034)', () => {
  const issue = { number: 3, title: 'T', state: 'open', labels: ['bug'], body: 'B', url: 'https://x/3', commentCount: 0 };

  it('REQ-031: getIssue success → {ok:true, issue}', async () => {
    const { client } = fakeClient({ async getIssue() { return issue; } });
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    expect(await r.getIssue(3)).toEqual({ ok: true, issue });
  });

  it('REQ-031: getIssue null → ISSUE_NOT_FOUND', async () => {
    const { client } = fakeClient({ async getIssue() { return null; } });
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await r.getIssue(9);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ISSUE_NOT_FOUND');
  });

  it('REQ-031: getIssue with no token → GITHUB_TOKEN_MISSING', async () => {
    const { client } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({}), clientImpl: client });
    const res = await r.getIssue(1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('GITHUB_TOKEN_MISSING');
  });

  it('REQ-031: getIssue client throw → GITHUB_API_ERROR', async () => {
    const { client } = fakeClient({ async getIssue() { throw new GithubApiError('403 Forbidden', 403); } });
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await r.getIssue(1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('GITHUB_API_ERROR');
  });

  it('REQ-032: listIssues success → {ok:true, issues}', async () => {
    const summaries = [{ number: 1, title: 'A', state: 'open', labels: [], url: 'https://x/1' }];
    const { client } = fakeClient({ async listIssues() { return summaries; } });
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    expect(await r.listIssues({ state: 'open' })).toEqual({ ok: true, issues: summaries });
  });

  it('REQ-032: listIssues with no token → GITHUB_TOKEN_MISSING', async () => {
    const { client } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({}), clientImpl: client });
    const res = await r.listIssues({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('GITHUB_TOKEN_MISSING');
  });

  it('REQ-033: getComments success → {ok:true, comments}; null → ISSUE_NOT_FOUND', async () => {
    const comments = [{ id: 5, author: 'me', body: 'hi', createdAt: '2026-01-01T00:00:00Z' }];
    const ok = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: fakeClient({ async getComments() { return comments; } }).client });
    expect(await ok.getComments(3)).toEqual({ ok: true, comments });
    const gone = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: fakeClient({ async getComments() { return null; } }).client });
    const res = await gone.getComments(3);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ISSUE_NOT_FOUND');
  });

  it('REQ-034: postComment success → {ok:true, commentId, url}', async () => {
    const { client, calls } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await r.postComment(7, 'progress update');
    expect(res).toEqual({ ok: true, commentId: 100, url: 'https://github.com/HsuJavis/remote-workflow-engine/issues/42#issuecomment-100' });
    expect(calls.createComment).toEqual([{ number: 7, body: 'progress update' }]);
  });

  it('REQ-034: postComment empty body → ISSUE_COMMENT_INVALID (field:body), no API call', async () => {
    const { client, calls } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await r.postComment(7, '   ');
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.error.code).toBe('ISSUE_COMMENT_INVALID'); expect(res.error.field).toBe('body'); }
    expect(calls.createComment).toHaveLength(0);
  });

  it('REQ-034: postComment null (unknown issue) → ISSUE_NOT_FOUND', async () => {
    const { client } = fakeClient({ async createComment() { return null; } });
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await r.postComment(9, 'x');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ISSUE_NOT_FOUND');
  });

  it('REQ-034: postComment with no token → GITHUB_TOKEN_MISSING', async () => {
    const { client } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({}), clientImpl: client });
    const res = await r.postComment(1, 'x');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('GITHUB_TOKEN_MISSING');
  });

  it('REQ-034: postComment client throw → GITHUB_API_ERROR', async () => {
    const { client } = fakeClient({ async createComment() { throw new GithubApiError('500 boom', 500); } });
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await r.postComment(1, 'x');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('GITHUB_API_ERROR');
  });
});

describe('issue_report de-dup (REQ-035)', () => {
  it('an existing open issue with the fingerprint → comments on it, no new issue, deduped:true', async () => {
    const { client, calls } = fakeClient({ async findOpenByFingerprint() { return 17; } });
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client, repo: 'o/rr' });
    const res = await r.report(OK_INPUT);
    expect(res).toEqual({ ok: true, issueNumber: 17, url: 'https://github.com/o/rr/issues/17', deduped: true });
    expect(calls.createIssue).toHaveLength(0);
    expect(calls.createComment).toHaveLength(1);
    expect(calls.createComment[0].number).toBe(17);
    // the de-dup comment carries the same structured body (with the hidden fp marker).
    expect(calls.createComment[0].body).toContain(`rwe-fp:${issueFingerprint(OK_INPUT.title)}`);
  });

  it('no matching open issue → creates a new one, deduped:false', async () => {
    const { client, calls } = fakeClient({ async findOpenByFingerprint() { return null; } });
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await r.report(OK_INPUT);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.deduped).toBe(false);
    expect(calls.createIssue).toHaveLength(1);
    expect(calls.createComment).toHaveLength(0);
  });

  it('the rendered body embeds the hidden fingerprint marker findOpenByFingerprint searches for', async () => {
    const { client, calls } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    await r.report({ ...OK_INPUT, component: 'run-manager' });
    const fp = issueFingerprint(OK_INPUT.title, 'run-manager');
    expect((calls.createIssue[0] as { body: string }).body).toContain(`<!-- rwe-fp:${fp} -->`);
  });
});

describe('issue_report runId enrichment (REQ-036)', () => {
  it('runDiagnostics output appears in the issue body', async () => {
    const { client, calls } = fakeClient();
    const r = new IssueReporter({
      secretSource: srcWith({ GITHUB_TOKEN: 't' }),
      clientImpl: client,
      runDiagnostics: async (runId) => `### Engine diagnostics\n- status: failed\n- run: ${runId}`,
    });
    await r.report({ ...OK_INPUT, runId: 'run-77' });
    const body = (calls.createIssue[0] as { body: string }).body;
    expect(body).toContain('## Linked run');
    expect(body).toContain('### Engine diagnostics');
    expect(body).toContain('run-77');
  });

  it('a throwing runDiagnostics still files the issue (best-effort, never fails the report)', async () => {
    const { client, calls } = fakeClient();
    const r = new IssueReporter({
      secretSource: srcWith({ GITHUB_TOKEN: 't' }),
      clientImpl: client,
      runDiagnostics: async () => { throw new Error('engine unavailable'); },
    });
    const res = await r.report({ ...OK_INPUT, runId: 'run-broken' });
    expect(res.ok).toBe(true);
    expect(calls.createIssue).toHaveLength(1);
  });

  it('runDiagnostics is NOT consulted when no runId is given', async () => {
    const spy = vi.fn(async () => 'diag');
    const { client } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client, runDiagnostics: spy });
    await r.report(OK_INPUT);
    expect(spy).not.toHaveBeenCalled();
  });
});
