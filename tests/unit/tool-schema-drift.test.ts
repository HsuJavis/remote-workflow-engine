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
//
// v24 (batch B migration). Three changes, one deletion:
//
//  * `docs/AUTHORING.md` is no longer hand-written: it is GENERATED from `buildAuthoringGuide()`
//    (`src/authoring-guide.ts`) by `scripts/gen-authoring-md.ts`, with
//    `tests/unit/authoring-md-generated.test.ts` as the diff lock (that lock is GREEN, so the
//    checked-in file already equals the builder's output — this file's reds are guide CONTENT, not
//    a stale checkout). The four-rules case is kept verbatim: REQ-106 is unchanged in v24 (still
//    `iter: v23`, no supersession) and all four rules are still live engine facts — `meta.params`
//    is where a knob is declared, the six `LOCKED_KEYS` are engine-owned (`PARAM_LOCKED`), and
//    phase titles are public on every surface (DES-136 made that owner-authorised, so the rule was
//    strengthened, not dropped).
//
//  * DELETED — the `graphAnalyzer.enabled` standing note. The mechanism it documented (registration
//    sending the whole script body to the configured LLM provider to draw a diagram, with
//    `graphAnalyzer.enabled:false` as the opt-out) is RETIRED: ADR-025/ARCH-101 replaced it with the
//    author-drawn `mermaid` argument, `src/` contains no analyzer — the only surviving mention is
//    `main.ts`'s warning that `graphAnalyzer` in `rwe.config.json` is an unrecognized key with no
//    replacement — and the generated guide now states the opposite ("that generator is retired …
//    nothing you write is sent anywhere just to produce a picture"). A disclosure requirement for
//    egress that no longer happens has no oracle to migrate onto.
//
//  * `SCRIPT_DSL_DOC` no longer exists (v24 deleted `server.ts`'s hand-written tool metadata for the
//    `src/tool-specs.ts` data array), so the third case grepped a constant that is gone. Its ORACLE
//    survives unchanged in REQ-106's own words — "the same rules are reachable from the MCP surface
//    itself (the `workflow_register.script` description **or an equivalent discoverable
//    reference**)" — and v24 chose the second vehicle: REQ-116 requires that "given `tools/list`
//    alone … `workflow_register`'s description tells [a cold client] to call
//    `workflow_authoring_guide` first". The case therefore asserts the pointer on the SERVED
//    projection (`projectToolsList()`, what a client actually receives) instead of source text. It
//    does NOT re-assert the four rules inline: v24 deliberately moved the rule TEXT into the guide
//    tool (ADR-032/DES-157) and keeps a standing guard on total `tools/list` description bytes, so
//    demanding the prose in both places would contradict the design. The pointer is the whole of
//    what the cold client needs and the whole of what REQ-116 requires.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectToolsList } from '../../src/tool-specs.js';

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
});

describe('the authoring rules stay reachable from tools/list alone (UT-118, REQ-106, REQ-116)', () => {
  it("workflow_register's SERVED description points a cold client at workflow_authoring_guide", () => {
    const register = projectToolsList().find((t) => t.name === 'workflow_register');
    expect(register).toBeDefined();
    // `projectToolsList()` folds `seeAlso` into the description as a "See also:" line, so a pointer
    // written either way satisfies a client reading only `tools/list`.
    expect(register!.description).toContain('workflow_authoring_guide');
  });
});
