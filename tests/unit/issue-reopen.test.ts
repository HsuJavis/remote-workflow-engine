// UT (issue #164 A): issue_reopen — a closed-but-not-actually-fixed issue previously had no path
// back to open. `IssueReporter.reopen()` authorizes "the issue's original reporter (its hidden
// `rwe-reporter:<actor>` marker) or an admin" and, when allowed, PATCHes state:'open' then posts
// `reason` as a comment. `renderIssueBody`/`parseReporterMarker` round-trip the marker;
// `createGithubIssueClient.reopenIssue` is the real-client half; `callTool`'s own 'issue_reopen'
// case (call-tool.ts) wires `principal.kind === 'admin'` + `actor` through to it.
import { describe, it, expect, vi } from 'vitest';
import {
  IssueReporter,
  createGithubIssueClient,
  renderIssueBody,
  parseReporterMarker,
  type GithubIssueClient,
  type IssueView,
} from '../../src/github/issue-reporter.js';
import type { SecretSource } from '../../src/secret-resolver.js';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';
import type { OwnerLookup, Principal } from '../../src/authz.js';

const srcWith = (m: Record<string, string>): SecretSource => ({ resolve: (h) => m[h], names: () => Object.keys(m) });

function issueView(over: Partial<IssueView> = {}): IssueView {
  return { number: 5, title: 'T', state: 'closed', labels: ['agent-reported'], body: 'body', url: 'https://x/5', commentCount: 0, ...over };
}

function fakeClient(over: Partial<GithubIssueClient> = {}): GithubIssueClient {
  return {
    async createIssue() { return { number: 1, url: 'https://x/1' }; },
    async getIssue() { return null; },
    async listIssues() { return []; },
    async getComments() { return null; },
    async createComment() { return { commentId: 1, url: 'https://x/1#c1' }; },
    async findOpenByFingerprint() { return null; },
    async reopenIssue() { return { commentId: 2, url: 'https://x/1#c2' }; },
    ...over,
  };
}

describe('renderIssueBody / parseReporterMarker (issue #164): the hidden reporter marker round-trips', () => {
  const INPUT = { title: 'T', reproSteps: 'R', analysis: 'A' };

  it('stamps <!-- rwe-reporter:<actor> --> when an actor is given, and parseReporterMarker reads it back', () => {
    const body = renderIssueBody(INPUT, { nowIso: '2026-01-01T00:00:00Z', reporter: 'alice' });
    expect(body).toContain('<!-- rwe-reporter:alice -->');
    expect(parseReporterMarker(body)).toBe('alice');
  });

  it('omits the marker when reporter is null/undefined — parseReporterMarker then returns null', () => {
    const body1 = renderIssueBody(INPUT, { nowIso: '2026-01-01T00:00:00Z', reporter: null });
    const body2 = renderIssueBody(INPUT, { nowIso: '2026-01-01T00:00:00Z' });
    expect(body1).not.toContain('rwe-reporter');
    expect(body2).not.toContain('rwe-reporter');
    expect(parseReporterMarker(body1)).toBeNull();
  });

  it('parseReporterMarker returns null for a pre-existing issue body with no marker at all', () => {
    expect(parseReporterMarker('## Summary\nsomething\n')).toBeNull();
  });
});

