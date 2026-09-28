// deploy/migrate-to-service-user.sh sets RWE_OFFICIAL_REMOTE to the scp-style SSH form
// (git@github.com:owner/repo.git) for a service user that reads the private repo through a
// read-only deploy key. Pins that deploy/rwe-update.sh passes that form to git verbatim for BOTH
// `ls-remote` and `fetch` and applies the tag. Real git; the SSH URL is redirected to a local repo
// with url.<local>.insteadOf (via GIT_CONFIG_COUNT), so no network or key is needed.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HELPER = resolve('deploy/rwe-update.sh');
const SSH_REMOTE = 'git@github.com:example-owner/remote-workflow-engine.git';
const ID = ['-c', 'user.email=t@t.local', '-c', 'user.name=T'];

const root = mkdtempSync(join(tmpdir(), 'rwe-ssh-remote-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('rwe-update.sh with an scp-style SSH RWE_OFFICIAL_REMOTE', () => {
  it('resolves, fetches and applies the tag through the SSH-form remote', () => {
    const remote = join(root, 'remote');
    mkdirSync(remote);
    execFileSync('git', [...ID, 'init', '-q', remote]);
    writeFileSync(join(remote, 'README'), 'v1');
    execFileSync('git', [...ID, 'add', '.'], { cwd: remote });
    execFileSync('git', [...ID, 'commit', '-qm', 'v1'], { cwd: remote });
    const work = join(root, 'working');
    execFileSync('git', [...ID, 'clone', '-q', remote, work]);
    execFileSync('git', [...ID, 'tag', 'v2.0.0'], { cwd: remote }); // tag exists ONLY on the remote
    writeFileSync(join(remote, 'README'), 'v2');
    execFileSync('git', [...ID, 'commit', '-qam', 'v2'], { cwd: remote });
    execFileSync('git', [...ID, 'tag', '-f', 'v2.0.0'], { cwd: remote });
    const want = execFileSync('git', ['rev-parse', 'v2.0.0'], { cwd: remote, encoding: 'utf8' }).trim();

    // git trace of the remote URLs the helper actually used
    const shims = join(root, 'shims');
    mkdirSync(shims);
    const gitLog = join(shims, 'git-calls.txt');
    const gitShim = join(shims, 'git');
    writeFileSync(gitShim, `#!/bin/sh\necho "$@" >> "${gitLog}"\nexec git "$@"\n`);
    for (const n of ['npm', 'systemctl']) writeFileSync(join(shims, n), '#!/bin/sh\nexit 0\n');
    for (const n of ['git', 'npm', 'systemctl']) chmodSync(join(shims, n), 0o755);
    const flag = join(root, 'update.flag');
    writeFileSync(flag, 'v2.0.0\n');

    const r = spawnSync(HELPER, [], {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: shims,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.${remote}.insteadOf`,
        GIT_CONFIG_VALUE_0: SSH_REMOTE,
        RWE_UPDATE_FLAG: flag,
        RWE_UPDATE_RESULT: join(root, 'result.json'),
        RWE_UPDATE_LOCK: join(root, 'update.lock'),
        RWE_OFFICIAL_REMOTE: SSH_REMOTE,
        RWE_UPDATE_SKIP_TESTS: '1',
        GIT: gitShim,
        NPM: join(shims, 'npm'),
        SYSTEMCTL: join(shims, 'systemctl'),
      },
    });

    expect(r.status).toBe(0);
    const calls = readFileSync(gitLog, 'utf8');
    expect(calls).toContain(`ls-remote --tags ${SSH_REMOTE} refs/tags/v2.0.0`);
    expect(calls).toContain(`fetch --tags ${SSH_REMOTE}`);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim()).toBe(want);
    expect(JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'))).toMatchObject({ tag: 'v2.0.0', status: 'applied' });
  });
});
