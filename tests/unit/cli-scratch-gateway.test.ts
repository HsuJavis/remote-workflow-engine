// Issue #101 residual (CLI scratch) — the SDK gateway hands every CONFINED dispatch its own CLI
// scratch dir under `<workRoot>/cli-tmp/`: TMPDIR and CLAUDE_CODE_TMPDIR both name it (the CLI falls
// back to `$TMPDIR/claude-<uid>` when the CLAUDE_CODE_TMPDIR-derived path is over 44 bytes, so only
// the pair moves the whole scratch — measured, docs/evidence/issue-101-cli-scratch.md), the host's
// shared `<tmpdir>/claude-<uid>` is denied for reads, and the dir is gone once the call returns.
// Mock policy (unit): vi.mock intercepts only the third-party SDK module (bash-confinement-wiring's
// convention).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentOpts } from '../../src/types.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

type Captured = { options: { env: Record<string, string>; sandbox?: { filesystem?: { denyRead?: string[] } } } };

let workRoot: string;
let workspace: string;
let seenDuringQuery: { exists: boolean; mode: number } | undefined;

beforeEach(() => {
  queryMock.mockReset();
  seenDuringQuery = undefined;
  queryMock.mockImplementation((arg: Captured) => {
    const dir = arg.options.env['CLAUDE_CODE_TMPDIR'];
    if (dir !== undefined) seenDuringQuery = { exists: existsSync(dir), mode: statSync(dir).mode & 0o777 };
    return (async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  });
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rwe-cliscr-')));
  workspace = join(workRoot, 'workflows', 'wf', 'runs', 'run-a');
  mkdirSync(workspace, { recursive: true });
});

afterEach(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

async function client(extra: Record<string, unknown>) {
  const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
  return new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', ...extra } as any);
}

const confinement = () => ({ allowHostPaths: [], protectedFiles: [], workRoot, homeDir: '/home/op', allowReadPaths: [] });

describe('issue #101 per-dispatch CLI scratch (SDK gateway)', () => {
  it('confined + workRoot: TMPDIR === CLAUDE_CODE_TMPDIR, a fresh 0700 dir under <workRoot>/cli-tmp/, removed after the call', async () => {
    const c = await client({ confinementPosture: 'confined', confinement: confinement() });
    const r = await c.invoke({ prompt: 'p', opts: {} as AgentOpts, runId: 'run-a', agentId: 'a1', workspace });
    expect(r.ok).toBe(true);
    const [[call]] = queryMock.mock.calls as [[Captured]];
    const dir = call.options.env['CLAUDE_CODE_TMPDIR'];
    expect(dir).toBeDefined();
    expect(call.options.env['TMPDIR']).toBe(dir);
    expect(dir.startsWith(join(workRoot, 'cli-tmp') + '/')).toBe(true);
    expect(seenDuringQuery).toEqual({ exists: true, mode: 0o700 });
    expect(existsSync(dir)).toBe(false);
    // Only the per-dispatch entry is ever made there, and it is gone.
    expect(readdirSync(join(workRoot, 'cli-tmp'))).toEqual([]);
  });

  it('two dispatches never share a scratch dir', async () => {
    const c = await client({ confinementPosture: 'confined', confinement: confinement() });
    await c.invoke({ prompt: 'p', opts: {} as AgentOpts, runId: 'run-a', agentId: 'a1', workspace });
    await c.invoke({ prompt: 'p', opts: {} as AgentOpts, runId: 'run-a', agentId: 'a2', workspace });
    const [[a], [b]] = queryMock.mock.calls as [[Captured], [Captured]];
    expect(a.options.env['CLAUDE_CODE_TMPDIR']).not.toBe(b.options.env['CLAUDE_CODE_TMPDIR']);
  });

  it("confined + workRoot: the host-shared <tmpdir>/claude-<uid> is on denyRead", async () => {
    const c = await client({ confinementPosture: 'confined', confinement: confinement() });
    await c.invoke({ prompt: 'p', opts: {} as AgentOpts, runId: 'run-a', agentId: 'a1', workspace });
    const [[call]] = queryMock.mock.calls as [[Captured]];
    expect(call.options.sandbox?.filesystem?.denyRead).toContain(join(tmpdir(), `claude-${process.getuid!()}`));
  });

  it('unconfined: no scratch is made — CLAUDE_CODE_TMPDIR absent, TMPDIR is the host value passed through', async () => {
    const c = await client({ confinementPosture: 'unconfined', confinement: confinement() });
    await c.invoke({ prompt: 'p', opts: {} as AgentOpts, runId: 'run-a', agentId: 'a1', workspace });
    const [[call]] = queryMock.mock.calls as [[Captured]];
    expect(call.options.env['CLAUDE_CODE_TMPDIR']).toBeUndefined();
    expect(call.options.env['TMPDIR']).toBe(process.env['TMPDIR']);
    expect(existsSync(join(workRoot, 'cli-tmp'))).toBe(false);
  });

  it('a workRoot too long for the CLI\'s unix sockets refuses typed, before any session', async () => {
    const deep = join(workRoot, 'x'.repeat(80));
    const ws = join(deep, 'workflows', 'wf', 'runs', 'run-a');
    mkdirSync(ws, { recursive: true });
    const c = await client({ confinementPosture: 'confined', confinement: { ...confinement(), workRoot: deep } });
    const r = await c.invoke({ prompt: 'p', opts: {} as AgentOpts, runId: 'run-a', agentId: 'a1', workspace: ws });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.detail).toMatch(/^CLI_SCRATCH_PATH_TOO_LONG: /);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('an uncreatable scratch dir refuses typed (fail closed — never falls back to the shared scratch)', async () => {
    // A FILE where the scratch parent must go: mkdir under it fails.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(workRoot, 'cli-tmp'), 'not a dir');
    const c = await client({ confinementPosture: 'confined', confinement: confinement() });
    const r = await c.invoke({ prompt: 'p', opts: {} as AgentOpts, runId: 'run-a', agentId: 'a1', workspace });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.detail).toMatch(/^CLI_SCRATCH_UNAVAILABLE: /);
    expect(queryMock).not.toHaveBeenCalled();
  });

  // #101 follow-up: the scratch dir used to be created (~L882) but only dropped at the
  // aborted-before-dispatch return and in the post-query() race's own finally — a throw from
  // anywhere in between (a caller-supplied `onHarness` included) escaped BOTH of those and left the
  // per-dispatch dir under `<workRoot>/cli-tmp/` on disk until the next engine boot's sweep.
  it('a throwing onHarness still drops the per-dispatch CLI scratch dir', async () => {
    const c = await client({ confinementPosture: 'confined', confinement: confinement() });
    const boom = new Error('onHarness blew up');
    await expect(c.invoke({
      prompt: 'p',
      opts: {} as AgentOpts,
      runId: 'run-a',
      agentId: 'a1',
      workspace,
      onHarness: async () => { throw boom; },
    })).rejects.toThrow('onHarness blew up');
    // the scratch dir it made for this dispatch must not have leaked
    expect(readdirSync(join(workRoot, 'cli-tmp'))).toEqual([]);
    // and query() must never have even been reached — onHarness fires before the CLI is spawned
    expect(queryMock).not.toHaveBeenCalled();
  });
});
