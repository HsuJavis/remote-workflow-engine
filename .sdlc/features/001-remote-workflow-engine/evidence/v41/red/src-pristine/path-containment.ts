// Realpath-based path containment (DES-025 / ARCH-007/016 / TASK-031, D-V2G8-1(d) hardening):
// a naive resolve()/startsWith() string-prefix check is fooled by a symlink whose own path sits
// inside the workspace but whose real target escapes it. `isPathContained` follows the real
// (symlink-resolved) target of both `path` and `root` before comparing, so the ARCH-007
// confinement callback denies that read/write instead of silently allowing it.
import { realpathSync, lstatSync, readlinkSync } from 'node:fs';
import { resolve, sep, dirname, isAbsolute, join } from 'node:path';

/** True only when `path`'s REAL (symlink-resolved) location is `root` itself or strictly nested
 *  inside `root`'s own real location. Falls back to the plain resolved path when `realpath`
 *  fails (e.g. the target does not exist yet) — still rejects a plain `../` escape (regression
 *  floor) even though it cannot yet detect a not-created symlink. `realpath` is injected (v24
 *  DES-142/TASK-134) so callers can exercise the symlink-escape branch without touching disk;
 *  defaults to `realpathSync` — every pre-v24 call site is unaffected. */
export function isPathContained(path: string, root: string, realpath: (p: string) => string = realpathSync): boolean {
  const realRoot = safeRealpath(resolve(root), realpath);
  const realPath = safeRealpath(resolve(path), realpath);
  return realPath === realRoot || realPath.startsWith(realRoot + sep);
}

function safeRealpath(p: string, realpath: (p: string) => string): string {
  try {
    return realpath(p);
  } catch {
    return p;
  }
}

/** moved here verbatim from project-config-guard.ts (pi harness v1 review B3, DES-025 family): a pure
 *  no-local-import home so the pi child (raw `node --experimental-transform-types`, no `.js`->`.ts`
 *  bundler resolution — see the "rwe sandbox child .ts imports" memory note) can load it directly,
 *  the same way it already loads `isPathContained` from this file. Byte-identical logic to the
 *  original — `project-config-guard.ts` now imports this instead of defining its own copy.
 *
 *  Where `p` really lands, the way the kernel walks it: component by component, following every
 *  symlink (including a dangling LEAF link — writing through it creates its target) and applying
 *  `..` after resolution. A component that does not exist yet ends the walk; the rest is appended.
 *  This is `isPathContained`'s own missing piece: `isPathContained` calls `realpathSync`, which
 *  THROWS on a dangling symlink's unresolvable target and falls back to the symlink's own (contained)
 *  lexical path — exactly the gap a dangling-symlink write escape exploits. Callers that create or
 *  write a file must check `isPathContained(resolveLanding(p), root)`, never `isPathContained(p,
 *  root)` alone. */
export function resolveLanding(p: string, hops = 0): string {
  const parts = p.split('/');
  let cur = '/';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === '' || part === '.') continue;
    if (part === '..') {
      cur = dirname(cur);
      continue;
    }
    const next = join(cur, part);
    let isLink: boolean;
    try {
      isLink = lstatSync(next).isSymbolicLink();
    } catch {
      return join(next, ...parts.slice(i + 1).filter((x) => x !== '' && x !== '.'));
    }
    if (!isLink) {
      cur = next;
      continue;
    }
    if (hops >= 40) return next; // ELOOP: the write fails anyway; judge the link itself
    const target = readlinkSync(next);
    cur = resolveLanding(isAbsolute(target) ? target : `${cur}/${target}`, hops + 1);
  }
  return cur;
}
