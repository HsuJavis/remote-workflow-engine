// UT (REQ-026): reclaimStaleWorkspaces deletes only TERMINAL + old workspaces, never active/unknown.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reclaimStaleWorkspaces } from '../../src/workspace-gc.js';
import type { RunStatus } from '../../src/types.js';

let root: string;
const NOW = 1_000_000_000_000;
function mkRun(name: string, runId: string, ageMs: number): string {
  const dir = join(root, 'workflows', name, 'runs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'f.txt'), 'x');
  const t = (NOW - ageMs) / 1000;
  utimesSync(dir, t, t);
  return dir;
}
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rwe-gc-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('reclaimStaleWorkspaces (REQ-026)', () => {
  it('deletes a TERMINAL workspace older than the TTL', () => {
    const d = mkRun('wf', 'old-done', 10_000);
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => 'completed' as RunStatus, NOW);
    expect(reclaimed).toEqual(['old-done']);
    expect(existsSync(d)).toBe(false);
  });
  it('KEEPS an active/suspended/queued run, and one younger than the TTL, and an unknown runId', () => {
    const running = mkRun('wf', 'running', 10_000);
    const suspended = mkRun('wf', 'suspended', 10_000);
    const young = mkRun('wf', 'young-done', 1_000);
    const unknown = mkRun('wf', 'unknown', 10_000);
    const status: Record<string, RunStatus> = { running: 'running', suspended: 'suspended', 'young-done': 'completed' };
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, (id) => status[id] ?? null, NOW);
    expect(reclaimed).toEqual([]);
    for (const d of [running, suspended, young, unknown]) expect(existsSync(d)).toBe(true);
  });
  it('no workflows dir -> no-op, no throw', () => {
    expect(reclaimStaleWorkspaces(join(root, 'nope'), 1, () => null, NOW)).toEqual([]);
  });
});
