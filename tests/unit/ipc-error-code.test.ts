// C-2 (review finding): the sandbox IPC boundary must carry each error's OWN code, not flatten
// every agent()/workflow() failure to one of two generic codes. ipcErrorCode is the host-side
// derivation used at both the agent and workflow IPC catch sites (src/sandbox/host.ts).
import { describe, it, expect } from 'vitest';
import { ipcErrorCode } from '../../src/sandbox/host.js';

describe('ipcErrorCode (C-2)', () => {
  it('prefers an explicit string .code', () => {
    expect(ipcErrorCode({ code: 'TIMEOUT', name: 'Whatever' }, 'AGENT_ERROR')).toBe('TIMEOUT');
  });

  it('uses the error .name for a typed Error subclass', () => {
    expect(ipcErrorCode(Object.assign(new Error('x'), { name: 'BudgetExceededError' }), 'AGENT_ERROR')).toBe('BudgetExceededError');
    expect(ipcErrorCode(Object.assign(new Error('x'), { name: 'CatalogNotFoundError' }), 'WORKFLOW_ERROR')).toBe('CatalogNotFoundError');
  });

  it('falls back for an anonymous Error (name === "Error")', () => {
    expect(ipcErrorCode(new Error('boom'), 'AGENT_ERROR')).toBe('AGENT_ERROR');
    expect(ipcErrorCode(new Error('boom'), 'WORKFLOW_ERROR')).toBe('WORKFLOW_ERROR');
  });

  it('falls back for non-Error throwables', () => {
    expect(ipcErrorCode('a string', 'AGENT_ERROR')).toBe('AGENT_ERROR');
    expect(ipcErrorCode(null, 'AGENT_ERROR')).toBe('AGENT_ERROR');
    expect(ipcErrorCode(42, 'AGENT_ERROR')).toBe('AGENT_ERROR');
  });
});
