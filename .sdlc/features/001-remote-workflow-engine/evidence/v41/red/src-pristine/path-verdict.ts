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
// it.
// issue #154 B4 follow-up (2026-10-09 re-verification): a plain case-SENSITIVE `startsWith` let
// `RWE-ver01`/`RWE-x` register and run — the reserved segment is a human-facing naming convention
// ("this is engine territory"), not a filesystem-identity check, so a caller should not be able to
// claim it back just by varying case. `isReservedPrefixed` below is now the ONE comparison every
// caller (including this file's own `lexicalVerdict`) uses; matching is case-INSENSITIVE.
export const RESERVED_PREFIX = 'rwe-';

/** Case-insensitive "does this bare name/path-segment start with the engine-reserved prefix" —
 *  the one comparison every caller of `RESERVED_PREFIX` must use (never a raw `startsWith` on the
 *  literal, which is case-sensitive and under this issue's fix no longer the actual rule). */
export function isReservedPrefixed(segment: string): boolean {
  return segment.toLowerCase().startsWith(RESERVED_PREFIX);
}

/** Pure, no filesystem access — decides everything that can be decided from the string alone.
 *  Normalizes `\` to `/`; rejects `''`, absolute paths (`/…`, `C:\…`), `..` traversal, NUL, and a
 *  reserved `rwe-*` first segment (on EITHER destination — issue #159 C6: this used to be
 *  asset-tree-only, which made it structurally unreachable for a seed/seedManifest path even though
 *  the identical-looking `workspace_push` check caught it); strips former `.claude` settings/hooks
 *  paths on a `run-workspace` destination. */
