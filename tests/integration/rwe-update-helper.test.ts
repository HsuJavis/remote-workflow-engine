// IT-062 (DES-060, ARCH-039, REQ-069): rwe-update.sh child-process integration harness.
// Real git against a throwaway local repo; NPM/SYSTEMCTL are fake shims recording argv.
// TEST-FIRST (RED): deploy/rwe-update.sh does not exist yet; execFile → ENOENT.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync,
  existsSync, rmSync, utimesSync,
} from 'node:fs';
import { execFileSync, execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const execFile = promisify(_execFile);

const HELPER = resolve('deploy/rwe-update.sh');

// ─── test harness helpers ──────────────────────────────────────────────────────

/** Write and chmod +x a shim script that records its argv and exits with a given code. */
function makeShim(dir: string, name: string, exitCode: number, recordFile?: string): string {
  const p = join(dir, name);
  const record = recordFile ? `echo "$@" >> "${recordFile}"` : '';
  writeFileSync(p, `#!/bin/sh\n${record}\nexit ${exitCode}\n`);
  chmodSync(p, 0o755);
  return p;
}

/** Run git with identity flags so the harness doesn't depend on host git config. */
function gitIdentity(): string[] {
  return ['-c', 'user.email=test@test.local', '-c', 'user.name=Test'];
}

/** Initialize a non-bare "official remote" repo with one commit and a tag.
 * Non-bare avoids the bare-repo HEAD/branch mismatch that makes `git clone` produce an empty tree. */
function initRemote(dir: string, tag: string): string {
  const repoDir = join(dir, 'remote');
  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', [...gitIdentity(), 'init', repoDir]);
  writeFileSync(join(repoDir, 'README'), `version ${tag}`);
  execFileSync('git', [...gitIdentity(), 'add', '.'], { cwd: repoDir });
  execFileSync('git', [...gitIdentity(), 'commit', '-m', `release ${tag}`], { cwd: repoDir });
  execFileSync('git', [...gitIdentity(), 'tag', tag], { cwd: repoDir });
  return repoDir;
}

/** Initialize the "working" engine repo that clones from remote. */
function initWorking(dir: string, remoteDir: string): string {
  const workDir = join(dir, 'working');
  execFileSync('git', [...gitIdentity(), 'clone', remoteDir, workDir]);
  return workDir;
}

/** Run the helper script with injected env seams. Returns exit code. */
async function runHelper(opts: {
  flagContent?: string;
  workDir: string;
  remoteDir: string;
  shimDir: string;
  npmExitCode?: number;
  npmRecordFile?: string;
  extraEnv?: Record<string, string>;
  systemctlRecordFile?: string;
  flagPath: string;
  resultPath: string;
  lockPath: string;
}): Promise<{ exitCode: number; result: string | null }> {
  const { flagPath, resultPath, lockPath, workDir, remoteDir, shimDir } = opts;
  if (opts.flagContent !== undefined) {
    writeFileSync(flagPath, opts.flagContent);
  }
  const npmShim = makeShim(shimDir, 'npm', opts.npmExitCode ?? 0);
  if (opts.npmRecordFile) {
    writeFileSync(npmShim, `#!/bin/sh\necho "$1 TMPDIR=$TMPDIR" >> "${opts.npmRecordFile}"\nexit ${opts.npmExitCode ?? 0}\n`);
  }
  const systemctlRecord = opts.systemctlRecordFile ?? join(shimDir, 'systemctl-calls.txt');
  const systemctlShim = makeShim(shimDir, 'systemctl', 0, systemctlRecord);

  let exitCode = 0;
  try {
    await execFile(HELPER, [], {
      env: {
        ...process.env,
        RWE_UPDATE_FLAG: flagPath,
        RWE_UPDATE_RESULT: resultPath,
        RWE_UPDATE_LOCK: lockPath,
        RWE_OFFICIAL_REMOTE: remoteDir,
        NPM: npmShim,
        SYSTEMCTL: systemctlShim,
        GIT: 'git',
        HOME: shimDir,  // prevent ~/.gitconfig from interfering
        ...opts.extraEnv,
      },
      cwd: workDir,
    });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e) {
      exitCode = (e as { code: number }).code ?? 0;
    } else {
      throw e;
    }
  }

  const result = existsSync(resultPath) ? readFileSync(resultPath, 'utf-8') : null;
  return { exitCode, result };
}

// ─── describe: helper happy paths and failure modes ───────────────────────────

