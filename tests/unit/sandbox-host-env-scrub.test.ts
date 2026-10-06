// Issue #157 B1, layer (2) — defense in depth: `SandboxHost.run()` forked the sandbox child with no
// `env:` override at all, so Node's default (full parent env) applied. The realm-escape fix
// (guards.ts, commit 149d887) closes the REACHABILITY of `process`/`fetch` from script — this closes
// the second, independent half: even if some future regression reopens a reachability path, the
// child process itself should not be CARRYING the parent's secrets (provider API keys per main.ts's
// own documented "read straight from process.env") in the first place.
//
// child-entry.ts and guards.ts read no `process.env.*` of their own (grepped before writing this
// test) — the forked child's own code needs nothing from the environment, so the strictest posture
// (an empty env) is both correct and sufficient; confirmed separately (see this fix's own commit
// body) that a child forked with `env: {}` boots and runs a real script successfully.
//
// Mock policy (unit): `node:child_process`'s `fork` is mocked to capture the options SandboxHost
// actually passes, with a minimal fake ChildProcess (EventEmitter-based) standing in for the real
// forked process — no real process is spawned, matching this file's unit tier.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const forkCalls: Array<{ modulePath: string; args: unknown; options: Record<string, unknown> }> = [];

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  send(msg: unknown): boolean {
    // Auto-reply so SandboxHost.run()'s promise settles without a real process.
    const m = msg as { t: string };
    if (m.t === 'start') {
      queueMicrotask(() => this.emit('message', { t: 'done', runId: 'fake', result: 'ok' }));
    }
    return true;
  }
  kill(): boolean {
    return true;
  }
}

vi.mock('node:child_process', () => ({
  fork: vi.fn((modulePath: string, args: unknown, options: Record<string, unknown>) => {
    forkCalls.push({ modulePath, args, options });
    const child = new FakeChild();
    queueMicrotask(() => child.emit('message', { t: 'ready' }));
    return child;
  }),
}));

import { SandboxHost, SANDBOX_CHILD_EXEC_ARGV } from '../../src/sandbox/host.js';

const SENTINEL = 'RWE_157_HOST_ENV_SCRUB_SENTINEL';

describe('#157 B1 layer 2: SandboxHost.run() does not hand the forked child the parent env', () => {
  beforeEach(() => {
    forkCalls.length = 0;
  });

  it('fork() is called with an explicit `env` override, not left to inherit the default (undefined)', async () => {
    const host = new SandboxHost({ workspaceRoot: '/tmp/rwe-env-scrub-test' });
    await host.run('r1', 'return 1;', {}, null);
    expect(forkCalls).toHaveLength(1);
    expect(forkCalls[0]!.options.env).toBeDefined();
  });

  it('a secret set only in THIS (parent) process is NOT present in the env fork() is called with', async () => {
    process.env[SENTINEL] = 'leaked-if-you-can-see-this';
    try {
      const host = new SandboxHost({ workspaceRoot: '/tmp/rwe-env-scrub-test' });
      await host.run('r2', 'return 1;', {}, null);
      const env = forkCalls[0]!.options.env as Record<string, unknown> | undefined;
      expect(env?.[SENTINEL]).toBeUndefined();
    } finally {
      delete process.env[SENTINEL];
    }
  });

  it('a real-looking provider key name is not present in the env fork() is called with', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fake-for-this-test-only';
    try {
      const host = new SandboxHost({ workspaceRoot: '/tmp/rwe-env-scrub-test' });
      await host.run('r3', 'return 1;', {}, null);
      const env = forkCalls[0]!.options.env as Record<string, unknown> | undefined;
      expect(env?.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

// #157 layer 3 (OS/Node-level containment): `fork()` must launch the sandbox child with Node's
// permission model enabled and scoped to the minimum the child's own module graph needs — see
// `SANDBOX_CHILD_EXEC_ARGV`'s own doc in host.ts for why exactly `src/*` (never `node_modules`) is
// both necessary and sufficient, and why none of the other --allow-* flags are granted.
describe('#157 layer 3: SandboxHost.run() launches the child under Node\'s permission model', () => {
  beforeEach(() => {
    forkCalls.length = 0;
  });

  it('fork() execArgv enables --permission with exactly one --allow-fs-read scope', async () => {
    const host = new SandboxHost({ workspaceRoot: '/tmp/rwe-env-scrub-test' });
    await host.run('r4', 'return 1;', {}, null);
    const execArgv = forkCalls[0]!.options.execArgv as string[];
    expect(execArgv).toContain('--permission');
    const fsReadFlags = execArgv.filter((a) => a.startsWith('--allow-fs-read='));
    expect(fsReadFlags).toHaveLength(1);
  });

  it('fork() execArgv grants none of --allow-fs-write / --allow-child-process / --allow-worker / --allow-addons / --allow-wasi', async () => {
    const host = new SandboxHost({ workspaceRoot: '/tmp/rwe-env-scrub-test' });
    await host.run('r5', 'return 1;', {}, null);
    const execArgv = forkCalls[0]!.options.execArgv as string[];
    for (const forbidden of ['--allow-fs-write', '--allow-child-process', '--allow-worker', '--allow-addons', '--allow-wasi']) {
      expect(execArgv.some((a) => a === forbidden || a.startsWith(`${forbidden}=`)), `${forbidden} must not be granted`).toBe(false);
    }
  });

  it('SANDBOX_CHILD_EXEC_ARGV is the exact array fork() receives (no caller-side drift)', async () => {
    const host = new SandboxHost({ workspaceRoot: '/tmp/rwe-env-scrub-test' });
    await host.run('r6', 'return 1;', {}, null);
    const execArgv = forkCalls[0]!.options.execArgv as string[];
    expect(execArgv).toEqual([...SANDBOX_CHILD_EXEC_ARGV]);
  });
});
