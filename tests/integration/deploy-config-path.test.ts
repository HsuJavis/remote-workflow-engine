// v26 Gate 7.5 round 6, defect D14 (orchestrator-scoped; see 06-impl-log IMPL-219). `deploy.sh`
// step 2 checked, created and reported on the repo-root `rwe.config.json` unconditionally, while
// step 4 launched the engine with `RWE_CONFIG_PATH` — so every second-instance boot printed a line
// about a file the engine would not read (`rwe.config.json 已存在，保留不覆蓋。`).
//
// This runs the REAL step-2 block out of the REAL deploy.sh — extracted between two structural
// anchors, never a copy of its text — so the assertion is on behaviour, not on a source grep. It
// stops before step 3, so no npm/uv/engine is ever started.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let step2 = '';

beforeAll(() => {
  const lines = readFileSync('deploy.sh', 'utf8').split('\n');
  const from = lines.findIndex((l) => l.startsWith('export RWE_CONFIG_PATH='));
  const to = lines.findIndex((l) => l.startsWith('echo "== 步驟 3/5'));
  expect(from, 'deploy.sh must resolve RWE_CONFIG_PATH before step 2').toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  step2 = lines.slice(from, to).join('\n');
});

/** Runs the extracted block with `bash`, cwd = repo root (step 2 copies `rwe.config.example.json`
 *  by relative path, exactly as the deployed script does). */
function runStep2(env: Record<string, string>): string {
  return execFileSync('bash', ['-c', step2], {
    encoding: 'utf8',
    env: { ...process.env, RWE_WORK_ROOT: '/tmp/rwe-test-workroot', ...env },
  });
}

describe('D14 — deploy.sh step 2 acts on the config file the engine will actually read', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('with RWE_CONFIG_PATH set, it creates and names THAT file — not the repo-root one', () => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-deploy-cfg-'));
    const target = join(dir, 'second-instance.json');

    const out = runStep2({ RWE_CONFIG_PATH: target });

    expect(out).toContain(`確認設定檔 (${target})`);
    expect(out).toContain(`建立 ${target}`);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(readFileSync('rwe.config.example.json', 'utf8'));
    // The bug: the old script talked about the repo-root file. No message may name it bare.
    expect(out).not.toMatch(/(^|[^/])rwe\.config\.json/m);
  });

  it('when that file already exists it is kept, and the keep message names its full path', () => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-deploy-cfg-'));
    const target = join(dir, 'second-instance.json');
    writeFileSync(target, '{"port":9999}\n');

    const out = runStep2({ RWE_CONFIG_PATH: target });

    expect(out).toContain(`${target} 已存在，保留不覆蓋。`);
    expect(readFileSync(target, 'utf8')).toBe('{"port":9999}\n'); // untouched
  });

  it('unset, RWE_CONFIG_PATH still defaults to the repo-root rwe.config.json', () => {
    // Assert the DEFAULT without letting step 2 write into the repo: run the resolution line only.
    const resolutionLine = step2.split('\n').find((l) => l.startsWith('export RWE_CONFIG_PATH='))!;
    const resolved = execFileSync('bash', ['-c', `${resolutionLine}\nprintf '%s' "$RWE_CONFIG_PATH"`], {
      encoding: 'utf8',
      env: { ...process.env, RWE_CONFIG_PATH: '' },
    });
    expect(resolved).toBe(join(process.cwd(), 'rwe.config.json'));
  });
});
