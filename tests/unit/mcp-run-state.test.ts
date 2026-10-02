// issue #126 B: per-run MCP state placeholders (${run:dir}, ${run:id}) — pure validate/resolve/
// path-naming behavior. RED: src/mcp-run-state.ts does not exist yet — module-not-found.
import { describe, it, expect } from 'vitest';
import {
  validateRunPlaceholders,
  resolveRunPlaceholders,
  mcpStateDir,
  mcpStateRunDir,
  workflowFolderOfWorkspace,
  UnknownRunPlaceholderError,
} from '../../src/mcp-run-state.js';

describe('validateRunPlaceholders (issue #126 B)', () => {
  it('accepts ${run:dir} and ${run:id} anywhere in a config (env values, args items)', () => {
    expect(() => validateRunPlaceholders({
      type: 'stdio', command: 'npx', args: ['-y', 'pkg', '${run:id}'],
      env: { MEMORY_FILE_PATH: '${run:dir}/memory.jsonl' },
    })).not.toThrow();
  });

  it('throws UnknownRunPlaceholderError on an unrecognized ${run:xxx} name', () => {
    expect(() => validateRunPlaceholders({ env: { X: '${run:bogus}' } })).toThrow(UnknownRunPlaceholderError);
  });

  it('the thrown error carries the literal placeholder text in its message', () => {
    try {
      validateRunPlaceholders({ args: ['${run:nope}'] });
      expect.fail('expected a throw');
    } catch (err) {
      expect((err as Error).message).toContain('${run:nope}');
      expect((err as { code?: string }).code).toBe('UNKNOWN_RUN_PLACEHOLDER');
    }
  });

  it('a config with no placeholders at all never throws', () => {
    expect(() => validateRunPlaceholders({ type: 'http', url: 'https://example.com' })).not.toThrow();
  });
});

describe('resolveRunPlaceholders (issue #126 B)', () => {
  it('substitutes ${run:dir} and ${run:id} in env values and args items, and reports usedDir', () => {
    const { config, usedDir } = resolveRunPlaceholders(
      { type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { MEMORY_FILE_PATH: '${run:dir}/memory.jsonl', RUN: '${run:id}' } },
      { dir: '/state/srv', id: 'run-123' },
    );
    expect(config).toEqual({
      type: 'stdio', command: 'npx', args: ['-y', 'pkg'],
      env: { MEMORY_FILE_PATH: '/state/srv/memory.jsonl', RUN: 'run-123' },
    });
    expect(usedDir).toBe(true);
  });

  it('usedDir is false when the config never references ${run:dir}', () => {
    const { usedDir } = resolveRunPlaceholders({ env: { RUN: '${run:id}' } }, { dir: '/unused', id: 'run-1' });
    expect(usedDir).toBe(false);
  });

  it('is a pure no-op on a config with no placeholders', () => {
    const cfg = { type: 'http', url: 'https://example.com' };
    const { config, usedDir } = resolveRunPlaceholders(cfg, { dir: '/x', id: 'y' });
    expect(config).toEqual(cfg);
    expect(usedDir).toBe(false);
  });
});

describe('mcpStateDir / mcpStateRunDir (issue #126 B — per-run, per-server isolation)', () => {
  it('two different runs of the same server get DIFFERENT directories', () => {
    const a = mcpStateDir('/work/workflows/wf', 'run-a', 'kv');
    const b = mcpStateDir('/work/workflows/wf', 'run-b', 'kv');
    expect(a).not.toBe(b);
  });

  it('the SAME run + server always resolves to the SAME directory (shared across agents in one run)', () => {
    const a = mcpStateDir('/work/workflows/wf', 'run-a', 'kv');
    const b = mcpStateDir('/work/workflows/wf', 'run-a', 'kv');
    expect(a).toBe(b);
  });

  it('two different servers in the SAME run get different directories', () => {
    const a = mcpStateDir('/work/workflows/wf', 'run-a', 'kv');
    const b = mcpStateDir('/work/workflows/wf', 'run-a', 'other-srv');
    expect(a).not.toBe(b);
  });

  it('mcpStateDir sits under mcpStateRunDir', () => {
    const runDir = mcpStateRunDir('/work/workflows/wf', 'run-a');
    const serverDir = mcpStateDir('/work/workflows/wf', 'run-a', 'kv');
    expect(serverDir.startsWith(runDir + '/')).toBe(true);
  });

  it('is NOT inside the run workspace (runs/<runId>) — not reachable via workspace_pull', () => {
    const serverDir = mcpStateDir('/work/workflows/wf', 'run-a', 'kv');
    expect(serverDir).not.toContain('/runs/');
  });

  it('refuses a server name that could escape the state tree (path traversal)', () => {
    expect(() => mcpStateDir('/work/workflows/wf', 'run-a', '../../etc')).toThrow();
    expect(() => mcpStateDir('/work/workflows/wf', 'run-a', '..')).toThrow();
    expect(() => mcpStateDir('/work/workflows/wf', 'run-a', 'a/b')).toThrow();
  });

  it('refuses an unsafe runId the same way', () => {
    expect(() => mcpStateDir('/work/workflows/wf', '../escape', 'kv')).toThrow();
  });
});

describe('workflowFolderOfWorkspace (issue #126 B)', () => {
  it('derives the workflow folder two levels above a run workspace (runWorkspace\'s own layout)', () => {
    expect(workflowFolderOfWorkspace('/work/workflows/wf/runs/run-a')).toBe('/work/workflows/wf');
  });
});
