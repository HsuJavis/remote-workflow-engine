// v24 DES-142 (ARCH-093, TASK-134): one pure lexical decision plus one injected-realpath
// containment check, shared by every write path (materializeSeed/materializeManifest,
// AssetSyncService.push, workspace_pull, workspace_delete) so the run-workspace and asset-tree
// rule sets can never drift apart (REQ-108's "a single shared path-verdict decides every write").
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { isPathContained } from './path-containment.js';

export type Dest = 'run-workspace' | 'asset-tree';

export type Verdict =
  | { kind: 'ok'; abs?: string; reason?: undefined }
  | { kind: 'stripped'; reason: 'CLAUDE_SETTINGS' | 'CLAUDE_HOOKS' }
  | { kind: 'reject'; reason: 'ESCAPE' | 'GIT_INTERNAL' | 'RESERVED_PREFIX' | 'ABSOLUTE' | 'SYMLINK' | 'NUL' | 'EMPTY' };

// `.claude/settings.json`, `.claude/settings.local.json`, anything under `.claude/hooks/` — the
// entries `settingSources:['project']` would EXECUTE. A plain `.claude/skills/**` or the user's own
// CLAUDE.md is NOT stripped AT SEED TIME (copied verbatim from the former workspace-seed.ts
// STRIP_RE — this module only decides what a SEED write may land as, never what survives past it).
// Issue #144 / v0374 review L-1: a seeded `.claude/skills/**` IS removed later, at the FIRST
// dispatch — `PROJECT_CONFIG_PATHS` (bash-confinement.ts) now includes `.claude/skills`, swept from
// the run workspace by `sweepPlantedConfig` before every agent() call, because the engine itself no
// longer materializes a declared skill into the workspace at all (it goes to a private per-dispatch
// directory instead — see that constant's own doc). A user who seeds their own `.claude/skills/`
// will see it vanish from `workspace_pull` after the first dispatch; push skills via
// `workspace_push({kind:'skill'})` instead (documented in the authoring guide and DEPLOY.md).
const STRIP_RE = /(^|\/)\.claude\/(settings[^/]*\.json|hooks\/.*)$/;

// Issue #91: exported so every other caller-supplied-NAME check (workflow_register's, so far —
// see workflow-catalog.ts's validateRegistration) reuses this ONE literal instead of duplicating
// it; the case-sensitivity (plain `startsWith`, no `toLowerCase`) is part of the contract other
// callers must match, not an implementation detail local to this file.
export const RESERVED_PREFIX = 'rwe-';

/** Pure, no filesystem access — decides everything that can be decided from the string alone.
 *  Normalizes `\` to `/`; rejects `''`, absolute paths (`/…`, `C:\…`), `..` traversal, and NUL;
 *  strips former `.claude` settings/hooks paths on a `run-workspace` destination; rejects a
 *  reserved `rwe-*` first segment on an `asset-tree` destination. */
export function lexicalVerdict(dest: Dest, rel: string): Verdict {
  if (rel === '') return { kind: 'reject', reason: 'EMPTY' };
  if (rel.includes('\0')) return { kind: 'reject', reason: 'NUL' };

  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return { kind: 'reject', reason: 'ABSOLUTE' };

  const segments = norm.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) return { kind: 'reject', reason: 'ESCAPE' };

  if (dest === 'run-workspace') {
    if (segments.includes('.git')) return { kind: 'reject', reason: 'GIT_INTERNAL' };
    const m = STRIP_RE.exec('/' + norm.replace(/^\/+/, ''));
    if (m) return { kind: 'stripped', reason: m[2].startsWith('hooks/') ? 'CLAUDE_HOOKS' : 'CLAUDE_SETTINGS' };
  } else {
    if (segments[0] && segments[0].startsWith(RESERVED_PREFIX)) return { kind: 'reject', reason: 'RESERVED_PREFIX' };
  }

  return { kind: 'ok' };
}

/** `lexicalVerdict` then realpath-injected containment — a path whose lexical shape is fine can
 *  still resolve outside `root` via a symlink. `realpath` defaults to `realpathSync`; tests inject
 *  a fake to exercise the escape without touching disk. */
export function pathVerdict(
  root: string,
  rel: string,
  realpath: (p: string) => string = realpathSync,
  dest: Dest = 'run-workspace',
): Verdict {
  const lex = lexicalVerdict(dest, rel);
  if (lex.kind !== 'ok') return lex;
  const abs = join(root, rel);
  if (!isPathContained(abs, root, realpath)) return { kind: 'reject', reason: 'SYMLINK' };
  return { kind: 'ok', abs };
}

// Issue #154 B4: a workflow NAME (unlike the multi-segment relative paths `lexicalVerdict` above
// decides) is a single bare path SEGMENT — it is joined directly as `join(workRoot, 'workflows',
// name)` (workflow-catalog.ts's `workFolder`, which becomes the forked sandbox child's own `cwd`)
// and, separately, as `join(assetRoot, name, 'skill'|'mcp', ...)` (asset-sync.ts). The ONLY check
// either site had was a case-sensitive `rwe-` prefix (RESERVED_PREFIX, above) — nothing rejected an
// empty name, whitespace, `..`, an embedded `/` (which turns one "name" into several real path
// segments, some of them `..`), or an unbounded length. A name failing this check can never become a
// `/`-free, non-`..`, non-empty single path segment, so joining it can never add or remove a
// directory level from what the caller intended — closing the escape at its ONE source rather than
// chasing every join site that uses a name downstream.
//
// Deliberately NOT `params/contract.ts`'s `validateNameArray` charset (`/^[A-Za-z0-9][\w.-]*$/`,
// alnum-first, no spaces/punctuation) — an early version of this function reused that exact pattern
// and broke a real, already-registered naming convention (tests/integration/guide-examples-register.
// test.ts registers workflows named e.g. `guide-nested workflow() black box`: spaces and parens,
// never a security concern on any target filesystem). The actual escape vector is narrower than
// "an unusual character": only `/` (and `\`, Windows) can turn one name into multiple real path
// segments, and only a name that resolves to exactly `.`/`..` can walk up a level with NO separator
// at all. Punctuation, spaces, unicode — anything else — is just a single, harmless path-segment
// NAME, whatever a filesystem makes of it.
/** Generous — real workflow names are short; this only needs to rule out pathological input before
 *  it reaches a filesystem call (ENAMETOOLONG territory starts well above this on every target OS). */
export const MAX_BARE_NAME_LENGTH = 128;

/** True for a non-empty, length-bounded name with no leading/trailing whitespace that contains
 *  neither path separator and is not exactly `.`/`..` — safe to join as exactly one path segment
 *  with no risk of adding, removing, or escaping a directory level. Deliberately silent on the
 *  `rwe-` reserved prefix: callers that care (workflow_register) check `RESERVED_PREFIX` separately,
 *  as a distinct refusal code from "malformed" (`INVALID_NAME`). */
export function isValidBareName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_BARE_NAME_LENGTH) return false;
  if (name.trim() !== name) return false; // rejects '', whitespace-only, and leading/trailing padding
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
  if (name === '.' || name === '..') return false;
  return true;
}
