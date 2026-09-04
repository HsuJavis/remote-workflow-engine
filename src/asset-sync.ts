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
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathVerdict, lexicalVerdict } from './path-verdict.js';
import { codedError } from './errors.js';
import type { Clock } from './clock.js';
import type { McpProbe, McpServerConfig } from './mcp-probe.js';
import { isEgressAllowed } from './seedref-egress.js';

/** Pre-v24 kind union — see file header. */
export type LegacyAssetKind = 'skill' | 'hook' | 'mcp-config';

export interface AssetPushFile {
  path: string;
  contentB64: string;
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

/** Injected catalog port (DES-153) — a pure in-memory/db seam, no fs/tmp roots required to fake it. */
export interface AssetCatalogPort {
  putAsset(row: AssetCatalogRow): void | Promise<void>;
  deleteAsset(criteria: { scope: AssetScope; workflow?: string; kind: AssetKind; name: string }): void | Promise<void>;
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

/**
 * Stores/lists/deletes assets across the workflow/global scopes via an injected catalog port.
 * `push()` for `kind:'skill'` verdicts EVERY file before writing any (partial-push atomicity),
 * writes the tree, THEN the row; for `kind:'mcp'` it checks egress (when the config carries a
 * `url`) BEFORE any probe, then probes, then the row — nothing is stored on either refusal.
 * `delete()` removes the row THEN the tree. `pushedAt` always comes from `deps.clock`.
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

  async push(req: AssetPushRequest): Promise<{ error: string } | { stored: string }> {
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
        if (!verdict.ok) return { error: 'EGRESS_DENIED' };
      }
      const probed = await this._probe.probe(req.config);
      if (!probed.ok) return { error: 'MCP_PROBE_FAILED' };
      // v24 Gate 7.5 (D-13, REQ-113): a GLOBAL asset is a built-in — the engine-level tree only an
      // admin can write, which every workflow sees.
      await this._catalog.putAsset({ scope: req.scope, workflow, builtin: req.scope === 'global', kind: 'mcp', name: req.name, config: req.config, pushedBy, pushedAt });
      return { stored: req.name };
    }

    // kind === 'skill': verdict every file before writing any, write the tree, THEN the row.
    const root = this._skillRoot(req.scope, workflow, req.name);
    const resolved: Array<{ abs: string; contentB64: string }> = [];
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
      resolved.push({ abs: v.abs, contentB64: f.contentB64 });
    }
    mkdirSync(root, { recursive: true });
    for (const { abs, contentB64 } of resolved) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, Buffer.from(contentB64, 'base64'));
    }
    await this._catalog.putAsset({ scope: req.scope, workflow, builtin: req.scope === 'global', kind: 'skill', name: req.name, pushedBy, pushedAt });
    return { stored: req.name };
  }

  /** Both scopes in one response (DES-153): global rows always included, workflow rows filtered by `workflow`. */
  async list(query: { workflow: string; kind: AssetKind }): Promise<AssetCatalogRow[]> {
    const rows = await this._catalog.listAssets();
    return rows.filter((r) => r.kind === query.kind && (r.scope === 'global' || r.workflow === query.workflow));
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

  /** Removes the row THEN the tree (DES-153) — a `skill` row also owns an on-disk tree; `mcp` is catalog-only. */
  async delete(req: { scope: AssetScope; workflow?: string; kind: AssetKind; name: string }): Promise<void> {
    await this._catalog.deleteAsset(req);
    if (req.kind === 'skill') {
      rmSync(this._skillRoot(req.scope, req.workflow, req.name), { recursive: true, force: true });
    }
  }
}