export function lexicalVerdict(dest: Dest, rel: string): Verdict {
  if (rel === '') return { kind: 'reject', reason: 'EMPTY' };
  if (rel.includes('\0')) return { kind: 'reject', reason: 'NUL' };

  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return { kind: 'reject', reason: 'ABSOLUTE' };

  const segments = norm.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) return { kind: 'reject', reason: 'ESCAPE' };
  if (segments[0] && isReservedPrefixed(segments[0])) return { kind: 'reject', reason: 'RESERVED_PREFIX' };

  if (dest === 'run-workspace') {
    if (segments.includes('.git')) return { kind: 'reject', reason: 'GIT_INTERNAL' };
    const m = STRIP_RE.exec('/' + norm.replace(/^\/+/, ''));
    if (m) return { kind: 'stripped', reason: m[2].startsWith('hooks/') ? 'CLAUDE_HOOKS' : 'CLAUDE_SETTINGS' };
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

// Issue #166 decision 2: `MAX_BARE_NAME_LENGTH` counts JS string characters (`.length`), and a
// surrogate-pair-free character is one JS "character" regardless of its UTF-8 encoded size — a
// 128-character name built from 3-byte CJK codepoints (e.g. "名") is ~384 UTF-8 bytes, comfortably
// past Linux's NAME_MAX (255 bytes for one path component, the exact ceiling the issue's live
// repro hit as `ENAMETOOLONG` out of `unlink`/`mkdir` on `assets/<name>` and `workflows/<name>`).
// This is an ADDITIONAL ceiling, enforced ALONGSIDE `MAX_BARE_NAME_LENGTH`, not a replacement for
// it — the owner's own number (#166 decision 2), chosen to leave ~55 bytes of headroom under the
// 255-byte NAME_MAX for any future name-derived sibling path component without having to re-audit
// every join site that already exists today.
export const MAX_BARE_NAME_BYTES = 200;

// Issue #166 tail (tester reverify, low item 2, owner decision): `isValidBareName`'s boolean API
// told a caller NOTHING about which of its six independent rules actually tripped — a 129-
// character name and a 201-byte name both came back `false`, indistinguishable from the message
// alone. `bareNameViolation` is the one function that now DECIDES ("ok" vs. which rule"), in the
// exact same checked order `isValidBareName` always used (so no existing boolean call site's
// result can change); `isValidBareName` becomes a thin `=== null` wrapper over it, never a second,
// independently-maintained copy of the same six conditions.
export type BareNameRule = 'empty' | 'whitespace' | 'separator' | 'control-char' | 'dot-segment' | 'maxChars' | 'maxBytes';

export interface BareNameViolation {
  rule: BareNameRule;
  /** Present only for the two bounded rules (`maxChars`/`maxBytes`) — the ceiling itself. */
  limit?: number;
  /** Present only for the two bounded rules — the actual character/byte count that exceeded it. */
  actual?: number;
}

/** `null` for a valid bare name; else the ONE rule that failed, in the same priority order
 *  `isValidBareName` has always checked in (empty/non-string first, then the character ceiling,
 *  then whitespace, then a separator, then a control character, then `.`/`..`, then the byte
 *  ceiling last). Pure, no filesystem access — see `isValidBareName`'s own doc for the history of
 *  each individual rule; this file only adds the ABILITY to name which one fired. */
export function bareNameViolation(name: string): BareNameViolation | null {
  if (typeof name !== 'string' || name.length === 0) return { rule: 'empty' };
  if (name.length > MAX_BARE_NAME_LENGTH) return { rule: 'maxChars', limit: MAX_BARE_NAME_LENGTH, actual: name.length };
  if (name.trim() !== name) return { rule: 'whitespace' }; // leading/trailing whitespace padding
  if (name.includes('/') || name.includes('\\')) return { rule: 'separator' };
  // eslint-disable-next-line no-control-regex -- deliberately matching C0 controls + DEL
  if (/[\x00-\x1f\x7f]/.test(name)) return { rule: 'control-char' };
  if (name === '.' || name === '..') return { rule: 'dot-segment' };
  const actualBytes = Buffer.byteLength(name, 'utf8');
  if (actualBytes > MAX_BARE_NAME_BYTES) return { rule: 'maxBytes', limit: MAX_BARE_NAME_BYTES, actual: actualBytes };
  return null;
}

/** True for a non-empty, length-bounded name with no leading/trailing whitespace that contains
 *  neither path separator and is not exactly `.`/`..` — safe to join as exactly one path segment
 *  with no risk of adding, removing, or escaping a directory level. Deliberately silent on the
 *  `rwe-` reserved prefix: callers that care (workflow_register) check `isReservedPrefixed`
 *  separately, as a distinct refusal code from "malformed" (`INVALID_NAME`).
 *
 *  issue #154 B4 follow-up (2026-10-09 re-verification): `name.trim() !== name` only ever caught a
 *  LEADING/TRAILING control/whitespace character — an EMBEDDED one (a tab, newline, or other C0
 *  control byte in the middle of the name, e.g. `'ver2-01-tab\tmid'`) round-tripped through `trim()`
 *  unchanged and registered. Every C0 control character (0x00–0x1F) and DEL (0x7F) anywhere in the
 *  name is now refused — not just the three ('\0', '/', '\\') already checked for path-escape
 *  reasons; a bare name has no business carrying a tab/newline/etc. at all, embedded or not.
 *
 *  issue #166 decision 2: ALSO refused past `MAX_BARE_NAME_BYTES` UTF-8 bytes — see that
 *  constant's own doc. This is the ONE shared validator `validateRegistration` (fresh
 *  registrations) and `_computeStoredVersionValidity` (the #154-style re-check of an
 *  already-stored row) both call, so a byte-oversized legacy name is refused at registration AND
 *  demoted to `NOT_RUNNABLE` on every existing row the same way — the two can never disagree about
 *  what counts as a valid bare name.
 *
 *  issue #166 tail (low item 2): now a thin wrapper over `bareNameViolation` — same six checks,
 *  same order, same boolean result for every existing call site; the only change is that a caller
 *  who also wants to know WHICH rule failed can call `bareNameViolation` directly instead. */
export function isValidBareName(name: string): boolean {
  return bareNameViolation(name) === null;
}
