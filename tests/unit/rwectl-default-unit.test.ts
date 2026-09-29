// deploy/rwectl passes systemctl verbs straight through to `systemctl --user "$@"`. For the
// unit-taking verbs (restart/status/stop/start/is-active/enable/disable) a bare `rwectl restart`
// used to forward zero arguments to systemctl, which fails with "Too few arguments." — every
// day-2 example in DEPLOY.md §6c always spelled out `rwe.service` to work around it. This test
// pins the fix: those verbs default the unit to `rwe.service` when none is given, while a unit
// that IS given (or any other systemctl verb, e.g. `daemon-reload`) passes through unchanged.
//
// Mock policy: `sudo`/`id`/`getent`/`systemctl` are stubbed on PATH so the test never touches a
// real systemd user instance or needs privilege — this is a pure argv-shape assertion on the
// rwectl script itself, no engine/service involved.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const RWECTL = join(REPO_ROOT, 'deploy', 'rwectl');

let stubDir: string;

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'rwectl-stubs-'));
  const stub = (name: string, body: string) => {
    const p = join(stubDir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
  };
  // id -u rwe → a fake uid
  stub('id', 'if [ "$1" = "-u" ]; then echo 997; else exit 1; fi');
  // getent passwd rwe → one passwd(5) line so `cut -d: -f6` yields a home dir
  stub('getent', 'if [ "$1" = "passwd" ]; then echo "rwe:x:997:997::/home/rwe:/usr/sbin/nologin"; fi');
  // sudo → run the wrapped command directly (no privilege needed for this argv-shape test);
  // strip a leading `-u <user>` the way real sudo does, since `exec` treats its first word as
  // the program name, not an option it understands.
  stub('sudo', 'if [ "$1" = "-u" ]; then shift 2; fi\nexec "$@"');
  // systemctl → print exactly what it was invoked with, so we can assert on the final argv
  stub('systemctl', 'echo "systemctl $*"');
});

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

function run(...args: string[]): string {
  return execFileSync('bash', [RWECTL, ...args], {
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, RWE_USER: 'rwe' },
    encoding: 'utf8',
  }).trim();
}

describe('deploy/rwectl defaults the unit to rwe.service for the unit-taking verbs', () => {
  it('rwectl restart (no unit) → systemctl --user restart rwe.service', () => {
    expect(run('restart')).toBe('systemctl --user restart rwe.service');
  });

  it('rwectl restart foo.service passes through unchanged', () => {
    expect(run('restart', 'foo.service')).toBe('systemctl --user restart foo.service');
  });

  it.each(['status', 'stop', 'start', 'is-active', 'enable', 'disable'])(
    'rwectl %s (no unit) defaults to rwe.service',
    (verb) => {
      expect(run(verb)).toBe(`systemctl --user ${verb} rwe.service`);
    },
  );

  it('a verb that never takes a bare unit (e.g. daemon-reload) is untouched', () => {
    expect(run('daemon-reload')).toBe('systemctl --user daemon-reload');
  });

  it('cat rwe.service (explicit unit, non-defaulted verb) passes through unchanged', () => {
    expect(run('cat', 'rwe.service')).toBe('systemctl --user cat rwe.service');
  });
});
