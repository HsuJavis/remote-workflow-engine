// Per-run MCP state placeholders (issue #126 B): a pushed stdio MCP server's `env` values and
// `args` items may reference `${run:dir}` (a per-run, per-server private directory) or `${run:id}`
// (this run's id) — resolved per-dispatch so a STATEFUL server (e.g.
// @modelcontextprotocol/server-memory, which otherwise writes a JSONL file in its own package dir)
// gets per-run isolation instead of a host-global file shared by every run/principal that declares
// it (the cross-tenant data channel issue #126 reports).
//
// Deliberately a SEPARATE closed vocabulary from `secret-resolver.ts`'s `${secret:NAME}` grammar —
// never confused with a secret handle, never resolved through the secret store. Mirrors its
// collect-then-substitute shape (validate BEFORE anything is substituted, same as
// `resolveConfig`'s atomic all-or-nothing posture) so the two stay structurally recognizable as
// siblings without sharing code that would let a change to one silently reshape the other.
import { dirname, join } from 'node:path';

const RUN_PLACEHOLDER_ANY = /\$\{run:([^}]*)\}/g;
const KNOWN_RUN_PLACEHOLDERS = new Set(['dir', 'id']);

export class UnknownRunPlaceholderError extends Error {
  readonly code = 'UNKNOWN_RUN_PLACEHOLDER' as const;
  constructor(raw: string) {
    super(`Unknown run placeholder: ${raw} — only \${run:dir} and \${run:id} are supported`);
    this.name = 'UnknownRunPlaceholderError';
  }
}

function walkStrings(value: unknown, fn: (s: string) => void): void {
  if (typeof value === 'string') fn(value);
  else if (Array.isArray(value)) for (const v of value) walkStrings(v, fn);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value as Record<string, unknown>)) walkStrings(v, fn);
}

/** PURE — throws UnknownRunPlaceholderError on the first `${run:xxx}` whose name is outside the
 *  closed vocabulary (dir, id). Call this at workspace_push time so an author with a typo finds out
 *  immediately, not on the run's first dispatch. Walks the WHOLE config (not just env/args) — a
 *  harmless superset of the "at minimum env values and args items" requirement; nothing else in a
 *  pushed MCP config shape is expected to carry one, but nothing stops it either. */
export function validateRunPlaceholders(config: unknown): void {
  walkStrings(config, (s) => {
    RUN_PLACEHOLDER_ANY.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RUN_PLACEHOLDER_ANY.exec(s))) {
      if (!KNOWN_RUN_PLACEHOLDERS.has(m[1]!)) throw new UnknownRunPlaceholderError(m[0]);
    }
  });
}

function substitute(value: unknown, values: { dir: string; id: string }, used: { dir: boolean }): unknown {
  if (typeof value === 'string') {
    RUN_PLACEHOLDER_ANY.lastIndex = 0;
    return value.replace(RUN_PLACEHOLDER_ANY, (full, name: string) => {
      if (name === 'dir') {
        used.dir = true;
        return values.dir;
      }
      if (name === 'id') return values.id;
      // Defense-in-depth only — `validateRunPlaceholders` should already have refused this
      // config at push time. Leaving an unrecognized placeholder's literal text untouched is
      // safer than guessing a substitution for it.
      return full;
    });
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, values, used));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = substitute(v, values, used);
    return out;
  }
  return value;
}

/** PURE — substitutes every known `${run:...}` placeholder. `usedDir` tells the caller whether
 *  `${run:dir}` actually appeared anywhere in `config`, so the caller only creates the directory
 *  (a side effect this function deliberately never performs itself) when something needs it. */
export function resolveRunPlaceholders(config: unknown, values: { dir: string; id: string }): { config: unknown; usedDir: boolean } {
  const used = { dir: false };
  const out = substitute(config, values, used);
  return { config: out, usedDir: used.dir };
}

// Belt-and-suspenders path-traversal guard (the declared mcp NAME is already lexically verdicted
// at workspace_push time, and the runId is always a server-minted randomUUID) — never build a
// filesystem path from either without re-checking it here too.
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;
function assertSafeSegment(label: string, value: string): void {
  if (!SAFE_NAME.test(value) || value === '.' || value === '..') {
    throw new Error(`Unsafe ${label} for MCP run-state dir: ${JSON.stringify(value)}`);
  }
}

/** The per-run DIRECTORY (parent of every declared server's own state dir within that run) —
 *  `<workflowFolder>/mcp-state/<runId>/`. `workflowFolder` is `workFolder(name)` from
 *  workflow-catalog.ts — `<workRoot>/workflows/<name>` — the SAME folder `runs/<runId>` (the pulled
 *  run workspace) sits under, so this is a SIBLING of the workspace: inside the engine's own
 *  workRoot deny (invisible to the run's own confined Bash) and never reachable via
 *  workspace_pull/workspace_list (which only ever read under `runs/<runId>`), yet still on the SAME
 *  host filesystem the stdio MCP child (which runs with host trust, outside the sandbox — see
 *  DEPLOY.md) can write to. */
export function mcpStateRunDir(workflowFolder: string, runId: string): string {
  assertSafeSegment('runId', runId);
  return join(workflowFolder, 'mcp-state', runId);
}

/** One declared server's own private state dir within a run — `.../mcp-state/<runId>/<server>/`.
 *  Created 0700 lazily, on first use, by the gateway (never by this pure module); persists across
 *  every agent dispatched within the SAME run (they all resolve the identical path), never across
 *  runs (a different runId is a different directory), and is reclaimed by `workspace-gc.ts`'s
 *  `reclaimStaleWorkspaces` on the SAME terminal+TTL sweep that reclaims the run's own workspace. */
export function mcpStateDir(workflowFolder: string, runId: string, serverName: string): string {
  assertSafeSegment('MCP server name', serverName);
  return join(mcpStateRunDir(workflowFolder, runId), serverName);
}

/** The workflow folder a run's workspace lives under. `runWorkspace(name, runId)`
 *  (workflow-catalog.ts) builds `<workflowFolder>/runs/<runId>` — this is the structural inverse
 *  (two path levels up), exported so the gateway (which only ever carries the resolved `workspace`
 *  string, never `workRoot`/`name` separately) and any future caller read the SAME derivation
 *  instead of a second hand-rolled one. */
export function workflowFolderOfWorkspace(workspace: string): string {
  return dirname(dirname(workspace));
}