describe('IssueReporter.report (issue #164): actor is threaded as a SEPARATE param, never via IssueReportInput', () => {
  it('stamps the actor passed to report() on the created issue body', async () => {
    let capturedBody = '';
    const client = fakeClient({ async createIssue(i) { capturedBody = i.body; return { number: 9, url: 'https://x/9' }; } });
    const reporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client, nowIso: () => '2026-01-01T00:00:00Z' });
    await reporter.report({ title: 'Boom', reproSteps: 'R', analysis: 'A' }, 'alice');
    expect(capturedBody).toContain('<!-- rwe-reporter:alice -->');
  });

  it('a forged `reporter` field inside the input object itself is IGNORED — only the actor param counts', async () => {
    let capturedBody = '';
    const client = fakeClient({ async createIssue(i) { capturedBody = i.body; return { number: 9, url: 'https://x/9' }; } });
    const reporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client, nowIso: () => '2026-01-01T00:00:00Z' });
    await reporter.report({ title: 'Boom', reproSteps: 'R', analysis: 'A', reporter: 'mallory' } as never, 'alice');
    expect(capturedBody).toContain('<!-- rwe-reporter:alice -->');
    expect(capturedBody).not.toContain('mallory');
  });

  it('actor omitted (auth-disabled/loopback-exempt) -> no marker at all', async () => {
    let capturedBody = '';
    const client = fakeClient({ async createIssue(i) { capturedBody = i.body; return { number: 9, url: 'https://x/9' }; } });
    const reporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client, nowIso: () => '2026-01-01T00:00:00Z' });
    await reporter.report({ title: 'Boom', reproSteps: 'R', analysis: 'A' }, null);
    expect(capturedBody).not.toContain('rwe-reporter');
  });
});

describe('IssueReporter.reopen (issue #164): original reporter or admin only', () => {
  it('the original reporter may reopen their own issue — PATCH then comment, ok:true', async () => {
    const calls: string[] = [];
    const client = fakeClient({
      async getIssue(n) { return issueView({ number: n, body: 'body\n<!-- rwe-reporter:alice -->' }); },
      async reopenIssue(n, reason) { calls.push(`${n}:${reason}`); return { commentId: 5, url: 'https://x/5#c5' }; },
    });
    const reporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await reporter.reopen(5, 'still broken', { actor: 'alice', isAdmin: false });
    expect(res).toEqual({ ok: true, issueNumber: 5 });
    expect(calls).toEqual(['5:still broken']);
  });

  it('a DIFFERENT principal is refused NOT_ISSUE_REPORTER — reopenIssue is never called', async () => {
    const reopenIssue = vi.fn().mockResolvedValue({ commentId: 1, url: 'x' });
    const client = fakeClient({
      async getIssue(n) { return issueView({ number: n, body: 'body\n<!-- rwe-reporter:alice -->' }); },
      reopenIssue,
    });
    const reporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await reporter.reopen(5, 'still broken', { actor: 'bob', isAdmin: false });
    expect(res).toEqual({ ok: false, error: { code: 'NOT_ISSUE_REPORTER', message: expect.stringContaining('#5') } });
    expect(reopenIssue).not.toHaveBeenCalled();
  });

  it('an admin may reopen ANY issue, even one with no recorded reporter at all', async () => {
    const client = fakeClient({ async getIssue(n) { return issueView({ number: n, body: 'body, no marker' }); } });
    const reporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await reporter.reopen(5, 'reopening as admin', { actor: 'root', isAdmin: true });
    expect(res).toEqual({ ok: true, issueNumber: 5 });
  });

  it('a null actor (auth-disabled/loopback-exempt, non-admin) never matches any marker, including a null one', async () => {
    const reopenIssue = vi.fn();
    const client = fakeClient({
      async getIssue(n) { return issueView({ number: n, body: 'no marker here' }); },
      reopenIssue,
    });
    const reporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await reporter.reopen(5, 'r', { actor: null, isAdmin: false });
    expect(res).toEqual({ ok: false, error: { code: 'NOT_ISSUE_REPORTER', message: expect.any(String) } });
    expect(reopenIssue).not.toHaveBeenCalled();
  });

  it('an unknown issue number -> ISSUE_NOT_FOUND, checked BEFORE authorization', async () => {
    const client = fakeClient({ async getIssue() { return null; } });
    const reporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await reporter.reopen(999999999, 'r', { actor: 'alice', isAdmin: false });
    expect(res).toEqual({ ok: false, error: { code: 'ISSUE_NOT_FOUND', message: expect.any(String) } });
  });

  it('missing token -> GITHUB_TOKEN_MISSING, before any client call', async () => {
    const getIssue = vi.fn();
    const reporter = new IssueReporter({ secretSource: srcWith({}), clientImpl: fakeClient({ getIssue }) });
    const res = await reporter.reopen(5, 'r', { actor: 'alice', isAdmin: true });
    expect(res.ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe('GITHUB_TOKEN_MISSING');
    expect(getIssue).not.toHaveBeenCalled();
  });
});

describe('createGithubIssueClient.reopenIssue (issue #164): PATCH state:open, then comment', () => {
  const repo = 'HsuJavis/remote-workflow-engine';
  const resp = (status: number, body: unknown): Response =>
    ({ ok: status >= 200 && status < 300, status, async json() { return body; }, async text() { return typeof body === 'string' ? body : JSON.stringify(body); } }) as unknown as Response;

  it('PATCHes the issue to state:open, then POSTs the reason as a comment', async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
      if (init?.method === 'PATCH') return resp(200, { number: 5, state: 'open' });
      return resp(201, { id: 55, html_url: 'https://x/5#c55' });
    });
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await c.reopenIssue(5, 'still broken');
    expect(r).toEqual({ commentId: 55, url: 'https://x/5#c55' });
    expect(calls[0]).toEqual({ method: 'PATCH', url: `https://api.github.com/repos/${repo}/issues/5`, body: { state: 'open' } });
    expect(calls[1]).toEqual({ method: 'POST', url: `https://api.github.com/repos/${repo}/issues/5/comments`, body: { body: 'still broken' } });
  });

  it('a 404 on the PATCH maps to null — never a throw', async () => {
    const c = createGithubIssueClient({ token: 't', repo, fetchImpl: (async () => resp(404, 'nope')) as unknown as typeof fetch });
    expect(await c.reopenIssue(999999999, 'r')).toBeNull();
  });
});

