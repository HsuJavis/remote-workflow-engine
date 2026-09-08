// UT-115 (TASK-120, DES-132, ARCH-083, ADR-022): the MECHANICAL guard — "the deletion is not
// finished while something still describes the deleted thing" is this ledger's single most-repeated
// defect (nine recorded instances across v21/v22), so REQ-105's deletion is enforced by a grep guard
// in CI, not by review discipline. `src/**` must mention "skeleton" (case-insensitive) NOWHERE outside
// an EXACTLY-FOUR file allowlist (`workflow-meta.ts`, `dashboard.ts`, `server.ts` — the last for its
// unchanged, still-auth-gated `/api/runs/:id/dag` branch, ADR-022/v22 finding H2 — and
// `graph-analyzer.ts`, added by Orchestrator adjudication (v23) #3, 04-design.md), and no advertised
// MCP tool description or input-schema string may contain the word at all.
//
// Adjudication (v23) #3 criterion (S-2) for ANY allowlist membership — both required, or it is not
// on the list: (1) the file consumes the skeleton INTERNALLY (layout, or grounding for the graph
// analyzer's prompt) and (2) it serves the skeleton, or any projection of it, to NO principal —
// directly or through a response body, tool schema, or rendered page. `graph-analyzer.ts` satisfies
// both: it grounds the analyzer's prompt from `parseWorkflowSkeleton` and the skeleton never reaches
// the analyzer's output, which is structure-only (adjudication A3). A fifth entry must be argued
// against these two sentences in a new adjudication, not merely added to the Set.
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
// `grep -rIli skeleton src/`), three more than the allowlist permits; `workflow_source`'s own advertised
// tool description ALSO contains the literal word "skeleton" (`server.ts` TOOL_METADATA, confirmed by
// direct read) — both assertions fail against the current tree, for the genuine unimplemented reason.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { projectToolsList } from '../../src/tool-specs.js';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');
// v26 (ADR-048, REQ-128, ARCH-113): a FIFTH and a SIXTH entry, added by the new adjudication
// ADR-022 demanded rather than by a mechanical edit. `skeleton-graph.ts` (`deriveExpectedGraph`)
// passes criterion S-2: the only thing it projects is the `expected:` block inside a
// DIAGRAM_DIRECTION / LANE_MISMATCH / TOOLS_MISMATCH / EDGE_MISMATCH refusal, returned to the caller
// who just submitted that very script in the same `workflow_register` call — a derivation of the
// author's OWN input, never a cross-principal projection, which is the leak ADR-022 exists to
// prevent. `workflow-catalog.ts` joins on exactly the same argument, because ADR-048's own sentence
// describes THAT file: `validateRegistration` is the call site that invokes the derivation and
// throws the refusal.
// FLAGGED for Gate 8: ADR-048's Action line names only `skeleton-graph.ts`; it should be amended to
// name its one caller too, since the adjudication's reasoning is about that caller's behaviour.
const ALLOWLIST = new Set(['workflow-meta.ts', 'dashboard.ts', 'server.ts', 'graph-analyzer.ts', 'skeleton-graph.ts', 'workflow-catalog.ts']);

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
  it('src/** mentions "skeleton" (case-insensitive) NOWHERE outside the exactly-four-file allowlist', () => {
    const violators: string[] = [];
    for (const file of listTsFiles(SRC_ROOT)) {
      const base = relative(SRC_ROOT, file);
      if (ALLOWLIST.has(base)) continue;
      const text = readFileSync(file, 'utf8');
      if (/skeleton/i.test(text)) violators.push(base);
    }
    expect(violators).toEqual([]);
  });

  it('a SEVENTH allowlist entry would still fail — the allowlist is exactly six, not "six or more"', () => {
    // v26 (ADR-048): four became six by ONE adjudication covering the derivation and its single
    // caller. The pin moves with it — the guard's point is that growth costs an ARGUMENT, not that
    // the number can never change.
    expect(ALLOWLIST.size).toBe(6);
  });

  // v24 (integrator): the advertised surface MOVED. `server.ts`'s `TOOL_METADATA` object is gone —
  // `tool-specs.ts` is now the ONE source of `tools/list` (DES-138) — so this guard's old anchor
  // (`text.indexOf('const TOOL_METADATA')`) could never be found again and the assertion failed on
  // its own scaffolding rather than on a leak. It now reads the REAL projection, which is strictly
  // stronger: it checks what a client is actually served, not a source block that happens to feed it.
  it('no advertised tool description or input/output schema contains the word "skeleton" (REQ-105)', () => {
    const advertised = JSON.stringify(projectToolsList());
    expect(/skeleton/i.test(advertised)).toBe(false);
  });
});
