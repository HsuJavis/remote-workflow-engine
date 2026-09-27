// VAL-011: Deploy packaging — docker-compose/systemd/smoke artifacts exist + hardening (REQ-011, DES-022)
// RED: docker-compose.yml, deploy/rwe.service, scripts/smoke.sh do not exist yet — existsSync fails.
// This is a pure artifact/structure test (no live container launch needed for RED confirmation).
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname);

describe('Deploy packaging artifacts (REQ-011, DES-022)', () => {
  it('docker-compose.yml exists at repo root', () => {
    expect(existsSync(join(REPO_ROOT, 'docker-compose.yml'))).toBe(true);
  });

  it('docker-compose.yml has a "litellm" profile (optional; default profile runs without LiteLLM)', () => {
    const p = join(REPO_ROOT, 'docker-compose.yml');
    if (!existsSync(p)) return;
    const text = readFileSync(p, 'utf8');
    expect(text).toMatch(/profiles.*litellm|litellm.*profiles/s);
  });

  it('systemd unit file exists at deploy/rwe.service', () => {
    expect(existsSync(join(REPO_ROOT, 'deploy', 'rwe.service'))).toBe(true);
  });

  it('systemd unit has Restart=on-failure (self-healing seam, DES-022)', () => {
    const p = join(REPO_ROOT, 'deploy', 'rwe.service');
    if (!existsSync(p)) return;
    const text = readFileSync(p, 'utf8');
    expect(text).toMatch(/Restart=on-failure/);
  });

  it('scripts/smoke.sh exists and is executable-shaped (non-interactive exit-code smoke check)', () => {
    expect(existsSync(join(REPO_ROOT, 'scripts', 'smoke.sh'))).toBe(true);
  });

  it('smoke.sh mentions boot → workflow submit → completion sequence (DES-022)', () => {
    const p = join(REPO_ROOT, 'scripts', 'smoke.sh');
    if (!existsSync(p)) return;
    const text = readFileSync(p, 'utf8');
    // Must exercise at minimum: server boot + run_start call
    expect(text).toMatch(/run_start|tools\/call/i);
  });

  it('DEPLOY.md mentions the dependency-free direct-fetch/SDK path (DES-022 replaceability)', () => {
    const p = join(REPO_ROOT, 'DEPLOY.md');
    if (!existsSync(p)) return;
    const text = readFileSync(p, 'utf8');
    expect(text).toMatch(/direct-fetch|sdk/i);
  });

  it('DEPLOY.md mentions the no-auth caveat for workspace_push (DES-022 security note)', () => {
    const p = join(REPO_ROOT, 'DEPLOY.md');
    if (!existsSync(p)) return;
    const text = readFileSync(p, 'utf8');
    expect(text).toMatch(/workspace_push|ssh.tunnel|vpn/i);
  });

  // Host-migration hardening (2026-09): the pre-push branch-protection substitute (no GitHub
  // branch protection on this free private repo) must be a versioned file, not a live-edited-only
  // `.git/hooks/pre-push` — otherwise a fresh clone/new host has no gate at all.
  it('versioned pre-push hook exists at deploy/git-hooks/pre-push and is executable', () => {
    const p = join(REPO_ROOT, 'deploy', 'git-hooks', 'pre-push');
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).mode & 0o111).not.toBe(0);
  });

  it('the versioned pre-push hook unsets the GIT_DIR-family env vars (2026-09-26 incident) and gates only master', () => {
    const p = join(REPO_ROOT, 'deploy', 'git-hooks', 'pre-push');
    if (!existsSync(p)) return;
    const text = readFileSync(p, 'utf8');
    expect(text).toMatch(/unset GIT_DIR/);
    expect(text).toMatch(/GIT_WORK_TREE/);
    expect(text).toMatch(/refs\/heads\/master/);
  });
});

// 2026-09-27 host-migration follow-up: the USER-mode templates must mirror the production host's
// live units (shape + values), generalized with systemd's %h specifier (home dir) so they are
// copy-installable for any user, not just the one machine they were captured from. Comment lines
// are stripped before the "%h, never a literal /home/" assertion so an explanatory comment can't
// false-positive the guard.
function stripUnitComments(text: string): string {
  return text
    .split('\n')
    .filter((l) => !l.trim().startsWith('#') && !l.trim().startsWith(';'))
    .join('\n');
}

