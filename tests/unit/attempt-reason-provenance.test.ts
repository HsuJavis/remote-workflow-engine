// UT-379 (ARCH-192/194 v41b, Gate 8 r1 V41-A2/R-1): `ATTEMPT_REASONS` (src/event-log.ts) is the ONE
// runtime source of truth for the `AttemptReason` vocabulary. Before this repair, `run-manager.ts`
// hand-copied the 8 words into its own module-private `ATTEMPT_REASONS` Set that imported nothing —
// one of FIVE independently hand-maintained copies (the type, the guide grammar, the `run_status`
// description, the `errors.ts` hint, the generated `docs/AUTHORING.md`) with only a single regex
// lock (sandbox-refusal-provenance.test.ts covers a DIFFERENT drift pair: ENGINE_REFUSAL_CODES vs
// RECORDED_REFUSAL_CODES — error CODES, not attempt-reason WORDS). A 9th word added to the type
// would compile clean and `failureReason()` would silently fall through to `'error'` with no red
// test — the exact "two names" defect class REQ-231 was opened to close (ARCH-185/INV-V40-7 was the
// same class, blocked at v40 Gate 8 r1). This test is the missing lock: it reads each served copy's
// SOURCE TEXT (never re-executes it) and asserts exact set equality against the one runtime value.
//
// Mock policy (unit): no RunManager/no harness — pure source-text regex extraction, the same
// pattern `sandbox-refusal-provenance.test.ts`'s own DRIFT GUARD case uses for a different pair.
//
// Red reason: this file (and its four extraction cases) did not exist before this repair; written
// AFTER `ATTEMPT_REASONS` already existed as a value export, so it is a pure LOCK, not a RED-first
// behavior test — it passes immediately once written because the four served copies were already
// correct text (ARCH-194 v41b: "no served wording changes in this amendment"). Its value is as a
// drift guard going forward, not as a red/green behavior proof.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ATTEMPT_REASONS } from '../../src/event-log.js';

const ROOT = join(__dirname, '..', '..');
const EXPECTED = [...ATTEMPT_REASONS].sort();

function extractGrammarWords(text: string): string[] {
  const m = text.match(/failed: \(([^)]*)\) after/);
  expect(m, 'PRIMITIVE_FAILED_GRAMMAR shape not found').not.toBeNull();
  return m![1]!
    .split('|')
    .map((alt) => (/^HTTP /.test(alt) ? 'http' : alt))
    .sort();
}

describe('UT-379: ATTEMPT_REASONS provenance — every served copy names EXACTLY the runtime set (Gate 8 r1 V41-A2/R-1)', () => {
  it('src/errors.ts — the PRIMITIVE_FAILED hint\'s "detail.reason carries ..." list', () => {
    const src = readFileSync(join(ROOT, 'src', 'errors.ts'), 'utf8');
    const m = src.match(/detail\.reason carries ([a-z_|]+)/);
    expect(m, 'PRIMITIVE_FAILED hint shape not found in errors.ts').not.toBeNull();
    const words = m![1]!.split('|').sort();
    expect(words).toEqual(EXPECTED);
  });

  it('src/tool-specs.ts — the run_status description\'s "the primitive\'s failure word (...)" list', () => {
    const src = readFileSync(join(ROOT, 'src', 'tool-specs.ts'), 'utf8');
    const m = src.match(/primitive's failure word \(([^)]*)\)/);
    expect(m, "\"primitive's failure word (...)\" shape not found in tool-specs.ts").not.toBeNull();
    const words = m![1]!
      .split(',')
      .map((w) => w.trim().replace(/`/g, ''))
      .sort();
    expect(words).toEqual(EXPECTED);
  });

  it('src/authoring-guide.ts — the PRIMITIVE_FAILED_GRAMMAR literal (source text; `http` spelled `HTTP \\d{3}`)', () => {
    const src = readFileSync(join(ROOT, 'src', 'authoring-guide.ts'), 'utf8');
    expect(extractGrammarWords(src)).toEqual(EXPECTED);
  });

  it('docs/AUTHORING.md (generated) — the SAME grammar, on disk', () => {
    const onDisk = readFileSync(join(ROOT, 'docs', 'AUTHORING.md'), 'utf8');
    expect(extractGrammarWords(onDisk)).toEqual(EXPECTED);
  });
});
