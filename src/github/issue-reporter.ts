// IssueReporter (v5 slice, REQ-027..030 / ARCH-023): the `issue_report` MCP tool's engine-side core.
// A connected client/agent supplies a pre-analyzed, structured problem report; this files ONE GitHub
// issue into the engine's own repo with an agent-consumable body — the intake side of a future
// "report → agent solves it" flow. Parent-side only: the GitHub token is read from the server-side
// SecretSource (REQ-018/REQ-028), never from a run workspace or the untrusted sandbox.
import type { SecretSource } from '../secret-resolver.js';

const DEFAULT_REPO = 'HsuJavis/remote-workflow-engine';
const GITHUB_API = 'https://api.github.com';
const TOKEN_SECRET_NAME = 'GITHUB_TOKEN'; // resolved from RWE_SECRET_GITHUB_TOKEN
const REPORTED_LABEL = 'agent-reported';
const REQUIRED_FIELDS = ['title', 'reproSteps', 'analysis'] as const;

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
  | { ok: true; issueNumber: number; url: string }
  | { ok: false; error: { code: string; message: string; field?: string } };

/** Injectable port over GitHub's create-issue API — a fake in unit tests, the real bounded client in prod. */
export interface GithubIssueClient {
  createIssue(input: { title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }>;
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
}

/** REQ-029: the FIXED, machine-parseable template a downstream issue-solving agent can reproduce from. */
export function renderIssueBody(input: IssueReportInput, meta: { engineVersion: string; nowIso: string }): string {
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
  }
  parts.push(``, `---`, `_Filed by the remote-workflow-engine \`issue_report\` tool (agent-reported)._`);
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

/** REQ-030: a bounded (timeout + retries) create-issue client. Any non-2xx / network error / timeout,
 *  after the retry budget, surfaces as a GithubApiError — never a hang, never a fake success. */
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
  return {
    async createIssue({ title, body, labels }) {
      const url = `${GITHUB_API}/repos/${opts.repo}/issues`;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetchImpl(url, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${opts.token}`,
              accept: 'application/vnd.github+json',
              'x-github-api-version': '2022-11-28',
              'user-agent': 'remote-workflow-engine',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ title, body, labels }),
            signal: ctrl.signal,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            // 4xx (except 429) is not retryable — a bad request won't fix itself.
            if (res.status < 500 && res.status !== 429) {
              throw new GithubApiError(`GitHub API ${res.status}: ${text.slice(0, 300)}`, res.status);
            }
            lastErr = new GithubApiError(`GitHub API ${res.status}: ${text.slice(0, 300)}`, res.status);
            continue;
          }
          const json = (await res.json()) as { number: number; html_url: string };
          return { number: json.number, url: json.html_url };
        } catch (err) {
          if (err instanceof GithubApiError && err.status !== undefined && err.status < 500 && err.status !== 429) throw err;
          lastErr = err;
        } finally {
          clearTimeout(timer);
        }
      }
      if (lastErr instanceof GithubApiError) throw lastErr;
      throw new GithubApiError(`GitHub API unreachable: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    },
  };
}

export class IssueReporter {
  constructor(private readonly cfg: IssueReporterConfig) {}

  async report(input: IssueReportInput): Promise<IssueReportResult> {
    // REQ-027: fail-fast validation — no partial/no-op GitHub call on a bad request.
    for (const field of REQUIRED_FIELDS) {
      const v = (input as unknown as Record<string, unknown>)[field];
      if (typeof v !== 'string' || v.trim() === '') {
        return { ok: false, error: { code: 'ISSUE_REPORT_INVALID', field, message: `issue_report requires a non-empty '${field}'` } };
      }
    }

    // REQ-028: token ONLY from the server-side secret store; missing → typed error, never a leak/no-op.
    const token = this.cfg.secretSource.resolve(TOKEN_SECRET_NAME);
    if (token === undefined || token === '') {
      return { ok: false, error: { code: 'GITHUB_TOKEN_MISSING', message: `GitHub token not configured (set RWE_SECRET_${TOKEN_SECRET_NAME})` } };
    }

    const repo = this.cfg.repo ?? DEFAULT_REPO;
    const body = renderIssueBody(input, {
      engineVersion: this.cfg.engineVersion ?? 'unknown',
      nowIso: (this.cfg.nowIso ?? (() => new Date().toISOString()))(),
    });
    // REQ-029: fixed intake label + optional severity label so the solve-flow can query these.
    const labels = [REPORTED_LABEL, ...(input.severity ? [`severity:${input.severity}`] : [])];

    const client =
      this.cfg.clientImpl ??
      createGithubIssueClient({ token, repo, fetchImpl: this.cfg.fetchImpl, timeoutMs: this.cfg.timeoutMs, retries: this.cfg.retries });

    // REQ-030: any client failure resolves to a typed envelope — never throws across the tool boundary.
    try {
      const { number, url } = await client.createIssue({ title: input.title, body, labels });
      return { ok: true, issueNumber: number, url };
    } catch (err) {
      const code = err instanceof Error && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : 'GITHUB_API_ERROR';
      return { ok: false, error: { code, message: err instanceof Error ? err.message : String(err) } };
    }
  }
}
