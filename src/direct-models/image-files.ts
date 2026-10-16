// v40 (DES-268, ARCH-185, ADR-090, TASK-264): generateImage()'s filesystem boundary — contained
// input read, sniffed mime, outDir resolution, tmp+rename write, `verifyFiles`. Real fs throughout
// (the host is a privileged deputy on an agent-written tree — containment/symlink-rejection must be
// proven against a real filesystem, not a faked one).
import { open, lstat, mkdir, rename, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';
import { codedError } from '../errors.js';
import type { ImageFile, ImageMime } from '../types.js';
import { isPathContained } from '../path-containment.js';

export const DEFAULT_OUT_DIR = 'generated';

type PathRefusedReason = 'escape' | 'not_regular' | 'too_large' | 'unsupported_type';

function pathRefused(reason: PathRefusedReason, subject: string): never {
  throw codedError('IMAGE_PATH_REFUSED', `IMAGE_PATH_REFUSED: generateImage: ${subject} ${reason}`, { reason });
}

const EXT_FOR: Record<ImageMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Magic-byte sniff — the ONLY thing that decides a file's mime here (never a claimed extension or
 *  content-type). `null` = not one of the four accepted image types. */
export function sniffMime(buf: Buffer): ImageMime | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  return null;
}

/** Rejects a lexical escape (absolute / any `..` segment) BEFORE touching the filesystem — same
 *  raw-string-first discipline as `inputs.ts`'s `outDir` check. */
function assertLexicallyContained(rel: string, subject: string): void {
  if (isAbsolute(rel)) pathRefused('escape', subject);
  for (const segment of rel.split('/')) {
    if (segment === '..') pathRefused('escape', subject);
  }
}

/** Reads one `inputImages` entry: lexical reject -> realpath containment -> lstat regular ->
 *  `open(O_RDONLY|O_NOFOLLOW)` -> size cap -> sniff. A planted symlink (lexically inside root,
 *  really outside) is caught by the containment check before any open — a symlink that stays
 *  inside root is caught by the `lstat` regular check (never followed either way). */
export async function readContainedInput(root: string, rel: string, maxBytes: number): Promise<{ data: Buffer; mimeType: ImageMime; sha256: string }> {
  const subject = `inputImages ${rel}`;
  assertLexicallyContained(rel, subject);
  const candidate = join(root, rel);
  if (!isPathContained(candidate, root)) pathRefused('escape', subject);
  const st = await lstat(candidate).catch(() => null);
  if (!st || !st.isFile()) pathRefused('not_regular', subject);
  const fh = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fh.stat();
    if (stat.size > maxBytes) pathRefused('too_large', subject);
    const data = Buffer.alloc(stat.size);
    await fh.read(data, 0, stat.size, 0);
    const mimeType = sniffMime(data);
    if (!mimeType) pathRefused('unsupported_type', subject);
    return { data, mimeType, sha256: createHash('sha256').update(data).digest('hex') };
  } finally {
    await fh.close();
  }
}

/** Resolves (and creates) the absolute output directory under `root` — `mkdir -p` semantics, then
 *  a realpath + containment RE-CHECK (a symlinked path component resolves outside root -> escape,
 *  caught here even though `mkdir` itself succeeded silently). */
export async function resolveOutDir(root: string, outDir: string | undefined): Promise<string> {
  const rel = outDir ?? DEFAULT_OUT_DIR;
  const abs = join(root, rel);
  await mkdir(abs, { recursive: true });
  if (!isPathContained(abs, root)) pathRefused('escape', 'outDir');
  return abs;
}

function toWorkspaceRelative(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

/** Writes each image under `absDir`, atomically (`O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` tmp file,
 *  then `rename` over the final name — a planted symlink AT the final name is replaced, never
 *  followed, since `rename`'s destination is unlinked, not opened). An image whose bytes sniff to
 *  no known mime is dropped (counted, not thrown) — `i` only advances for files actually written. */
export async function writeImages(root: string, absDir: string, label: string, callSeq: number, images: { data: Buffer }[]): Promise<{ files: ImageFile[]; dropped: number }> {
  const files: ImageFile[] = [];
  let dropped = 0;
  let i = 0;
  for (const img of images) {
    const mimeType = sniffMime(img.data);
    if (!mimeType) { dropped++; continue; }
    const name = `${label}-${callSeq}-${i}.${EXT_FOR[mimeType]}`;
    const finalPath = join(absDir, name);
    const tmpPath = join(absDir, `.${name}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const fh = await open(tmpPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW);
    try {
      await fh.write(img.data, 0, img.data.length, 0);
    } finally {
      await fh.close();
    }
    await rename(tmpPath, finalPath);
    files.push({
      path: toWorkspaceRelative(root, finalPath),
      mimeType,
      bytes: img.data.length,
      sha256: createHash('sha256').update(img.data).digest('hex'),
    });
    i++;
  }
  return { files, dropped };
}

/** True iff every listed file is present, contained, a regular (non-symlink) file, and its size +
 *  sha256 match the journaled values. Any single mismatch (missing, symlinked, size, hash) -> false
 *  — never throws. */
export async function verifyFiles(root: string, files: ImageFile[]): Promise<boolean> {
  for (const f of files) {
    const abs = join(root, f.path);
    if (!isPathContained(abs, root)) return false;
    let st;
    try {
      st = await lstat(abs);
    } catch {
      return false;
    }
    if (!st.isFile() || st.size !== f.bytes) return false;
    const data = await readFile(abs);
    if (createHash('sha256').update(data).digest('hex') !== f.sha256) return false;
  }
  return true;
}
