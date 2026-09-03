// UT-118 (TASK-123, DES-135, ARCH-086, ARCH-051): `docs/AUTHORING.md` states the four authoring
// rules (declare every tunable knob in `meta.params`; never read a value the contract doesn't
// declare; treat the six `LOCKED_KEYS` as engine-owned; keep secrets/distinctive prose out of phase
// titles — they're public on every surface, adjudication #1); `workflow_register`'s `script`
// parameter description carries the same four in condensed form plus the AUTHORING.md pointer — the
// tool schemas are ALL a cold MCP client with no guidance skills ever sees (REQ-106's own premise).
//
// Mock policy (unit, DES-119): static source-text assertions over `src/server.ts` + a real
// `fs.readFileSync` of `docs/AUTHORING.md` — same convention as the no-skeleton-surface guard
// (TASK-120) and this codebase's own ARCH-051 drift-lock series (schema text as prose, presence
// asserted literally).
//
// Red reason: `docs/AUTHORING.md` does not exist (`ENOENT`, confirmed `ls docs/`); `SCRIPT_DSL_DOC`
// (the `workflow_register.script` description's shared text, `src/server.ts`) contains none of the
// four rules or an `AUTHORING.md` pointer today (confirmed by reading the current text) — every
// assertion below fails against the current tree, for the genuine unimplemented reason.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const AUTHORING_PATH = join(REPO_ROOT, 'docs', 'AUTHORING.md');

describe('docs/AUTHORING.md (UT-118, DES-135, REQ-106)', () => {
  it('exists', () => {
    expect(existsSync(AUTHORING_PATH)).toBe(true);
  });

  it('states all four authoring rules', () => {
    const text = readFileSync(AUTHORING_PATH, 'utf8');
    expect(text).toMatch(/meta\.params/);
    expect(text.toLowerCase()).toContain('never read a value the contract does not declare');
    expect(text).toMatch(/LOCKED_KEYS|locked key/i);
    expect(text.toLowerCase()).toContain('phase title');
  });

  it('states the standing note: registration sends the script to the configured LLM provider, and graphAnalyzer.enabled:false turns that off', () => {
    const text = readFileSync(AUTHORING_PATH, 'utf8');
    expect(text).toContain('graphAnalyzer.enabled');
  });
});

describe('workflow_register.script description carries the same four rules + the AUTHORING.md pointer (UT-118, ARCH-051 drift-lock)', () => {
  it('the shared SCRIPT_DSL_DOC text mentions the AUTHORING.md pointer and the four rules in condensed form', () => {
    const serverText = readFileSync(join(REPO_ROOT, 'src', 'server.ts'), 'utf8');
    const docStart = serverText.indexOf('SCRIPT_DSL_DOC');
    const docBlock = serverText.slice(docStart, docStart + 4000);
    expect(docBlock).toMatch(/AUTHORING\.md/);
    expect(docBlock).toMatch(/meta\.params/);
    expect(docBlock.toLowerCase()).toContain('locked');
    expect(docBlock.toLowerCase()).toContain('phase title');
  });
});
