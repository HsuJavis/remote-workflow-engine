// UT-161 (DES-159, v24): three source-text grep guards over src/ — (1) no mermaid npm import or
// CDN <script> tag; (2) none of the 15 old tool names appear as string literals; (3) no
// Date.now()/new Date() outside clock.ts in the four v24 seam files. Written test-first (Gate 5,
// RED) — the old tool names are still literally present in src/server.ts's TOOL_NAMES /
// callTool's switch today (this is the ENTIRE point of the guard: it must be red until TASK-152's
// rename sweep removes them).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
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

// v26 (DES-173, ARCH-112, TASK-173/174, issue #66): the deletion's grep half — 10 retired
// identifiers, 2 provider literals, 3 env var names, comment-stripped for src/, raw for docs.
// Written test-first (Gate 5, RED): today `curateToolsForProvider`/`thinkingFor`/`EFFORT_PROFILES`/
// `sumUsageTokens` and the `'openai'`/`'gemini'` literals are all still present in src/, and
// `OPENAI_API_KEY`/`OPENAI_API_BASE`/`GEMINI_API_KEY` are still read/documented.
const RETIRED_IDENTIFIERS = [
  'NON_ANTHROPIC_EXCLUDED_TOOLS', 'curateToolsForProvider', 'STATIC_OPENAI', 'effortMapping',
  'ProviderEffortProfile', 'thinkingFor', 'EFFORT_PROFILES', 'mapEffort', 'profileFor', 'sumUsageTokens',
];
const RETIRED_PROVIDER_LITERALS = ["'openai'", "'gemini'"];
const RETIRED_ENV_NAMES = ['OPENAI_API_KEY', 'OPENAI_API_BASE', 'GEMINI_API_KEY'];
const DOCS_FILES = ['DEPLOY.md', 'README.md', 'rwe.env.example', 'rwe.config.example.json']
  .map((n) => join(dirname(SRC_DIR), n));

describe('grep guards — v26 provider retirement is complete (DES-173, issue #66)', () => {
  it('(1) none of the 10 retired identifiers remain anywhere in src/ (comment-stripped)', () => {
    const offenders: Array<{ file: string; name: string }> = [];
    for (const f of walk(SRC_DIR)) {
      const text = stripComments(readFileSync(f, 'utf-8'));
      for (const name of RETIRED_IDENTIFIERS) {
        if (new RegExp(`\\b${name}\\b`).test(text)) offenders.push({ file: f, name });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('(2) neither retired provider literal (openai/gemini) remains in src/', () => {
    const offenders: Array<{ file: string; name: string }> = [];
    for (const f of walk(SRC_DIR)) {
      const text = readFileSync(f, 'utf-8');
      for (const lit of RETIRED_PROVIDER_LITERALS) {
        if (text.includes(lit)) offenders.push({ file: f, name: lit });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('(3) none of the 3 retired env var names are read or documented (src/ + docs)', () => {
    const offenders: Array<{ file: string; name: string }> = [];
    const files = [...walk(SRC_DIR), ...DOCS_FILES.filter((f) => existsSync(f))];
    for (const f of files) {
      const text = f.endsWith('.ts') ? stripComments(readFileSync(f, 'utf-8')) : readFileSync(f, 'utf-8');
      for (const name of RETIRED_ENV_NAMES) {
        if (text.includes(name)) offenders.push({ file: f, name });
      }
    }
    expect(offenders).toEqual([]);
  });
});
