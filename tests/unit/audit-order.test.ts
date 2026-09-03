// UT-153 (DES-151, v24): audit — AuditAction subset of ToolName, synchronous append BEFORE
// bytes; a throwing appendAudit fails closed (INTERNAL_ERROR, zero bytes). Written test-first
// (Gate 5, RED) — the audited-read orchestration function does not exist yet.
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — auditedWorkspaceRead does not exist yet (v24 DES-151/TASK-140/148)
import { auditedWorkspaceRead } from '../../src/audited-read.js';

describe('audited read order (UT-153, DES-151)', () => {
  it('[T1] appendAudit is called BEFORE readArtifactChunk (recording fake, ordered call log)', async () => {
    const calls: string[] = [];
    const store = {
      appendAudit: vi.fn(() => { calls.push('appendAudit'); }),
      readArtifactChunk: vi.fn(() => { calls.push('readArtifactChunk'); return { bytes: 'x' }; }),
    };
    await auditedWorkspaceRead(store, { actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob', path: 'a.txt' });
    expect(calls).toEqual(['appendAudit', 'readArtifactChunk']);
  });

  it('a store whose appendAudit throws ⇒ INTERNAL_ERROR and readArtifactChunk is NEVER called (fail-closed, zero bytes)', async () => {
    const readSpy = vi.fn();
    const store = {
      appendAudit: vi.fn(() => { throw new Error('disk full'); }),
      readArtifactChunk: readSpy,
    };
    await expect(
      auditedWorkspaceRead(store, { actor: 'admin', action: 'workspace_pull', runId: 'r1', owner: 'bob', path: 'a.txt' }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/INTERNAL_ERROR/) });
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('no audit row is written when auth is disabled (no actor id exists)', async () => {
    const store = { appendAudit: vi.fn(), readArtifactChunk: vi.fn(() => ({ bytes: 'x' })) };
    await auditedWorkspaceRead(store, { actor: null, action: 'workspace_pull', runId: 'r1', owner: 'bob', path: 'a.txt' });
    expect(store.appendAudit).not.toHaveBeenCalled();
  });
});
