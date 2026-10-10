// Issue #116 (OWNER DECISION b, carrying decision a's shape rule into call-tool.ts): every
// `authorize()` refusal writes exactly one audit row and echoes a requestId on the response
// envelope — a masked refusal's envelope is shaped EXACTLY like that tool's genuine `*_NOT_FOUND`
// answer PLUS a requestId (review round 6 finding 3: previously it carried none at all, which left
// the masked case untraceable — see call-tool.ts's `stampRequestId` for why both sides now get one
// without that presence itself becoming a new tell). Written test-first (RED): before this change,
// `callTool`'s refusal branch called `refusalEnvelope()` directly with no audit write and no
// requestId.
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

  it('a MASKED refusal on run_status (RUN_NOT_FOUND) carries the REAL runId, no top-level code — byte-identical shape to mcp-facade.ts\'s own notFound() EXCEPT for a requestId (review round 6 finding 3: a masked refusal now carries one too, so it can be traced to its own audit row)', async () => {
    const audit = fakeAuditStore();
    const verdict: AuthzVerdict = { ok: false, code: 'RUN_NOT_FOUND', internalReason: 'NOT_RUN_OWNER', reason: 'Run not found: r1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, refusalAudit: audit, authorize: () => verdict });
    const result = await callTool(deps, 'run_status', { runId: 'r1' }, { kind: 'user', id: 'bob' }) as Record<string, unknown>;
    const error = (result as { error: { code: string; message: string; detail?: { requestId?: string } } }).error;
    expect(result).toEqual({ runId: 'r1', status: 'failed', error: { code: 'RUN_NOT_FOUND', message: 'Run not found: r1', detail: { requestId: error.detail!.requestId } } });
    expect(typeof error.detail?.requestId).toBe('string');
    expect(audit.rows[0]).toMatchObject({ realReason: 'NOT_RUN_OWNER', returnedCode: 'RUN_NOT_FOUND', targetKind: 'run', targetId: 'r1', requestId: error.detail!.requestId });
  });

  it('a MASKED refusal on run_agent_log carries the three always-present fields the real handler sets, plus a requestId', async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'RUN_NOT_FOUND', internalReason: 'NOT_RUN_OWNER', reason: 'Run not found: r1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'run_agent_log', { runId: 'r1', agentId: 'a1' }, { kind: 'user', id: 'bob' }) as Record<string, unknown>;
    const error = (result as { error: { detail?: { requestId?: string } } }).error;
    expect(result).toEqual({ runId: 'r1', status: 'failed', error: { code: 'RUN_NOT_FOUND', message: 'Run not found: r1', detail: { requestId: error.detail!.requestId } }, harness: null, events: [], hasMore: false });
  });

  it.each(['schedule_delete', 'webhook_delete'])('a MASKED refusal on %s is the bare {error} shape, no runId/status/top-level code, plus a requestId', async (toolName) => {
    const verdict: AuthzVerdict = { ok: false, code: 'TRIGGER_NOT_FOUND', internalReason: 'NOT_TRIGGER_OWNER', reason: 'Unknown schedule: t1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, toolName, { id: 't1' }, { kind: 'author', id: 'bob' }) as { error: { detail?: { requestId?: string } } };
    expect(result).toEqual({ error: { code: 'TRIGGER_NOT_FOUND', message: 'Unknown schedule: t1', detail: { requestId: result.error.detail!.requestId } } });
    expect(typeof result.error.detail?.requestId).toBe('string');
  });

  it('a MASKED refusal on issue_report is ALSO the bare {error} shape, plus a requestId', async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'RUN_NOT_FOUND', internalReason: 'NOT_RUN_OWNER', reason: 'Run not found: r1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'issue_report', { title: 't', body: 'b', reproSteps: 's', analysis: 'a', runId: 'r1' }, { kind: 'user', id: 'bob' }) as { error: { detail?: { requestId?: string } } };
    expect(result).toEqual({ error: { code: 'RUN_NOT_FOUND', message: 'Run not found: r1', detail: { requestId: result.error.detail!.requestId } } });
  });

  it('a MASKED refusal on workflow_deregister needs NO special envelope beyond the requestId — the generic refusalEnvelope shape already matches (verified against the real handler: no error.see key)', async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'WORKFLOW_NOT_FOUND', internalReason: 'NOT_WORKFLOW_OWNER', reason: 'Unknown workflow: wf1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'workflow_deregister', { name: 'wf1' }, { kind: 'author', id: 'bob' }) as { error: { detail?: { requestId?: string } } };
    expect(result).toEqual({ runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: 'Unknown workflow: wf1', detail: { requestId: result.error.detail!.requestId } } });
  });

  it("a MASKED refusal on workflow_publish DOES need its own envelope: its genuine not-found travels through toErrEnvelope() and carries error.see:null, which the generic refusalEnvelope omits — plus a requestId", async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'WORKFLOW_NOT_FOUND', internalReason: 'NOT_WORKFLOW_OWNER', reason: 'Workflow not found in catalog: wf1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'workflow_publish', { name: 'wf1', version: 'v1', channel: 'release' }, { kind: 'author', id: 'bob' }) as { error: { detail?: { requestId?: string } } };
    expect(result).toEqual({ runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found in catalog: wf1', see: null, detail: { requestId: result.error.detail!.requestId } } });
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

  // Review round 6 finding 1: workspace_pull/workspace_purge, and workspace_list/workspace_delete's
  // OWN `run` mode, now join authz.ts's templated set — masked the SAME way run_status etc. are.
  it("a MASKED refusal on workspace_pull (run mode) is notFound()'s bare shape, plus a requestId", async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'RUN_NOT_FOUND', internalReason: 'NOT_RUN_OWNER', reason: 'Run not found: r1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'workspace_pull', { runId: 'r1', path: 'a.txt' }, { kind: 'user', id: 'bob' }) as { error: { detail?: { requestId?: string } } };
    expect(result).toEqual({ runId: 'r1', status: 'failed', error: { code: 'RUN_NOT_FOUND', message: 'Run not found: r1', detail: { requestId: result.error.detail!.requestId } } });
    expect(typeof result.error.detail?.requestId).toBe('string');
  });

  it("a MASKED refusal on workspace_list (run mode) is notFound()'s bare shape, plus a requestId", async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'RUN_NOT_FOUND', internalReason: 'NOT_RUN_OWNER', reason: 'Run not found: r1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'workspace_list', { runId: 'r1' }, { kind: 'user', id: 'bob' }) as { error: { detail?: { requestId?: string } } };
    expect(result).toEqual({ runId: 'r1', status: 'failed', error: { code: 'RUN_NOT_FOUND', message: 'Run not found: r1', detail: { requestId: result.error.detail!.requestId } } });
  });

  it("workspace_list's WORKFLOW-mode refusal is NOT masked (mode trap guard) — NOT_WORKFLOW_OWNER reaches the wire unchanged, still with a requestId via the ordinary unmasked path", async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'NOT_WORKFLOW_OWNER', internalReason: 'NOT_WORKFLOW_OWNER', reason: "NOT_WORKFLOW_OWNER: workflow 'wf1' is not owned by the caller" };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'workspace_list', { workflow: 'wf1', kind: 'skill' }, { kind: 'author', id: 'bob' }) as { code: string; error: { code: string; detail?: { requestId?: string } } };
    expect(result.code).toBe('NOT_WORKFLOW_OWNER');
    expect(result.error.code).toBe('NOT_WORKFLOW_OWNER');
    expect(typeof result.error.detail?.requestId).toBe('string');
  });

  it('a MASKED refusal on workspace_delete (run mode) matches the toErrEnvelope() shape (top-level code, error.see:null), plus a requestId', async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'RUN_NOT_FOUND', internalReason: 'NOT_RUN_OWNER', reason: 'Run not found: r1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'workspace_delete', { runId: 'r1', paths: ['a.txt'] }, { kind: 'user', id: 'bob' }) as { error: { detail?: { requestId?: string } } };
    expect(result).toEqual({ runId: 'r1', status: 'failed', code: 'RUN_NOT_FOUND', error: { code: 'RUN_NOT_FOUND', message: 'Run not found: r1', see: null, detail: { requestId: result.error.detail!.requestId } } });
  });

  it('a MASKED refusal on workspace_purge matches its own toErrEnvelope() shape (NO top-level code, error.see:null), plus a requestId', async () => {
    const verdict: AuthzVerdict = { ok: false, code: 'RUN_NOT_FOUND', internalReason: 'NOT_RUN_OWNER', reason: 'Run not found: r1' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, authorize: () => verdict });
    const result = await callTool(deps, 'workspace_purge', { runId: 'r1' }, { kind: 'user', id: 'bob' }) as { error: { detail?: { requestId?: string } } };
    expect(result).toEqual({ runId: 'r1', status: 'failed', error: { code: 'RUN_NOT_FOUND', message: 'Run not found: r1', see: null, detail: { requestId: result.error.detail!.requestId } } });
  });

  // Review round 6 finding 5: the audit row's target is derived from the TOOL'S OWN row, not from
  // the refusal reason — so a role refusal on a run-scoped tool still names the run.
  it('a role refusal (FORBIDDEN_ROLE) on a run-scoped tool still records the NAMED run as the target, not "none"', async () => {
    const audit = fakeAuditStore();
    const verdict: AuthzVerdict = { ok: false, code: 'FORBIDDEN_ROLE', internalReason: 'FORBIDDEN_ROLE', reason: "role 'user' is below the required 'author'" };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, refusalAudit: audit, authorize: () => verdict });
    await callTool(deps, 'run_suspend', { runId: 'r1' }, { kind: 'user', id: 'bob' });
    expect(audit.rows[0]).toMatchObject({ targetKind: 'run', targetId: 'r1', realReason: 'FORBIDDEN_ROLE' });
  });

  it('an ACCOUNT_PENDING_APPROVAL refusal on a workflow-scoped tool still records the NAMED workflow as the target', async () => {
    const audit = fakeAuditStore();
    const verdict: AuthzVerdict = { ok: false, code: 'ACCOUNT_PENDING_APPROVAL', internalReason: 'ACCOUNT_PENDING_APPROVAL', reason: 'pending' };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, refusalAudit: audit, authorize: () => verdict });
    await callTool(deps, 'workflow_deregister', { name: 'wf1' }, { kind: 'none', id: 'carol' });
    expect(audit.rows[0]).toMatchObject({ targetKind: 'workflow', targetId: 'wf1', realReason: 'ACCOUNT_PENDING_APPROVAL' });
  });

  it('a role refusal on a tool with NO scoped resource (ownership:\'none\', no workflowArg) records "none", not a guess', async () => {
    const audit = fakeAuditStore();
    const verdict: AuthzVerdict = { ok: false, code: 'FORBIDDEN_ROLE', internalReason: 'FORBIDDEN_ROLE', reason: "role 'user' is below the required 'admin'" };
    const deps = partialDeps({ facade: {}, lookup: {}, audit: {}, refusalAudit: audit, authorize: () => verdict });
    await callTool(deps, 'audit_refusals_list', {}, { kind: 'user', id: 'bob' });
    expect(audit.rows[0]).toMatchObject({ targetKind: 'none', targetId: null });
  });

  // Review round 6 finding 2: workflow_register's own catalog-level NOT_WORKFLOW_OWNER (a taken
  // name, workflow-catalog.ts — NOT authorize()'s ownership branch, which never fires here since
  // the row is ownership:'none') is reachable over the wire and must now be audited too, unmasked
  // (no sibling to mask toward for a brand-new name), with a requestId echoed on the response.
  it('workflow_register NOT_WORKFLOW_OWNER (a taken name) writes one UNMASKED audit row and echoes its requestId', async () => {
    const audit = fakeAuditStore();
    const facade = { workflowRegister: vi.fn(async () => ({ runId: '', status: 'failed', code: 'NOT_WORKFLOW_OWNER', error: { code: 'NOT_WORKFLOW_OWNER', message: "NOT_WORKFLOW_OWNER: workflow 'wf1' is not owned by the caller", see: null } })) };
    const deps = partialDeps({ facade, lookup: {}, audit: {}, refusalAudit: audit, authorize: () => ({ ok: true }) });
    const result = await callTool(deps, 'workflow_register', { name: 'wf1', script: 's', mermaid: 'graph LR' }, { kind: 'author', id: 'bob' }) as { error: { code: string; detail?: { requestId?: string } } };
    expect(result.error.code).toBe('NOT_WORKFLOW_OWNER');
    expect(typeof result.error.detail?.requestId).toBe('string');
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]).toMatchObject({ actor: 'bob', tool: 'workflow_register', targetKind: 'workflow', targetId: 'wf1', realReason: 'NOT_WORKFLOW_OWNER', returnedCode: 'NOT_WORKFLOW_OWNER', requestId: result.error.detail!.requestId });
  });

  it('workflow_register success (no NOT_WORKFLOW_OWNER) writes NO refusal audit row', async () => {
    const audit = fakeAuditStore();
    const facade = { workflowRegister: vi.fn(async () => ({ runId: '', status: 'completed', version: 1, result: { name: 'wf1', version: 'v1', versions: ['v1'], channels: { release: null, beta: null } } })) };
    const deps = partialDeps({ facade, lookup: {}, audit: {}, refusalAudit: audit, authorize: () => ({ ok: true }) });
    await callTool(deps, 'workflow_register', { name: 'wf1', script: 's', mermaid: 'graph LR' }, { kind: 'author', id: 'bob' });
    expect(audit.appendRefusal).not.toHaveBeenCalled();
  });
});
