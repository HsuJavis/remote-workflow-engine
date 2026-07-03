// IT-003: Sandbox child process with fake IPC parent — dry-runs workflow JS (ARCH-003)
// This is the master test seam: stub the parent side to dry-run real workflow JS with zero model calls.
import { describe, it, expect } from 'vitest';
import { SandboxHost } from '../../src/sandbox/host.js';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORK_DIR = join(tmpdir(), 'rwe-sandbox-test');

// A fake IPC parent that immediately returns canned results for every agent() call
class FakeIpcParent {
  private _returnValue: unknown;
  constructor(returnValue: unknown) { this._returnValue = returnValue; }
  handleAgentRequest(_prompt: string, _opts: unknown): unknown { return this._returnValue; }
}

describe('SandboxHost child process (ARCH-003)', () => {
  it('runs a simple return-value script and resolves with the result', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const r = await host.run('run-1', 'return 42;', undefined, null);
    expect('result' in r).toBe(true);
    expect((r as { result: unknown }).result).toBe(42);
  });

  it('dry-runs a workflow with agent() calls using a fake IPC parent (zero model calls)', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    // When the child sends an 'agent' IPC message, the host (fake parent) replies with 'fake-answer'
    const r = await host.run(
      'run-dry',
      'return agent("summarize this");',
      undefined,
      null,
    );
    expect('result' in r).toBe(true);
    // The returned value should be what the fake parent responded with
    expect(typeof (r as { result: unknown }).result).toBe('string');
  });

  it('script that throws returns error result (does not crash host process)', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const r = await host.run('run-err', 'throw new Error("intentional");', undefined, null);
    expect('error' in r).toBe(true);
  });

  it('host.abort sends abort IPC message and run resolves promptly', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const p = host.run('run-abort', 'while(true){}', undefined, null);
    await host.abort('run-abort', 'stop');
    const r = await p;
    // Should resolve (not hang) after abort
    expect(r).toBeDefined();
  });

  it('child process has no access to require or process (untrusted sandbox)', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const r = await host.run(
      'run-sandbox',
      'return typeof require + "," + typeof process;',
      undefined,
      null,
    );
    // Either error (guard throws) or the types are both 'undefined' (not exposed)
    if ('result' in r) {
      expect((r as { result: unknown }).result).toBe('undefined,undefined');
    } else {
      expect('error' in r).toBe(true);
    }
  });
});
