// UT (v5 slice, REQ-027..030): IssueReporter — files a structured GitHub issue via an injectable
// GithubIssueClient, reads the token from the server-side SecretSource, renders an agent-consumable
// body, and bounds the API call with typed errors. Pure/injected — no real GitHub call.
import { describe, it, expect, vi } from 'vitest';
import { IssueReporter, renderIssueBody, createGithubIssueClient, GithubApiError, type GithubIssueClient } from '../../src/github/issue-reporter.js';
import type { SecretSource } from '../../src/secret-resolver.js';

const srcWith = (map: Record<string, string>): SecretSource => ({ resolve: (h) => map[h], names: () => Object.keys(map) });
const OK_INPUT = { title: 'Boom on resume', reproSteps: '1. run X\n2. resume', analysis: 'cache replay returns stale null' };
const META = { engineVersion: '1.2.3', nowIso: '2026-07-19T00:00:00Z' };

// v6: the client interface grew read/reply methods; the fake implements them all (defaults keep the
// v5 create-path behavior — findOpenByFingerprint returns null, so report() creates rather than dedups).
function fakeClient(over: Partial<GithubIssueClient> = {}): { client: GithubIssueClient; calls: Array<{ title: string; body: string; labels: string[] }> } {
  const calls: Array<{ title: string; body: string; labels: string[] }> = [];
  const client: GithubIssueClient = {
    async createIssue(i) { calls.push(i); return { number: 42, url: 'https://github.com/HsuJavis/remote-workflow-engine/issues/42' }; },
    async getIssue() { return null; },
    async listIssues() { return []; },
    async getComments() { return null; },
    async createComment() { return { commentId: 100, url: 'https://github.com/HsuJavis/remote-workflow-engine/issues/42#issuecomment-100' }; },
    async findOpenByFingerprint() { return null; },
    ...over,
  };
  return { calls, client };
}

describe('IssueReporter (REQ-027..030)', () => {
  it('REQ-027: files an issue and returns {issueNumber, url}', async () => {
    const { client, calls } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client, engineVersion: '1.2.3', nowIso: () => META.nowIso });
    const res = await r.report({ ...OK_INPUT, severity: 'high' });
    expect(res).toEqual({ ok: true, issueNumber: 42, url: 'https://github.com/HsuJavis/remote-workflow-engine/issues/42', deduped: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].title).toBe('Boom on resume');
  });

  it('REQ-027: missing/empty required field → ISSUE_REPORT_INVALID (field named), no API call', async () => {
    const { client, calls } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    for (const [field, input] of [
      ['title', { ...OK_INPUT, title: '' }],
      ['reproSteps', { ...OK_INPUT, reproSteps: '   ' }],
      ['analysis', { ...OK_INPUT, analysis: undefined as unknown as string }],
    ] as const) {
      const res = await r.report(input);
      expect(res.ok).toBe(false);
      if (!res.ok) { expect(res.error.code).toBe('ISSUE_REPORT_INVALID'); expect(res.error.field).toBe(field); }
    }
    expect(calls).toHaveLength(0);
  });

  it('REQ-028: no token configured → GITHUB_TOKEN_MISSING, no API call, no leak', async () => {
    const { client, calls } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({}), clientImpl: client });
    const res = await r.report(OK_INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('GITHUB_TOKEN_MISSING');
    expect(calls).toHaveLength(0);
  });

  it('REQ-029: renders the fixed agent-consumable template with all sections + labels', async () => {
    const { client, calls } = fakeClient();
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client, engineVersion: '1.2.3', nowIso: () => META.nowIso });
    await r.report({ ...OK_INPUT, logs: 'ERR x', severity: 'high', component: 'run-manager', runId: 'run-9' });
    const body = calls[0].body;
    for (const section of ['## Summary', '## Reproduction steps', '## Logs', '## Analysis / root cause', '## Environment', '## Linked run']) {
      expect(body).toContain(section);
    }
    expect(body).toContain('1.2.3');           // engine version
    expect(body).toContain('2026-07-19');       // timestamp
    expect(body).toContain('run-9');            // linked run
    expect(calls[0].labels).toContain('agent-reported');
    expect(calls[0].labels).toContain('severity:high');
  });

  it('REQ-029: renderIssueBody omits the Linked run section when no runId', () => {
    const body = renderIssueBody({ ...OK_INPUT }, META);
    expect(body).not.toContain('## Linked run');
    expect(body).toContain('## Summary');
  });

  it('REQ-030: createGithubIssueClient posts to the repo issues endpoint and returns {number,url}', async () => {
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe('https://api.github.com/repos/HsuJavis/remote-workflow-engine/issues');
      expect(init.headers.authorization).toBe('Bearer tkn');
      return { ok: true, status: 201, async json() { return { number: 5, html_url: 'https://x/5' }; } } as unknown as Response;
    });
    const client = createGithubIssueClient({ token: 'tkn', repo: 'HsuJavis/remote-workflow-engine', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.createIssue({ title: 't', body: 'b', labels: ['agent-reported'] })).toEqual({ number: 5, url: 'https://x/5' });
  });

  it('REQ-030: createGithubIssueClient maps a non-2xx to GithubApiError (no retry on 4xx)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 422, async text() { return 'Validation failed'; } }) as unknown as Response);
    const client = createGithubIssueClient({ token: 't', repo: 'o/r', fetchImpl: fetchImpl as unknown as typeof fetch, retries: 2 });
    await expect(client.createIssue({ title: 't', body: 'b', labels: [] })).rejects.toBeInstanceOf(GithubApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 422 is not retried
  });

  it('REQ-030: createGithubIssueClient surfaces a network error as GithubApiError after retries', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const client = createGithubIssueClient({ token: 't', repo: 'o/r', fetchImpl: fetchImpl as unknown as typeof fetch, retries: 1 });
    await expect(client.createIssue({ title: 't', body: 'b', labels: [] })).rejects.toBeInstanceOf(GithubApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('REQ-030: a GithubIssueClient failure → GITHUB_API_ERROR envelope, never a throw', async () => {
    const { client } = fakeClient({ async createIssue() { throw Object.assign(new Error('422 Unprocessable'), { code: 'GITHUB_API_ERROR', status: 422 }); } });
    const r = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 't' }), clientImpl: client });
    const res = await r.report(OK_INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.error.code).toBe('GITHUB_API_ERROR'); expect(res.error.message).toMatch(/422/); }
  });
});
