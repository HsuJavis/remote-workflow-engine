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
import { pathVerdict } from './path-verdict.js';
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

/** Thrown when any `files[].path` in a push fails `pathVerdict` (DES-142) — the whole push is
 *  rejected (no half-written asset dir), same rooting invariant as DES-011's `WorkspaceEscapeError`. */
export class AssetPathEscapeError extends Error {
  constructor(path: string) {
    super(`Asset file path escapes its asset dir: ${path}`);
    this.name = 'AssetPathEscapeError';
  }
}

// ---------------------------------------------------------------------------------------------
// v24 (DES-153/TASK-144): AssetSyncService — two scopes (workflow/global), a catalog port for
// rows, `kind:'mcp'` gated on egress-then-probe, `pushedBy`/`pushedAt` on every row.
// ---------------------------------------------------------------------------------------------

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
      await this._catalog.putAsset({ scope: req.scope, workflow, builtin: false, kind: 'mcp', name: req.name, config: req.config, pushedBy, pushedAt });
      return { stored: req.name };
    }

    // kind === 'skill': verdict every file before writing any, write the tree, THEN the row.
    const root = this._skillRoot(req.scope, workflow, req.name);
    const resolved: Array<{ abs: string; contentB64: string }> = [];
    for (const f of req.files) {
      const v = pathVerdict(root, f.path, undefined, 'asset-tree');
      if (v.kind !== 'ok' || !v.abs) throw new AssetPathEscapeError(f.path);
      resolved.push({ abs: v.abs, contentB64: f.contentB64 });
    }
    mkdirSync(root, { recursive: true });
    for (const { abs, contentB64 } of resolved) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, Buffer.from(contentB64, 'base64'));
    }
    await this._catalog.putAsset({ scope: req.scope, workflow, builtin: false, kind: 'skill', name: req.name, pushedBy, pushedAt });
    return { stored: req.name };
  }

  /** Both scopes in one response (DES-153): global rows always included, workflow rows filtered by `workflow`. */
  async list(query: { workflow: string; kind: AssetKind }): Promise<AssetCatalogRow[]> {
    const rows = await this._catalog.listAssets();
    return rows.filter((r) => r.kind === query.kind && (r.scope === 'global' || r.workflow === query.workflow));
  }

  /** Removes the row THEN the tree (DES-153) — a `skill` row also owns an on-disk tree; `mcp` is catalog-only. */
  async delete(req: { scope: AssetScope; workflow?: string; kind: AssetKind; name: string }): Promise<void> {
    await this._catalog.deleteAsset(req);
    if (req.kind === 'skill') {
      rmSync(this._skillRoot(req.scope, req.workflow, req.name), { recursive: true, force: true });
    }
  }
}
