// Realpath-based path containment (DES-025 / ARCH-007/016 / TASK-031, D-V2G8-1(d) hardening):
// a naive resolve()/startsWith() string-prefix check is fooled by a symlink whose own path sits
// inside the workspace but whose real target escapes it. `isPathContained` follows the real
// (symlink-resolved) target of both `path` and `root` before comparing, so the ARCH-007
// confinement callback denies that read/write instead of silently allowing it.
import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

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
