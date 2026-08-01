// v2 (REQ-025): materialize a client-supplied seed tree into a run workspace BEFORE any agent
// starts, so the run's agents Read/Edit the real project in place (not only a bounded base embedded
// in a prompt). STRIPS executable-on-load Claude config (.claude/settings*.json, .claude/hooks/**)
// so `settingSources:['project']` can never run seed-borne hooks/settings on the engine host —
// closing the DES-028 hook-gate vector for the seed path. Every write is realpath-contained to the
// workspace; a path escaping via `../`/symlink, or targeting .git internals, is rejected (never
// written).
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { isPathContained } from './path-containment.js';
import type { ManifestEntry } from './types.js';

export interface SeedFile {
  path: string;
  contentB64: string;
}

export interface SeedResult {
  written: string[];
  stripped: string[]; // .claude settings/hooks removed by policy (RCE guard)
  rejected: string[]; // path escaped the workspace / targeted .git internals
}

/** The per-path guardrail verdict, shared by the inline (materializeSeed) and CAS (materializeManifest)
 *  seed paths so they can NEVER diverge. Path plane only — the byte source is irrelevant to policy. */
function seedPathVerdict(workspace: string, rel: string): { verdict: 'ok'; abs: string } | { verdict: 'stripped' | 'rejected' } {
  if (rel === '') return { verdict: 'rejected' };
  if (isStrippedSeedPath(rel)) return { verdict: 'stripped' };
  const norm = '/' + rel.split(sep).join('/');
  if (norm.includes('/.git/') || norm.endsWith('/.git')) return { verdict: 'rejected' };
  const abs = join(workspace, rel);
  if (!isPathContained(abs, workspace)) return { verdict: 'rejected' }; // ../ or symlink escape
  return { verdict: 'ok', abs };
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
    const v = seedPathVerdict(workspace, rel);
    if (v.verdict !== 'ok') { res[v.verdict].push(rel); continue; }
    mkdirSync(dirname(v.abs), { recursive: true });
    writeFileSync(v.abs, Buffer.from(f.contentB64 ?? '', 'base64'));
    res.written.push(rel);
  }
  return res;
}

/** v10 Slice 2 (REQ-065): assemble a workspace from a CAS manifest — the SAME per-path guardrails as
 *  materializeSeed (strip/.git/realpath), reading each file's bytes from the content store by sha256,
 *  and applying the masked exec bit (`exec?true:false → 0o755:0o644`; setuid/setgid/sticky can't be
 *  expressed). `readBlob` returns the raw bytes for a sha, or null if absent (→ rejected). */
export function materializeManifest(workspace: string, manifest: ManifestEntry[], readBlob: (sha: string) => Buffer | null): SeedResult {
  const res: SeedResult = { written: [], stripped: [], rejected: [] };
  for (const e of manifest) {
    const rel = String(e?.path ?? '');
    const v = seedPathVerdict(workspace, rel);
    if (v.verdict !== 'ok') { res[v.verdict].push(rel); continue; }
    const bytes = readBlob(String(e.sha256 ?? ''));
    if (bytes === null) { res.rejected.push(rel); continue; } // blob not present in the store
    mkdirSync(dirname(v.abs), { recursive: true });
    writeFileSync(v.abs, bytes);
    chmodSync(v.abs, e.exec ? 0o755 : 0o644); // masked: only the exec bit, never setuid/setgid/sticky
    res.written.push(rel);
  }
  return res;
}
