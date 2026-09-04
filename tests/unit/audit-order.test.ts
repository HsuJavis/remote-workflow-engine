// UT-153 (DES-151, v24): audit — AuditAction subset of ToolName, synchronous append BEFORE
// bytes; a throwing appendAudit fails closed (INTERNAL_ERROR, zero bytes). Written test-first
// (Gate 5, RED) — the audited-read orchestration function does not exist yet.
import { describe, it, expect, vi } from 'vitest';
import { auditedWorkspaceRead } from '../../src/audited-read.js';

// v24 (TASK-157, adjudication A-7 [10]): `readArtifactChunk` was never really a store method — the
// real function (workspace-artifacts.ts) is a free function with its own signature, and only ONE
// of the four audited call sites (workspace_pull) actually calls it; the other three read
// something else entirely. The invented `{runId, owner, path}` object shape that used to be
// "echoed" back by a fake `store.readArtifactChunk` pretended to be that real signature but was
// never actually passed to it. Reconciled: `AuditReadStore` carries only `appendAudit`, and the
// read itself is a plain thunk (third argument) — these cases push `'readArtifactChunk'` from the
// thunk so the call-order pin below is unchanged.
describe('audited read order (UT-153, DES-151)', () => {
  it('[T1] appendAudit is called BEFORE the read thunk (recording fake, ordered call log)', async () => {
    const calls: string[] = [];
    const store = { appendAudit: vi.fn(() => { calls.push('appendAudit'); }) };
    const read = vi.fn(() => { calls.push('readArtifactChunk'); return { bytes: 'x' }; });
    await auditedWorkspaceRead(store, { actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob', path: 'a.txt' }, read);
    expect(calls).toEqual(['appendAudit', 'readArtifactChunk']);
  });

  it('a store whose appendAudit throws ⇒ INTERNAL_ERROR and the read thunk is NEVER called (fail-closed, zero bytes)', async () => {
    const readSpy = vi.fn();
    const store = { appendAudit: vi.fn(() => { throw new Error('disk full'); }) };
    await expect(
      auditedWorkspaceRead(store, { actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob', path: 'a.txt' }, readSpy),
    ).rejects.toMatchObject({ message: expect.stringMatching(/INTERNAL_ERROR/) });
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('no audit row is written when auth is disabled (no actor id exists)', async () => {
    const store = { appendAudit: vi.fn() };
    const read = vi.fn(() => ({ bytes: 'x' }));
    await auditedWorkspaceRead(store, { actor: null, action: 'workspace_pull', runId: 'r1', owner: 'bob', path: 'a.txt' }, read);
    expect(store.appendAudit).not.toHaveBeenCalled();
  });

  it('the appended event carries actor/action/runId/owner/path unmodified, and the read thunk\'s return value passes through', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const store = { appendAudit: vi.fn((ev: Record<string, unknown>) => { seen.push(ev); }) };
    const read = vi.fn(() => ({ bytes: 'payload' }));
    const result = await auditedWorkspaceRead(store, { actor: 'carol', action: 'run_agent_log', runId: 'r9', owner: 'dave', path: 'x/y.txt' }, read);
    expect(seen[0]).toMatchObject({ actor: 'carol', action: 'run_agent_log', runId: 'r9', owner: 'dave', path: 'x/y.txt' });
    expect(result).toMatchObject({ bytes: 'payload' });
  });
});
