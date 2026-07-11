// v2 (REQ-025): materialize a client-supplied seed tree into a run workspace BEFORE any agent
// starts, so the run's agents Read/Edit the real project in place (not only a bounded base embedded
// in a prompt). STRIPS executable-on-load Claude config (.claude/settings*.json, .claude/hooks/**)
// so `settingSources:['project']` can never run seed-borne hooks/settings on the engine host —
// closing the DES-028 hook-gate vector for the seed path. Every write is realpath-contained to the
// workspace; a path escaping via `../`/symlink, or targeting .git internals, is rejected (never
// written).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { isPathContained } from './path-containment.js';

export interface SeedFile {
  path: string;
  contentB64: string;
}

export interface SeedResult {
  written: string[];
  stripped: string[]; // .claude settings/hooks removed by policy (RCE guard)
  rejected: string[]; // path escaped the workspace / targeted .git internals
}

// `.claude/settings.json`, `.claude/settings.local.json`, anything under `.claude/hooks/` — the
// entries `settingSources:['project']` would EXECUTE. (A plain `.claude/skills/**` or the user's own
// CLAUDE.md is NOT stripped — skills are the intended materialized surface; CLAUDE.md is inert data.)
const STRIP_RE = /(^|\/)\.claude\/(settings[^/]*\.json|hooks\/.*)$/;

export function isStrippedSeedPath(rel: string): boolean {
  return STRIP_RE.test('/' + rel.split(sep).join('/').replace(/^\/+/, ''));
}

export function materializeSeed(workspace: string, seed: SeedFile[]): SeedResult {
  const res: SeedResult = { written: [], stripped: [], rejected: [] };
  for (const f of seed) {
    const rel = String(f?.path ?? '');
    if (rel === '') {
      res.rejected.push(rel);
      continue;
    }
    if (isStrippedSeedPath(rel)) {
      res.stripped.push(rel);
      continue;
    }
    const norm = '/' + rel.split(sep).join('/');
    if (norm.includes('/.git/') || norm.endsWith('/.git')) {
      res.rejected.push(rel);
      continue;
    }
    const abs = join(workspace, rel);
    if (!isPathContained(abs, workspace)) {
      res.rejected.push(rel); // ../ or symlink escape
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.from(f.contentB64 ?? '', 'base64'));
    res.written.push(rel);
  }
  return res;
}
