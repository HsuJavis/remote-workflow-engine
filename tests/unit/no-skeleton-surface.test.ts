// UT-115 (TASK-120, DES-132, ARCH-083, ADR-022): the MECHANICAL guard — "the deletion is not
// finished while something still describes the deleted thing" is this ledger's single most-repeated
// defect (nine recorded instances across v21/v22), so REQ-105's deletion is enforced by a grep guard
// in CI, not by review discipline. `src/**` must mention "skeleton" (case-insensitive) NOWHERE outside
// an EXACTLY-THREE file allowlist (`workflow-meta.ts`, `dashboard.ts`, `server.ts` — the last for its
// unchanged, still-auth-gated `/api/runs/:id/dag` branch, ADR-022/v22 finding H2), and no advertised
// MCP tool description or input-schema string may contain the word at all.
//
// Written FIRST and watched to fail against the CURRENT tree (TASK-120's own dod: "a guard written
// after the deletion is a guard fitted to whatever the deletion happened to leave"). Gate 6 performs
// the deletion this guard then turns green for.
//
// Mock policy (unit, DES-119): pure static analysis over `src/**` source text — no I/O beyond
// reading this repo's own files, no server boot (same convention as no-mock static-grep guards
// elsewhere in this ledger, e.g. schema-drift's own tools/list check but at the source-text level).
//
// Red reason: TODAY six files mention "skeleton" (`dashboard-page.ts`, `dashboard.ts`,
// `mcp-facade.ts`, `server.ts`, `workflow-meta.ts`, `workflow-view.ts` — confirmed via
// `grep -rIli skeleton src/`), three more than the allowlist permits; `workflow_get`'s own advertised
// tool description ALSO contains the literal word "skeleton" (`server.ts` TOOL_METADATA, confirmed by
// direct read) — both assertions fail against the current tree, for the genuine unimplemented reason.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');
const ALLOWLIST = new Set(['workflow-meta.ts', 'dashboard.ts', 'server.ts']);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listTsFiles(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('no-skeleton-surface guard (UT-115, ADR-022, REQ-105)', () => {
  it('src/** mentions "skeleton" (case-insensitive) NOWHERE outside the exactly-three-file allowlist', () => {
    const violators: string[] = [];
    for (const file of listTsFiles(SRC_ROOT)) {
      const base = relative(SRC_ROOT, file);
      if (ALLOWLIST.has(base)) continue;
      const text = readFileSync(file, 'utf8');
      if (/skeleton/i.test(text)) violators.push(base);
    }
    expect(violators).toEqual([]);
  });

  it('a FOURTH allowlist entry would still fail — the allowlist is exactly three, not "three or more"', () => {
    expect(ALLOWLIST.size).toBe(3);
  });

  it('no advertised MCP tool description or input-schema string in server.ts contains the word "skeleton"', () => {
    const text = readFileSync(join(SRC_ROOT, 'server.ts'), 'utf8');
    const metaBlockStart = text.indexOf('const TOOL_METADATA');
    expect(metaBlockStart).toBeGreaterThan(-1);
    // Isolate the TOOL_METADATA object literal (bounded by the next top-level `const`/`function`
    // declaration) so this assertion is scoped to advertised schema text, not the whole file (the
    // /dag branch's own allowlisted internal comment legitimately still says "skeleton").
    const rest = text.slice(metaBlockStart);
    const nextTopLevel = rest.slice(20).search(/\n(const|function|type|interface) /);
    const metaBlock = nextTopLevel === -1 ? rest : rest.slice(0, nextTopLevel + 20);
    expect(/skeleton/i.test(metaBlock)).toBe(false);
  });
});
