// v1.5 (REQ-022/023): recursive artifact listing (+ per-file sha256) and chunked, size-capped,
// realpath-contained byte reads of a run workspace's files. Containment is realpath-based
// (isPathContained), NOT a string prefix — a planted symlink whose real target escapes the
// workspace is never listed or read. Pure over the real fs; callers pass an already-resolved
// workspace dir (RunManager.workspacePath).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isPathContained } from './path-containment.js';

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
      if (e.isDirectory()) {
        walk(abs);
      } else if (e.isFile()) {
        let buf: Buffer;
        try {
          buf = readFileSync(abs) as Buffer;
        } catch {
          continue;
        }
        out.push({
          path: relative(workspace, abs).split(sep).join('/'),
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
