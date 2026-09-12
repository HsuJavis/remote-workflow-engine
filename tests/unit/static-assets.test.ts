// UT-240 (DES-199, ARCH-123, ADR-049, TASK-204, REQ-131): `STATIC_ASSETS` — a closed literal map,
// `lookupStaticAsset` an exact `Map.get` on the URL suffix and nothing else (no `join`, no
// `normalize`, no decode — the engine's FIRST static-file route, so the smallest correct answer is
// a fixed map: the URL is a key, not a path).
//
// Tier: unit — pure static analysis + a real fs read for the closed-both-ways check (no server
// boot needed).
//
// Red reason (measured): `src/static-assets.ts` does not exist at all (whole-file import failure).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lookupStaticAsset, STATIC_ASSETS } from '../../src/static-assets.js';

const CLIENT_ROOT = join(__dirname, '..', '..', 'src', 'dashboard');

const TRAVERSAL_TABLE = ['../../etc/passwd', '%2e%2e%2f', 'ui/../lib/theme.js', 'ui/app.js%00.png', '//etc/passwd'];

describe('static-assets.ts (UT-240, DES-199)', () => {
  it('lookupStaticAsset is an exact Map.get — every traversal string returns null', () => {
    for (const bad of TRAVERSAL_TABLE) {
      expect(lookupStaticAsset(bad)).toBeNull();
    }
  });

  it('a known key (dashboard.css) resolves to a real on-disk file with the right type and cache policy', () => {
    const entry = lookupStaticAsset('dashboard.css');
    expect(entry).not.toBeNull();
    expect(entry?.type).toBe('text/css');
    expect(entry?.cache).toBe('no-store');
    expect(existsSync(entry!.file)).toBe(true);
  });

  // [v27c AC-8 Gate 8 repair] the FULL directive (ARCH-123's api: `public, max-age=31536000,
  // immutable`) — the bare token `'immutable'` let a modifier with no freshness lifetime through.
  it('a vendored woff2 key resolves with a year-long public immutable cache', () => {
    const entry = lookupStaticAsset('fonts/archivo-400.woff2');
    expect(entry).not.toBeNull();
    expect(entry?.type).toBe('font/woff2');
    expect(entry?.cache).toBe('public, max-age=31536000, immutable');
  });

  it('the module contains no join(/normalize(/decodeURI( — the URL is a key, never a path', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'src', 'static-assets.ts'), 'utf8');
    expect(/\bjoin\(/.test(src)).toBe(false);
    expect(/\.normalize\(/.test(src)).toBe(false);
    expect(/decodeURI/.test(src)).toBe(false);
  });

  it('the map is closed BOTH ways: every listed key resolves to a file on disk (once TASK-204..212 land), and every .js/.css/.woff2 under src/dashboard/ is listed', () => {
    // Half 1: every STATIC_ASSETS entry's file must exist.
    for (const [key, entry] of STATIC_ASSETS) {
      expect(existsSync(entry.file), `listed key "${key}" has no file on disk`).toBe(true);
    }
    // Half 2: every real .js/.css/.woff2 under src/dashboard/ must be a listed key's target — a
    // typo-catcher. Vacuously true today only for the two files this task itself ships
    // (dashboard.css does not exist yet either — TASK-205 ships it — so this walks whatever exists).
    if (existsSync(CLIENT_ROOT)) {
      const onDisk: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
          const p = join(dir, entry);
          if (statSync(p).isDirectory()) walk(p);
          else if (/\.(js|css|woff2)$/.test(entry)) onDisk.push(p);
        }
      };
      walk(CLIENT_ROOT);
      const listedFiles = new Set([...STATIC_ASSETS.values()].map((e) => e.file));
      for (const file of onDisk) {
        expect(listedFiles.has(file), `on-disk file ${file} is not registered in STATIC_ASSETS`).toBe(true);
      }
    }
  });
});
