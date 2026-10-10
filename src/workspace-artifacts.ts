// v1.5 (REQ-022/023): recursive artifact listing (+ per-file sha256) and chunked, size-capped,
// realpath-contained byte reads of a run workspace's files. Containment is realpath-based
// (isPathContained), NOT a string prefix — a planted symlink whose real target escapes the
// workspace is never listed or read. Pure over the real fs; callers pass an already-resolved
// workspace dir (RunManager.workspacePath).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isPathContained } from './path-containment.js';
import { PROJECT_CONFIG_MOUNT_TARGETS, READONLY_MOUNT_TARGETS } from './gateway/bash-confinement.js';

// Issue #159 (NEW row): the pi gateway's `prepareDispatchMountTargets` (project-config-guard.ts)
// pre-creates every still-missing `PROJECT_CONFIG_MOUNT_TARGETS` 'file' entry as a 0-byte real file
// before each dispatch (issue #148's bwrap lazy-mount-race fix) — an engine-owned placeholder, not a
// client deliverable, exactly like `.git/` just below. `sweepPlantedConfig` already treats a 0-byte
// real file at one of these paths as "nothing to sweep" (its own doc comment); listArtifacts applies
// the SAME "0 bytes at this exact path = placeholder, not content" rule so `workspace_list`/
// `workspace_pull` don't surface 5 empty files a client never wrote and the sdk gateway (which never
// calls `prepareDispatchMountTargets`) never produces in the first place. A placeholder that an agent
// later wrote REAL content into is no longer 0 bytes and is listed normally — this only hides the
// untouched, genuinely-empty engine artifact.
// Issue #119: the SDK gateway's `prepareReadonlyMountTargets` (project-config-guard.ts) pre-creates
// every still-missing `READONLY_MOUNT_TARGETS` 'file' entry (.gitconfig, .bashrc, ...) as a 0-byte
// real file before a `bashMode:'readonly'` dispatch — the SAME "engine-owned placeholder, not a
// client deliverable" shape `PROJECT_CONFIG_MOUNT_TARGETS` already gets exempted for just above
// (af54cee/02a040c, pi gateway only). `READONLY_MOUNT_TARGETS` is a DIFFERENT list (a different
// gateway, a different trigger condition) but the exact same rule applies: untouched (0 bytes at
// this exact path) is hidden from workspace_list/workspace_pull; a file the agent actually wrote
// content to is no longer 0 bytes and stays listed/pullable normally. The two lists overlap on no
// path in practice, but the Set naturally unions either way.
//
// Issue #159 (round-3): this used to filter BOTH lists down to `kind === 'file'` entries only —
// right for THIS engine's own two pre-creation paths (`createMountTargets`'s `kind` branch really
// does `mkdirSync` for a 'dir' entry, `writeFileSync` for a 'file' one), but wrong for a SEPARATE,
// unrelated placeholder source neither pre-creation path controls: pi's vendored
// `@anthropic-ai/sandbox-runtime` (0.0.78, the only srt copy pi loads — see
// bash-confinement.ts's `HOME_CONVENIENCE_WRITE_DIRS` doc comment for the "bundled CLI embeds its
// own compiled copy, pi loads the npm package" split this reuses) hardcodes `.vscode`/`.idea`
// (`READONLY_MOUNT_TARGETS`'s two `kind:'dir'` entries) into its OWN mandatory write-deny set for
// EVERY sandboxed Bash call, unconditional on bashMode (`getDangerousDirectories()` /
// `linuxGetCwdMandatoryDenyPaths`, sandbox-utils.js) — neither gateway's dispatch-prep ever
// pre-creates `.vscode`/`.idea` for pi (`prepareDispatchMountTargets` only covers
// `PROJECT_CONFIG_MOUNT_TARGETS`, which has no such entry; `prepareReadonlyMountTargets`, the call
// that WOULD, is only ever reached from the SDK gateway's `bashMode:'readonly'` branch — pi's own
// dispatch path never calls it). So when the workspace lacks them, bwrap's own deny-path handling
// (linux-sandbox-utils.js: "Handle non-existent paths by mounting /dev/null to block creation")
// mounts `/dev/null` directly onto the absent leaf target — and because `/dev/null` is a file,
// bwrap creates the destination AS A REAL 0-BYTE FILE on the host, for the live duration of that
// sandboxed child process (removed by its own `cleanupBwrapMountPoints()` once the process exits —
// exactly why this is visible to `workspace_list` only while the run is RUNNING, and gone once it
// completes). The on-disk node this race leaves behind is therefore a FILE even for a path this
// engine's OWN code only ever creates as a directory, so the hiding rule must key off the REL PATH
// alone, not the declared `kind` — every entry of both lists is now a candidate, regardless of
// 'file' or 'dir', and the existing "0 bytes at this exact path" test below still only hides a
// genuinely untouched placeholder: a 0-byte file an agent itself wrote (not pi's own sandbox
// machinery) is indistinguishable from this case by design, same as every other entry here, and a
// non-empty directory (real content under `.idea/`, say) is unaffected — `listArtifacts` never
// lists a directory node itself, only the files inside it.
const MOUNT_PLACEHOLDER_FILES: ReadonlySet<string> = new Set([
  ...PROJECT_CONFIG_MOUNT_TARGETS.map((t): string => t.rel),
  ...READONLY_MOUNT_TARGETS.map((t): string => t.rel),
]);

