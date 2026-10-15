// UT-344 (DES-268, ARCH-185, ADR-090, TASK-264): `src/direct-models/image-files.ts` — contained
// input read, sniffed mime, outDir resolution, tmp+rename write, `verifyFiles`. Real tmp dir, real
// fs (no mocks — the host is a privileged deputy on an agent-written tree, so the containment and
// symlink-rejection behavior must be proven against a REAL filesystem, not a faked one).
//
// Red reason: `src/direct-models/image-files.ts` does not exist yet — module-not-found.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sniffMime, readContainedInput, resolveOutDir, writeImages, verifyFiles, DEFAULT_OUT_DIR,
} from '../../src/direct-models/image-files.js';

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'rwe-image-files-'))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe('UT-344: sniffMime (DES-268)', () => {
  it.each([
    [PNG_BYTES, 'image/png'],
    [JPEG_BYTES, 'image/jpeg'],
  ])('sniffs the magic bytes correctly', (bytes, expected) => {
    expect(sniffMime(bytes as Buffer)).toBe(expected);
  });

  it('returns null for an unrecognized byte sequence', () => {
    expect(sniffMime(Buffer.from('not an image'))).toBeNull();
  });
});

describe('UT-344: readContainedInput (DES-268)', () => {
  it('reads a regular file inside root and returns data/mimeType/sha256', async () => {
    writeFileSync(join(root, 'a.png'), PNG_BYTES);
    const r = await readContainedInput(root, 'a.png', 1024);
    expect(r.mimeType).toBe('image/png');
    expect(r.data.equals(PNG_BYTES)).toBe(true);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a path with a ".." segment (IMAGE_PATH_REFUSED, reason escape)', async () => {
    await expect(readContainedInput(root, '../x.png', 1024)).rejects.toThrow(/IMAGE_PATH_REFUSED/);
  });

  it('refuses an absolute path', async () => {
    await expect(readContainedInput(root, '/etc/passwd', 1024)).rejects.toThrow(/IMAGE_PATH_REFUSED/);
  });

  it('refuses a planted symlink that points OUTSIDE root (escape, not followed)', async () => {
    const outsideFile = join(tmpdir(), 'rwe-image-files-outside-target.txt');
    writeFileSync(outsideFile, 'secret');
    symlinkSync(outsideFile, join(root, 'link.png'));
    await expect(readContainedInput(root, 'link.png', 1024)).rejects.toThrow(/IMAGE_PATH_REFUSED/);
    rmSync(outsideFile, { force: true });
  });

  it('refuses a FIFO (not_regular)', async () => {
    const { execFileSync } = await import('node:child_process');
    const fifoPath = join(root, 'f.png');
    execFileSync('mkfifo', [fifoPath]);
    await expect(readContainedInput(root, 'f.png', 1024)).rejects.toThrow(/IMAGE_PATH_REFUSED/);
  });

  it('refuses a file over maxBytes (too_large)', async () => {
    writeFileSync(join(root, 'big.png'), Buffer.concat([PNG_BYTES, Buffer.alloc(2048)]));
    await expect(readContainedInput(root, 'big.png', 16)).rejects.toThrow(/IMAGE_PATH_REFUSED/);
  });

  it('refuses a non-image byte sequence (unsupported_type)', async () => {
    writeFileSync(join(root, 'garbage.png'), Buffer.from('not an image at all'));
    await expect(readContainedInput(root, 'garbage.png', 1024)).rejects.toThrow(/IMAGE_PATH_REFUSED/);
  });
});

describe('UT-344: resolveOutDir (DES-268)', () => {
  it('defaults to DEFAULT_OUT_DIR when outDir is undefined, creating it', async () => {
    const abs = await resolveOutDir(root, undefined);
    expect(abs).toBe(join(root, DEFAULT_OUT_DIR));
  });

  it('creates a nested outDir (mkdir -p semantics)', async () => {
    const abs = await resolveOutDir(root, 'out/ig');
    expect(abs).toBe(join(root, 'out', 'ig'));
  });

  it('refuses when a PATH COMPONENT is a symlink escaping root', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'rwe-image-files-outside-dir-'));
    mkdirSync(join(root, 'out'));
    symlinkSync(outsideDir, join(root, 'out', 'ig'));
    await expect(resolveOutDir(root, 'out/ig')).rejects.toThrow(/IMAGE_PATH_REFUSED/);
    rmSync(outsideDir, { recursive: true, force: true });
  });
});

describe('UT-344: writeImages (DES-268)', () => {
  it('writes files named <label>-<callSeq>-<i>.<ext>, atomically (tmp + rename)', async () => {
    const absDir = await resolveOutDir(root, undefined);
    const { files, dropped } = await writeImages(root, absDir, 'hero', 3, [{ data: PNG_BYTES }]);
    expect(dropped).toBe(0);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(`${DEFAULT_OUT_DIR}/hero-3-0.png`);
    expect(files[0]?.bytes).toBe(PNG_BYTES.length);
  });

  it('drops an image whose bytes sniff to no known mime, without throwing', async () => {
    const absDir = await resolveOutDir(root, undefined);
    const { files, dropped } = await writeImages(root, absDir, 'hero', 1, [{ data: Buffer.from('garbage') }]);
    expect(dropped).toBe(1);
    expect(files).toHaveLength(0);
  });

  it('a planted symlink at the final name is REPLACED, not followed', async () => {
    const absDir = await resolveOutDir(root, undefined);
    const outsideFile = join(tmpdir(), 'rwe-image-files-final-name-target.txt');
    writeFileSync(outsideFile, 'should not be written through');
    symlinkSync(outsideFile, join(absDir, 'hero-1-0.png'));
    const { files } = await writeImages(root, absDir, 'hero', 1, [{ data: PNG_BYTES }]);
    expect(files[0]?.path).toBe(`${DEFAULT_OUT_DIR}/hero-1-0.png`);
    const verified = await verifyFiles(root, files);
    expect(verified).toBe(true);
    rmSync(outsideFile, { force: true });
  });
});

describe('UT-344: verifyFiles (DES-268)', () => {
  it('true when every file is present, contained, regular, and size+sha match', async () => {
    const absDir = await resolveOutDir(root, undefined);
    const { files } = await writeImages(root, absDir, 'hero', 1, [{ data: PNG_BYTES }]);
    expect(await verifyFiles(root, files)).toBe(true);
  });

  it('false when a listed file is missing', async () => {
    expect(await verifyFiles(root, [{ path: `${DEFAULT_OUT_DIR}/missing.png`, mimeType: 'image/png', bytes: 10, sha256: 'x'.repeat(64) }])).toBe(false);
  });

  it('false when the file at that path is now a symlink', async () => {
    const absDir = await resolveOutDir(root, undefined);
    const { files } = await writeImages(root, absDir, 'hero', 1, [{ data: PNG_BYTES }]);
    const abs = join(root, files[0]!.path);
    rmSync(abs, { force: true });
    const outsideFile = join(tmpdir(), 'rwe-image-files-verify-target.txt');
    writeFileSync(outsideFile, 'x');
    symlinkSync(outsideFile, abs);
    expect(await verifyFiles(root, files)).toBe(false);
    rmSync(outsideFile, { force: true });
  });
});
