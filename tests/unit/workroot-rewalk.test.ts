// UT-320/UT-321 (DES-257, ARCH-180, TASK-253, REQ-219) — findProjectMarkerAboveWorkspace(),
// REQ-021's intra-run re-walk WIRED for the first time, walking ABOVE the workspace so the engine's
// own git/CLAUDE.md markers at the workspace root are ALLOWED (the architecture's first draft had
// this flipped and refused every seeded run). UT-320 exercises the pure function directly (real fs,
// no injected deps — same convention as workroot-guard.ts's own assertWorkRootIsolated tests);
// UT-321 exercises the GATEWAY wiring (the refusal must call queryImpl ZERO times).
// Written test-first (Gate 5, RED): findProjectMarkerAboveWorkspace does not exist yet, and the
// gateway never calls it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentOpts } from '../../src/types.js';

describe('UT-320 findProjectMarkerAboveWorkspace() — pure, real fs — the six-arm table (DES-257)', () => {
  it("a .git at the workspace root (the engine's own initGitBaseline) is ALLOWED — the regression this row exists to guard", async () => {
    const { findProjectMarkerAboveWorkspace } = await import('../../src/workroot-guard.js');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-rewalk-'));
    const workspace = join(workRoot, 'workflows', 'wf', 'runs', 'run-1');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, '.git'), 'gitdir: ...');
    expect(findProjectMarkerAboveWorkspace(workspace, workRoot)).toBeNull();
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('a CLAUDE.md at the workspace root (a seeded repo) is ALLOWED', async () => {
    const { findProjectMarkerAboveWorkspace } = await import('../../src/workroot-guard.js');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-rewalk-'));
    const workspace = join(workRoot, 'workflows', 'wf', 'runs', 'run-1');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'CLAUDE.md'), '# seeded');
    expect(findProjectMarkerAboveWorkspace(workspace, workRoot)).toBeNull();
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('a marker at an ancestor BETWEEN the workspace and workRoot is REFUSED', async () => {
    const { findProjectMarkerAboveWorkspace } = await import('../../src/workroot-guard.js');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-rewalk-'));
    const wfDir = join(workRoot, 'workflows', 'wf');
    const workspace = join(wfDir, 'runs', 'run-1');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(wfDir, '.git'), 'gitdir: ...');
    expect(findProjectMarkerAboveWorkspace(workspace, workRoot)).toBe(wfDir);
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('workspace === workRoot (degenerate config) is ALLOWED, short-circuited BEFORE the walk', async () => {
    const { findProjectMarkerAboveWorkspace } = await import('../../src/workroot-guard.js');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-rewalk-'));
    expect(findProjectMarkerAboveWorkspace(workRoot, workRoot)).toBeNull();
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('a workspace that is a symlink into a project is REFUSED (realpath first, on the containment check itself)', async () => {
    const { findProjectMarkerAboveWorkspace } = await import('../../src/workroot-guard.js');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-rewalk-'));
    const project = mkdtempSync(join(tmpdir(), 'rwe-rewalk-project-'));
    writeFileSync(join(project, '.git'), 'gitdir: ...');
    const real = join(project, 'sub', 'workspace');
    mkdirSync(real, { recursive: true });
    const link = join(workRoot, 'run-link');
    symlinkSync(real, link);
    expect(findProjectMarkerAboveWorkspace(link, workRoot)).not.toBeNull();
    rmSync(workRoot, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });
});

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

describe('UT-321 the gateway wires the re-walk BEFORE query() (DES-257 gateway integration)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
  });

  it('a refusal calls queryImpl ZERO times and returns {ok:false, reason:"terminal", retryable:false, detail: WORKROOT_INSIDE_PROJECT}', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const { WORKROOT_INSIDE_PROJECT } = await import('../../src/workroot-guard.js');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-rewalk-gw-'));
    const wfDir = join(workRoot, 'workflows', 'wf');
    const workspace = join(wfDir, 'runs', 'run-1');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(wfDir, '.git'), 'gitdir: ...');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4000',
      confinement: { allowHostPaths: [], protectedFiles: [], workRoot },
    } as any);
    const opts: AgentOpts = {};
    const result = await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace });
    expect(queryMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, reason: 'terminal', retryable: false });
    expect((result as { detail?: string }).detail).toContain(WORKROOT_INSIDE_PROJECT);
    rmSync(workRoot, { recursive: true, force: true });
  });

  it("a run created via the engine's own initGitBaseline (.git at the workspace root) is ALLOWED — query() runs", async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-rewalk-gw-'));
    const workspace = join(workRoot, 'workflows', 'wf', 'runs', 'run-1');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, '.git'), 'gitdir: ...');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4000',
      confinement: { allowHostPaths: [], protectedFiles: [], workRoot },
    } as any);
    const opts: AgentOpts = {};
    const result = await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('workRoot unknown on this call (no confinement configured) — the re-walk is SKIPPED, query() proceeds (neither fail-open nor fail-closed on a missing config)', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const opts: AgentOpts = {};
    const result = await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace: '/tmp/remote-workflow-runs/_adhoc/run-f' });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });
});
