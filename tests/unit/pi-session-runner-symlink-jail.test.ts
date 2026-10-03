// pi harness v1, review B3 (HIGH, security) + M5: `assertJailed`'s dangling-symlink write escape and
// `walkDir`'s symlinked-directory traversal leak. Direct unit coverage of the pure jail logic
// (exported from session-runner.ts for exactly this) against REAL temp dirs/symlinks and the REAL
// isPathContained/resolveLanding from path-containment.ts — no pi session needed, this is the one
// security-critical boundary the real-tier driver (piv/jail-drive.mts) also exercises end to end.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertJailed, walkDir } from '../../src/gateway/pi-child/session-runner.js';
import { isPathContained, resolveLanding } from '../../src/path-containment.js';
import type { PiChildConfig } from '../../src/gateway/pi-child/protocol.js';

const deps = { isPathContained, resolveLanding, buildBashEnv: (_c: unknown, _s: unknown) => ({}) as NodeJS.ProcessEnv, isWrapped: () => false, resolveRipgrepOverride: () => null };

function config(cwd: string): PiChildConfig {
  return { runId: 'r', agentId: 'a', prompt: '', model: { provider: 'ollama', model: 'x', baseUrl: 'http://x' }, cwd, agentDir: '/tmp/unused', systemPrompt: '', tools: [], protectedFiles: [] };
}

let dirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('assertJailed — dangling symlink write/create escape (review B3, HIGH)', () => {
  it('refuses a dangling symlink whose target lies outside the workspace', () => {
    const base = tmp('rwe-pi-jail-b3-');
    const ws = join(base, 'ws'); mkdirSync(ws);
    const out = join(base, 'out'); mkdirSync(out);
    symlinkSync(join(out, 'created.txt'), join(ws, 'dangle')); // target does NOT exist yet
    expect(() => assertJailed(join(ws, 'dangle'), config(ws), deps)).toThrow(/PATH_ESCAPES_WORKSPACE/);
    // The real regression check: the file must never actually get created outside the workspace by
    // whatever code calls assertJailed before a writeFile — proven here by confirming the refusal
    // throws BEFORE any write would occur (assertJailed itself never writes; the caller does only
    // after this passes).
    expect(existsSync(join(out, 'created.txt'))).toBe(false);
  });

  it('refuses a dangling symlink nested two levels deep (link -> link -> outside)', () => {
    const base = tmp('rwe-pi-jail-b3n-');
    const ws = join(base, 'ws'); mkdirSync(ws);
    const out = join(base, 'out'); mkdirSync(out);
    symlinkSync(join(out, 'final.txt'), join(ws, 'mid'));
    symlinkSync(join(ws, 'mid'), join(ws, 'dangle2'));
    expect(() => assertJailed(join(ws, 'dangle2'), config(ws), deps)).toThrow(/PATH_ESCAPES_WORKSPACE/);
  });

  it('a dangling symlink whose target lies INSIDE the workspace is allowed (no false positive)', () => {
    const base = tmp('rwe-pi-jail-b3ok-');
    const ws = join(base, 'ws'); mkdirSync(ws);
    symlinkSync(join(ws, 'will-exist.txt'), join(ws, 'dangle-ok'));
    expect(() => assertJailed(join(ws, 'dangle-ok'), config(ws), deps)).not.toThrow();
  });

  it('still refuses an EXISTING-target symlink outside the workspace (regression floor, unchanged behavior)', () => {
    const base = tmp('rwe-pi-jail-b3existing-');
    const ws = join(base, 'ws'); mkdirSync(ws);
    const out = join(base, 'out'); mkdirSync(out);
    writeFileSync(join(out, 'real.txt'), 'x');
    symlinkSync(join(out, 'real.txt'), join(ws, 'link'));
    expect(() => assertJailed(join(ws, 'link'), config(ws), deps)).toThrow(/PATH_ESCAPES_WORKSPACE/);
  });

  it('still refuses a plain ../ escape with no symlink involved (regression floor)', () => {
    const base = tmp('rwe-pi-jail-b3dotdot-');
    const ws = join(base, 'ws'); mkdirSync(ws);
    expect(() => assertJailed(join(ws, '..', 'outside.txt'), config(ws), deps)).toThrow(/PATH_ESCAPES_WORKSPACE/);
  });
});

describe('walkDir (find/Glob) — never traverses or lists a symlinked directory (review M5)', () => {
  it('a symlinked subdirectory pointing outside the workspace is neither traversed nor listed', async () => {
    const base = tmp('rwe-pi-jail-m5-');
    const ws = join(base, 'ws'); mkdirSync(ws);
    const outdir = join(base, 'outdir'); mkdirSync(outdir);
    writeFileSync(join(outdir, 'secret.txt'), 'OUTSIDE_SECRET');
    writeFileSync(join(ws, 'inside.txt'), 'inside');
    symlinkSync(outdir, join(ws, 'linkdir'));
    const out: string[] = [];
    await walkDir(ws, ws, out, [], 1000);
    expect(out).toContain('inside.txt');
    expect(out).not.toContain('linkdir'); // the symlink itself is not listed as a leaf either
    expect(out.some((f) => f.startsWith('linkdir/'))).toBe(false); // nothing beneath it leaked
  });

  it('a symlinked subdirectory pointing INSIDE the workspace is still skipped (same simple rule, no special-casing)', async () => {
    const base = tmp('rwe-pi-jail-m5in-');
    const ws = join(base, 'ws'); mkdirSync(ws);
    const real = join(ws, 'real'); mkdirSync(real);
    writeFileSync(join(real, 'f.txt'), 'x');
    symlinkSync(real, join(ws, 'alias'));
    const out: string[] = [];
    await walkDir(ws, ws, out, [], 1000);
    expect(out).toContain('real/f.txt'); // reached via the real, non-symlink path
    expect(out.some((f) => f.startsWith('alias/'))).toBe(false); // never via the alias
  });

  it('a self-referencing symlink loop never hangs or grows unbounded', async () => {
    const base = tmp('rwe-pi-jail-m5loop-');
    const ws = join(base, 'ws'); mkdirSync(ws);
    symlinkSync(ws, join(ws, 'self'));
    const out: string[] = [];
    await walkDir(ws, ws, out, [], 50);
    expect(out).toEqual([]); // the only entry is the symlink itself, which is skipped outright
  });
});
