// IT-007: WorkflowCatalog — workspace rooting + run-A/run-B isolation (ARCH-007)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { WorkspaceEscapeError } from '../../src/errors.js';

describe('WorkflowCatalog workspace isolation (ARCH-007)', () => {
  let workRoot: string;
  let cat: WorkflowCatalog;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-cat-'));
    cat = new WorkflowCatalog(workRoot);
  });

  afterEach(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('run-A workspace and run-B workspace are separate directories', () => {
    const wsA = cat.runWorkspace('flow-x', 'run-A');
    const wsB = cat.runWorkspace('flow-x', 'run-B');
    expect(wsA).not.toBe(wsB);
    // One must not be a prefix of the other in a way that allows cross-access
    expect(wsB.startsWith(wsA)).toBe(false);
    expect(wsA.startsWith(wsB)).toBe(false);
  });

  it('a file written to run-A workspace is not visible in run-B workspace path', () => {
    const wsA = cat.runWorkspace('flow-x', 'run-A');
    const wsB = cat.runWorkspace('flow-x', 'run-B');

    // Create wsA directory and write a file
    mkdirSync(wsA, { recursive: true });
    writeFileSync(join(wsA, 'secret.txt'), 'run-A data');

    // The file should NOT be visible from run-B's path
    expect(existsSync(join(wsB, 'secret.txt'))).toBe(false);
  });

  it('workflow-X and workflow-Y have distinct work folders', () => {
    const folderX = cat.workFolder('flow-x');
    const folderY = cat.workFolder('flow-y');
    expect(folderX).not.toBe(folderY);
  });

  it('resolveInWorkspace rejects .. traversal', () => {
    expect(() => cat.resolveInWorkspace('run-Z', '../etc/hosts')).toThrow(WorkspaceEscapeError);
  });

  it('runWorkspace path is rooted under workFolder', () => {
    const folder = cat.workFolder('flow-q');
    const ws = cat.runWorkspace('flow-q', 'run-1');
    expect(ws.startsWith(folder)).toBe(true);
  });
});
