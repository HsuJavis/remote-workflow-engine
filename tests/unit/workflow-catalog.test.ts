// UT-011: WorkflowCatalog — registry, workspace rooting, path escape rejection (DES-011)
import { describe, it, expect } from 'vitest';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { CatalogNotFoundError, WorkspaceEscapeError } from '../../src/errors.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORK_ROOT = join(tmpdir(), 'rwe-test-catalog');

describe('WorkflowCatalog', () => {
  // v22 (DES-111): get()/getFull() are deleted — resolve()/resolveDetail() take a selector.
  // An explicit {version} selector always resolves regardless of channel/publish state.
  it('register creates an entry retrievable by resolve({version})', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const { version } = await cat.register({ name: 'my-flow', script: 'return 1;', mermaid: 'graph TD;' });
    expect(typeof version).toBe('string');
    const entry = await cat.resolve('my-flow', { version });
    expect(entry.script).toBe('return 1;');
    expect(entry.version).toBe(version);
  });

  it('registering the same name twice bumps the version and keeps BOTH retrievable (v22, REQ-096)', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const { version: v1 } = await cat.register({ name: 'bump-flow', script: 'return 1;', mermaid: 'graph TD;' });
    const { version: v2 } = await cat.register({ name: 'bump-flow', script: 'return 2;', mermaid: 'graph TD;' });
    expect(v2).not.toBe(v1);
    expect((await cat.resolve('bump-flow', { version: v2 })).script).toBe('return 2;');
    expect((await cat.resolve('bump-flow', { version: v1 })).script).toBe('return 1;');
  });

  it('resolve() on unknown name throws CatalogNotFoundError', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    await expect(cat.resolve('no-such-workflow', {})).rejects.toThrow(CatalogNotFoundError);
  });

  it('deregister removes a registered workflow (gone from resolve() and list())', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const { version } = await cat.register({ name: 'temp-flow', script: 'return 1;', mermaid: 'graph TD;' });
    const { removed } = await cat.deregister('temp-flow');
    expect(removed).toBe(true);
    await expect(cat.resolve('temp-flow', { version })).rejects.toThrow(CatalogNotFoundError);
    expect((await cat.list()).map((e) => e.name)).not.toContain('temp-flow');
  });

  it('deregister on an unknown name returns removed:false (no throw)', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    const { removed } = await cat.deregister('never-registered');
    expect(removed).toBe(false);
  });

  it('list() returns all registered workflows', async () => {
    const cat = new WorkflowCatalog(WORK_ROOT);
    await cat.register({ name: 'alpha', script: 'return 1;', mermaid: 'graph TD;' });
    await cat.register({ name: 'beta', script: 'return 2;', mermaid: 'graph TD;' });
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
