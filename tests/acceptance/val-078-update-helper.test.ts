// VAL-078 (REQ-069): privilege-separated updater — engine writes a flag, the helper does git/build/restart.
// Acceptance tier — MUST NOT mock the SUT's own boundaries: real bash helper against a real
// throwaway git repo. External tools (npm, systemctl) shimmed because they are genuinely not
// runnable in CI.
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

function gitId(): string[] {
  return ['-c', 'user.email=val078@test.local', '-c', 'user.name=Val078Test'];
}

function makeShim(shimDir: string, name: string, exitCode: number, recordFile?: string): string {
  const p = join(shimDir, name);
  const record = recordFile ? `echo "$@" >> "${recordFile}"` : '';
  writeFileSync(p, `#!/bin/sh\n${record}\nexit ${exitCode}\n`);
  chmodSync(p, 0o755);
  return p;
}

/** Non-bare remote: avoids the bare-repo HEAD/branch mismatch that breaks `git clone`. */
function initRemote(parentDir: string, tag: string): { remoteDir: string; tagSha: string } {
  const remoteDir = join(parentDir, 'remote');
  mkdirSync(remoteDir, { recursive: true });
  execFileSync('git', [...gitId(), 'init', remoteDir]);
  writeFileSync(join(remoteDir, 'package.json'), JSON.stringify({ name: 'rwe', version: tag }));
  execFileSync('git', [...gitId(), 'add', '.'], { cwd: remoteDir });
  execFileSync('git', [...gitId(), 'commit', '-m', `release ${tag}`], { cwd: remoteDir });
  execFileSync('git', [...gitId(), 'tag', tag], { cwd: remoteDir });
  const tagSha = execFileSync('git', ['rev-list', '-n1', tag], { cwd: remoteDir, encoding: 'utf-8' }).trim();
  return { remoteDir, tagSha };
}

function cloneWorking(parentDir: string, remoteDir: string): string {
  const workDir = join(parentDir, 'working');
  execFileSync('git', [...gitId(), 'clone', remoteDir, workDir]);
  return workDir;
}

type RunResult = { exitCode: number; result: null | { tag: string; status: string } };

async function runHelper(opts: {
  caseDir: string;
  remoteDir: string;
  workDir: string;
  flagContent?: string;
  npmExit?: number;
  recordSystemctl?: boolean;
}): Promise<RunResult & { systemctlCalled: boolean }> {
  const { caseDir, remoteDir, workDir } = opts;
  const shimDir = join(caseDir, 'shims');
  mkdirSync(shimDir, { recursive: true });
  const flagPath = join(caseDir, 'update.flag');
  const resultPath = join(caseDir, 'result.json');
  const lockPath = join(caseDir, 'update.lock');
  const systemctlRecord = join(shimDir, 'ctl-calls.txt');

  if (opts.flagContent !== undefined) writeFileSync(flagPath, opts.flagContent);

  makeShim(shimDir, 'npm', opts.npmExit ?? 0);
  makeShim(shimDir, 'systemctl', 0, opts.recordSystemctl ? systemctlRecord : undefined);

  let exitCode = 0;
  try {
    await execFile(HELPER, [], {
      env: {
        ...process.env,
        RWE_UPDATE_FLAG: flagPath,
        RWE_UPDATE_RESULT: resultPath,
        RWE_UPDATE_LOCK: lockPath,
        RWE_OFFICIAL_REMOTE: remoteDir,
        NPM: join(shimDir, 'npm'),
        SYSTEMCTL: join(shimDir, 'systemctl'),
        GIT: 'git',
        HOME: shimDir,
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

  let result: { tag: string; status: string } | null = null;
  if (existsSync(resultPath)) {
    result = JSON.parse(readFileSync(resultPath, 'utf-8'));
  }
  return { exitCode, result, systemctlCalled: existsSync(systemctlRecord) };
}

let rootDir: string;
beforeAll(() => { rootDir = mkdtempSync(join(tmpdir(), 'rwe-val078-')); });
afterAll(() => { rmSync(rootDir, { recursive: true, force: true }); });

describe('VAL-078 — REQ-069 acceptance: privilege-separated updater', () => {
  it('engine writing the flag causes the helper to check out the tag and restart — NOT the engine', async () => {
    // REQ-069: the ENGINE only writes the flag; the HELPER does git + restart.
    // Here we verify the helper (the privileged unit) does the git/build/restart correctly.
    const caseDir = join(rootDir, 'normal');
    mkdirSync(caseDir, { recursive: true });
    const { remoteDir, tagSha } = initRemote(caseDir, 'v1.2.0');
    const workDir = cloneWorking(caseDir, remoteDir);

    const { exitCode, result, systemctlCalled } = await runHelper({
      caseDir, remoteDir, workDir,
      flagContent: 'v1.2.0\n',
      recordSystemctl: true,
    });

    // Helper exits 0 (applied)
    expect(exitCode).toBe(0);
    // Result file says applied
    expect(result?.status).toBe('applied');
    expect(result?.tag).toBe('v1.2.0');
    // The helper checked out the tag's SHA
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf-8' }).trim();
    expect(headSha).toBe(tagSha);
    // The helper (not the engine) issued the restart
    expect(systemctlCalled).toBe(true);
  }, 30000);

  it('given a flag naming a non-existent/foreign ref, helper refuses and changes nothing', async () => {
    const caseDir = join(rootDir, 'foreign');
    mkdirSync(caseDir, { recursive: true });
    const { remoteDir } = initRemote(caseDir, 'v1.0.0');
    const workDir = cloneWorking(caseDir, remoteDir);
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf-8' }).trim();

    const { exitCode, systemctlCalled } = await runHelper({
      caseDir, remoteDir, workDir,
      flagContent: 'v9.99.0-does-not-exist\n',
      recordSystemctl: true,
    });

    expect(exitCode).toBe(20);
    expect(systemctlCalled).toBe(false);
    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf-8' }).trim();
    expect(headAfter).toBe(headBefore);
  }, 30000);

  it('safe-fail: build failure → restart NOT called, service stays on prior checkout', async () => {
    // REQ-069: safe-fail: abort BEFORE systemctl restart on build failure.
    const caseDir = join(rootDir, 'safefail');
    mkdirSync(caseDir, { recursive: true });
    const { remoteDir } = initRemote(caseDir, 'v1.1.0');
    const workDir = cloneWorking(caseDir, remoteDir);
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf-8' }).trim();

    const { exitCode, result, systemctlCalled } = await runHelper({
      caseDir, remoteDir, workDir,
      flagContent: 'v1.1.0\n',
      npmExit: 1,          // npm fails → safe-fail path
      recordSystemctl: true,
    });

    // Exit 30 (build/checkout-fail)
    expect(exitCode).toBe(30);
    // SYSTEMCTL must NOT be called (abort before restart — prior version keeps running)
    expect(systemctlCalled).toBe(false);
    // Working tree is still at the prior SHA
    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf-8' }).trim();
    expect(headAfter).toBe(headBefore);
    // Result file records the failure
    expect(result?.status).toBe('failed');
  }, 30000);
});
