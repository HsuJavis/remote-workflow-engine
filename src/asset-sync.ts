// Asset Sync core (DES-019 / ARCH-012 / TASK-021, v24 DES-153/TASK-144): the two mandatory pure
// security predicates — recursion-guard (D4) and path-safety — plus the AssetSyncService that
// stores assets under a workflow OR global scope using them. Transport-agnostic and UT-heavy on
// purpose (D-V2f task split): the live network probe for mcp transports (classifyTransport /
// McpProbe) is a DISTINCT test seam owned by DES-020/TASK-026.
//
// v24 (DES-153): `AssetKind` narrows to 'skill'|'mcp' — `hook` is refused by the MCP tool's own
// schema enum (INVALID_ARGUMENT) rather than this service, and `mcp-config`'s old
// redirect-to-provisioning path is retired along with `mcp_provision` (workspace_push replaces
// both). `LegacyAssetKind`/`AssetPush`/`classifyAsset`/`AssetDisposition` below are the PRE-v24
// surface, kept unchanged (still consumed by `server.ts`'s not-yet-migrated `asset_push` handler
// and by tests exercising `isSelfReferential`/`classifyAsset` directly) — TASK-147/148 retire them
// when the facade is rewritten; they are decoupled from the new `AssetKind` on purpose so neither
// union constrains the other.
import { mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readdirSync, statSync, renameSync, rmdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathVerdict, lexicalVerdict } from './path-verdict.js';
import { codedError } from './errors.js';
import type { Clock } from './clock.js';
import { classifyTransport, PROBE_TIMEOUT_MS, type McpProbe, type McpServerConfig } from './mcp-probe.js';
import { isEgressAllowed } from './seedref-egress.js';
import { validateRunPlaceholders, UnknownRunPlaceholderError } from './mcp-run-state.js';

/** Pre-v24 kind union — see file header. */
export type LegacyAssetKind = 'skill' | 'hook' | 'mcp-config';

export interface AssetPushFile {
  path: string;
  contentB64: string;
  // Issue #105 part A (owner decision): identical in shape to seedManifest's {path, sha256,
  // exec?} — exec:true materializes this file 0o755, absent/false materializes 0o644. Ignored by
  // the pre-v24 `AssetPush`/`isSelfReferential`/`classifyAsset` surface this interface is also
  // shared with (see file header) — only `AssetSyncService.push()`'s v24 skill branch reads it.
  exec?: boolean;
}

export interface AssetPush {
  kind: LegacyAssetKind;
  name: string;
  files: AssetPushFile[];
}

/**
 * Recursion guard (D4, pure): true when `a` is either (a) a mcp-config file whose own `url` field
 * resolves to THIS server's own bind address/port (`selfBind`), or (b) named with the reserved
 * `reservedPrefix` (this system's own plugin/guidance-skill identity) — regardless of kind. Never
 * throws; an unparseable mcp-config file simply isn't a self-reference BY URL (still may be caught
 * by the name check above).
 */
export function isSelfReferential(
  a: AssetPush,
  selfBind: { host: string; port: number },
  reservedPrefix: string,
): boolean {
  if (a.name.startsWith(reservedPrefix)) return true;
  if (a.kind === 'mcp-config') {
    for (const f of a.files) {
      let cfg: { url?: string } | undefined;
      try {
        cfg = JSON.parse(Buffer.from(f.contentB64, 'base64').toString('utf-8')) as { url?: string };
      } catch {
        continue; // not parseable JSON — not a self-reference by URL
      }
      if (!cfg?.url) continue;
      try {
        const u = new URL(cfg.url);
        const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
        if (u.hostname === selfBind.host && port === selfBind.port) return true;
      } catch {
        continue; // not a parseable URL — not a self-reference by URL
      }
    }
  }
  return false;
}

export interface AssetPushResult {
  stored: string[];
  excluded: Array<{ name: string; reason: string }>;
}

/** Asset-Ingestion Policy disposition (DES-028 / ARCH-018 / TASK-034). */
export type AssetDisposition =
  | { action: 'materialize' }
  | { action: 'redirect-to-provisioning' }
  | { action: 'reject'; code: 'HOOKS_UNSUPPORTED' };

/**
 * Pure per-kind classifier at the asset boundary (DES-028): `hook` is rejected by construction
 * (closes the arbitrary-server-side-code / RCE vector — never silently materialized; the engine's
 * OWN internal PreToolUse workspace-boundary hook is a fixed control, not user-uploadable, and is
 * unaffected); `mcp-config` redirects to provisioning (DES-024, REQ-009 rescope — not per-run
 * materialized); `skill` materializes as before (ARCH-012 unchanged). Takes no action itself —
 * callers (asset_push wiring) act on the returned disposition.
 */
export function classifyAsset(kind: LegacyAssetKind, _asset: unknown): AssetDisposition {
  if (kind === 'hook') return { action: 'reject', code: 'HOOKS_UNSUPPORTED' };
  if (kind === 'mcp-config') return { action: 'redirect-to-provisioning' };
  return { action: 'materialize' };
}

