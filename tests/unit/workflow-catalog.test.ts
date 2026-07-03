// UT-011: WorkflowCatalog — registry, workspace rooting, path escape rejection (DES-011)
import { describe, it, expect } from 'vitest';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { CatalogNotFoundError, WorkspaceEscapeError } from '../../src/errors.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORK_ROOT = join(tmpdir(), 'rwe-test-catalog');

describe('WorkflowCatalog', () => {
  it('register creates an entry retrievable by get()', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const { version } = await cat.register('my-flow', 'return 1;');
    expect(typeof version).toBe('string');
    const entry = await cat.get('my-flow');
    expect(entry.script).toBe('return 1;');
    expect(entry.version).toBe(version);
  });

  it('updating a registered workflow bumps the version', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const { version: v1 } = await cat.register('bump-flow', 'return 1;');
    const { version: v2 } = await cat.register('bump-flow', 'return 2;');
    expect(v2).not.toBe(v1);
    const entry = await cat.get('bump-flow');
    expect(entry.script).toBe('return 2;');
  });

  it('get() on unknown name throws CatalogNotFoundError', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    await expect(cat.get('no-such-workflow')).rejects.toThrow(CatalogNotFoundError);
  });

  it('list() returns all registered workflows', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    await cat.register('alpha', 'return 1;');
    await cat.register('beta', 'return 2;');
    const entries = await cat.list();
    const names = entries.map((e) => e.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  it('runWorkspace returns different paths for different runIds', () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const ws1 = cat.runWorkspace('my-flow', 'run-aaa');
    const ws2 = cat.runWorkspace('my-flow', 'run-bbb');
    expect(ws1).not.toBe(ws2);
  });

  it('workFolder is stable (same name → same path across calls)', () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    expect(cat.workFolder('stable-flow')).toBe(cat.workFolder('stable-flow'));
  });

  it('workFolders for different workflows are distinct', () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    expect(cat.workFolder('flow-x')).not.toBe(cat.workFolder('flow-y'));
  });

  it('resolveInWorkspace rejects path traversal via ..', () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    expect(() => cat.resolveInWorkspace('run-abc', '../secret')).toThrow(WorkspaceEscapeError);
    expect(() => cat.resolveInWorkspace('run-abc', '/etc/passwd')).toThrow(WorkspaceEscapeError);
  });

  it('resolveInWorkspace resolves safe relative paths inside the workspace', () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const resolved = cat.resolveInWorkspace('run-abc', 'output/result.json');
    expect(resolved).toMatch(/run-abc/);
    expect(resolved).toMatch(/result\.json$/);
  });
});
