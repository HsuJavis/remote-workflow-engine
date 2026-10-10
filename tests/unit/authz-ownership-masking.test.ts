// Issue #116 (OWNER DECISION a): for a NON-ADMIN caller, "exists but not yours" (NOT_*_OWNER) must
// be indistinguishable from "does not exist" (*_NOT_FOUND) on every tool `authz.ts`'s
// `notFoundTemplate` covers — admin keeps the precise code. Written test-first (RED): before this
// change, `authorize()` never masked anything and carried no `internalReason`.
import { describe, it, expect } from 'vitest';
import { authorize, type OwnerLookup, type Principal } from '../../src/authz.js';

const NOOP_LOOKUP: OwnerLookup = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };
const BOB: Principal = { kind: 'user', id: 'bob' };
const ROOT: Principal = { kind: 'admin', id: 'root' };
const CAROL: Principal = { kind: 'author', id: 'carol' };

describe('authz ownership masking (issue #116 decision a)', () => {
  it('run_status: a non-owner (owner exists, is someone else) gets the SAME code+message as a genuinely missing run', () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => 'alice' };
    const verdict = authorize(BOB, { name: 'run_status', key: 'runId', authz: { minRole: 'user', ownership: 'run' } }, { runId: 'r1' }, lookup);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('RUN_NOT_FOUND');
    expect(verdict.reason).toBe('Run not found: r1');
    // The TRUE reason survives for the audit row even though the caller-facing code was masked.
    expect(verdict.internalReason).toBe('NOT_RUN_OWNER');
    // No `detail` at all — a real RUN_NOT_FOUND answer carries none; `detail.mode` would be a tell.
    expect(verdict.detail).toBeUndefined();
  });

  it('run_status: an OWNERLESS run (admin-only) is ALSO masked to RUN_NOT_FOUND for a non-admin', () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => null };
    const verdict = authorize(BOB, { name: 'run_status', key: 'runId', authz: { minRole: 'user', ownership: 'run' } }, { runId: 'legacy' }, lookup);
    expect(verdict.code).toBe('RUN_NOT_FOUND');
    expect(verdict.reason).toBe('Run not found: legacy');
    expect(verdict.internalReason).toBe('NOT_RUN_OWNER');
  });

  it('run_status: a genuinely missing run (owner undefined) still passes authorize() ok — unchanged, the handler answers RUN_NOT_FOUND downstream', () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => undefined };
    const verdict = authorize(BOB, { name: 'run_status', key: 'runId', authz: { minRole: 'user', ownership: 'run' } }, { runId: 'missing' }, lookup);
    expect(verdict.ok).toBe(true);
  });

  it.each([
    ['run_result', 'RUN_NOT_FOUND', (id: string) => `Run not found: ${id}`],
    ['run_suspend', 'RUN_NOT_FOUND', (id: string) => `Run not found: ${id}`],
    ['run_resume', 'RUN_NOT_FOUND', (id: string) => `Run not found: ${id}`],
    ['run_stop', 'RUN_NOT_FOUND', (id: string) => `Run not found: ${id}`],
    ['run_agent_log', 'RUN_NOT_FOUND', (id: string) => `Run not found: ${id}`],
    ['issue_report', 'RUN_NOT_FOUND', (id: string) => `Run not found: ${id}`],
  ])('%s: non-owner is masked to %s with the real handler\'s own message', (toolName, code, msg) => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => 'alice' };
    const verdict = authorize(BOB, { name: toolName, key: 'runId', authz: { minRole: 'user', ownership: 'run' } }, { runId: 'r9' }, lookup);
    expect(verdict.code).toBe(code);
    expect(verdict.reason).toBe(msg('r9'));
    expect(verdict.internalReason).toBe('NOT_RUN_OWNER');
  });

  it("workflow_deregister: non-owner masked to WORKFLOW_NOT_FOUND, message 'Unknown workflow: X' (mcp-facade.ts's own wording)", () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, workflowOwner: () => 'alice' };
    const verdict = authorize(CAROL, { name: 'workflow_deregister', key: 'name', authz: { minRole: 'author', ownership: 'workflow' } }, { name: 'wf1' }, lookup);
    expect(verdict.code).toBe('WORKFLOW_NOT_FOUND');
    expect(verdict.reason).toBe('Unknown workflow: wf1');
    expect(verdict.internalReason).toBe('NOT_WORKFLOW_OWNER');
  });

  it("workflow_publish: non-owner masked to WORKFLOW_NOT_FOUND, message 'Workflow not found in catalog: X' (CatalogNotFoundError's own wording)", () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, workflowOwner: () => 'alice' };
    const verdict = authorize(CAROL, { name: 'workflow_publish', key: 'name', authz: { minRole: 'author', ownership: 'workflow' } }, { name: 'wf1' }, lookup);
    expect(verdict.code).toBe('WORKFLOW_NOT_FOUND');
    expect(verdict.reason).toBe('Workflow not found in catalog: wf1');
    expect(verdict.internalReason).toBe('NOT_WORKFLOW_OWNER');
  });

  it.each([
    ['schedule_delete', 'Unknown schedule: trig-1'],
    ['schedule_setEnabled', 'Unknown schedule: trig-1'],
  ])('%s: non-owner masked to TRIGGER_NOT_FOUND, message %j (scheduler.ts own wording)', (toolName, msg) => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, triggerOwner: () => 'alice' };
    const verdict = authorize(CAROL, { name: toolName, key: 'id', authz: { minRole: 'author', ownership: 'trigger' } }, { id: 'trig-1' }, lookup);
    expect(verdict.code).toBe('TRIGGER_NOT_FOUND');
    expect(verdict.reason).toBe(msg);
    expect(verdict.internalReason).toBe('NOT_TRIGGER_OWNER');
  });

  it("webhook_delete: non-owner masked to TRIGGER_NOT_FOUND, message 'Unknown webhook: X' (webhook-registry's own wording)", () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, triggerOwner: () => 'alice' };
    const verdict = authorize(CAROL, { name: 'webhook_delete', key: 'id', authz: { minRole: 'author', ownership: 'trigger' } }, { id: 'hook-1' }, lookup);
    expect(verdict.code).toBe('TRIGGER_NOT_FOUND');
    expect(verdict.reason).toBe('Unknown webhook: hook-1');
    expect(verdict.internalReason).toBe('NOT_TRIGGER_OWNER');
  });

  it('admin bypasses ownership entirely — never reaches the masking branch, keeps ok:true (the precise-code requirement is satisfied by never being refused)', () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => 'alice' };
    const verdict = authorize(ROOT, { name: 'run_status', key: 'runId', authz: { minRole: 'user', ownership: 'run', adminCrossRead: true } }, { runId: 'r1' }, lookup);
    expect(verdict.ok).toBe(true);
    expect(verdict.crossPrincipalRead).toBe(true);
  });

  // Independent-verifier finding (2026-10-10, reverify-r6-b finding 5): decision a says "every
  // MCP tool" — workspace_list/workspace_delete's own `workflow` mode and workspace_push's own
  // `asset` mode (all three resolve `ownership:'workflow'`) were left unmasked, an oracle a
  // non-owner could still exploit (NOT_WORKFLOW_OWNER vs WORKFLOW_NOT_FOUND). Now templated the
  // same way workflow_deregister/workflow_publish already are, using each tool's OWN genuine
  // not-found wording (verified against mcp-facade.ts's real handlers).
  it("workspace_push (asset mode): non-owner masked to WORKFLOW_NOT_FOUND, message matching mcp-facade.ts's own wording", () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, workflowOwner: () => 'alice' };
    const verdict = authorize(CAROL, { name: 'workspace_push', key: null, authz: { minRole: 'author', ownership: 'workflow' } }, { workflow: 'wf1' }, lookup);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('WORKFLOW_NOT_FOUND');
    expect(verdict.reason).toBe("WORKFLOW_NOT_FOUND: unknown workflow 'wf1' — register it first (workflow_register), then push its assets");
    expect(verdict.internalReason).toBe('NOT_WORKFLOW_OWNER');
    expect(verdict.detail).toBeUndefined();
  });

  it("workspace_list (workflow mode): non-owner masked to WORKFLOW_NOT_FOUND, message 'Unknown workflow: X' (mcp-facade.ts's own wording)", () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, workflowOwner: () => 'alice' };
    const verdict = authorize(CAROL, { name: 'workspace_list', key: null, authz: { minRole: 'author', ownership: 'workflow' } }, { workflow: 'wf1' }, lookup);
    expect(verdict.code).toBe('WORKFLOW_NOT_FOUND');
    expect(verdict.reason).toBe('Unknown workflow: wf1');
    expect(verdict.internalReason).toBe('NOT_WORKFLOW_OWNER');
  });

  it("workspace_delete (workflow mode): non-owner masked to WORKFLOW_NOT_FOUND, message matching mcp-facade.ts's own wording", () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, workflowOwner: () => 'alice' };
    const verdict = authorize(CAROL, { name: 'workspace_delete', key: null, authz: { minRole: 'author', ownership: 'workflow' } }, { workflow: 'wf1' }, lookup);
    expect(verdict.code).toBe('WORKFLOW_NOT_FOUND');
    expect(verdict.reason).toBe("WORKFLOW_NOT_FOUND: unknown workflow 'wf1'");
    expect(verdict.internalReason).toBe('NOT_WORKFLOW_OWNER');
  });

  // workspace_list/workspace_delete's RUN mode (a DIFFERENT ownerCode on the SAME tool name) must
  // keep masking to RUN_NOT_FOUND unaffected by the new WORKFLOW_NOT_FOUND template above — this is
  // the "first-match-wins" trap a Map<string, ErrorCode> would fall into (call-tool.ts's
  // NOT_FOUND_STAMP_CODE must be a Map<string, Set<ErrorCode>> for exactly this reason).
  it('workspace_list (run mode) still masks to RUN_NOT_FOUND — unaffected by its own workflow-mode template', () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => 'alice' };
    const verdict = authorize(BOB, { name: 'workspace_list', key: 'runId', authz: { minRole: 'user', ownership: 'run' } }, { runId: 'r1' }, lookup);
    expect(verdict.code).toBe('RUN_NOT_FOUND');
    expect(verdict.reason).toBe('Run not found: r1');
  });

  it('a role refusal (FORBIDDEN_ROLE) is never masked and always carries internalReason === code', () => {
    const verdict = authorize({ kind: 'user', id: 'bob' }, { name: 'workflow_deregister', key: 'name', authz: { minRole: 'author', ownership: 'workflow' } }, { name: 'wf1' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('FORBIDDEN_ROLE');
    expect(verdict.internalReason).toBe('FORBIDDEN_ROLE');
  });

  it('ACCOUNT_PENDING_APPROVAL is never masked', () => {
    const verdict = authorize({ kind: 'none', id: 'bob' }, { name: 'run_status', key: 'runId', authz: { minRole: 'user', ownership: 'run' } }, { runId: 'r1' }, NOOP_LOOKUP);
    expect(verdict.code).toBe('ACCOUNT_PENDING_APPROVAL');
    expect(verdict.internalReason).toBe('ACCOUNT_PENDING_APPROVAL');
  });
});
