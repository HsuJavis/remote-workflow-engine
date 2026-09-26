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
