// UT-161 (DES-159, v24): three source-text grep guards over src/ — (1) no mermaid npm import or
// CDN <script> tag; (2) none of the 15 old tool names appear as string literals; (3) no
// Date.now()/new Date() outside clock.ts in the four v24 seam files. Written test-first (Gate 5,
// RED) — the old tool names are still literally present in src/server.ts's TOOL_NAMES /
// callTool's switch today (this is the ENTIRE point of the guard: it must be red until TASK-152's
// rename sweep removes them).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src');

/** The clock guard is about CALLS, not prose. `scheduler.ts:218` documents its own rule with the
 *  words "never a bare Date.now()" and was flagged as an offender by the raw source-text grep — a
 *  guard that fails on the comment EXPLAINING the guard teaches the next author to delete the
 *  comment. Comments are stripped; a real call still trips it (string literals are left alone, so
 *  a `Date.now()` hidden in one still counts). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const OLD_NAMES = [
  'workflow_run', 'workflow_get', 'blob_put', 'seed_plan', 'asset_push', 'asset_list',
  'asset_delete', 'workflow_artifacts', 'workflow_artifact_get', 'workflow_trigger',
  'mcp_provision', 'workflow_regenerate_diagram',
];

describe('grep guards — no retired v24 surface remains in src/ (UT-161, DES-159)', () => {
  it('(1) no `mermaid` npm import or CDN <script> tag anywhere in src/', () => {
    const offenders = walk(SRC_DIR).filter((f) => {
      const text = readFileSync(f, 'utf-8');
      return /from ['"]mermaid['"]/.test(text) || /cdn.*mermaid/i.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('(2) none of the 15 retired old tool names appear as a string literal in src/', () => {
    const offenders: Array<{ file: string; name: string }> = [];
    for (const f of walk(SRC_DIR)) {
      const text = readFileSync(f, 'utf-8');
      for (const name of OLD_NAMES) {
        if (text.includes(`'${name}'`) || text.includes(`"${name}"`)) offenders.push({ file: f, name });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('(3) no Date.now()/new Date() outside clock.ts in the four v24 seam files', () => {
    const seamFiles = ['scheduler.ts', 'webhook-registry.ts', 'asset-sync.ts', 'run-store.ts'].map((n) => join(SRC_DIR, n));
    const offenders = seamFiles.filter((f) => /Date\.now\(\)|new Date\(\)/.test(stripComments(readFileSync(f, 'utf-8'))));
    expect(offenders).toEqual([]);
  });
});
