// IT-165 (DES-192, ADR-054, TASK-197, REQ-140/141/136): what the dashboard discloses is pinned by
// ONE golden key-set test per (endpoint x outcome), not by per-route review every iteration
// (ADR-054's decision (b)). `keys ⊆ ALLOWED` catches an undeclared addition; `REQUIRED ⊆ keys`
// keeps it honest about optionality (a field omitted-together is not a violation).
//
// This file ALSO carries REQ-136's three-conjunct oracle (DES-192's own placement: "so disclosure
// and confidentiality cannot drift apart") — asserted against the REAL response BODY of both
// transports (HTTP + MCP `run_agent_log`), never against the decorator's return value. This is the
// v27 real-tier path for REQ-136 (04-design.md's own table names no separate browser file for it)
// and doubles as VAL-203.
//
// Mock policy (integration, DES-192/per-tier v27): real createServer() + real MCP HTTP + real
// agentType composition root (agents/*.md frontmatter) + a real local HTTP stub standing in for the
// one genuinely un-runnable third-party network boundary (the model provider) — same technique as
// IT-016/agent-type-composition-root.test.ts.
//
// [v28 Gate 5/6, DES-218, TASK-219, REQ-137/138/139] IT-165 gains four rows this iteration: `GET
// /api/system (ok)` and `(per-section degraded)` (`SYSTEM_OK`/`SYSTEM_SECTION_DEGRADED`,
// `tests/fixtures/dashboard-wire.ts`), `GET /api/models[i] (ok)` (`MODEL_ENTRY_OK`), and `GET
// /api/issues (ok)` (`ISSUES_OK`) — all FOUR real bodies fetched in `beforeAll` above (`/api/system`
// and `/api/models` need no mock at all; `/api/issues` needs only the fake GitHub client boundary,
// `FAKE_ISSUE_CLIENT` above, the same convention as `FAKE_GATEWAY`). The system/models rows are
// GREEN today (the routes and their key sets are unchanged by v28 — ARCH-135's only change is the
// `topN` COUNT, tested in `dashboard-http.test.ts` separately) — recorded as Mode-C
// green-by-construction, not forced red: the row exists to LOCK the v28 key-set contract in place,
// and it is already true. `GET /api/issues (ok)` is genuinely new (TASK-219 mints `IssuesListView`
// in the same commit).
//
// Red reason (measured): `AgentLogView` does not exist in src/types.ts (whole-file import failure —
// `tests/fixtures/dashboard-wire.ts` fails `tsc --noEmit` on the missing export, which is DES-192's
// own "first test"); vitest/esbuild does not type-check so the runtime table below still executes,
// and fails behaviourally — today's `run_agent_log`/HTTP response carries no `record` key
// (REQUIRED_AGENT_LOG_OK_KEYS asserts it present) and RunSummary carries no `costUSD`/`lanes` etc.
// REQ-136's oracle is behaviourally red today: `agent-executor.ts` composes the agentType
// systemPrompt as segment 1 and puts it verbatim on `HarnessDescriptor.prompt`, which both
// transports return unchanged.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server, ServerConfig } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { IssueReporter, type GithubIssueClient } from '../../src/github/issue-reporter.js';
import type { SecretSource } from '../../src/secret-resolver.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';
import { DISCLOSURE_TABLE } from '../fixtures/dashboard-wire.js';

// v27c AC-1 repair (Gate 8 send-back): the pre-repair version of this test asserted
// `Object.keys(row.body)` against the FIXTURE'S OWN hand-written literal — no served body was ever
// checked, so an undeclared leak on any route would pass silently forever. This describe boots the
// SAME kind of real server the REQ-136 describe below already does, drives it through real MCP/HTTP
// calls, and asserts each row's ALLOWED/REQUIRED sets (still the fixture's — "keep the fixture as
// the allow-list") against the JSON the server actually served. `FAKE_GATEWAY` stands in only for
// the third-party model provider (same convention as usage-live-equals-fold.test.ts / IT-167); every
// other participant (server, store, MCP, HTTP) is real.
const FAKE_GATEWAY: GatewayClient = {
  invoke: async () => ({ ok: true, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { input: 10, output: 4 }, content: 'x' }),
};

