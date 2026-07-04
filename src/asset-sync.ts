// Asset Sync core (DES-019 / ARCH-012 / TASK-021): the two mandatory pure security predicates —
// recursion-guard (D4) and path-safety — plus the AssetSyncService that stores assets under the
// workspace root using them. Transport-agnostic and UT-heavy on purpose (D-V2f task split): the
// live network probe for mcp-config transports (classifyTransport / McpProbe) is a DISTINCT test
// seam owned by DES-020/TASK-026 — this service accepts assets of kind 'mcp-config' the same as
// any other kind (no live probe applied here); rejecting an unsupported mcp-config transport is
// TASK-026's own composition-root wiring, layered on top without changing this class.
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, isAbsolute, sep, join, dirname } from 'node:path';

export type AssetKind = 'skill' | 'hook' | 'mcp-config';

export interface AssetPushFile {
  path: string;
  contentB64: string;
}

export interface AssetPush {
  kind: AssetKind;
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

/**
 * Path-safety (pure): resolves `p` (a `files[].path`) relative to `assetRoot`. Returns the
 * resolved absolute path when it stays INSIDE `assetRoot`; `null` when `p` is absolute or
 * normalizes to escape the root (`..` traversal) — same rooting invariant as DES-011's
 * `resolveInWorkspace` (without it, asset_push is arbitrary host-file-write, D5).
 */
export function safeRelPath(p: string, assetRoot: string): string | null {
  if (isAbsolute(p)) return null;
  const resolved = resolve(assetRoot, p);
  if (resolved !== assetRoot && !resolved.startsWith(assetRoot + sep)) return null;
  return resolved;
}

export interface AssetPushResult {
  stored: string[];
  excluded: Array<{ name: string; reason: string }>;
}

/** Thrown when any `files[].path` in a push fails `safeRelPath` — the whole push is rejected (no
 *  half-written asset dir), same rooting invariant as DES-011's `WorkspaceEscapeError`. */
export class AssetPathEscapeError extends Error {
  constructor(path: string) {
    super(`Asset file path escapes its asset dir: ${path}`);
    this.name = 'AssetPathEscapeError';
  }
}

export interface AssetSyncDeps {
  assetRoot: string;
  selfBind: { host: string; port: number };
  reservedPrefix?: string; // default 'rwe-' (DES-019/DES-021)
}

/**
 * Stores/lists/deletes assets under `assetRoot/<kind>/<name>/...` after applying the two mandatory
 * pure predicates above. `push()` validates EVERY file before writing ANY (partial-push atomicity).
 */
export class AssetSyncService {
  private readonly _assetRoot: string;
  private readonly _selfBind: { host: string; port: number };
  private readonly _reservedPrefix: string;

  constructor(deps: AssetSyncDeps) {
    this._assetRoot = deps.assetRoot;
    this._selfBind = deps.selfBind;
    this._reservedPrefix = deps.reservedPrefix ?? 'rwe-';
  }

  async push(a: AssetPush): Promise<AssetPushResult> {
    if (isSelfReferential(a, this._selfBind, this._reservedPrefix)) {
      return { stored: [], excluded: [{ name: a.name, reason: 'self-referential (D4): points at this server or matches the reserved rwe-* identity' }] };
    }
    const targetDir = join(this._assetRoot, a.kind, a.name);
    // Validate every file BEFORE writing any (partial-push atomicity) — throws on the first escape.
    const resolved: Array<{ abs: string; contentB64: string }> = [];
    for (const f of a.files) {
      const abs = safeRelPath(f.path, targetDir);
      if (abs === null) throw new AssetPathEscapeError(f.path);
      resolved.push({ abs, contentB64: f.contentB64 });
    }
    mkdirSync(targetDir, { recursive: true });
    for (const { abs, contentB64 } of resolved) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, Buffer.from(contentB64, 'base64'));
    }
    return { stored: [a.name], excluded: [] };
  }

  async list(): Promise<Array<{ kind: AssetKind; name: string }>> {
    const out: Array<{ kind: AssetKind; name: string }> = [];
    for (const kind of ['skill', 'hook', 'mcp-config'] as AssetKind[]) {
      const dir = join(this._assetRoot, kind);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (statSync(join(dir, name)).isDirectory()) out.push({ kind, name });
      }
    }
    return out;
  }

  async delete(a: { kind: AssetKind; name: string }): Promise<void> {
    rmSync(join(this._assetRoot, a.kind, a.name), { recursive: true, force: true });
  }
}
