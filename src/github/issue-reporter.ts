// IssueReporter (v5 slice, REQ-027..030 / ARCH-023): the `issue_report` MCP tool's engine-side core.
// v6 slice (REQ-031..036): extended with the read/reply GitHub-issue primitives the
// "report -> agent solves it" flow needs (issue_get/list/comments/comment), plus two upgrades to
// issue_report — de-dup (REQ-035) and runId diagnostics enrichment (REQ-036).
// A connected client/agent supplies a pre-analyzed, structured problem report; this files ONE GitHub
// issue into the engine's own repo with an agent-consumable body — the intake side of a future
// "report -> agent solves it" flow. Parent-side only: the GitHub token is read from the server-side
// SecretSource (REQ-018/REQ-028), never from a run workspace or the untrusted sandbox.
import { createHash } from 'node:crypto';
import type { SecretSource } from '../secret-resolver.js';

const DEFAULT_REPO = 'HsuJavis/remote-workflow-engine';
const GITHUB_API = 'https://api.github.com';
const TOKEN_SECRET_NAME = 'GITHUB_TOKEN'; // resolved from RWE_SECRET_GITHUB_TOKEN
const REPORTED_LABEL = 'agent-reported';
const REQUIRED_FIELDS = ['title', 'reproSteps', 'analysis'] as const;
// REQ-032: bound the list so a huge repo can never return unbounded.
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 100;

/** Caller-supplied, pre-analyzed problem report (the agent has already reproduced/confirmed it). */
export interface IssueReportInput {
  title: string;
  reproSteps: string;
  analysis: string;
  logs?: string;
  severity?: string;
  component?: string;
  runId?: string;
}

export type IssueReportResult =
  | { ok: true; issueNumber: number; url: string; deduped: boolean }
  | { ok: false; error: IssueError };

export interface IssueError {
  code: string;
  message: string;
  field?: string;
}

/** REQ-031: a single issue's full view. */
export interface IssueView {
  number: number;
  title: string;
  state: string;
  labels: string[];
  body: string;
  url: string;
  commentCount: number;
}

/** REQ-032: a bounded list entry (no body/commentCount — cheaper enumeration). */
export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  labels: string[];
  url: string;
}

