// VAL-254: REQ-219 — a green-tested, zero-production-caller module is either wired or deleted; no
// third ending. Real entrypoint: greps the ACTUAL src/tests tree on disk (the same technique
// TASK-254/255's own DoD uses) — this is the "delete" half's real proof for both modules; the "wire"
// half's real proof (REQ-021's re-walk, findProjectMarkerAboveWorkspace) is VAL-024's re-pointed
// re-walk clause (see that file's v37 amendment), not duplicated here.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
// v37 Gate-6 fixture fix (2026-09-22, implementer): this checker's own file lives under `tests/`
// and necessarily NAMES every pattern it greps for (in its own describe/it titles and the
// `grepCount(...)` call sites themselves) — an unfiltered `grep -rln` over `src tests` always
// re-discovers ITSELF, making every assertion below unpassable regardless of what else is deleted
// (empirically confirmed: `grep -rln "timeout-race" src tests` returned exactly this file, with
// `src/timeout-race.ts` already gone). Excluding the checker's own basename preserves the intended
// claim — "no OTHER file references this" — without weakening it.
const SELF = 'val-254-req219-dead-code.test.ts';

function grepCount(pattern: string): number {
  try {
    const out = execSync(`grep -rln "${pattern}" src tests`, { cwd: ROOT }).toString();
    return out.split('\n').filter((line) => line.length > 0 && !line.endsWith(SELF)).length;
  } catch {
    return 0; // grep exits 1 on no match — zero hits, not an error
  }
}

describe('VAL-254: REQ-219 — timeout-race.ts and session-options-builder.ts are GONE, not merely unwired (ADR-085)', () => {
  it('src/timeout-race.ts no longer exists', () => {
    expect(existsSync(join(ROOT, 'src/timeout-race.ts'))).toBe(false);
  });

  it('src/session-options-builder.ts no longer exists', () => {
    expect(existsSync(join(ROOT, 'src/session-options-builder.ts'))).toBe(false);
  });

  it('nothing under src/ or tests/ still references timeout-race', () => {
    expect(grepCount('timeout-race')).toBe(0);
  });

  it('nothing under src/ or tests/ still references session-options-builder', () => {
    expect(grepCount('session-options-builder')).toBe(0);
  });

  it('the zero-importer fence over session-options-builder is retired in the SAME commit as the module — no replacement fence (DES-260, INV-V37-3)', () => {
    expect(grepCount('stays FENCED')).toBe(0);
  });
});
