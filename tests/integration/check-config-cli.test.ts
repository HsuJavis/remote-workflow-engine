// IT-143 (DES-172, ARCH-112, ADR-042, TASK-172, v26, issue #66): `main.ts --check-config` =
// `loadFileConfig()` + `composeConfig(cfg, {proxyManager: NOOP, listen:false})` → exit 0/1 with the
// SAME refusal message `composeConfig` throws, no proxy spawn, no port bind — so the deploy script
// can gate a restart on it. Written test-first (Gate 5, RED): main.ts recognizes no `--check-config`
// flag today, so the process falls into its normal boot path and binds a real listening socket
// forever — this test bounds the child process with a short timeout so that hang is a clean,
// diagnosable red rather than a suite-blocking one.
// Mock policy (integration, real adjacent components): a REAL `tsx` child process running the REAL
// main.ts entry point against a REAL temp config file on disk — no mock of the SUT boundary.
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

function run(configPath: string, port: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      'npx',
      ['tsx', join(process.cwd(), 'src/main.ts'), '--check-config'],
      { cwd: process.cwd(), timeout: 8000, env: { ...process.env, RWE_CONFIG_PATH: configPath, RWE_PORT: String(port) } },
      (err, stdout, stderr) => {
        resolve({ code: (err as any)?.code ?? 0, stdout, stderr });
      },
    );
    void child;
  });
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

let tmpDir: string;

describe('main.ts --check-config: validate without binding a port (IT-143, DES-172)', () => {
  it('exits 0 on a clean config, with no port bound', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it143-clean-'));
    const configPath = join(tmpDir, 'rwe.config.json');
    writeFileSync(configPath, JSON.stringify({ maxTimeoutMs: 600000 }));
    const port = 18787;
    const result = await run(configPath, port);
    expect(result.code).toBe(0);
    expect(await portIsFree(port)).toBe(true);
    rmSync(tmpDir, { recursive: true, force: true });
  }, 10000);

  // 2026-09-26 (alias mechanism removed): a config file that STILL carries `aliases` (a pre-existing
  // production config, unmodified across a self-update restart) must still BOOT — this is that
  // spec rule's own automated coverage, not merely the planned real-run's one-off check. `--check-
  // config` shares `composeConfig()` with the real boot path, so this exercises the exact same
  // RETIRED_CONFIG_KEYS warning (main.ts) a live restart would hit.
  it('exits 0 with a one-line deprecation warning on a config that still carries the retired aliases key', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it143-aliases-'));
    const configPath = join(tmpDir, 'rwe.config.json');
    writeFileSync(configPath, JSON.stringify({ aliases: { sonnet: { provider: 'anthropic', model: 'claude-sonnet-5' } } }));
    const port = 18789;
    const result = await run(configPath, port);
    expect(result.code).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain('aliases');
    expect(out.toLowerCase()).toContain('alias mechanism is removed');
    expect(await portIsFree(port)).toBe(true);
    rmSync(tmpDir, { recursive: true, force: true });
  }, 10000);

  it('exits 1 naming an invalid principals role, with no port bound', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it143-bad-'));
    const configPath = join(tmpDir, 'rwe.config.json');
    writeFileSync(configPath, JSON.stringify({ principals: { alice: { role: 'not-a-real-role' } } }));
    const port = 18788;
    const result = await run(configPath, port);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain('not-a-real-role');
    expect(await portIsFree(port)).toBe(true);
    rmSync(tmpDir, { recursive: true, force: true });
  }, 10000);
});
