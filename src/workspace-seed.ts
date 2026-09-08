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

/** v26 (DES-170, ARCH-110, TASK-175, REQ-121, issue #64): the ONE string interpolated into both the
 *  `run_start` schema's `seed.items.contentB64` description (tool-specs.ts) and validateSeedSpec's
 *  own refusal message below — a drift lock so the two can never say something different. */
export const SEED_ITEM_HINT =
  "each seed[] element must supply contentB64: a base64-encoded string of the file's bytes " +
  '(large trees, or content you already have a sha256 for, should use seedManifest instead)';

type SeedSpecOk = { ok: true; files: SeedFile[] } | { ok: true; entries: ManifestEntry[] };
type SeedSpecErr = { ok: false; code: 'INVALID_SEED_SPEC'; index: number; path: string | null; message: string };

const SHA256_RE = /^[0-9a-f]{64}$/;

function refuse(source: 'seed' | 'seedManifest', index: number, path: string | null, message: string): SeedSpecErr {
  return { ok: false, code: 'INVALID_SEED_SPEC', index, path, message: `${source}[${index}]${path !== null ? ` (${path})` : ''}: ${message}` };
}

/** DES-170: the ONE door for `INVALID_SEED_SPEC` — pure, no I/O, never throws. Refuses the FIRST
 *  offending element (validate-all-then-write means nothing is materialized until every element
 *  passes). A non-array `value` refuses whole, `index: -1`. */
export function validateSeedSpec(source: 'seed' | 'seedManifest', value: unknown): SeedSpecOk | SeedSpecErr {
  if (!Array.isArray(value)) {
    return { ok: false, code: 'INVALID_SEED_SPEC', index: -1, path: null, message: `${source} must be an array; got ${value === null ? 'null' : typeof value}` };
  }
  for (let i = 0; i < value.length; i++) {
    const el = value[i];
    if (el === null || typeof el !== 'object' || Array.isArray(el)) {
      return refuse(source, i, null, `element must be an object; got ${el === null ? 'null' : Array.isArray(el) ? 'array' : typeof el}`);
    }
    const path = (el as Record<string, unknown>).path;
    if (typeof path !== 'string' || path.length === 0) {
      return refuse(source, i, null, 'path is required and must be a non-empty string');
    }
    if (source === 'seed') {
      const contentB64 = (el as Record<string, unknown>).contentB64;
      if (typeof contentB64 !== 'string') {
        return refuse(source, i, path, `contentB64 is required and must be a string — ${SEED_ITEM_HINT}`);
      }
    } else {
      const sha256 = (el as Record<string, unknown>).sha256;
      if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
        return refuse(source, i, path, 'sha256 is required and must be a 64-character lowercase hex string');
      }
      const exec = (el as Record<string, unknown>).exec;
      if (exec !== undefined && typeof exec !== 'boolean') {
        return refuse(source, i, path, 'exec must be a boolean when present');
      }
    }
  }
  return source === 'seed' ? { ok: true, files: value as SeedFile[] } : { ok: true, entries: value as ManifestEntry[] };
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