let rootDir: string;
beforeAll(() => { rootDir = mkdtempSync(join(tmpdir(), 'rwe-it062-')); });
afterAll(() => { rmSync(rootDir, { recursive: true, force: true }); });

describe('rwe-update.sh child-process harness (DES-060)', () => {
  it('valid tag in flag → git checkout that SHA + SYSTEMCTL called, result=applied, exit 0', async () => {
    const caseDir = join(rootDir, 'valid');
    mkdirSync(caseDir, { recursive: true });
    const remoteDir = initRemote(caseDir, 'v1.0.0');
    const workDir = initWorking(caseDir, remoteDir);
    const flagPath = join(caseDir, 'update.flag');
    const resultPath = join(caseDir, 'result.json');
    const lockPath = join(caseDir, 'update.lock');
    const shimDir = join(caseDir, 'shims');
    mkdirSync(shimDir, { recursive: true });
    const systemctlRecord = join(shimDir, 'systemctl-calls.txt');

    const { exitCode, result } = await runHelper({
      flagContent: 'v1.0.0\n', workDir, remoteDir, shimDir,
      flagPath, resultPath, lockPath,
      systemctlRecordFile: systemctlRecord,
    });

    expect(exitCode).toBe(0);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.status).toBe('applied');
    expect(parsed.tag).toBe('v1.0.0');
    // SYSTEMCTL restart was called
    expect(existsSync(systemctlRecord)).toBe(true);
    expect(readFileSync(systemctlRecord, 'utf-8')).toContain('restart');
    // Flag consumed (not present in original path)
    expect(existsSync(flagPath)).toBe(false);
  }, 30000);

  it('foreign/nonexistent ref → exit 20, nothing changed, no result written', async () => {
    const caseDir = join(rootDir, 'foreign');
    mkdirSync(caseDir, { recursive: true });
    const remoteDir = initRemote(caseDir, 'v1.0.0');
    const workDir = initWorking(caseDir, remoteDir);
    const flagPath = join(caseDir, 'update.flag');
    const resultPath = join(caseDir, 'result.json');
    const lockPath = join(caseDir, 'update.lock');
    const shimDir = join(caseDir, 'shims');
    mkdirSync(shimDir, { recursive: true });

    const { exitCode, result } = await runHelper({
      flagContent: 'v9.9.9-nonexistent\n',
      workDir, remoteDir, shimDir, flagPath, resultPath, lockPath,
    });

    expect(exitCode).toBe(20);
    // No result file written (the call failed before the build/checkout)
    expect(result).toBeNull();
  }, 30000);

  it('failing NPM → exit 30, SYSTEMCTL NOT called, tree at prior SHA, result=failed', async () => {
    const caseDir = join(rootDir, 'failnpm');
    mkdirSync(caseDir, { recursive: true });
    const remoteDir = initRemote(caseDir, 'v1.0.0');
    const workDir = initWorking(caseDir, remoteDir);
    const flagPath = join(caseDir, 'update.flag');
    const resultPath = join(caseDir, 'result.json');
    const lockPath = join(caseDir, 'update.lock');
    const shimDir = join(caseDir, 'shims');
    mkdirSync(shimDir, { recursive: true });
    const systemctlRecord = join(shimDir, 'systemctl-calls.txt');

    const priorSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf-8' }).trim();

    const { exitCode, result } = await runHelper({
      flagContent: 'v1.0.0\n',
      workDir, remoteDir, shimDir,
      flagPath, resultPath, lockPath,
      npmExitCode: 1,
      systemctlRecordFile: systemctlRecord,
    });

    expect(exitCode).toBe(30);
    // SYSTEMCTL must NOT have been called (safe-fail: abort before restart)
    expect(existsSync(systemctlRecord)).toBe(false);
    // Working tree stays at the prior SHA
    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf-8' }).trim();
    expect(headAfter).toBe(priorSha);
    // Result file records the failure
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.status).toBe('failed');
    expect(parsed.tag).toBe('v1.0.0');
  }, 30000);

  it('flag absent at trigger time → exit 0 (clean no-op, not failure)', async () => {
    const caseDir = join(rootDir, 'absent');
    mkdirSync(caseDir, { recursive: true });
    const remoteDir = initRemote(caseDir, 'v1.0.0');
    const workDir = initWorking(caseDir, remoteDir);
    const flagPath = join(caseDir, 'update.flag');
    const resultPath = join(caseDir, 'result.json');
    const lockPath = join(caseDir, 'update.lock');
    const shimDir = join(caseDir, 'shims');
    mkdirSync(shimDir, { recursive: true });

    // Do NOT write the flag (simulates a post-consume re-fire from systemd .path unit)
    const { exitCode, result } = await runHelper({
      // flagContent deliberately absent
      workDir, remoteDir, shimDir, flagPath, resultPath, lockPath,
    });

    // Must be clean exit 0 (not exit 10 / failure) — systemd should not mark the oneshot failed
    expect(exitCode).toBe(0);
    expect(result).toBeNull();
  }, 30000);
});