// v28 (DES-218, TASK-219, REQ-139): GET /api/issues (ok) needs a real `ok:true` listIssues() call,
// which needs a resolvable token — `FAKE_ISSUE_CLIENT` stands in only for the third-party GitHub API
// boundary (same convention as FAKE_GATEWAY above and tests/integration/issue-ops-http.test.ts's
// `dashClient`); the partition into open/resolved (server.ts's own filter) is real.
const srcWith = (m: Record<string, string>): SecretSource => ({ resolve: (h) => m[h], names: () => Object.keys(m) });
const FAKE_ISSUE_CLIENT: GithubIssueClient = {
  async createIssue() { return { number: 1, url: 'https://x/1' }; },
  async getIssue() { return null; },
  async listIssues() {
    return [
      { number: 20, title: 'example open issue', state: 'open', labels: ['agent-reported'], url: 'https://x/20' },
      { number: 21, title: 'example resolved issue', state: 'closed', labels: ['agent-reported'], url: 'https://x/21' },
    ];
  },
  async getComments() { return null; },
  async createComment() { return null; },
  async findOpenByFingerprint() { return null; },
};

describe('dashboard disclosure key-set table (IT-165, ADR-054, DES-192)', () => {
  let discServer: Server;
  let discTmpDir: string;
  const realBodies: Record<string, Record<string, unknown>> = {};

  async function discMcpCall(name: string, args: unknown): Promise<any> {
    const res = await fetch(`http://127.0.0.1:${discServer.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  }

  async function runAndWait(name: string, script: string): Promise<string> {
    await registerPublishedVia(discMcpCall, name, script);
    const started = await discMcpCall('run_start', { name });
    const runId = started.runId as string;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const s = await discMcpCall('run_status', { runId });
      if (['completed', 'failed'].includes(s.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return runId;
  }

  beforeAll(async () => {
    discTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it165-disclosure-'));
    const issueReporter = new IssueReporter({ secretSource: srcWith({ GITHUB_TOKEN: 'tkn' }), clientImpl: FAKE_ISSUE_CLIENT });
    discServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: discTmpDir, gateway: FAKE_GATEWAY, issueReporter });
    const base = `http://127.0.0.1:${discServer.port}`;

    // ---- v28 (DES-218, TASK-219, REQ-138): GET /api/system, TWO real calls. `SystemInfoSampler`'s
    // `prev` sample is null on the FIRST call after boot (`system-info.ts:136-138`), which is a
    // REAL, naturally-occurring `cpu.utilizationDegraded:{reason:'awaiting-second-sample'}` — no
    // fault injection needed. The sampler caches for `ttlMs` (1500ms, `server.ts:892`), so the
    // SECOND call must wait past that TTL to force a genuinely fresh sample with a resolved
    // `utilizationPct`, never the cached first reading.
    const systemDegradedRes = await fetch(`${base}/api/system`);
    realBodies['GET /api/system (per-section degraded)'] = await systemDegradedRes.json();
    await new Promise((r) => setTimeout(r, 1700));
    const systemOkRes = await fetch(`${base}/api/system`);
    realBodies['GET /api/system (ok)'] = await systemOkRes.json();

    // ---- run with ONE agent() call: feeds run_agent_log (ok/facade-error), the HTTP agent-detail
    // row, the "priced" RunSummary row (ADR-052's four usage fields appear TOGETHER once ≥1 record
    // exists — the row's name is about key PRESENCE, not the dollar value) and the DAG row.
    const withAgentRunId = await runAndWait('it165-with-agent', `
      await agent('withagent', { prompt: 'p' });
      return 'ok';
    `);
    const withAgentStatus = await discMcpCall('run_status', { runId: withAgentRunId });
    const agentId = (withAgentStatus.result.agents as Array<{ agentId: string }>)[0]!.agentId;

    realBodies['run_agent_log (ok)'] = await discMcpCall('run_agent_log', { runId: withAgentRunId, label: 'withagent' });
    realBodies['run_agent_log (facade-error)'] = await discMcpCall('run_agent_log', { runId: withAgentRunId, label: 'does-not-exist' });
    const httpAgentRes = await fetch(`${base}/api/runs/${withAgentRunId}/agents/${agentId}`);
    realBodies['GET /api/runs/:id/agents/:agentId (http, ok)'] = await httpAgentRes.json();
    const dagRes = await fetch(`${base}/api/runs/${withAgentRunId}/dag`);
    realBodies['GET /api/runs/:id/dag'] = await dagRes.json();

    // ---- run with ZERO agent() calls: feeds the "no records" RunSummary row.
    const zeroRunId = await runAndWait('it165-zero-agents', `return 'no agents here';`);

    const runsRes = await fetch(`${base}/api/runs`);
    const runsList = (await runsRes.json()) as Array<Record<string, unknown>>;
    realBodies['GET /api/runs[i] (ok, priced)'] = runsList.find((r) => r['runId'] === withAgentRunId)!;
    realBodies['GET /api/runs[i] (ok, no records)'] = runsList.find((r) => r['runId'] === zeroRunId)!;

    const homeRes = await fetch(`${base}/api/home`);
    realBodies['GET /api/home'] = await homeRes.json();

    // v28 (DES-218, TASK-219, REQ-137): GET /api/models — the real static anthropic catalog table
    // (always included regardless of any catalog config), so this is a genuinely non-empty,
    // non-mocked `EnrichedModelEntry[]`.
    const modelsRes = await fetch(`${base}/api/models`);
    const modelsList = (await modelsRes.json()) as Array<Record<string, unknown>>;
    realBodies['GET /api/models[i] (ok)'] = modelsList[0]!;

    // v28 (DES-218, TASK-219, REQ-139): GET /api/issues — `issueReporter` above resolves a token and
    // a fake client, so `listIssues` returns `ok:true` and server.ts's own open/closed partition runs
    // for real over that list.
    const issuesRes = await fetch(`${base}/api/issues`);
    realBodies['GET /api/issues (ok)'] = await issuesRes.json();

    // Reachable-producer for the shared degrade path (server.ts:342-356/611-617): a malformed
    // %-encoded describe segment throws `URIError` inside handleDashboardRequest's own try, caught
    // by its own catch — the SAME "any /api/*" degrade shape every route falls back to on a fault
    // (DES-018: never a 500). Precedent: dashboard-http.test.ts's identical recipe.
    const degradedRes = await fetch(`${base}/api/workflows/%/describe`);
    realBodies['any /api/* (degraded)'] = await degradedRes.json();
  }, 30000);

  afterAll(async () => {
    await discServer?.close();
    rmSync(discTmpDir, { recursive: true, force: true });
  });

  it('every (endpoint x outcome) row satisfies keys ⊆ ALLOWED and REQUIRED ⊆ keys against the REAL SERVED BODY', () => {
    for (const row of DISCLOSURE_TABLE) {
      const body = realBodies[row.route];
      expect(body, `${row.route}/${row.outcome}: no real body was captured for this row`).toBeDefined();
      const keys = Object.keys(body!);
      const notAllowed = keys.filter((k) => !row.allowed.includes(k));
      expect(notAllowed, `${row.route}/${row.outcome}: undeclared key(s)`).toEqual([]);
      const missingRequired = row.required.filter((k) => !keys.includes(k));
      expect(missingRequired, `${row.route}/${row.outcome}: missing required key(s)`).toEqual([]);
    }
  });

  // v28 (DES-218, TASK-219, REQ-139): the key-set loop above cannot tell `GET /api/issues (ok)`
  // apart from the token-missing degraded arm — both satisfy the SAME allowed/required sets
  // (`degraded` is optional). This is the discriminating check: the `issueReporter` wired into
  // `discServer` above must have actually returned `ok:true`, not silently fallen back.
  it('GET /api/issues (ok) is the real ok arm, not the token-missing degraded arm', () => {
    const body = realBodies['GET /api/issues (ok)'] as { open: unknown[]; resolved: unknown[]; degraded?: string };
    expect(body).not.toHaveProperty('degraded');
    expect(body.open).toHaveLength(1);
    expect(body.resolved).toHaveLength(1);
  });
});

// v34 (DES-225, ARCH-137, ADR-061, TASK-229, REQ-203): the `REQ-136 (real run, both transports)`
// describe block that used to stand here — booting a real server with `agentDefinitionsDir` and
// dispatching `agent('r', { agentType: 'marked', ... })` — retires WITH the composition root it
// boots (`src/agent-definitions.ts`, `ServerConfig.agentDefinitionsDir`); neither compiles any
// more. 隨機制消失: REQ-136's own disclosure PROPERTY survives (the panel improves — with nothing to
// strip, `descriptor.prompt` is the gateway's verbatim echo of the whole prompt), re-verified by
// IT-175 (`tests/unit/dashboard-lib-agent.test.js`) against a legacy row instead of a live
// agentType run. **Named risk, not this task's to resolve** (per the v34 retirement register,
// 05-tests.md): VAL-211 was `real:true` Gate 7.5 evidence riding this exact block — its real-tier
// evidence cannot be re-run as specified once `agentType` is gone, so whoever next touches
// REQ-136/VAL-211 (Gate 1 or Gate 7.5) needs a new `real:true` path, most likely IT-175's
// legacy-row scenario read back off a genuinely upgraded deployment.