/** REQ-033: one comment in an issue's conversation. */
export interface CommentView {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

/** REQ-032: filter for issue_list. */
export interface IssueListFilter {
  labels?: string[];
  state?: string;
  since?: string;
  limit?: number;
}

export type IssueGetResult = { ok: true; issue: IssueView } | { ok: false; error: IssueError };
export type IssueListResult = { ok: true; issues: IssueSummary[] } | { ok: false; error: IssueError };
export type IssueCommentsResult = { ok: true; comments: CommentView[] } | { ok: false; error: IssueError };
export type IssueCommentResult = { ok: true; commentId: number; url: string } | { ok: false; error: IssueError };

/** Injectable port over GitHub's Issues API — a fake in unit tests, the real bounded client in prod.
 *  Read methods that hit a non-existent issue return `null` (mapped to ISSUE_NOT_FOUND upstream)
 *  rather than throwing; any other non-2xx / network error surfaces as a GithubApiError. */
export interface GithubIssueClient {
  createIssue(input: { title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }>;
  getIssue(number: number): Promise<IssueView | null>;
  listIssues(filter: IssueListFilter): Promise<IssueSummary[]>;
  getComments(number: number): Promise<CommentView[] | null>;
  createComment(number: number, body: string): Promise<{ commentId: number; url: string } | null>;
  /** REQ-035: the number of an OPEN issue carrying the given de-dup fingerprint, or null. */
  findOpenByFingerprint(fp: string): Promise<number | null>;
}

export interface IssueReporterConfig {
  secretSource: SecretSource;
  /** Fixed target repo `owner/name`; defaults to the engine's own repo. */
  repo?: string;
  engineVersion?: string;
  /** Test seam: an explicit client bypasses createGithubIssueClient (no real fetch). */
  clientImpl?: GithubIssueClient;
  /** Real-client knobs (ignored when clientImpl is set). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  /** Injectable clock for a deterministic issue timestamp in tests. */
  nowIso?: () => string;
  /** REQ-036: best-effort engine-side diagnostics for a runId, appended to the issue body's
   *  `## Linked run` section. A null/throw NEVER fails the report (enrichment is opportunistic). */
  runDiagnostics?: (runId: string) => Promise<string | null>;
}

/** REQ-035: a stable fingerprint over (normalized title + component) so the same problem, re-reported,
 *  lands on the existing open issue instead of spamming a duplicate. */
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}
export function issueFingerprint(title: string, component?: string): string {
  return createHash('sha256').update(normalizeTitle(title) + '|' + (component ?? '')).digest('hex').slice(0, 16);
}

/** REQ-029: the FIXED, machine-parseable template a downstream issue-solving agent can reproduce from. */
export function renderIssueBody(
  input: IssueReportInput,
  meta: { engineVersion: string; nowIso: string; fp?: string; diagnostics?: string | null },
): string {
  const parts = [
    `## Summary`,
    input.title,
    ``,
    `## Reproduction steps`,
    input.reproSteps,
    ``,
    `## Logs`,
    input.logs && input.logs.trim() ? '```\n' + input.logs + '\n```' : '_none provided_',
    ``,
    `## Analysis / root cause`,
    input.analysis,
    ``,
    `## Environment`,
    `- engine version: ${meta.engineVersion}`,
    `- reported at: ${meta.nowIso}`,
    input.severity ? `- severity: ${input.severity}` : undefined,
    input.component ? `- component: ${input.component}` : undefined,
  ].filter((l) => l !== undefined) as string[];
  if (input.runId) {
    parts.push(``, `## Linked run`, `- runId: ${input.runId}`);
    // REQ-036: append real engine-side diagnostics (status / artifacts / transcript tail) when present.
    if (meta.diagnostics && meta.diagnostics.trim()) {
      parts.push(``, meta.diagnostics.trim());
    }
  }
  parts.push(``, `---`, `_Filed by the remote-workflow-engine \`issue_report\` tool (agent-reported)._`);
  // REQ-035: hidden de-dup marker findOpenByFingerprint searches for (`in:body "rwe-fp:<fp>"`).
  if (meta.fp) parts.push(`<!-- rwe-fp:${meta.fp} -->`);
  return parts.join('\n');
}

/** Typed GitHub API failure — carried across the tool boundary as GITHUB_API_ERROR (REQ-030). */
export class GithubApiError extends Error {
  readonly code = 'GITHUB_API_ERROR' as const;
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GithubApiError';
  }
}

function mapLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels.map((l) =>
    typeof l === 'string' ? l : l && typeof l === 'object' && 'name' in l ? String((l as { name: unknown }).name) : String(l),
  );
}

/** REQ-030: a bounded (timeout + retries) GitHub Issues client. Any non-2xx / network error / timeout,
 *  after the retry budget, surfaces as a GithubApiError — never a hang, never a fake success. Read
 *  methods map a 404 to `null` (a missing issue is not an error at this layer). */
