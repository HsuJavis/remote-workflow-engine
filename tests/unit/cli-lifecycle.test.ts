// UT-049: D-PROC per-agent CLI subprocess lifecycle — injected spawn/kill seam (DES-029, TASK-037)
// RED: src/cli-lifecycle.js does not exist yet — all tests fail on module-not-found.
// Mock policy (unit tier): injected spawnImpl/killImpl — never a real `claude` CLI process.
import { describe, it, expect, vi } from 'vitest';
// Value import — causes module-not-found at load time when the module is absent.
import { RealCliLifecycle } from '../../src/cli-lifecycle.js';

function fakeChild(pid = 4242) {
  return { pid, kill: vi.fn() };
}

describe('CliLifecycle.spawnDetached — own process group (DES-029)', () => {
  it('spawns via the injected spawnImpl with detached:true so the CLI owns its own process group', () => {
    const spawnImpl = vi.fn().mockReturnValue(fakeChild());
    const lifecycle = new RealCliLifecycle({ spawnImpl, killImpl: vi.fn() });
    lifecycle.spawnDetached('claude', ['--print'], { cwd: '/work' });
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const [, , opts] = spawnImpl.mock.calls[0] as [string, string[], { detached?: boolean }];
    expect(opts.detached).toBe(true);
  });
});

describe('CliLifecycle.killGroup — kills the WHOLE process group exactly once (DES-029)', () => {
  it('calls the injected killImpl exactly once with the negative pid (process-group kill convention)', () => {
    const spawnImpl = vi.fn().mockReturnValue(fakeChild(4242));
    const killImpl = vi.fn();
    const lifecycle = new RealCliLifecycle({ spawnImpl, killImpl });
    const handle = lifecycle.spawnDetached('claude', ['--print'], { cwd: '/work' });
    lifecycle.killGroup(handle);
    expect(killImpl).toHaveBeenCalledTimes(1);
    expect(killImpl).toHaveBeenCalledWith(-4242, expect.any(String));
  });

  it('never calls a real process.kill directly (only the injected seam) — no real `claude` CLI spawned in this tier', () => {
    const spawnImpl = vi.fn().mockReturnValue(fakeChild());
    const killImpl = vi.fn();
    const realKillSpy = vi.spyOn(process, 'kill');
    const lifecycle = new RealCliLifecycle({ spawnImpl, killImpl });
    const handle = lifecycle.spawnDetached('claude', [], { cwd: '/work' });
    lifecycle.killGroup(handle);
    expect(realKillSpy).not.toHaveBeenCalled();
    realKillSpy.mockRestore();
  });
});

describe('CliLifecycle.cleanupTemp — removes the session temp dir (DES-029)', () => {
  it('calls the injected rmImpl with the handle temp dir, recursive+force', () => {
    const spawnImpl = vi.fn().mockReturnValue(fakeChild());
    const rmImpl = vi.fn();
    const lifecycle = new RealCliLifecycle({ spawnImpl, killImpl: vi.fn(), rmImpl });
    const handle = lifecycle.spawnDetached('claude', [], { cwd: '/work', tempDir: '/tmp/rwe-session-1' });
    lifecycle.cleanupTemp(handle);
    expect(rmImpl).toHaveBeenCalledWith('/tmp/rwe-session-1', expect.objectContaining({ recursive: true, force: true }));
  });
});
