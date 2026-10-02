// issue #129(a): the workspace_push stdio-MCP probe used to leave a grandchild process running
// after a successful (or failed/timed-out) probe — a bare `child.kill()` only signals the direct
// child. Fixed: the probe spawn is DETACHED (its own process group) and the whole group is reaped
// via `cli-lifecycle.ts`'s `RealCliLifecycle.killGroup` once the probe settles.
//
// issue #126 B: the probe also resolves `${run:dir}`/`${run:id}` against a disposable temp dir
// before spawning, so a config that references `${run:dir}` in `env` is actually launchable at
// push time (not handed the literal placeholder text).
//
// Mock policy (integration, per cli-lifecycle-process-group.test.ts's own "stub child" carve-out):
// a REAL detached process tree is spawned and killed; only the probed "npx" executable itself is a
// fake script (never a real network/package fetch at this tier) named `npx` on PATH, since
// `classifyTransport` only ever probes `command === 'npx'`.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealMcpProbe } from '../../src/mcp-probe.js';

let binDir: string | undefined;
afterEach(() => {
  if (binDir) rmSync(binDir, { recursive: true, force: true });
  binDir = undefined;
});

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Writes a fake `npx` on a fresh PATH-prepended bin dir. The script forks a long-lived
 *  grandchild (`sleep 100`), records its pid to `pidFile`, optionally touches `$MEMORY_FILE_PATH`
 *  (to prove an `env` value survives verbatim through the probe's spawn), then exits quickly with
 *  `exitCode` — simulating a real server-runnable `npx` package's fast "launchable" check. */
function installFakeNpx(pidFile: string, exitCode = 0): string {
  binDir = mkdtempSync(join(tmpdir(), 'rwe-fake-npx-'));
  const script = join(binDir, 'npx');
  writeFileSync(script, `#!/bin/sh\nsleep 100 &\necho $! > "${pidFile}"\nif [ -n "$MEMORY_FILE_PATH" ]; then echo ok > "$MEMORY_FILE_PATH"; fi\nexit ${exitCode}\n`);
  chmodSync(script, 0o755);
  process.env['PATH'] = `${binDir}:${process.env['PATH']}`;
  return binDir;
}

describe('RealMcpProbe — process-group reap (issue #129a)', () => {
  it('a grandchild forked by the probed stdio command is dead after a successful probe', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'rwe-pidfile-')), 'grandchild.pid');
    installFakeNpx(pidFile);
    const probe = new RealMcpProbe();
    const result = await probe.probe({ type: 'stdio', command: 'npx', args: ['-y', 'fake-pkg'] });
    expect(result.ok).toBe(true);
    // Give the fake script a moment to write the pid file and fork.
    await new Promise((r) => setTimeout(r, 200));
    const grandchildPid = Number(readFileSync(pidFile, 'utf-8').trim());
    expect(Number.isFinite(grandchildPid)).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(pidAlive(grandchildPid)).toBe(false);
  }, 10000);

  it('a grandchild is also reaped when the probed command exits non-zero (PROBE_FAILED)', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'rwe-pidfile-')), 'grandchild.pid');
    installFakeNpx(pidFile, 7);
    const probe = new RealMcpProbe();
    const result = await probe.probe({ type: 'stdio', command: 'npx', args: ['-y', 'fake-pkg'] });
    expect(result.ok).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    const grandchildPid = Number(readFileSync(pidFile, 'utf-8').trim());
    await new Promise((r) => setTimeout(r, 300));
    expect(pidAlive(grandchildPid)).toBe(false);
  }, 10000);
});

function leakedProbeTempDirs(): string[] {
  return readdirSync(tmpdir()).filter((n) => n.startsWith('rwe-mcp-probe-'));
}

describe('RealMcpProbe — ${run:dir} resolution at push time (issue #126 B)', () => {
  it('resolves ${run:dir} in env to a real writable temp dir, then removes it after the probe', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'rwe-pidfile-')), 'grandchild.pid');
    installFakeNpx(pidFile);
    const before = leakedProbeTempDirs();
    const probe = new RealMcpProbe();
    // The fake script writes a file INTO $MEMORY_FILE_PATH's directory without `mkdir -p` — if
    // the probe handed it the literal, unresolved "${run:dir}/memory.jsonl" text, the `sh -c`
    // redirect would fail to open a path with literal `${`/`}` characters in a nonexistent
    // directory and the script would exit non-zero; a real, pre-created temp dir lets it succeed.
    const result = await probe.probe({
      type: 'stdio', command: 'npx', args: ['-y', 'fake-pkg'],
      env: { MEMORY_FILE_PATH: '${run:dir}/memory.jsonl' },
    });
    expect(result.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    // The probe's own temp dir is removed again once it settles — never left behind.
    expect(leakedProbeTempDirs()).toEqual(before);
  }, 10000);

  it('rejects nothing extra when the config has no ${run:...} placeholders at all (unchanged behavior)', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'rwe-pidfile-')), 'grandchild.pid');
    installFakeNpx(pidFile);
    const probe = new RealMcpProbe();
    const result = await probe.probe({ type: 'stdio', command: 'npx', args: ['-y', 'fake-pkg'] });
    expect(result).toEqual({ ok: true });
  }, 10000);

  // review v035 L-3: a config with `${run:id}` in `args` but NO `env` and NO `${run:dir}` used to be
  // probed with the LITERAL `${run:id}` text — `_probeStdioConfig` only resolved placeholders when
  // `${run:dir}` appeared (to create a probe temp dir) or `env` was present (an `else if` branch),
  // leaving an args-only `${run:id}` config unresolved. Fixed: both placeholders are resolved in
  // args and env unconditionally at probe time.
  it('L-3: resolves ${run:id} in args even with no env and no ${run:dir} (previously left as the literal text)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-pidfile-'));
    const pidFile = join(dir, 'grandchild.pid');
    const argsFile = join(dir, 'args.txt');
    binDir = mkdtempSync(join(tmpdir(), 'rwe-fake-npx-'));
    const script = join(binDir, 'npx');
    writeFileSync(script, `#!/bin/sh\nsleep 100 &\necho $! > "${pidFile}"\necho "$@" > "${argsFile}"\nexit 0\n`);
    chmodSync(script, 0o755);
    process.env['PATH'] = `${binDir}:${process.env['PATH']}`;
    const probe = new RealMcpProbe();
    const result = await probe.probe({ type: 'stdio', command: 'npx', args: ['-y', 'fake-pkg', '--session=${run:id}'] });
    expect(result.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    const receivedArgs = readFileSync(argsFile, 'utf-8').trim();
    expect(receivedArgs).toBe('-y fake-pkg --session=probe');
  }, 10000);
});
