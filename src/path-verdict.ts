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
// CLAUDE.md is NOT stripped (copied verbatim from the former workspace-seed.ts STRIP_RE).
const STRIP_RE = /(^|\/)\.claude\/(settings[^/]*\.json|hooks\/.*)$/;

const RESERVED_PREFIX = 'rwe-';

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