export function createGithubIssueClient(opts: {
  token: string;
  repo: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}): GithubIssueClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const retries = opts.retries ?? 1;

  // Bounded fetch: retries only on a retryable status (5xx / 429) or a network error; otherwise
  // returns the Response for the caller to interpret (2xx, or a 4xx like 404/422). Only a network
  // error that outlives the retry budget throws a GithubApiError here.
  async function ghFetch(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${GITHUB_API}${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${opts.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'remote-workflow-engine',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        if (res.ok) return res;
        const retryable = res.status >= 500 || res.status === 429;
        if (retryable && attempt < retries) {
          lastErr = new GithubApiError(`GitHub API ${res.status}`, res.status);
          continue;
        }
        return res; // non-retryable 4xx, or a retryable status with the budget exhausted
      } catch (err) {
        lastErr = err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new GithubApiError(`GitHub API unreachable: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }

  async function fail(res: Response): Promise<never> {
    const text = await res.text().catch(() => '');
    throw new GithubApiError(`GitHub API ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  // A read/write that must surface every non-2xx (no 404->null) — returns parsed JSON.
  async function ghJson(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await ghFetch(method, path, body);
    if (!res.ok) await fail(res);
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    async createIssue({ title, body, labels }) {
      const json = await ghJson('POST', `/repos/${opts.repo}/issues`, { title, body, labels });
      return { number: json.number as number, url: json.html_url as string };
    },

    async getIssue(number) {
      const res = await ghFetch('GET', `/repos/${opts.repo}/issues/${number}`);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res);
      const j = (await res.json()) as Record<string, unknown>;
      return {
        number: j.number as number,
        title: (j.title as string) ?? '',
        state: (j.state as string) ?? '',
        labels: mapLabels(j.labels),
        body: (j.body as string) ?? '',
        url: j.html_url as string,
        commentCount: (j.comments as number) ?? 0,
      };
    },

    async listIssues(filter) {
      const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT);
      const params = new URLSearchParams();
      params.set('state', filter.state ?? 'open');
      if (filter.labels && filter.labels.length) params.set('labels', filter.labels.join(','));
      if (filter.since) params.set('since', filter.since);
      params.set('per_page', String(limit));
      const json = (await ghJson('GET', `/repos/${opts.repo}/issues?${params.toString()}`)) as unknown;
      const arr = Array.isArray(json) ? (json as Array<Record<string, unknown>>) : [];
      // GitHub's list-issues endpoint returns PRs too; a PR carries `pull_request`. Drop them.
      return arr
        .filter((it) => it.pull_request === undefined)
        .slice(0, limit)
        .map((it) => ({
          number: it.number as number,
          title: (it.title as string) ?? '',
          state: (it.state as string) ?? '',
          labels: mapLabels(it.labels),
          url: it.html_url as string,
        }));
    },

    async getComments(number) {
      const res = await ghFetch('GET', `/repos/${opts.repo}/issues/${number}/comments`);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res);
      const arr = (await res.json()) as Array<Record<string, unknown>>;
      return (Array.isArray(arr) ? arr : []).map((c) => ({
        id: c.id as number,
        author: ((c.user as { login?: string } | undefined)?.login) ?? '',
        body: (c.body as string) ?? '',
        createdAt: (c.created_at as string) ?? '',
      }));
    },

    async createComment(number, body) {
      const res = await ghFetch('POST', `/repos/${opts.repo}/issues/${number}/comments`, { body });
      if (res.status === 404) return null;
      if (!res.ok) await fail(res);
      const j = (await res.json()) as Record<string, unknown>;
      return { commentId: j.id as number, url: j.html_url as string };
    },

    async findOpenByFingerprint(fp) {
      const q = `repo:${opts.repo} is:issue is:open in:body "rwe-fp:${fp}"`;
      const json = await ghJson('GET', `/search/issues?q=${encodeURIComponent(q)}`);
      const items = Array.isArray(json.items) ? (json.items as Array<Record<string, unknown>>) : [];
      return items.length ? (items[0].number as number) : null;
    },
  };
}

export class IssueReporter {
  constructor(private readonly cfg: IssueReporterConfig) {}

  // REQ-028: token ONLY from the server-side secret store; missing -> typed error, never a leak/no-op.
  private resolveToken(): { ok: true; token: string } | { ok: false; error: IssueError } {
    const token = this.cfg.secretSource.resolve(TOKEN_SECRET_NAME);
    if (token === undefined || token === '') {
      return { ok: false, error: { code: 'GITHUB_TOKEN_MISSING', message: `GitHub token not configured (set RWE_SECRET_${TOKEN_SECRET_NAME})` } };
    }
    return { ok: true, token };
  }

  private resolveClient(token: string): GithubIssueClient {
    return (
      this.cfg.clientImpl ??
      createGithubIssueClient({ token, repo: this.cfg.repo ?? DEFAULT_REPO, fetchImpl: this.cfg.fetchImpl, timeoutMs: this.cfg.timeoutMs, retries: this.cfg.retries })
    );
  }

  // REQ-030: any client failure resolves to a typed envelope — never throws across the tool boundary.
  private apiError(err: unknown): { ok: false; error: IssueError } {
    const code =
      err instanceof Error && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : 'GITHUB_API_ERROR';
    return { ok: false, error: { code, message: err instanceof Error ? err.message : String(err) } };
  }

