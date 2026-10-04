// UT (issue #130): `issue_report({runId})` used to attach that run's diagnostics with NO ownership
// check at all (server.ts's `runDiagnostics` read the store through a god-mode `auth-disabled`
// principal regardless of who actually called the tool) — any principal who learned another
// principal's runId could publish excerpts of its transcript to the PUBLIC GitHub issue tracker.
//
// Fix: `issue_report`'s authz row (tool-specs.ts) is now MODED exactly like workspace_push/list/
// delete — a `runId` resolves to the SAME `ownership:'run'` row run_status itself uses, so
// `authorize()` (authz.ts, already exhaustively covered by tests/unit/authz.test.ts's matrix)
// refuses a non-owner/non-admin NOT_RUN_OWNER before `call-tool.ts`'s dispatch switch is ever
// reached — `deps.issueReporter.report` is provably never called. `call-tool.ts` additionally
// answers RUN_NOT_FOUND for a runId that does not exist at all (the one case authz's own tri-state
// deliberately lets through to the handler, same as every other `ownership:'run'` tool).
//
// This file tests the INTEGRATION (tool-specs.ts's row + call-tool.ts's dispatch + the real
// authz.ts), not authz.ts's own decision table again — that is authz.test.ts's job.
// Mock policy (unit): a fake IssueReporter/OwnerLookup; no real GitHub call, no real store.
import { describe, it, expect, vi } from 'vitest';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';
import type { OwnerLookup, Principal } from '../../src/authz.js';

const NOOP_LOOKUP: OwnerLookup = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };

function depsWith(runOwner: OwnerLookup['runOwner'], reportResult: unknown = { ok: true, issueNumber: 1, url: 'https://x/1', deduped: false }): { deps: ToolDeps; report: ReturnType<typeof vi.fn> } {
  const report = vi.fn().mockResolvedValue(reportResult);
  const deps = {
    facade: {},
    lookup: { ...NOOP_LOOKUP, runOwner },
    audit: {},
    issueReporter: { report },
  } as unknown as ToolDeps;
  return { deps, report };
}

const ALICE: Principal = { kind: 'user', id: 'alice' };
const BOB: Principal = { kind: 'user', id: 'bob' };
const ADMIN: Principal = { kind: 'admin', id: 'root' };
const SERVICE_ACCOUNT: Principal = { kind: 'user', id: 'sa:ci-bot' };

const OK_ARGS = { title: 'Boom', reproSteps: 'do X', analysis: 'root cause', runId: 'run-1' };

type ToolEnvelope = { error?: { code?: string | number; message?: string }; result?: { issueNumber: number } };

describe('issue #130 — issue_report({runId}) ownership (integration: tool-specs.ts + call-tool.ts + authz.ts)', () => {
  it('the owner may attach their own run — issueReporter.report is called', async () => {
    const { deps, report } = depsWith(() => 'alice');
    const res = (await callTool(deps, 'issue_report', OK_ARGS, ALICE)) as ToolEnvelope;
    expect(res.error).toBeUndefined();
    expect(res.result?.issueNumber).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('an admin may attach ANY run — issueReporter.report is called', async () => {
    const { deps, report } = depsWith(() => 'alice');
    const res = (await callTool(deps, 'issue_report', OK_ARGS, ADMIN)) as ToolEnvelope;
    expect(res.error).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("a non-owner is refused NOT_RUN_OWNER and NOTHING is filed — the fake reporter is never called", async () => {
    const { deps, report } = depsWith(() => 'alice');
    const res = (await callTool(deps, 'issue_report', OK_ARGS, BOB)) as ToolEnvelope;
    expect(res.error?.code).toBe('NOT_RUN_OWNER');
    expect(report).not.toHaveBeenCalled();
  });

  it('a nonexistent runId answers RUN_NOT_FOUND — exactly as run_status would — and nothing is filed', async () => {
    const { deps, report } = depsWith(() => undefined);
    const res = (await callTool(deps, 'issue_report', OK_ARGS, ALICE)) as ToolEnvelope;
    expect(res.error?.code).toBe('RUN_NOT_FOUND');
    expect(report).not.toHaveBeenCalled();
  });

  it('an ownerless (legacy) run is admin-only: a regular user is refused NOT_RUN_OWNER, nothing filed', async () => {
    const { deps, report } = depsWith(() => null);
    const res = (await callTool(deps, 'issue_report', OK_ARGS, ALICE)) as ToolEnvelope;
    expect(res.error?.code).toBe('NOT_RUN_OWNER');
    expect(report).not.toHaveBeenCalled();
  });

  it('an ownerless (legacy) run is admin-only: admin succeeds', async () => {
    const { deps, report } = depsWith(() => null);
    const res = (await callTool(deps, 'issue_report', OK_ARGS, ADMIN)) as ToolEnvelope;
    expect(res.error).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('a service-account principal that owns the run succeeds — same rule, no special-casing', async () => {
    const { deps, report } = depsWith(() => 'sa:ci-bot');
    const res = (await callTool(deps, 'issue_report', OK_ARGS, SERVICE_ACCOUNT)) as ToolEnvelope;
    expect(res.error).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("a service-account principal that does NOT own the run is refused NOT_RUN_OWNER, nothing filed", async () => {
    const { deps, report } = depsWith(() => 'alice');
    const res = (await callTool(deps, 'issue_report', OK_ARGS, SERVICE_ACCOUNT)) as ToolEnvelope;
    expect(res.error?.code).toBe('NOT_RUN_OWNER');
    expect(report).not.toHaveBeenCalled();
  });

  it('omitting runId entirely needs no ownership at all — a bare report still succeeds for any user', async () => {
    const { deps, report } = depsWith(() => { throw new Error('runOwner must not be consulted when no runId is given'); });
    const { runId: _runId, ...bareArgs } = OK_ARGS;
    const res = (await callTool(deps, 'issue_report', bareArgs, BOB)) as ToolEnvelope;
    expect(res.error).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
