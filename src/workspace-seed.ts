// v2 (REQ-025): materialize a client-supplied seed tree into a run workspace BEFORE any agent
// starts, so the run's agents Read/Edit the real project in place (not only a bounded base embedded
// in a prompt). STRIPS executable-on-load Claude config (.claude/settings*.json, .claude/hooks/**)
// so `settingSources:['project']` can never run seed-borne hooks/settings on the engine host —
// closing the DES-028 hook-gate vector for the seed path. Every write is realpath-contained to the
// workspace; a path escaping via `../`/symlink, or targeting .git internals, is rejected (never
// written).
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lexicalVerdict, pathVerdict } from './path-verdict.js';
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
 *  seed paths so they can NEVER diverge. Path plane only — the byte source is irrelevant to policy.
 *  A thin adapter over the shared `pathVerdict` (v24 DES-142/TASK-134) onto this module's own
 *  ok/stripped/rejected shape, so `SeedResult`'s field names don't change. */
function seedPathVerdict(workspace: string, rel: string): { verdict: 'ok'; abs: string } | { verdict: 'stripped' | 'rejected' } {
  const v = pathVerdict(workspace, rel, undefined, 'run-workspace');
  if (v.kind === 'ok') return { verdict: 'ok', abs: v.abs ?? join(workspace, rel) };
  if (v.kind === 'stripped') return { verdict: 'stripped' };
  return { verdict: 'rejected' };
}

export function isStrippedSeedPath(rel: string): boolean {
  return lexicalVerdict('run-workspace', rel).kind === 'stripped';
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
