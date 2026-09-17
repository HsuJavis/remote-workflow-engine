// src/static-assets.ts
// DES-199 (ARCH-123, ADR-049, TASK-204, REQ-131): STATIC_ASSETS -- a closed literal map, an exact
// Map.get, and no path ever built from a URL. This is the engine's first static-file route (its
// first path-traversal surface): the smallest correct answer is a fixed map, because a URL suffix
// that is only ever used as a Map key can never reach the filesystem -- no encoding trick can defeat
// a lookup that never builds or resolves a path from caller input. Deliberately absent from this
// module: anything that joins, normalizes, or decodes a path segment.
//
// The map must stay closed in BOTH directions (every listed key has a file on disk, every js/css/
// woff2 file on disk is a listed key) -- tests/unit/static-assets.test.ts enforces this with a
// readdirSync diff, which doubles as the typo-catcher for a renamed module.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DASHBOARD_ROOT = fileURLToPath(new URL('./dashboard/', import.meta.url));

const ASSET_KEYS = [
  'ui/app.js', 'ui/theme-init.js', 'ui/poll.js', 'ui/home.js', 'ui/workflow.js', 'ui/run.js',
  'ui/agent-panel.js', 'ui/models.js', 'ui/system.js', 'ui/issues.js', 'ui/dom.js', 'ui/clock.js',
  'lib/theme.js', 'lib/strings.js', 'lib/connection.js', 'lib/swimlane.js', 'lib/runlist.js',
  'lib/agent.js', 'lib/status.js', 'lib/model.js', 'lib/scheduler.js', 'lib/system.js',
  'lib/issues.js',
  'demo/dataset.js',
  'dashboard.css',
  'fonts/archivo-400.woff2', 'fonts/archivo-500.woff2', 'fonts/archivo-600.woff2',
  'fonts/jetbrains-mono-400.woff2', 'fonts/jetbrains-mono-500.woff2',
] as const;

// [v27c AC-8 Gate 8 repair] the FULL directive, not the bare `immutable` token — ARCH-123's `api:`
// specifies `public, max-age=31536000, immutable` for woff2 (a year-long freshness lifetime;
// `immutable` alone is a modifier with nothing to modify, RFC 8246). JS/CSS's `no-store` is
// unchanged — this type is now the exact `Cache-Control` header VALUE, written verbatim by
// `server.ts`'s `entry.cache`.
export type StaticAssetCache = 'public, max-age=31536000, immutable' | 'no-store';

export interface StaticAssetEntry {
  file: string;
  type: string;
  cache: StaticAssetCache;
}

function typeForKey(key: string): string {
  if (key.endsWith('.woff2')) return 'font/woff2';
  if (key.endsWith('.css')) return 'text/css';
  return 'text/javascript';
}

function cacheForKey(key: string): StaticAssetCache {
  return key.endsWith('.woff2') ? 'public, max-age=31536000, immutable' : 'no-store';
}

export const STATIC_ASSETS: ReadonlyMap<string, StaticAssetEntry> = new Map(
  ASSET_KEYS.map((key) => {
    const file = DASHBOARD_ROOT + key;
    // Boot-time only -- this module-level initializer runs once, so a listed key whose file is
    // missing logs exactly once here, never per request (a font is fetched on every page load).
    if (!existsSync(file)) {
      console.warn(JSON.stringify({ event: 'dashboard_asset_missing', key }));
    }
    return [key, { file, type: typeForKey(key), cache: cacheForKey(key) }];
  }),
);

/** Exact Map.get on the URL suffix and nothing else -- the suffix is a key, never a path. */
export function lookupStaticAsset(urlPath: string): StaticAssetEntry | null {
  return STATIC_ASSETS.get(urlPath) ?? null;
}

const fileCache = new Map<string, Buffer>();

/** Reads through a small in-memory cache. Throws if the file is missing; the one caller
 *  (server.ts's `/static/dashboard/*` route) already wraps this in a try/catch and answers 404,
 *  which is DES-199's missing-file degrade -- never a boot failure, never a thrown 500. */
export function readStaticAsset(entry: StaticAssetEntry): Buffer {
  let buf = fileCache.get(entry.file);
  if (!buf) {
    buf = readFileSync(entry.file);
    fileCache.set(entry.file, buf);
  }
  return buf;
}
