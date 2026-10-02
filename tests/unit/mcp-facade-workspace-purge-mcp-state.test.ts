// Review v035 M-1: `workspacePurge` (mcp-facade.ts) used to delete only `runs/<runId>` — the run's
// own MCP state dir (`<workflowFolder>/mcp-state/<runId>/`, mcp-run-state.ts, a SIBLING of
// `runs/<runId>` that a stateful stdio MCP server such as server-memory writes into via
// `${run:dir}`) was never touched, so a caller who explicitly purged a run's workspace found its
// tenant data (e.g. a memory graph) still on disk forever — contradicting AUTHORING's and
// tool-specs workspace_push's own promise ("deleted when the run's own workspace is"). Unit test: a
// stubbed RunManager (same pattern as mcp-facade-run-control-refusal-envelope.test.ts), real FS.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpFacade } from '../../src/mcp-facade.js';
import { mcpStateRunDir } from '../../src/mcp-run-state.js';

const PRINCIPAL = { kind: 'auth-disabled' } as const;

function stubRunManager(workspace: string | null): unknown {
  return {
    withTerminalRun: async (_runId: string, fn: () => unknown) => fn(),
    workspacePath: async () => workspace,
  };
}

describe('workspace_purge also removes the run\'s mcp-state dir (review v035 M-1)', () => {
  it('purge removes mcp-state/<runId> alongside runs/<runId>, not just the workspace', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-purge-mcpstate-'));
    const runId = 'run-purge-1';
    const workflowFolder = join(workRoot, 'workflows', 'wf');
    const workspace = join(workflowFolder, 'runs', runId);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'f.txt'), 'x');
    const stateDir = mcpStateRunDir(workflowFolder, runId);
    mkdirSync(join(stateDir, 'mem'), { recursive: true });
    writeFileSync(join(stateDir, 'mem', 'memory.jsonl'), '{"entity":"ENT-P"}');

    const facade = new McpFacade({ runManager: stubRunManager(workspace) } as never);
    const result = await facade.workspacePurge({ runId }, PRINCIPAL);

    expect(result.status).toBe('completed');
    expect(result.result?.purged).toBe(true);
    expect(existsSync(workspace)).toBe(false);
    expect(existsSync(stateDir)).toBe(false); // <-- the gap: this used to stay on disk forever

    rmSync(workRoot, { recursive: true, force: true });
  });

  it('purge is a no-op for a run that declared no stateful MCP server (no mcp-state dir at all) — no throw', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-purge-mcpstate-'));
    const runId = 'run-purge-2';
    const workflowFolder = join(workRoot, 'workflows', 'wf');
    const workspace = join(workflowFolder, 'runs', runId);
    mkdirSync(workspace, { recursive: true });

    const facade = new McpFacade({ runManager: stubRunManager(workspace) } as never);
    const result = await facade.workspacePurge({ runId }, PRINCIPAL);

    expect(result.status).toBe('completed');
    expect(result.result?.purged).toBe(true);
    expect(existsSync(workspace)).toBe(false);

    rmSync(workRoot, { recursive: true, force: true });
  });

  it('a DIFFERENT run\'s mcp-state dir is never touched by this purge', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-purge-mcpstate-'));
    const workflowFolder = join(workRoot, 'workflows', 'wf');
    const purgedRunId = 'run-purge-3';
    const otherRunId = 'run-keep-3';
    const purgedWorkspace = join(workflowFolder, 'runs', purgedRunId);
    mkdirSync(purgedWorkspace, { recursive: true });
    const purgedState = mcpStateRunDir(workflowFolder, purgedRunId);
    mkdirSync(join(purgedState, 'mem'), { recursive: true });
    writeFileSync(join(purgedState, 'mem', 'memory.jsonl'), '{}');
    const otherState = mcpStateRunDir(workflowFolder, otherRunId);
    mkdirSync(join(otherState, 'mem'), { recursive: true });
    writeFileSync(join(otherState, 'mem', 'memory.jsonl'), '{}');

    const facade = new McpFacade({ runManager: stubRunManager(purgedWorkspace) } as never);
    await facade.workspacePurge({ runId: purgedRunId }, PRINCIPAL);

    expect(existsSync(purgedState)).toBe(false);
    expect(existsSync(otherState)).toBe(true);

    rmSync(workRoot, { recursive: true, force: true });
  });
});