// ---------------------------------------------------------------------------------------------
// v24 (DES-153/TASK-144): AssetSyncService — two scopes (workflow/global), a catalog port for
// rows, `kind:'mcp'` gated on egress-then-probe, `pushedBy`/`pushedAt` on every row.
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// The asset tree layout — ONE expression of it (v24 integrator, adjudication #4 C-7 [12])
//
// Three files disagreed about where a workflow's assets live, so the production asset-tree GC
// branch had never run over a tree the production writer had actually produced:
//   - `main.ts:192`  resolved `assetRoot` to `join(workRoot,'assets')` and `server.ts` never read
//                    the field, so the resolved value was thrown away (the composeConfig-forward
//                    bug class again);
//   - `server.ts`    handed `AssetSyncService` the BARE `workRoot`, so assets landed at
//                    `<workRoot>/<workflow>/skill/<name>`, a sibling of `workflows/`;
//   - `workspace-gc` swept `<workRoot>/assets/<name>` — a directory nothing ever wrote, which is
//                    why IT-110 could only pass by hand-building the fixture in the GC's own idiom.
// Every path now comes from these two functions. `globalAssetRoot` deliberately sits OUTSIDE the
// swept `assets/` tree: the sweep deletes every child of `assets/` whose name is not a live
// workflow, and `_global` is not a workflow.
// ---------------------------------------------------------------------------------------------

/** v24 (integrator): `pathVerdict`'s REJECT reasons are its own internal vocabulary, not
 *  `ErrorCode`s — handing one to the caller verbatim (as the first cut of the asset-NAME check did)
 *  reproduces exactly the `NOT_A_FILE`/`PATH_OUTSIDE_WORKSPACE` drift the facade had to undo for
 *  `workspace_pull`. `RESERVED_PREFIX` earns its own catalog key because it is specific and
 *  actionable ("pick a name that does not start with `rwe-`"); every other lexical reject is either
 *  a containment failure or a malformed argument. */
function assetNameErrorCode(v: { kind: 'reject'; reason: string } | { kind: string; reason?: string }): string {
  switch (v.reason) {
    case 'RESERVED_PREFIX': return 'RESERVED_PREFIX';
    case 'ESCAPE':
    // v24 Gate 7.5 (D-5): an ABSOLUTE path is a containment failure like `..` is — it names a
    // destination outside the asset tree — so it answers the code the row advertises for exactly
    // that (`WORKSPACE_ESCAPE`), not the generic malformed-argument code. `INVALID_ARGUMENT`
    // remains for the shapes that are not about containment at all (empty, NUL).
    case 'ABSOLUTE':
    case 'SYMLINK': return 'WORKSPACE_ESCAPE';
    default: return 'INVALID_ARGUMENT';
  }
}

/** Workflow-scoped asset trees: `<assetRoot>/<workflow>/<kind>/<name>`. */
export function defaultAssetRoot(workRoot: string): string {
  return join(workRoot, 'assets');
}

/** Global (admin-pushed) asset trees: `<workRoot>/_global_assets/<kind>/<name>`. */
export function globalAssetRoot(workRoot: string): string {
  return join(workRoot, '_global_assets');
}

/** The `roots` pair `materializeAssets` (DES-154) takes for one dispatch. */
export function assetRootsFor(assetRoot: string, globalRoot: string, workflow: string): { workflow: string; global: string } {
  return { workflow: join(assetRoot, workflow), global: globalRoot };
}

// ---------------------------------------------------------------------------------------------
// The pre-v24 boot migration (ARCH-098, TASK-160; Gate 8 AF-1 / adjudication (v24) #7 G-1)
//
// A pre-v24 deployment keeps its GLOBAL assets at `<assetRoot>/<kind>/<name>` — INSIDE the tree
// `reclaimStaleWorkspaces` now sweeps, where every child that is not a live workflow is deleted.
// `skill` is not a live workflow. So on the first sweep after an upgrade with `workspaceTtlMs > 0`
// the operator's global skills are destroyed, and every provisioned MCP config silently resolves
// to `missing` (`resolveMcp` reads only `catalog.assets`).
//
// This function is therefore ORDERED, not merely present: `server.ts` runs it before the GC timer
// is armed, so by the time any sweep can run there is nothing left in `<assetRoot>/` for it to
// destroy. A test pins the order by booting with a TTL and asserting the tree survived real sweeps
// (tests/integration/legacy-asset-migration.test.ts) — asserting the migration "works" in
// isolation would not have caught the hazard.
// ---------------------------------------------------------------------------------------------

/** The three pre-v24 kind directories (`LegacyAssetKind`) that could sit directly under the asset
 *  root. Only `skill` has a v24 `assets` row equivalent; `hook`/`mcp-config` bytes are still moved
 *  to safety rather than left for the sweep, because deleting an operator's files is not this
 *  migration's job. */
const LEGACY_KIND_DIRS: readonly LegacyAssetKind[] = ['skill', 'hook', 'mcp-config'];

/** Written LAST, inside the global root. Its presence means "the one-shot migration is done", which
 *  is what keeps a later boot from (a) treating a workflow legitimately NAMED `skill` as a legacy
 *  kind directory and (b) resurrecting an `mcp_provisions` row an admin deleted after migrating —
 *  `mcp-registry.db` is left on disk untouched, so without this the copy would come back forever. */
const MIGRATION_MARKER = '.v24-legacy-migrated';

export interface LegacyAssetRow {
  workflow: string; // always '' — the global-scope sentinel (ARCH-098)
  kind: string;
  name: string;
  pushedBy: string; // always 'legacy'
  pushedAt: string;
  config: string | null;
}