describe('User-mode systemd templates mirror the live host units (host-migration 2026-09-27)', () => {
  it('deploy/rwe.user.service PATH includes the LiteLLM venv bin dir (matches gateway:"sdk" live unit)', () => {
    const text = readFileSync(join(REPO_ROOT, 'deploy', 'rwe.user.service'), 'utf8');
    expect(text).toMatch(/Environment=PATH=.*\.rwe-litellm-venv\/bin/);
  });

  it('deploy/rwe.user.service ships RWE_BIND=0.0.0.0 (mirrors the live unit; drop-in/edit for loopback-only)', () => {
    const text = readFileSync(join(REPO_ROOT, 'deploy', 'rwe.user.service'), 'utf8');
    expect(text).toMatch(/^Environment=RWE_BIND=0\.0\.0\.0$/m);
  });

  it('deploy/rwe.user.service base RWE_PORT stays 8787 — the port surface is the drop-in, not this file', () => {
    const text = readFileSync(join(REPO_ROOT, 'deploy', 'rwe.user.service'), 'utf8');
    expect(text).toMatch(/^Environment=RWE_PORT=8787$/m);
  });

  it('deploy/rwe.service.d/override.conf exists and sets the live host\'s RWE_PORT (8899)', () => {
    const p = join(REPO_ROOT, 'deploy', 'rwe.service.d', 'override.conf');
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, 'utf8');
    expect(text).toMatch(/^\[Service\]$/m);
    expect(text).toMatch(/^Environment=RWE_PORT=8899$/m);
  });

  it('deploy/rwe-update.service is the user-unit inline-Environment shape, not the root//opt//etc/rwe shape', () => {
    const text = readFileSync(join(REPO_ROOT, 'deploy', 'rwe-update.service'), 'utf8');
    expect(text).not.toMatch(/\/opt\/remote-workflow-engine/);
    expect(text).not.toMatch(/\/etc\/rwe\/update\.env/);
    expect(text).toMatch(/^Environment=RWE_UPDATE_FLAG=%h\/rwe-update\.flag$/m);
    expect(text).toMatch(/^Environment=RWE_UPDATE_RESULT=%h\/\.local\/share\/rwe-update\/result\.json$/m);
    expect(text).toMatch(/^Environment=RWE_UPDATE_LOCK=%h\/\.local\/share\/rwe-update\/update\.lock$/m);
    expect(text).toMatch(/^Environment=RWE_OFFICIAL_REMOTE=https:\/\/github\.com\//m);
    expect(text).toMatch(/^Environment=SYSTEMCTL=%h\/\.local\/share\/rwe-update\/systemctl-user$/m);
    expect(text).toMatch(/^Environment=RWE_CONFIG_PATH=%h\/.*rwe\.config\.json$/m);
    expect(text).toMatch(/^SuccessExitStatus=0 10 20 30 40$/m);
  });

  it('deploy/systemctl-user exists, is executable, and wraps `systemctl --user`', () => {
    const p = join(REPO_ROOT, 'deploy', 'systemctl-user');
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).mode & 0o111).not.toBe(0);
    const text = readFileSync(p, 'utf8');
    expect(text).toMatch(/systemctl --user "\$@"/);
  });

  it('deploy/rwe-update.path is unchanged: still %h, no literal home path', () => {
    const text = readFileSync(join(REPO_ROOT, 'deploy', 'rwe-update.path'), 'utf8');
    expect(text).toMatch(/^PathExists=%h\/rwe-update\.flag$/m);
    expect(text).toMatch(/^PathChanged=%h\/rwe-update\.flag$/m);
  });

  it('none of the four user-mode templates hardcode a literal /home/<user> path (comments excluded)', () => {
    const files = ['rwe.user.service', 'rwe-update.service', 'rwe-update.path', 'rwe.service.d/override.conf'];
    for (const f of files) {
      const text = stripUnitComments(readFileSync(join(REPO_ROOT, 'deploy', f), 'utf8'));
      expect(text, `${f} should use %h, not a literal /home/ path`).not.toMatch(/\/home\//);
    }
  });

  it('the root/system-mode deploy/rwe.service keeps its /opt literals (NOT %h — %h under User=rwe would resolve to root\'s home, not the service user\'s)', () => {
    const text = readFileSync(join(REPO_ROOT, 'deploy', 'rwe.service'), 'utf8');
    expect(text).toMatch(/WorkingDirectory=\/opt\/remote-workflow-engine/);
    expect(text).not.toMatch(/%h/);
  });
});
