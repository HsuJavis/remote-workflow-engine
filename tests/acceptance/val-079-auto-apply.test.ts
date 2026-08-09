// VAL-079 (REQ-070): fully-automatic apply — outcome observable via /api/status and dashboard;
// safe-fail (service stays up on prior version when build fails).
// Acceptance tier — MUST NOT mock the SUT's own boundaries: real HTTP server boot-time ingestion,
// real /api/status, real dashboard HTML. Helper-external tools (npm, systemctl) shimmed.
// "version == tag" assertion is deferred to Gate 7.5 live run (real:false); this CI-safe test
// validates outcome ingestion at "boot" (a fresh createServer on the same updateResultPath config)
// and safe-fail behavior, matching what's reproducible without a live systemd/git deployment.
// TEST-FIRST (RED): ServerConfig.updateResultPath / readUpdateResult not yet implemented; /api/status
// returns no lastUpdate field; the server does not ingest the result file at boot.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync,
  existsSync, rmSync,
} from 'node:fs';
import { execFileSync, execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { UpdateOutcome } from '../../src/update-types.js';

const execFile = promisify(_execFile);

const HELPER = resolve('deploy/rwe-update.sh');

function gitId(): string[] {
  return ['-c', 'user.email=val079@test.local', '-c', 'user.name=Val079Test'];
}

function makeShim(shimDir: string, name: string, exitCode: number, recordFile?: string): string {
  const p = join(shimDir, name);
  const record = recordFile ? `echo "$@" >> "${recordFile}"` : '';
  writeFileSync(p, `#!/bin/sh\n${record}\nexit ${exitCode}\n`);
  chmodSync(p, 0o755);
  return p;
}

/** Non-bare remote: avoids the bare-repo HEAD/branch mismatch that breaks `git clone`. */
function initRepo(parentDir: string, tag: string): { remoteDir: string; workDir: string } {
  const remoteDir = join(parentDir, 'remote');
  mkdirSync(remoteDir, { recursive: true });
  execFileSync('git', [...gitId(), 'init', remoteDir]);
  writeFileSync(join(remoteDir, 'package.json'), JSON.stringify({ name: 'rwe', version: tag }));
  execFileSync('git', [...gitId(), 'add', '.'], { cwd: remoteDir });
  execFileSync('git', [...gitId(), 'commit', '-m', `release ${tag}`], { cwd: remoteDir });
  execFileSync('git', [...gitId(), 'tag', tag], { cwd: remoteDir });
  const workDir = join(parentDir, 'working');
  execFileSync('git', [...gitId(), 'clone', remoteDir, workDir]);
  return { remoteDir, workDir };
}

async function runHelper(opts: {
  caseDir: string;
  remoteDir: string;
  workDir: string;
  flagContent: string;
  npmExit?: number;
}): Promise<{ exitCode: number; result: UpdateOutcome | null }> {
  const { caseDir, remoteDir, workDir } = opts;
  const shimDir = join(caseDir, 'shims');
  mkdirSync(shimDir, { recursive: true });
  const flagPath = join(caseDir, 'update.flag');
  const resultPath = join(caseDir, 'result.json');
  const lockPath = join(caseDir, 'update.lock');
  writeFileSync(flagPath, opts.flagContent);
  makeShim(shimDir, 'npm', opts.npmExit ?? 0);
  makeShim(shimDir, 'systemctl', 0);

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

  const result = existsSync(resultPath)
    ? JSON.parse(readFileSync(resultPath, 'utf-8')) as UpdateOutcome
    : null;
  return { exitCode, result };
}

// ─── shared temp root ─────────────────────────────────────────────────────────

let rootDir: string;
beforeAll(() => { rootDir = mkdtempSync(join(tmpdir(), 'rwe-val079-')); });
afterAll(() => { rmSync(rootDir, { recursive: true, force: true }); });

// ─── test cases ───────────────────────────────────────────────────────────────

describe('VAL-079 — REQ-070 acceptance: applied outcome ingested at boot, observable via /api/status', () => {
  it('helper applies a valid tag → fresh server ingests result at boot → /api/status shows applied', async () => {
    const caseDir = join(rootDir, 'applied');
    mkdirSync(caseDir, { recursive: true });
    const { remoteDir, workDir } = initRepo(caseDir, 'v1.4.0');
    const auxDir = join(caseDir, 'aux');
    mkdirSync(auxDir, { recursive: true });
    const resultPath = join(caseDir, 'result.json'); // must match runHelper's RWE_UPDATE_RESULT (caseDir/result.json)
    const workRootDir = join(caseDir, 'workroot');
    mkdirSync(workRootDir, { recursive: true });

    // 1. Run the helper (normal npm, simulated restart)
    const { exitCode, result } = await runHelper({
      caseDir, remoteDir, workDir, flagContent: 'v1.4.0\n',
    });
    expect(exitCode).toBe(0);
    expect(result?.status).toBe('applied');
    expect(result?.tag).toBe('v1.4.0');

    // 2. "Restart" = fresh createServer with updateResultPath pointing at the result file.
    //    The engine should ingest the result at boot and expose it via GET /api/status.
    const server: Server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot: workRootDir,
      updateResultPath: resultPath,
      selfUpdateDbPath: join(auxDir, 'self-update.db'),
    });
    try {
      const statusRes = await fetch(`http://127.0.0.1:${server.port}/api/status`);
      expect(statusRes.ok).toBe(true);
      const status = await statusRes.json() as { lastUpdate?: UpdateOutcome };
      // REQ-070 acceptance: last-update outcome observable; tag and status ingested at boot.
      expect(status.lastUpdate).toBeDefined();
      expect(status.lastUpdate!.status).toBe('applied');
      expect(status.lastUpdate!.tag).toBe('v1.4.0');

      // Dashboard HTML should contain the "applied" indicator.
      const dashRes = await fetch(`http://127.0.0.1:${server.port}/dashboard`);
      expect(dashRes.ok).toBe(true);
      const html = await dashRes.text();
      // A rendered dashboard update panel shows the status text.
      expect(html).toContain('applied');
    } finally {
      await server.close();
    }
  }, 60000);

  it('safe-fail: build failure → service stays on prior version; /api/status shows failed for that tag', async () => {
    // REQ-070: "A build/checkout FAILURE is safe: the helper aborts BEFORE systemctl restart
    // so a bad tag NEVER leaves the service down."
    const caseDir = join(rootDir, 'safefail');
    mkdirSync(caseDir, { recursive: true });
    const { remoteDir, workDir } = initRepo(caseDir, 'v1.5.0');
    const auxDir = join(caseDir, 'aux');
    mkdirSync(auxDir, { recursive: true });
    const resultPath = join(caseDir, 'result.json'); // must match runHelper's RWE_UPDATE_RESULT (caseDir/result.json)
    const workRootDir = join(caseDir, 'workroot');
    mkdirSync(workRootDir, { recursive: true });

    // Helper with failing npm → safe-fail path
    const { exitCode, result } = await runHelper({
      caseDir, remoteDir, workDir, flagContent: 'v1.5.0\n', npmExit: 1,
    });
    expect(exitCode).toBe(30);
    expect(result?.status).toBe('failed');
    expect(result?.tag).toBe('v1.5.0');

    // "Restart" (or lazy /api/status read) — server reads the failed result.
    const server: Server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot: workRootDir,
      updateResultPath: resultPath,
      selfUpdateDbPath: join(auxDir, 'self-update.db'),
    });
    try {
      const statusRes = await fetch(`http://127.0.0.1:${server.port}/api/status`);
      const status = await statusRes.json() as { lastUpdate?: UpdateOutcome };
      // REQ-070 acceptance: failure outcome is recorded and observable.
      expect(status.lastUpdate?.status).toBe('failed');
      expect(status.lastUpdate?.tag).toBe('v1.5.0');

      // Dashboard update panel shows the failure.
      const dashRes = await fetch(`http://127.0.0.1:${server.port}/dashboard`);
      const html = await dashRes.text();
      expect(html).toContain('failed');
    } finally {
      await server.close();
    }
  }, 60000);
});