/** The catalog side of the migration (implemented by `WorkflowCatalog`): one transactional upsert
 *  of every row, and a read of the PRE-v24 `mcp_provisions` table from the on-disk sibling database
 *  (`<workRoot>/mcp-registry.db`). `grep -rn "mcp_provisions" src/` is empty only because v24
 *  deleted `mcp-registry.ts` — an upgraded deployment's DISK still has the table. */
export interface LegacyAssetMigrationPort {
  putLegacyAssets(rows: readonly LegacyAssetRow[]): void;
  readLegacyMcpProvisions(): Array<{ name: string; config: string; provisionedAt: string }>;
}

/** Idempotent, ordered: rows first (one transaction), then the file moves, then the marker. A crash
 *  anywhere re-runs the whole thing on the next boot — the row upsert is idempotent and a move whose
 *  source is already gone is skipped. Returns what it did, for the boot log. */
export function migrateLegacyGlobalAssets(deps: {
  assetRoot: string;
  globalRoot: string;
  clock: Clock;
  port: LegacyAssetMigrationPort;
}): { rows: number; movedTrees: number; alreadyDone: boolean } {
  const { assetRoot, globalRoot, clock, port } = deps;
  if (existsSync(join(globalRoot, MIGRATION_MARKER))) return { rows: 0, movedTrees: 0, alreadyDone: true };

  const rows: LegacyAssetRow[] = [];
  const moves: Array<{ from: string; to: string }> = [];
  const pushedAt = clock.isoNow();
  for (const kind of LEGACY_KIND_DIRS) {
    const kindDir = join(assetRoot, kind);
    let names: string[];
    try {
      names = readdirSync(kindDir);
    } catch {
      continue; // this kind was never used on that deployment
    }
    for (const name of names) {
      const from = join(kindDir, name);
      try {
        if (!statSync(from).isDirectory()) continue;
      } catch {
        continue;
      }
      const to = join(globalRoot, kind, name);
      // A name that ALREADY exists in the v24 global tree is left where it is rather than
      // overwritten — this migration never destroys bytes to make room for other bytes.
      if (!existsSync(to)) moves.push({ from, to });
      if (kind === 'skill') rows.push({ workflow: '', kind: 'skill', name, pushedBy: 'legacy', pushedAt, config: null });
    }
  }
  for (const p of port.readLegacyMcpProvisions()) {
    rows.push({ workflow: '', kind: 'mcp', name: p.name, pushedBy: 'legacy', pushedAt: p.provisionedAt, config: p.config });
  }

  if (rows.length > 0) port.putLegacyAssets(rows);
  for (const { from, to } of moves) {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }
  // Only an EMPTY legacy kind directory is removed (`rmdirSync`, never a recursive delete): if
  // anything was left behind by the collision rule above it stays, visible, on disk.
  for (const kind of LEGACY_KIND_DIRS) {
    try {
      rmdirSync(join(assetRoot, kind));
    } catch {
      /* absent or non-empty — nothing to reclaim */
    }
  }
  mkdirSync(globalRoot, { recursive: true });
  writeFileSync(join(globalRoot, MIGRATION_MARKER), `${clock.isoNow()}\n`);
  return { rows: rows.length, movedTrees: moves.length, alreadyDone: false };
}

/** v24 narrow kind union — see file header for why this is decoupled from `LegacyAssetKind`. */
export type AssetKind = 'skill' | 'mcp';

export type AssetScope = 'workflow' | 'global';

/** One stored/listed row (DES-153 signature: `list()` return element). */
export interface AssetCatalogRow {
  scope: AssetScope;
  workflow?: string; // present iff scope === 'workflow'
  builtin: boolean;
  kind: AssetKind;
  name: string;
  pushedBy: string;
  pushedAt: string;
  config?: McpServerConfig; // kind === 'mcp' only
}

/** issue #109: the safe-to-disclose projection of a GLOBAL-scope row, returned by
 *  `AssetSyncService.listGlobal()` — NEVER `command`/`args`/`env`/`url`/headers/secret refs/file
 *  contents, only what a discovery listing needs: the exact name to opt in with, plus a skill's own
 *  advertised description or an MCP server's transport kind.
 *
 *  Issue #146: `body`/`bodyTruncated` are the ONE addition, present only when the caller opted in
 *  (`listGlobal(kind, {includeBody:true})`) — the skill's own `SKILL.md` text, bounded by
 *  `GLOBAL_SKILL_BODY_MAX_BYTES`, so an author can read a global skill's instructions and declared
 *  dependencies (e.g. "requires MCP X") BEFORE registering a workflow that declares it. Still never
 *  any OTHER file in the skill's tree (no bin/exec content, no sibling file) — `readGlobalSkillBody`
 *  reads the exact same single path `readGlobalSkillDescription` already does. */
export type GlobalAssetView =
  | { kind: 'skill'; name: string; description: string | null; body?: string | null; bodyTruncated?: boolean }
  | { kind: 'mcp'; name: string; transport: string | null };