/** Default max bytes returned by a single artifact_get chunk (a client pages by advancing offset). */
export const DEFAULT_MAX_CHUNK = 1024 * 1024; // 1 MiB

export type ArtifactError = 'PATH_OUTSIDE_WORKSPACE' | 'NOT_A_FILE';

export interface ArtifactEntry {
  path: string; // workspace-relative, forward-slash
  size: number;
  sha256: string;
}

/** Recursively list every regular file under `workspace` (workspace-relative paths), each with its
 *  size + content sha256. Any entry whose realpath escapes the workspace (a planted symlink) is
 *  skipped — the listing never contains a path resolving outside the workspace. */
export function listArtifacts(workspace: string): ArtifactEntry[] {
  const out: ArtifactEntry[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (!isPathContained(abs, workspace)) continue; // realpath escape guard (symlink)
      // `.git/` is the engine's own seed baseline (REQ-027 initGitBaseline), not a client deliverable —
      // its internals must never surface as pullable artifacts. Skip the whole directory at any depth.
      if (e.isDirectory() && e.name === '.git') continue;
      if (e.isDirectory()) {
        walk(abs);
      } else if (e.isFile()) {
        let buf: Buffer;
        try {
          buf = readFileSync(abs) as Buffer;
        } catch {
          continue;
        }
        const relPath = relative(workspace, abs).split(sep).join('/');
        if (buf.length === 0 && MOUNT_PLACEHOLDER_FILES.has(relPath)) continue; // issue #159: untouched engine mount placeholder, not client content
        out.push({
          path: relPath,
          size: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'),
        });
      }
    }
  };
  walk(workspace);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export interface ChunkResult {
  path: string;
  size: number; // total file size
  offset: number;
  length: number; // bytes actually returned in this chunk
  eof: boolean; // true when offset+length reached the end
  base64: string;
}

/** Read `[offset, offset+min(length, maxChunk))` bytes of `relPath` under `workspace`, positioned
 *  (never loads the whole file for a windowed read). `relPath` is realpath-contained. Returns a
 *  typed error on escape / missing / non-regular-file — never bytes from outside the workspace,
 *  never a partial/garbage read. */
export function readArtifactChunk(
  workspace: string,
  relPath: string,
  offset = 0,
  length?: number,
  maxChunk: number = DEFAULT_MAX_CHUNK,
): ChunkResult | { error: ArtifactError } {
  const abs = join(workspace, relPath);
  if (!isPathContained(abs, workspace)) return { error: 'PATH_OUTSIDE_WORKSPACE' };
  let size: number;
  try {
    const st = statSync(abs);
    if (!st.isFile()) return { error: 'NOT_A_FILE' };
    size = st.size;
  } catch {
    return { error: 'NOT_A_FILE' };
  }
  // issue #159 (reverify-3): the SAME "0 bytes at this exact path = untouched engine mount
  // placeholder, not client content" rule listArtifacts applies above — workspace_pull must agree
  // with workspace_list, or a client sees the placeholder hidden from one tool and still readable
  // from the other. relPath is compared as given (forward-slash already, same as listArtifacts'
  // own relPath — this engine ships/tests on Linux only).
  if (size === 0 && MOUNT_PLACEHOLDER_FILES.has(relPath)) return { error: 'NOT_A_FILE' };
  const off = Math.max(0, Math.floor(offset));
  const cap = Math.max(0, Math.floor(maxChunk));
  const want = length === undefined ? cap : Math.min(Math.max(0, Math.floor(length)), cap);
  const toRead = Math.max(0, Math.min(want, size - off));
  const buf = Buffer.alloc(toRead);
  if (toRead > 0) {
    const fd = openSync(abs, 'r');
    try {
      let got = 0;
      while (got < toRead) {
        const n = readSync(fd, buf, got, toRead - got, off + got);
        if (n <= 0) break;
        got += n;
      }
    } finally {
      closeSync(fd);
    }
  }
  return {
    path: relPath.split(sep).join('/'),
    size,
    offset: off,
    length: buf.length,
    eof: off + buf.length >= size,
    base64: buf.toString('base64'),
  };
}
