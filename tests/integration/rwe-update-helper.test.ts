// IT-062 (DES-060, ARCH-039, REQ-069): rwe-update.sh child-process integration harness.
// Real git against a throwaway local repo; NPM/SYSTEMCTL are fake shims recording argv.
// TEST-FIRST (RED): deploy/rwe-update.sh does not exist yet; execFile → ENOENT.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync,
  existsSync, rmSync,
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