/** Injected catalog port (DES-153) — a pure in-memory/db seam, no fs/tmp roots required to fake it. */
export interface AssetCatalogPort {
  putAsset(row: AssetCatalogRow): void | Promise<void>;
  // Issue #92 part B: `{deleted}` is the port's real answer (`WorkflowCatalog.deleteAsset` has
  // always returned it) — it used to be declared `void` here and thrown away at the server.ts
  // adapter, which is why `workspace_delete` could only ever answer a hardcoded `{deleted: true}`.
  deleteAsset(criteria: { scope: AssetScope; workflow?: string; kind: AssetKind; name: string }): { deleted: boolean } | Promise<{ deleted: boolean }>;
  listAssets(): AssetCatalogRow[] | Promise<AssetCatalogRow[]>;
}

export type AssetPushRequest =
  | { scope: 'workflow'; workflow: string; kind: 'skill'; name: string; files: AssetPushFile[]; pushedBy?: string }
  | { scope: 'workflow'; workflow: string; kind: 'mcp'; name: string; config: McpServerConfig; pushedBy?: string }
  | { scope: 'global'; kind: 'skill'; name: string; files: AssetPushFile[]; pushedBy?: string }
  | { scope: 'global'; kind: 'mcp'; name: string; config: McpServerConfig; pushedBy?: string };

export interface AssetSyncDeps {
  /** The ASSET root (`defaultAssetRoot(workRoot)` unless the operator overrode `assetRoot`) — NOT
   *  the bare work root; see the layout block above for what handing it the bare work root cost. */
  workRoot: string;
  globalRoot: string;
  selfBind: { host: string; port: number };
  clock: Clock;
  catalog: AssetCatalogPort;
  probe: McpProbe;
  egressAllowlist: readonly string[];
  reservedPrefix?: string; // default 'rwe-' (DES-019/DES-021), unused by the v24 flow itself
}

/**
 * `resolveMcp` (DES-153): a PURE helper over the catalog PORT (constructible in a unit test with
 * an in-memory catalog, no tmp roots) — workflow scope wins a name clash with global.
 */
export async function resolveMcp(
  catalog: Pick<AssetCatalogPort, 'listAssets'>,
  workflow: string,
  names: readonly string[],
): Promise<{ configs: Record<string, McpServerConfig>; missing: string[] }> {
  const rows = await catalog.listAssets();
  const configs: Record<string, McpServerConfig> = {};
  const missing: string[] = [];
  for (const name of names) {
    const row =
      rows.find((r) => r.kind === 'mcp' && r.name === name && r.scope === 'workflow' && r.workflow === workflow) ??
      rows.find((r) => r.kind === 'mcp' && r.name === name && r.scope === 'global');
    if (row?.config) configs[name] = row.config;
    else missing.push(name);
  }
  return { configs, missing };
}

// issue #103(b): a probe failure's own `code`/`message` used to be dropped entirely
// (`push()` answered the bare `{error: 'MCP_PROBE_FAILED'}`) — a caller learned only THAT the
// probe failed, never WHY. This module has no `SecretValueProvider` injected (unlike
// `agent-executor.ts`'s marker-substitution `redact()`, which needs one), so "redacted" here is a
// lighter-weight, structural scrub: strip any userinfo/query string off a URL substring the
// probe's own message happens to echo back (a fetch/spawn error can include the request URL,
// which may carry a token in its query string). Never touches `code`/`transport`/`timeoutMs`,
// which are engine-authored, not caller/network-authored.
const URL_WITH_CREDS_OR_QUERY = /\b(https?:\/\/)(?:[^/\s@]+@)?([^/\s?]+)(\/[^\s?]*)?(\?[^\s]*)?/gi;
function redactProbeMessage(message: string): string {
  return message.replace(URL_WITH_CREDS_OR_QUERY, (_m, scheme: string, host: string, path = '') => `${scheme}${host}${path}`);
}

// issue #109: how far a global skill's `description` travels into a discovery listing — bounded so
// a SKILL.md author cannot turn the ONE field `listGlobal` discloses into an unbounded free-text
// channel toward every approved principal.
export const GLOBAL_SKILL_DESCRIPTION_MAX_CHARS = 500;
const SKILL_FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const SKILL_DESCRIPTION_LINE_RE = /^description\s*:\s*(.*)$/i;
// Review send-back LOW-3: a YAML block-scalar indicator (`|`, `|-`, `|+`, `>`, `>-`, `>+`, each with
// an optional explicit indentation digit) — the ONE-line reader below used to return this literal
// marker as if it were the description text.
const SKILL_BLOCK_SCALAR_RE = /^([|>])[+-]?\d*$/;

/** issue #109 (review send-back LOW-3): folds a YAML block-scalar `description` (`|`/`>`, with
 *  either chomping indicator) into plain text instead of returning the bare marker — `startIndex`
 *  is the index, within `lines`, of the `description: |`/`>` line itself. `|` (literal) keeps line
 *  breaks; `>` (folded) joins lines with spaces, treating a blank line as a paragraph break (the
 *  YAML folding rule, simplified — good enough for a one-line discovery description, not a full
 *  parser). The block's own lines are whatever is MORE indented than the `description:` key itself;
 *  the first line at the key's own indentation or less ends the block. Returns `null` when the
 *  block has no lines at all (nothing to fold) rather than echoing the indicator back. */
