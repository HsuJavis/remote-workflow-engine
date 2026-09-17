// (DES-191 amended v27j, ADR-049 amended v27h, TASK-216, ARCH-124, REQ-131, REQ-134): the inverse
// `tsc` program — the server tree (`src` minus `src/dashboard`) is a complete program without the
// client tree and without DOM, run beside the root config in BOTH `typecheck` and `build`, so the
// property is re-proven on every self-update with no human in the loop.
//
// Tier: unit — static analysis over `package.json` and `tsconfig.server.json`'s own bytes. The
// actual compile (three planted-violation falsifiers: `document.title` in a server `.ts` →
// TS2584, `import … from './dashboard/lib/connection.js'` in a server `.ts` → TS7016, a stray
// token in `src/dashboard/ui/app.js` → TS1109 on the ROOT program) is a real `tsc -p` run and is
// verified manually per the task's `dod:` (paste both exit codes) — it is not re-run as part of
// this suite, matching DES-191's own split between "ONE unit test pinning both script strings" and
// the falsifiers, which the architect already measured once at `eb387a1`.
//
// Red reason (measured against HEAD before this task): `package.json`'s `scripts.typecheck` and
// `scripts.build` are both the bare string `tsc --noEmit` — neither names `tsconfig.server.json` —
// and `tsconfig.server.json` does not exist on disk at all (ENOENT).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('tsconfig.server.json — the inverse tsc program (TASK-216, ADR-049, DES-191)', () => {
  it('scripts.typecheck and scripts.build both name tsconfig.server.json, so neither program can vanish', () => {
    expect(pkg.scripts.typecheck).toContain('tsconfig.server.json');
    expect(pkg.scripts.build).toContain('tsconfig.server.json');
  });

  it('scripts.typecheck and scripts.build still run the ROOT program first (the parse coverage over src/dashboard/**/*.js must not trade away)', () => {
    expect(pkg.scripts.typecheck).toMatch(/^tsc --noEmit\b/);
    expect(pkg.scripts.build).toMatch(/^tsc --noEmit\b/);
  });

  it('tsconfig.server.json exists and matches ADR-049\'s amended shape exactly', () => {
    const path = join(ROOT, 'tsconfig.server.json');
    expect(existsSync(path)).toBe(true);
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.extends).toBe('./tsconfig.json');
    expect(cfg.compilerOptions.lib).toEqual(['ES2022']);
    expect(cfg.compilerOptions.allowJs).toBe(false);
    expect(cfg.compilerOptions.declaration).toBe(false);
    expect(cfg.include).toEqual(['src']);
    expect(cfg.exclude).toContain('src/dashboard');
  });
});
