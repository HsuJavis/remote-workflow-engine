// IT-039: Secret source loader (real env) + two-layer parent-only containment hardening
// (DES-025, TASK-031, ARCH-016). Target-tier per DES-025/DES-030: a planted-symlink integration
// case against a REAL filesystem (no fs mock) — a naive string-prefix path check is fooled by a
// symlink whose OWN path is inside the workspace but whose REAL target resolves outside it; the
// hardened check must follow the real (`realpath`) target, not just the literal path string.
// RED: src/secret-source.js and src/path-containment.js do not exist yet — module-not-found.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Value imports — cause module-not-found at load time when the modules are absent.
import { loadSecretSourceFromEnv } from '../../src/secret-source.js';
import { isPathContained } from '../../src/path-containment.js';

let tmpDir: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it-secret-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); delete process.env['RWE_SECRET_ITTEST']; });

describe('loadSecretSourceFromEnv — real process.env loader (TASK-031, no async/vault impl)', () => {
  it('loads a real env var under the RWE_SECRET_ prefix into a resolvable SecretSource', () => {
    process.env['RWE_SECRET_ITTEST'] = 'real-loaded-value';
    const source = loadSecretSourceFromEnv();
    expect(source.resolve('ITTEST')).toBe('real-loaded-value');
    expect(source.names()).toContain('ITTEST');
  });

  it('a name never set in the environment resolves to undefined (never a hang, never a thrown value)', () => {
    const source = loadSecretSourceFromEnv();
    expect(source.resolve('DEFINITELY_NOT_SET_XYZ')).toBeUndefined();
  });
});

describe('isPathContained — realpath-based (not string-prefix), planted-symlink integration (D-V2G8-1(d) hardening, ARCH-007/016)', () => {
  it('denies a path that IS textually inside the workspace but whose real (symlinked) target escapes it', () => {
    const root = join(tmpDir, 'workspace');
    mkdirSync(root, { recursive: true });
    const secretFile = join(tmpDir, 'sibling-secret.txt'); // OUTSIDE root
    writeFileSync(secretFile, 'top-secret-proxy-config');
    const plantedSymlink = join(root, 'looks-safe.txt'); // textually INSIDE root
    symlinkSync(secretFile, plantedSymlink);

    // A naive resolve()/startsWith() check on the literal symlink path would say "inside" —
    // the hardened, realpath-following check must say "NOT contained" (denies the read).
    expect(isPathContained(plantedSymlink, root)).toBe(false);
  });

  it('allows a genuine path fully inside the workspace with no symlink involved', () => {
    const root = join(tmpDir, 'workspace2');
    mkdirSync(root, { recursive: true });
    const real = join(root, 'output.txt');
    writeFileSync(real, 'fine');
    expect(isPathContained(real, root)).toBe(true);
  });

  it('denies a plain ../ escape with no symlink at all (regression floor)', () => {
    const root = join(tmpDir, 'workspace3');
    mkdirSync(root, { recursive: true });
    expect(isPathContained(join(root, '..', 'sibling-secret.txt'), root)).toBe(false);
  });
});