// 2026-10-09: the v0.37.9 self-update failed twice because `npm test` ran in the shared /tmp tmpfs —
// other users' scratch pushed free space under the engine's 5 GiB DISK_LOW floor, so ~290 tests
// failed and the deploy reverted. The test gate now runs with TMPDIR on the updater's own disk.
describe('rwe-update.sh test gate TMPDIR (DISK_LOW on a shared /tmp tmpfs)', () => {
  async function runRecorded(name: string, extraEnv?: Record<string, string>) {
    const caseDir = join(rootDir, name);
    mkdirSync(caseDir, { recursive: true });
    const remoteDir = initRemote(caseDir, 'v1.0.0');
    const workDir = initWorking(caseDir, remoteDir);
    const shimDir = join(caseDir, 'shims');
    mkdirSync(shimDir, { recursive: true });
    const npmRecordFile = join(caseDir, 'npm-calls.txt');
    const { exitCode } = await runHelper({
      flagContent: 'v1.0.0\n', workDir, remoteDir, shimDir,
      flagPath: join(caseDir, 'update.flag'), resultPath: join(caseDir, 'result.json'),
      lockPath: join(caseDir, 'update.lock'), npmRecordFile, extraEnv,
    });
    const lines = readFileSync(npmRecordFile, 'utf-8').trim().split('\n');
    return { exitCode, shimDir, caseDir, testLine: lines.find((l) => l.startsWith('test ')), ciLine: lines.find((l) => l.startsWith('ci ')) };
  }

  it('npm test runs with TMPDIR=$HOME/.cache/rwt (created), not the inherited /tmp; npm ci keeps the inherited TMPDIR', async () => {
    const { exitCode, shimDir, testLine, ciLine } = await runRecorded('tmpdir-default', { TMPDIR: '/tmp' });
    expect(exitCode).toBe(0);
    expect(testLine).toBe(`test TMPDIR=${join(shimDir, '.cache', 'rwt')}`);
    expect(existsSync(join(shimDir, '.cache', 'rwt'))).toBe(true);
    expect(ciLine).toBe('ci TMPDIR=/tmp');
  }, 30000);

  it('RWE_UPDATE_TEST_TMPDIR overrides the default', async () => {
    const custom = join(rootDir, 'custom-tt');
    const { exitCode, testLine } = await runRecorded('tmpdir-override', { RWE_UPDATE_TEST_TMPDIR: custom });
    expect(exitCode).toBe(0);
    expect(testLine).toBe(`test TMPDIR=${custom}`);
    expect(existsSync(custom)).toBe(true);
  }, 30000);

  it('prunes rwe-test-* roots older than 12h (a crashed earlier run), never a fresh one or anything else', async () => {
    const custom = join(rootDir, 'prune-tt');
    mkdirSync(join(custom, 'rwe-test-crashed', 'deep'), { recursive: true });
    writeFileSync(join(custom, 'rwe-test-crashed', 'deep', 'blob'), 'x');
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    utimesSync(join(custom, 'rwe-test-crashed'), dayAgo, dayAgo);
    mkdirSync(join(custom, 'rwe-test-live'), { recursive: true });  // a suite still running elsewhere
    writeFileSync(join(custom, 'keep-me'), 'operator file');
    utimesSync(join(custom, 'keep-me'), dayAgo, dayAgo);
    const { exitCode } = await runRecorded('tmpdir-prune', { RWE_UPDATE_TEST_TMPDIR: custom });
    expect(exitCode).toBe(0);
    expect(existsSync(join(custom, 'rwe-test-crashed'))).toBe(false);
    expect(existsSync(join(custom, 'rwe-test-live'))).toBe(true);
    expect(existsSync(join(custom, 'keep-me'))).toBe(true);
  }, 30000);
});
