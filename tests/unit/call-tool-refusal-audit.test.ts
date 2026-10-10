// Issue #116 (OWNER DECISION b, carrying decision a's shape rule into call-tool.ts): every
// `authorize()` refusal writes exactly one audit row and (unless masked) echoes the SAME
// requestId on the response envelope; a masked refusal's envelope is shaped EXACTLY like that
// tool's genuine `*_NOT_FOUND` answer and carries no requestId at all. Written test-first (RED):
// before this change, `callTool`'s refusal branch called `refusalEnvelope()` directly with no
// audit write and no requestId.
import { describe, it, expect, vi } from 'vitest';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';
import type { AuthzVerdict } from '../../src/authz.js';

function partialDeps(d: Record<string, unknown>): ToolDeps {
  return d as unknown as ToolDeps;
}

function fakeAuditStore() {
  const rows: Array<Record<string, unknown>> = [];
  return { rows, appendRefusal: vi.fn((ev: Record<string, unknown>) => { rows.push(ev); }), queryRefusals: vi.fn(() => rows) };
}

describe('callTool — authorize() refusal audit + requestId (issue #116)', () => {
  it('an UNMASKED refusal (FORBIDDEN_ROLE) writes one audit row and echoes its requestId in detail.requestId', async () => {
    const audit = fakeAuditStore();
    const verdict: AuthzVerdict = { ok: false, code: 'FORBIDDEN_ROLE', internalReason: 'FORBIDDEN_ROLE', reason: "role 'user' is below the required 'author'" };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, refusalAudit: audit, authorize: () => verdict });
    const result = await callTool(deps, 'workflow_deregister', { name: 'wf1' }, { kind: 'user', id: 'bob' }) as Record<string, unknown>;
    const error = result['error'] as { code: string; message: string; detail?: { requestId?: string } };
    expect(error.code).toBe('FORBIDDEN_ROLE');
    expect(typeof error.detail?.requestId).toBe('string');
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]).toMatchObject({ actor: 'bob', tool: 'workflow_deregister', realReason: 'FORBIDDEN_ROLE', returnedCode: 'FORBIDDEN_ROLE', requestId: error.detail!.requestId });
  });

  it('a MASKED refusal on run_status (RUN_NOT_FOUND) carries the REAL runId, no top-level code, no requestId in the body — byte-identical shape to mcp-facade.ts\'s own notFound()', async () => {
    const audit = fakeAuditStore();
    const verdict: AuthzVerdict = { ok: false, code: 'RUN_NOT_FOUND', internalReason: 'NOT_RUN_OWNER', reason: 'Run not found: r1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, refusalAudit: audit, authorize: () => verdict });
    const result = await callTool(deps, 'run_status', { runId: 'r1' }, { kind: 'user', id: 'bob' }) as Record<string, unknown>;
    expect(result).toEqual({ runId: 'r1', status: 'failed', error: { code: 'RUN_NOT_FOUND', message: 'Run not found: r1' } });
    expect(audit.rows[0]).toMatchObject({ realReason: 'NOT_RUN_OWNER', returnedCode: 'RUN_NOT_FOUND', targetKind: 'run', targetId: 'r1' });
  });

  it('a MASKED refusal on run_agent_log carries the three always-present fields the real handler sets', async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'RUN_NOT_FOUND', internalReason: 'NOT_RUN_OWNER', reason: 'Run not found: r1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'run_agent_log', { runId: 'r1', agentId: 'a1' }, { kind: 'user', id: 'bob' }) as Record<string, unknown>;
    expect(result).toEqual({ runId: 'r1', status: 'failed', error: { code: 'RUN_NOT_FOUND', message: 'Run not found: r1' }, harness: null, events: [], hasMore: false });
  });

  it.each(['schedule_delete', 'webhook_delete'])('a MASKED refusal on %s is the bare {error} shape, no runId/status/top-level code', async (toolName) => {
    const verdict: AuthzVerdict = { ok: false, code: 'TRIGGER_NOT_FOUND', internalReason: 'NOT_TRIGGER_OWNER', reason: 'Unknown schedule: t1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, toolName, { id: 't1' }, { kind: 'author', id: 'bob' });
    expect(result).toEqual({ error: { code: 'TRIGGER_NOT_FOUND', message: 'Unknown schedule: t1' } });
  });

  it('a MASKED refusal on issue_report is ALSO the bare {error} shape', async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'RUN_NOT_FOUND', internalReason: 'NOT_RUN_OWNER', reason: 'Run not found: r1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'issue_report', { title: 't', body: 'b', reproSteps: 's', analysis: 'a', runId: 'r1' }, { kind: 'user', id: 'bob' });
    expect(result).toEqual({ error: { code: 'RUN_NOT_FOUND', message: 'Run not found: r1' } });
  });

  it('a MASKED refusal on workflow_deregister needs NO special envelope — the generic refusalEnvelope shape already matches (verified against the real handler: no error.see key)', async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'WORKFLOW_NOT_FOUND', internalReason: 'NOT_WORKFLOW_OWNER', reason: 'Unknown workflow: wf1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'workflow_deregister', { name: 'wf1' }, { kind: 'author', id: 'bob' });
    expect(result).toEqual({ runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: 'Unknown workflow: wf1' } });
  });

  it("a MASKED refusal on workflow_publish DOES need its own envelope: its genuine not-found travels through toErrEnvelope() and carries error.see:null, which the generic refusalEnvelope omits", async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'WORKFLOW_NOT_FOUND', internalReason: 'NOT_WORKFLOW_OWNER', reason: 'Workflow not found in catalog: wf1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'workflow_publish', { name: 'wf1', version: 'v1', channel: 'release' }, { kind: 'author', id: 'bob' });
    expect(result).toEqual({ runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found in catalog: wf1', see: null } });
  });

  it('an audit-write FAILURE still refuses — never a success, never a thrown/crashed request', async () => {
    const throwingAudit = { appendRefusal: () => { throw new Error('disk full'); }, queryRefusals: () => [] };
    const verdict: AuthzVerdict = { ok: false, code: 'FORBIDDEN_ROLE', internalReason: 'FORBIDDEN_ROLE', reason: 'nope' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, refusalAudit: throwingAudit, authorize: () => verdict });
    const result = await callTool(deps, 'workflow_deregister', { name: 'wf1' }, { kind: 'user', id: 'bob' }) as Record<string, unknown>;
    const error = result['error'] as { code: string };
    expect(error.code).toBe('FORBIDDEN_ROLE');
  });

  it('refusalAudit absent (existing ToolDeps fixtures) never crashes — the refusal is still returned, just unaudited', async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'FORBIDDEN_ROLE', internalReason: 'FORBIDDEN_ROLE', reason: 'nope' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'workflow_deregister', { name: 'wf1' }, { kind: 'user', id: 'bob' }) as Record<string, unknown>;
    expect((result['error'] as { code: string }).code).toBe('FORBIDDEN_ROLE');
  });

  it("admin_only tool call that passes authorize() (ok:true) is dispatched normally and writes NO refusal audit row", async () => {
    const audit = fakeAuditStore();
    const queryRefusals = vi.fn().mockReturnValue([{ requestId: 'x' }]);
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, refusalAudit: { ...audit, queryRefusals }, authorize: () => ({ ok: true }) });
    await callTool(deps, 'audit_refusals_list', {}, { kind: 'admin', id: 'root' });
    expect(audit.appendRefusal).not.toHaveBeenCalled();
    expect(queryRefusals).toHaveBeenCalledTimes(1);
  });
});
