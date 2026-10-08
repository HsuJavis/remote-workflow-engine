// UT (issue #164 B): `issue_list`'s advertised schema/description used to under-advertise an
// ALREADY-IMPLEMENTED capability — `IssueListFilter`/`listIssues` (issue-reporter.ts) have always
// supported state/labels/since/limit/workflow, but the inputSchema was bare `schema({})` and the
// description just "List issues." — undiscoverable, not broken. This locks in the advertised shape
// AND (via callTool) that the filter really reaches `listIssues` unfiltered, same as before.
// Mock policy (unit): pure TOOL_SPECS data assertion + a fake IssueReporter.listIssues through callTool.
import { describe, it, expect, vi } from 'vitest';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';
import type { OwnerLookup, Principal } from '../../src/authz.js';

function issueListSpec() {
  const spec = TOOL_SPECS.find((s) => s.name === 'issue_list');
  if (!spec) throw new Error('issue_list not found in TOOL_SPECS');
  return spec;
}

describe('issue_list advertised schema (issue #164 B)', () => {
  it('declares state as a closed enum of open/closed/all, defaulting to open per its description', () => {
    const props = (issueListSpec().inputSchema as any).properties;
    expect(props.state?.enum).toEqual(['open', 'closed', 'all']);
    expect(issueListSpec().description).toMatch(/open/i);
  });

  it('declares labels as an array of strings, since as a string, limit as a number, and workflow as a string', () => {
    const props = (issueListSpec().inputSchema as any).properties;
    expect(props.labels).toEqual({ type: 'array', items: { type: 'string' }, description: expect.any(String) });
    expect(props.since?.type).toBe('string');
    expect(props.limit?.type).toBe('number');
    expect(props.workflow?.type).toBe('string');
  });

  it('does NOT close the schema with additionalProperties:false (owner decision #107: undeclared keys pass through)', () => {
    expect((issueListSpec().inputSchema as any).additionalProperties).not.toBe(false);
  });

  it('nothing is required — state/labels/since/limit/workflow are all optional filters', () => {
    expect((issueListSpec().inputSchema as any).required ?? []).toEqual([]);
  });
});

describe("callTool('issue_list') (issue #164 B): the advertised filter really reaches listIssues unfiltered", () => {
  const NOOP_LOOKUP: OwnerLookup = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };
  const ALICE: Principal = { kind: 'user', id: 'alice' };

  it('issue_list({state:"closed", labels:["bug"], since, limit, workflow}) passes every field through to listIssues', async () => {
    const listIssues = vi.fn().mockResolvedValue({ ok: true, issues: [] });
    const deps = { facade: {}, lookup: NOOP_LOOKUP, issueReporter: { listIssues } } as unknown as ToolDeps;
    const args = { state: 'closed', labels: ['bug'], since: '2026-01-01T00:00:00Z', limit: 10, workflow: 'wf-1' };
    await callTool(deps, 'issue_list', args, ALICE);
    expect(listIssues).toHaveBeenCalledWith(args);
  });

  it('issue_list({}) still works — every filter field is optional', async () => {
    const listIssues = vi.fn().mockResolvedValue({ ok: true, issues: [] });
    const deps = { facade: {}, lookup: NOOP_LOOKUP, issueReporter: { listIssues } } as unknown as ToolDeps;
    const res = await callTool(deps, 'issue_list', {}, ALICE);
    expect(listIssues).toHaveBeenCalledWith({});
    expect((res as { result: unknown[] }).result).toEqual([]);
  });

  it('an out-of-enum state is refused INVALID_ARGUMENT before listIssues is ever called', async () => {
    const listIssues = vi.fn();
    const deps = { facade: {}, lookup: NOOP_LOOKUP, issueReporter: { listIssues } } as unknown as ToolDeps;
    const res = await callTool(deps, 'issue_list', { state: 'bogus' }, ALICE);
    expect((res as { error: { code: string } }).error?.code).toBe('INVALID_ARGUMENT');
    expect(listIssues).not.toHaveBeenCalled();
  });
});