  async report(input: IssueReportInput): Promise<IssueReportResult> {
    // REQ-027: fail-fast validation — no partial/no-op GitHub call on a bad request.
    for (const field of REQUIRED_FIELDS) {
      const v = (input as unknown as Record<string, unknown>)[field];
      if (typeof v !== 'string' || v.trim() === '') {
        return { ok: false, error: { code: 'ISSUE_REPORT_INVALID', field, message: `issue_report requires a non-empty '${field}'` } };
      }
    }

    const tok = this.resolveToken();
    if (!tok.ok) return tok;

    const repo = this.cfg.repo ?? DEFAULT_REPO;
    const fp = issueFingerprint(input.title, input.component);
    // REQ-036: best-effort enrichment — a null/throw NEVER fails the report.
    let diagnostics: string | null = null;
    if (input.runId && this.cfg.runDiagnostics) {
      diagnostics = await this.cfg.runDiagnostics(input.runId).catch(() => null);
    }
    const body = renderIssueBody(input, {
      engineVersion: this.cfg.engineVersion ?? 'unknown',
      nowIso: (this.cfg.nowIso ?? (() => new Date().toISOString()))(),
      fp,
      diagnostics,
    });
    // REQ-029: fixed intake label + optional severity label so the solve-flow can query these.
    const labels = [REPORTED_LABEL, ...(input.severity ? [`severity:${input.severity}`] : [])];
    const client = this.resolveClient(tok.token);

    try {
      // REQ-035: an OPEN issue with this fingerprint already exists -> comment on it, don't duplicate.
      const dup = await client.findOpenByFingerprint(fp);
      if (dup !== null) {
        const commented = await client.createComment(dup, body);
        if (commented !== null) {
          return { ok: true, issueNumber: dup, url: `https://github.com/${repo}/issues/${dup}`, deduped: true };
        }
        // The dup vanished between search and comment (closed/deleted) — fall through and create fresh.
      }
      const { number, url } = await client.createIssue({ title: input.title, body, labels });
      return { ok: true, issueNumber: number, url, deduped: false };
    } catch (err) {
      return this.apiError(err);
    }
  }

  /** REQ-031: read a single issue. Missing -> ISSUE_NOT_FOUND; token missing -> GITHUB_TOKEN_MISSING. */
  async getIssue(number: number): Promise<IssueGetResult> {
    const tok = this.resolveToken();
    if (!tok.ok) return tok;
    try {
      const issue = await this.resolveClient(tok.token).getIssue(number);
      if (issue === null) return { ok: false, error: { code: 'ISSUE_NOT_FOUND', message: `Issue not found: #${number}` } };
      return { ok: true, issue };
    } catch (err) {
      return this.apiError(err);
    }
  }

  /** REQ-032: enumerate issues (bounded) for the solve-flow to pick up work. */
  async listIssues(filter: IssueListFilter): Promise<IssueListResult> {
    const tok = this.resolveToken();
    if (!tok.ok) return tok;
    try {
      const issues = await this.resolveClient(tok.token).listIssues(filter ?? {});
      return { ok: true, issues };
    } catch (err) {
      return this.apiError(err);
    }
  }

  /** REQ-033: read an issue's comment thread (prior attempts). Unknown number -> ISSUE_NOT_FOUND. */
  async getComments(number: number): Promise<IssueCommentsResult> {
    const tok = this.resolveToken();
    if (!tok.ok) return tok;
    try {
      const comments = await this.resolveClient(tok.token).getComments(number);
      if (comments === null) return { ok: false, error: { code: 'ISSUE_NOT_FOUND', message: `Issue not found: #${number}` } };
      return { ok: true, comments };
    } catch (err) {
      return this.apiError(err);
    }
  }

  /** REQ-034: post a reply. Empty body -> ISSUE_COMMENT_INVALID; unknown number -> ISSUE_NOT_FOUND. */
  async postComment(number: number, body: string): Promise<IssueCommentResult> {
    const tok = this.resolveToken();
    if (!tok.ok) return tok;
    if (typeof body !== 'string' || body.trim() === '') {
      return { ok: false, error: { code: 'ISSUE_COMMENT_INVALID', field: 'body', message: 'issue_comment requires a non-empty body' } };
    }
    try {
      const r = await this.resolveClient(tok.token).createComment(number, body);
      if (r === null) return { ok: false, error: { code: 'ISSUE_NOT_FOUND', message: `Issue not found: #${number}` } };
      return { ok: true, commentId: r.commentId, url: r.url };
    } catch (err) {
      return this.apiError(err);
    }
  }
}
