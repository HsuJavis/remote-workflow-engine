// IT (v5 slice, REQ-027..030): issue_report over the real MCP HTTP surface. Uses a real IssueReporter
// with a FAKE GithubIssueClient (no real GitHub call) injected via ServerConfig; a second server with
// NO token configured exercises the real composition-root default wiring (GITHUB_TOKEN_MISSING).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { IssueReporter, type GithubIssueClient } from '../../src/github/issue-reporter.js';
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

describe('issue_report over the real MCP HTTP surface (REQ-027..030)', () => {
  let server: Server; let baseUrl: string;
  const calls: Array<{ title: string; body: string; labels: string[] }> = [];
  const fakeClient: GithubIssueClient = { async createIssue(i) { calls.push(i); return { number: 7, url: 'https://github.com/HsuJavis/remote-workflow-engine/issues/7' }; } };

  beforeAll(async () => {
    const issueReporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 'tkn' }), clientImpl: fakeClient, engineVersion: '9.9.9', nowIso: () => '2026-07-19T00:00:00Z' });
    server = await createServer({ port: 0, bind: '127.0.0.1', issueReporter });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => { await server?.close(); });

  it('tools/list advertises issue_report', async () => {
    const body = await rpc(baseUrl, 'tools/list', {});
    expect((body.result!.tools ?? []).map((t) => t.name)).toContain('issue_report');
  });

  it('files an issue and returns {issueNumber, url}; body carries the structured template', async () => {
    const res = await toolCall(baseUrl, 'issue_report', { title: 'X breaks', reproSteps: 'do X', analysis: 'root cause Y', severity: 'high', runId: 'run-1' });
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ issueNumber: 7, url: 'https://github.com/HsuJavis/remote-workflow-engine/issues/7' });
    expect(calls).toHaveLength(1);
    expect(calls[0].labels).toEqual(expect.arrayContaining(['agent-reported', 'severity:high']));
    expect(calls[0].body).toContain('## Reproduction steps');
    expect(calls[0].body).toContain('run-1');
  });

  it('missing required field → ISSUE_REPORT_INVALID envelope, no issue filed', async () => {
    const before = calls.length;
    const res = await toolCall(baseUrl, 'issue_report', { title: 'no repro', analysis: 'a' });
    expect(res.error?.code).toBe('ISSUE_REPORT_INVALID');
    expect(calls.length).toBe(before);
  });
});

describe('issue_report default wiring: no token → GITHUB_TOKEN_MISSING (REQ-028)', () => {
  it('a server with no RWE_SECRET_GITHUB_TOKEN returns a typed token-missing envelope', async () => {
    const saved = process.env.RWE_SECRET_GITHUB_TOKEN;
    delete process.env.RWE_SECRET_GITHUB_TOKEN;
    const server = await createServer({ port: 0, bind: '127.0.0.1' }); // real default IssueReporter
    try {
      const res = await toolCall(`http://127.0.0.1:${server.port}`, 'issue_report', { title: 't', reproSteps: 's', analysis: 'a' });
      expect(res.error?.code).toBe('GITHUB_TOKEN_MISSING');
    } finally {
      await server.close();
      if (saved !== undefined) process.env.RWE_SECRET_GITHUB_TOKEN = saved;
    }
  });
});