function foldBlockScalar(lines: string[], startIndex: number, style: '|' | '>'): string | null {
  const keyIndent = (lines[startIndex]!.match(/^(\s*)/)?.[1] ?? '').length;
  const blockLines: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') { blockLines.push(''); continue; }
    const indent = (line.match(/^(\s*)/)?.[1] ?? '').length;
    if (indent <= keyIndent) break;
    blockLines.push(line);
  }
  // Trim trailing blank lines (chomping) without needing to honour `-`/`+` precisely — this is a
  // display description, not a byte-exact YAML round-trip.
  while (blockLines.length > 0 && blockLines[blockLines.length - 1] === '') blockLines.pop();
  if (blockLines.length === 0) return null;
  const minIndent = Math.min(...blockLines.filter((l) => l !== '').map((l) => (l.match(/^(\s*)/)?.[1] ?? '').length));
  const dedented = blockLines.map((l) => (l === '' ? '' : l.slice(minIndent)));
  const text = style === '|' ? dedented.join('\n') : dedented.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

/** issue #109: reads the `description:` field out of a global skill's own `SKILL.md` YAML
 *  frontmatter (the same `---\n...\n---` block every skill fixture in this codebase already
 *  writes) — `null` when the file is missing, has no frontmatter block, or declares no
 *  `description`. Never throws: a malformed/missing skill file degrades to "no description", never
 *  a listing failure. Deliberately dumb (no real YAML parser) — this reads ONE scalar line (or, for
 *  a block-scalar `|`/`>` value, folds the following indented lines — `foldBlockScalar`), not
 *  nested structure, and a quoted value has its surrounding quotes stripped. */
