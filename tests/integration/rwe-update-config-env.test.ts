// deploy/rwe-update.sh's pre-restart `npm run check-config` must see the RWE_SECRET_* values the
// service itself loads (rwe.config.json may hold `${secret:NAME}` handles, e.g. for
// auth.googleClientSecret — check-config refuses an unresolvable one). RWE_CONFIG_ENV_FILE names the
// service's env file; ONLY its RWE_SECRET_* lines are exported, and ONLY for check-config — never for
// `npm ci` / `npm test` (a test suite that finds real provider keys in env may make real calls).
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HELPER = resolve('deploy/rwe-update.sh');
const ID = ['-c', 'user.email=t@t.local', '-c', 'user.name=T'];
const root = mkdtempSync(join(tmpdir(), 'rwe-cfg-env-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('rwe-update.sh: check-config sees the service env file RWE_SECRET_* values only', () => {
  it('exports RWE_SECRET_* from RWE_CONFIG_ENV_FILE to check-config, not to ci/test, not other keys', () => {
    const remote = join(root, 'remote');
    mkdirSync(remote);
    execFileSync('git', [...ID, 'init', '-q', remote]);
    writeFileSync(join(remote, 'README'), 'v1');
    execFileSync('git', [...ID, 'add', '.'], { cwd: remote });
    execFileSync('git', [...ID, 'commit', '-qm', 'v1'], { cwd: remote });
    const work = join(root, 'working');
    execFileSync('git', [...ID, 'clone', '-q', remote, work]);
    writeFileSync(join(remote, 'README'), 'v2');
    execFileSync('git', [...ID, 'commit', '-qam', 'v2'], { cwd: remote });
    execFileSync('git', [...ID, 'tag', 'v2.0.0'], { cwd: remote });

    const shims = join(root, 'shims');
    mkdirSync(shims);
    const npmLog = join(shims, 'npm-calls.txt');
    writeFileSync(join(shims, 'npm'),
      `#!/bin/sh\necho "$* | A=\${RWE_SECRET_GOOGLE_CS:-unset} | B=\${RWE_SECRET_SPACED:-unset} | O=\${OPENROUTER_API_KEY:-unset}" >> "${npmLog}"\nexit 0\n`);
    writeFileSync(join(shims, 'systemctl'), '#!/bin/sh\nexit 0\n');
    for (const n of ['npm', 'systemctl']) chmodSync(join(shims, n), 0o755);
    const envFile = join(root, 'rwe.env');
    writeFileSync(envFile, [
      '# comment',
      '',
      'RWE_SECRET_GOOGLE_CS=abc=def',
      'RWE_SECRET_SPACED="two words"',
      'OPENROUTER_API_KEY=sk-should-not-leak',
    ].join('\n') + '\n');
    const flag = join(root, 'update.flag');
    writeFileSync(flag, 'v2.0.0\n');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: shims,
      RWE_UPDATE_FLAG: flag,
      RWE_UPDATE_RESULT: join(root, 'result.json'),
      RWE_UPDATE_LOCK: join(root, 'update.lock'),
      RWE_OFFICIAL_REMOTE: remote,
      RWE_CONFIG_PATH: join(work, 'rwe.config.json'),
      RWE_CONFIG_ENV_FILE: envFile,
      GIT: 'git',
      NPM: join(shims, 'npm'),
      SYSTEMCTL: join(shims, 'systemctl'),
    };
    for (const k of ['RWE_SECRET_GOOGLE_CS', 'RWE_SECRET_SPACED', 'OPENROUTER_API_KEY']) delete env[k];

    const r = spawnSync(HELPER, [], { cwd: work, encoding: 'utf8', env });
    expect(r.status).toBe(0);
    const lines = readFileSync(npmLog, 'utf8').trim().split('\n');
    const check = lines.find((l) => l.startsWith('run check-config'));
    expect(check).toBe('run check-config | A=abc=def | B=two words | O=unset');
    for (const l of lines.filter((x) => !x.startsWith('run check-config'))) {
      expect(l).toMatch(/\| A=unset \| B=unset \| O=unset$/);
    }
    expect(JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'))).toMatchObject({ status: 'applied', configCheck: 'passed' });
  });
});