// Integration: callTool's 'issue_reopen' case (call-tool.ts) wires principal.kind==='admin' and
// `actor` through to IssueReporter.reopen() — the ownership:'none' authz row never itself checks
// "original reporter", by design (see tool-specs.ts's own row comment).
describe("callTool('issue_reopen') (issue #164): principal.kind==='admin' and actor wiring", () => {
  const NOOP_LOOKUP: OwnerLookup = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };
  const ALICE: Principal = { kind: 'user', id: 'alice' };
  const BOB: Principal = { kind: 'user', id: 'bob' };
  const ADMIN: Principal = { kind: 'admin', id: 'root' };

  function depsWith(reopen: ReturnType<typeof vi.fn>): ToolDeps {
    return {
      facade: {},
      lookup: NOOP_LOOKUP,
      issueReporter: { reopen },
    } as unknown as ToolDeps;
  }

  it('passes isAdmin:true and the admin\'s own actor id for an admin caller', async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: true, issueNumber: 5 });
    const res = await callTool(depsWith(reopen), 'issue_reopen', { number: 5, reason: 'r' }, ADMIN);
    expect(reopen).toHaveBeenCalledWith(5, 'r', { actor: 'root', isAdmin: true });
    expect((res as { result: { issueNumber: number } }).result).toEqual({ issueNumber: 5 });
  });

  it('passes isAdmin:false and the caller\'s own actor id for a non-admin user', async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: false, error: { code: 'NOT_ISSUE_REPORTER', message: 'no' } });
    const res = await callTool(depsWith(reopen), 'issue_reopen', { number: 5, reason: 'r' }, BOB);
    expect(reopen).toHaveBeenCalledWith(5, 'r', { actor: 'bob', isAdmin: false });
    expect((res as { error: { code: string } }).error.code).toBe('NOT_ISSUE_REPORTER');
  });

  it('a non-admin reporter succeeds end to end through callTool', async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: true, issueNumber: 5 });
    const res = await callTool(depsWith(reopen), 'issue_reopen', { number: 5, reason: 'r' }, ALICE);
    expect(reopen).toHaveBeenCalledWith(5, 'r', { actor: 'alice', isAdmin: false });
    expect((res as { result: { issueNumber: number } }).result).toEqual({ issueNumber: 5 });
  });
});