function readGlobalSkillDescription(globalRoot: string, name: string): string | null {
  let md: string;
  try {
    md = readFileSync(join(globalRoot, 'skill', name, 'SKILL.md'), 'utf-8');
  } catch {
    return null;
  }
  const frontmatter = SKILL_FRONTMATTER_RE.exec(md);
  if (!frontmatter) return null;
  const lines = frontmatter[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = SKILL_DESCRIPTION_LINE_RE.exec(lines[i]!);
    if (!m) continue;
    const raw = m[1]!.trim();
    const blockScalar = SKILL_BLOCK_SCALAR_RE.exec(raw);
    if (blockScalar) {
      const folded = foldBlockScalar(lines, i, blockScalar[1] as '|' | '>');
      return folded !== null ? folded.slice(0, GLOBAL_SKILL_DESCRIPTION_MAX_CHARS) : null;
    }
    const value = raw.replace(/^['"]|['"]$/g, '');
    return value.length > 0 ? value.slice(0, GLOBAL_SKILL_DESCRIPTION_MAX_CHARS) : null;
  }
  return null;
}

// issue #146: how far a global skill's own SKILL.md BODY travels into an opt-in discovery read —
// bounded the same way GLOBAL_SKILL_DESCRIPTION_MAX_CHARS bounds the frontmatter-only description,
// just measured in BYTES (not chars) since the body is the whole file, not one scalar line, and a
// byte bound is what keeps the truncation cheap and predictable regardless of encoding.
export const GLOBAL_SKILL_BODY_MAX_BYTES = 16 * 1024;

/** Issue #146: reads a global skill's ENTIRE `SKILL.md` text (frontmatter + body), for an
 *  opt-in discovery read (`listGlobal(kind, {includeBody:true})`) — so an author can see a global
 *  skill's own instructions and any dependency it names (e.g. "requires MCP X") before registering
 *  a workflow that declares it. `null` when the file is missing/unreadable, never a listing
 *  failure — same "degrades honestly" convention as `readGlobalSkillDescription`. Reads the EXACT
 *  SAME single path that function does (`<globalRoot>/skill/<name>/SKILL.md`) — never any other
 *  file in the skill's tree, so a sibling exec/bin file or data file can never reach this response.
 *  Truncated at a BYTE boundary (`Buffer.subarray`, not a string `.slice`) so a multi-byte UTF-8
 *  character straddling the cutoff cannot inflate the returned byte size past the bound; `truncated`
 *  tells the caller the text was cut, since silently returning a shorter string would read as the
 *  skill's whole content. */
function readGlobalSkillBody(globalRoot: string, name: string): { body: string; truncated: boolean } | null {
  let raw: Buffer;
  try {
    raw = readFileSync(join(globalRoot, 'skill', name, 'SKILL.md'));
  } catch {
    return null;
  }
  if (raw.byteLength <= GLOBAL_SKILL_BODY_MAX_BYTES) return { body: raw.toString('utf-8'), truncated: false };
  return { body: raw.subarray(0, GLOBAL_SKILL_BODY_MAX_BYTES).toString('utf-8'), truncated: true };
}

/**
 * Stores/lists/deletes assets across the workflow/global scopes via an injected catalog port.
 * `push()` for `kind:'skill'` verdicts EVERY file before writing any (partial-push atomicity),
 * writes the tree, THEN the row; for `kind:'mcp'` it checks egress (when the config carries a
 * `url`) BEFORE any probe, then probes, then the row — nothing is stored on either refusal. A
 * failed probe's own code/message/transport/timeout travel in `detail`, message redacted (issue
 * #103b). `delete()` removes the row THEN the tree. `pushedAt` always comes from `deps.clock`.
 */
export class AssetSyncService {
  private readonly _workRoot: string;
  private readonly _globalRoot: string;
  private readonly _clock: Clock;
  private readonly _catalog: AssetCatalogPort;
  private readonly _probe: McpProbe;
  private readonly _egressAllowlist: readonly string[];

  constructor(deps: AssetSyncDeps) {
    this._workRoot = deps.workRoot;
    this._globalRoot = deps.globalRoot;
    this._clock = deps.clock;
    this._catalog = deps.catalog;
    this._probe = deps.probe;
    this._egressAllowlist = deps.egressAllowlist;
  }

  private _skillRoot(scope: AssetScope, workflow: string | undefined, name: string): string {
    return scope === 'workflow' ? join(this._workRoot, workflow!, 'skill', name) : join(this._globalRoot, 'skill', name);
  }

  /** issue #103(a): the ONE resolver both registration (a non-fatal warning) and admission (a
   *  refusal before any side effect — run_start, a schedule/webhook firing, a nested workflow()
   *  call) use — the SAME rule dispatch itself resolves with (`gateway/claude-agent-sdk-client.ts`'s
   *  `materializeAssets` for skills: workflow-scoped tree, then global; this class's own
   *  `resolveMcp` for mcp: workflow-scoped row, then global) — so admission and dispatch can never
   *  disagree about what is or isn't provisioned. Skill existence is a plain `existsSync` on the
   *  SAME two paths `materializeAssets`/`_skillRoot` check, not a second implementation of that
   *  rule. Empty declared sets short-circuit to empty missing sets with no catalog/fs work at all. */
  async resolveDeclaredAssets(workflow: string, declared: { skills: string[]; mcp: string[] }): Promise<{ missingSkills: string[]; missingMcp: string[] }> {
    const missingSkills = declared.skills.filter((name) =>
      !existsSync(this._skillRoot('workflow', workflow, name)) && !existsSync(this._skillRoot('global', undefined, name)));
    const { missing: missingMcp } = declared.mcp.length > 0 ? await resolveMcp(this._catalog, workflow, declared.mcp) : { missing: [] };
    return { missingSkills, missingMcp };
  }

  async push(req: AssetPushRequest): Promise<{ error: string; detail?: Record<string, unknown> } | { stored: string }> {
    const kind = (req as { kind: string }).kind;
    if (kind !== 'skill' && kind !== 'mcp') {
      throw codedError(
        'INVALID_ARGUMENT',
        `INVALID_ARGUMENT: unsupported asset kind "${kind}" — only "skill" and "mcp" are accepted (v24, DES-153); a hook is refused by the tool schema, never reaching this service.`,
      );
    }
    // v24 (integrator; ARCH-093 + adjudication (v24) #2 A-5): the asset NAME goes through the SAME
    // lexical rule as every file INSIDE the asset — it is itself a path segment of the asset tree
    // (`<assetRoot>/<workflow>/<kind>/<name>`) and, for a skill, of the run workspace
    // (`.claude/skills/<name>`). Only the per-file rule was wired, so a skill could be STORED as
    // `rwe-…` and materialized under the engine's own reserved prefix — precisely the
    // impersonation A-5 re-affirmed the prefix exists to prevent. Reuses `lexicalVerdict`; no
    // second regex (a duplicated rule is a rule that drifts).
    const nameVerdict = lexicalVerdict('asset-tree', req.name);
    if (nameVerdict.kind !== 'ok') return { error: assetNameErrorCode(nameVerdict) };
    const pushedBy = req.pushedBy ?? 'local';
    const pushedAt = this._clock.isoNow();
    const workflow = req.scope === 'workflow' ? req.workflow : undefined;

    if (req.kind === 'mcp') {
      if (typeof req.config.url === 'string') {
        const verdict = isEgressAllowed(req.config.url, this._egressAllowlist);
        // Owner decision 2026-09-30: EGRESS_DENIED's code is shared with seedRef (errors.ts's
        // ERROR_CATALOG hint stays generic for both) — the MCP-specific pointer at the
        // system_info policy field lives HERE, in the message, not in the shared catalog hint.
        // Echoes only the URL the CALLER sent — no host-measured detail (e.g. which allowlist
        // prefix would have matched) beyond that.
        if (!verdict.ok) {
          return {
            error: 'EGRESS_DENIED',
            detail: {
              message: `MCP server URL "${req.config.url}" is not on this engine's mcpEgressAllowlist — call system_info and check policy.mcpEgressAllowlist for the currently allowed https prefixes.`,
            },
          };
        }
      }
      // issue #126 B: an unknown ${run:xxx} placeholder is refused BEFORE the probe (which may
      // spawn a real process / make a network call) — `${run:dir}`/`${run:id}` themselves are
      // left UNRESOLVED here and stored verbatim; resolution is per-dispatch (the gateway), never
      // at push time, so the SAME stored config serves every future run with its own isolated dir.
      try {
        validateRunPlaceholders(req.config);
      } catch (err) {
        if (err instanceof UnknownRunPlaceholderError) {
          return { error: 'UNKNOWN_RUN_PLACEHOLDER', detail: { message: err.message } };
        }
        throw err;
      }
      const probed = await this._probe.probe(req.config);
      if (!probed.ok) {
        return {
          error: 'MCP_PROBE_FAILED',
          detail: { code: probed.code, message: redactProbeMessage(probed.message), transport: classifyTransport(req.config), timeoutMs: PROBE_TIMEOUT_MS },
        };
      }
      // v24 Gate 7.5 (D-13, REQ-113): a GLOBAL asset is a built-in — the engine-level tree only an
      // admin can write, which every workflow sees.
      await this._catalog.putAsset({ scope: req.scope, workflow, builtin: req.scope === 'global', kind: 'mcp', name: req.name, config: req.config, pushedBy, pushedAt });
      return { stored: req.name };
    }

    // kind === 'skill': verdict every file before writing any, write the tree, THEN the row.
    const root = this._skillRoot(req.scope, workflow, req.name);
    const skillMdAbs = join(root, 'SKILL.md');
    const resolved: Array<{ abs: string; contentB64: string; exec: boolean }> = [];
    for (const f of req.files) {
      const v = pathVerdict(root, f.path, undefined, 'asset-tree');
      // v24 Gate 7.5 (D-5, REQ-118): a refused file path answers the code the `workspace_push` row
      // ADVERTISES — `WORKSPACE_ESCAPE` / `RESERVED_PREFIX` — through the SAME `assetNameErrorCode`
      // mapping the asset NAME already goes through, three lines up. It used to throw a bare
      // `AssetPathEscapeError`, whose JS class name reached the caller as the machine-readable
      // code: not a member of the closed `ErrorCode` union, not in `ERROR_CATALOG`, and impossible
      // for a cold model to anticipate. The write was always refused; only the code leaked. The
      // whole push is still refused before ANY file is written (no half-written asset dir).
      if (v.kind !== 'ok' || !v.abs) return { error: assetNameErrorCode(v) };
      // Issue #105 part A: exec:true on the skill's own top-level SKILL.md is refused outright —
      // SKILL.md is never executed (it is the skill's manifest, read by the harness, not run), so
      // an exec bit on it can only be a caller mistake or an attempt to smuggle a different
      // meaning onto the one file every skill is guaranteed to carry. Compared against the
      // RESOLVED path (`v.abs`, the same value the write loop below actually writes to), not the
      // caller's raw `f.path` string — `pathVerdict`/`lexicalVerdict` normalizes `\` to `/` and
      // drops `.` segments, so a literal `f.path === 'SKILL.md'` check misses spellings like
      // `./SKILL.md` or `.\SKILL.md` that resolve to the exact same file. Still before any write
      // (this loop runs entirely before the write pass further down).
      if (f.exec === true && v.abs === skillMdAbs) {
        throw codedError(
          'INVALID_ARGUMENT',
          "INVALID_ARGUMENT: exec:true is not permitted on a skill's top-level SKILL.md — it is the skill's manifest, never executed; set exec:true on the script/binary file itself instead.",
        );
      }
      resolved.push({ abs: v.abs, contentB64: f.contentB64, exec: f.exec === true });
    }
    mkdirSync(root, { recursive: true });
    for (const { abs, contentB64, exec } of resolved) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, Buffer.from(contentB64, 'base64'));
      // Issue #105 part A: `writeFileSync`'s own `mode` option is only honoured when the OPEN call
      // actually CREATES the file (O_CREAT) — a re-push that overwrites an existing name would
      // silently keep that file's OLD mode. `chmodSync` afterward is unconditional, so the mode
      // this push declared always wins, first push or tenth.
      chmodSync(abs, exec ? 0o755 : 0o644);
    }
    await this._catalog.putAsset({ scope: req.scope, workflow, builtin: req.scope === 'global', kind: 'skill', name: req.name, pushedBy, pushedAt });
    return { stored: req.name };
  }

  /** issue #109 review send-back (F0): the ONE projection of a GLOBAL row to what is safe to
   *  disclose — shared by `list()` (the per-workflow merge, below) and `listGlobal()` (the dedicated
   *  `scope:'global'` door), so a global row can never carry its full `config` (command/args/env/a
   *  credential-bearing `url`) out through ONE door while the other already projects it. A
   *  WORKFLOW-scoped row never reaches this — only the caller's own asset, kept as-is by `list()`.
   *  Issue #146: `includeBody` is OFF by default (`opts` absent/`includeBody` falsy never adds the
   *  `body`/`bodyTruncated` keys at all, not even `undefined` ones — issue #109's small-by-default
   *  listing shape stays byte-identical) and `_projectGlobalRowForList` (the per-workflow merge)
   *  never passes it — the body is reachable ONLY through the dedicated `listGlobal()` door, on
   *  purpose, per the owner's lightweight #146 decision. */
  private _projectGlobalRow(r: AssetCatalogRow, opts?: { includeBody?: boolean }): GlobalAssetView {
    if (r.kind !== 'skill') return { kind: 'mcp', name: r.name, transport: typeof r.config?.type === 'string' ? r.config.type : null };
    const description = readGlobalSkillDescription(this._globalRoot, r.name);
    if (!opts?.includeBody) return { kind: 'skill', name: r.name, description };
    const bodyResult = readGlobalSkillBody(this._globalRoot, r.name);
    return { kind: 'skill', name: r.name, description, body: bodyResult?.body ?? null, bodyTruncated: bodyResult?.truncated ?? false };
  }

  /** issue #109 review send-back (F0): the per-workflow `list()` merge keeps the row's existing
   *  non-secret metadata (`scope`, `builtin`, `pushedBy`, `pushedAt`, `kind`, `name` — the shape
   *  `advertised-surface-truth.test.ts`'s REQ-113 case already pins: "a global asset lists as
   *  builtin" lets a caller tell a global row apart from their own workflow-scoped one in the SAME
   *  merged response) but drops `config` and substitutes the same safe field `_projectGlobalRow`
   *  already computes for the dedicated `listGlobal()` door — never the narrower `GlobalAssetView`
   *  alone, which would silently drop `scope`/`builtin`/attribution a caller already relies on. */
  private _projectGlobalRowForList(r: AssetCatalogRow): Omit<AssetCatalogRow, 'config'> & GlobalAssetView {
    const { config: _config, ...rest } = r;
    return { ...rest, ...this._projectGlobalRow(r) };
  }

  /** Both scopes in one response (DES-153): global rows always included, workflow rows filtered by
   *  `workflow`. issue #109 review send-back (F0): a global row merged in here is projected through
   *  `_projectGlobalRowForList` — it is exactly as sensitive as one reached via `listGlobal()`'s
   *  dedicated `scope:'global'` door, and must never hand out its raw `config` just because the
   *  caller asked through their OWN workflow's listing instead. A workflow-scoped row the caller
   *  already owns keeps its full shape (`config` included), unchanged. */
  async list(query: { workflow: string; kind: AssetKind }): Promise<Array<AssetCatalogRow | (Omit<AssetCatalogRow, 'config'> & GlobalAssetView)>> {
    const rows = await this._catalog.listAssets();
    return rows
      .filter((r) => r.kind === query.kind && (r.scope === 'global' || r.workflow === query.workflow))
      .map((r) => (r.scope === 'global' ? this._projectGlobalRowForList(r) : r));
  }

  /** issue #109: the GLOBAL-scope discovery read — before this, no tool enumerated `scope:'global'`
   *  rows at all, so an author without the exact name already in hand had no way to find an
   *  admin-pushed skill/MCP server (the only existence oracle was a missing-registration WARNING,
   *  which requires guessing the name first). Callable by any approved principal (role gating lives
   *  at the tool layer, mcp-facade.ts/tool-specs.ts — this method itself is role-blind, matching
   *  `list()` above). Projects EVERY global row of the requested `kind` to the safe subset
   *  (`GlobalAssetView`, `_projectGlobalRow`) — never the stored `config` object itself, which for
   *  `kind:'mcp'` may carry `command`/`args`/`env`/a credential-bearing `url`.
   *
   *  Issue #146: `opts.includeBody` (default false/absent — the response stays exactly as small as
   *  issue #109 left it) additionally returns each `kind:'skill'` row's own `SKILL.md` body, bounded
   *  by `GLOBAL_SKILL_BODY_MAX_BYTES` — so an author can read a global skill's instructions and any
   *  dependency it declares (e.g. "requires MCP X") before registering a workflow around it. Ignored
   *  for `kind:'mcp'` (an mcp row has no body to disclose). SECURITY: an admin-pushed global skill's
   *  `SKILL.md` becomes readable this way by every approved principal (role gating only requires
   *  'user', same as the rest of this discovery door) — an admin must never put a secret in a global
   *  skill's `SKILL.md`; the tool-facing description states this (mcp-facade.ts/tool-specs.ts). */
  async listGlobal(kind: AssetKind, opts?: { includeBody?: boolean }): Promise<GlobalAssetView[]> {
    const rows = (await this._catalog.listAssets()).filter((r) => r.scope === 'global' && r.kind === kind);
    return rows.map((r) => this._projectGlobalRow(r, opts));
  }

  /** v24 Gate 7.5 (D-10, REQ-113): the WHOLE workflow's asset tree, for `workflow_deregister`.
   *  The catalog transaction has always deleted the `assets` ROWS with the workflow; the tree under
   *  `<assetRoot>/<workflow>/` was left on disk, so the next registrant of the freed name could
   *  declare a skill it had never pushed and get the previous owner's `SKILL.md` materialized into
   *  its own agent workspace (reproduced live, 08-validation.md D-10) — ownership held in the
   *  database and not on the filesystem.
   *
   *  The workflow name is a PATH SEGMENT here, so it goes through the same `lexicalVerdict` every
   *  asset name and file path goes through before anything is removed: a name that is not a plain
   *  contained segment deletes NOTHING (returning false) rather than resolving to some parent of
   *  the asset root. `deregister` accepts an arbitrary string from the wire; `rmSync` does not get
   *  to see one. */
  deleteWorkflowTree(workflow: string): boolean {
    const verdict = lexicalVerdict('asset-tree', workflow);
    if (verdict.kind !== 'ok' || workflow.includes('/') || workflow.includes('\\')) return false;
    rmSync(join(this._workRoot, workflow), { recursive: true, force: true });
    return true;
  }

  /** Removes the row THEN the tree (DES-153) — a `skill` row also owns an on-disk tree; `mcp` is
   *  catalog-only. Issue #92 part B: the tree is only touched when the catalog actually removed a
   *  row (`deleted:true`) — a `deleted:false` (nothing matched) leaves whatever is on disk alone
   *  rather than blindly `rmSync`-ing a path that may not even belong to this name. The `{deleted}`
   *  the catalog reports is returned as-is, not re-derived. */
  async delete(req: { scope: AssetScope; workflow?: string; kind: AssetKind; name: string }): Promise<{ deleted: boolean }> {
    const result = await this._catalog.deleteAsset(req);
    if (result.deleted && req.kind === 'skill') {
      rmSync(this._skillRoot(req.scope, req.workflow, req.name), { recursive: true, force: true });
    }
    return result;
  }
}
