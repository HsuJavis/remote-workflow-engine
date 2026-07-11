// UT (REQ-022/023/025, v1.5+v2): pure workspace-artifacts (recursive list + sha256, chunked
// realpath-contained byte read) and workspace-seed (materialize + strip .claude settings/hooks +
// reject escapes). Real temp fs; the security guards (symlink/`../` escape, .claude RCE strip) are
// pinned, not just the happy path.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { listArtifacts, readArtifactChunk, DEFAULT_MAX_CHUNK } from '../../src/workspace-artifacts.js';
import { materializeSeed, isStrippedSeedPath } from '../../src/workspace-seed.js';

let ws: string;
let outside: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'rwe-ws-'));
  outside = mkdtempSync(join(tmpdir(), 'rwe-out-'));
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('listArtifacts (REQ-023: recursive + sha256, escape-safe)', () => {
  it('lists nested files recursively with size + sha256, workspace-relative and sorted', () => {
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'a.txt'), 'hello');
    writeFileSync(join(ws, 'src', 'b.py'), 'print(1)\n');
    const arts = listArtifacts(ws);
    expect(arts.map((a) => a.path)).toEqual(['a.txt', 'src/b.py']);
    const a = arts.find((x) => x.path === 'a.txt')!;
    expect(a.size).toBe(5);
    expect(a.sha256).toBe(createHash('sha256').update('hello').digest('hex'));
  });

  it('skips a symlink whose real target escapes the workspace', () => {
    writeFileSync(join(outside, 'secret'), 'TOP SECRET');
    try {
      symlinkSync(join(outside, 'secret'), join(ws, 'link'));
    } catch {
      return; // symlink unsupported in this env — skip
    }
    const arts = listArtifacts(ws);
    expect(arts.some((a) => a.path === 'link')).toBe(false);
    expect(JSON.stringify(arts)).not.toContain('secret');
  });
});

describe('readArtifactChunk (REQ-022: windowed, capped, realpath-contained)', () => {
  it('returns the requested window with eof + real size', () => {
    writeFileSync(join(ws, 'f.bin'), 'ABCDEFGHIJ'); // 10 bytes
    const r = readArtifactChunk(ws, 'f.bin', 3, 4);
    if ('error' in r) throw new Error(r.error);
    expect(Buffer.from(r.base64, 'base64').toString()).toBe('DEFG');
    expect(r).toMatchObject({ size: 10, offset: 3, length: 4, eof: false });
    const last = readArtifactChunk(ws, 'f.bin', 8, 100);
    if ('error' in last) throw new Error(last.error);
    expect(Buffer.from(last.base64, 'base64').toString()).toBe('IJ');
    expect(last.eof).toBe(true);
  });

  it('caps a chunk at maxChunk even when length asks for more', () => {
    writeFileSync(join(ws, 'big'), Buffer.alloc(50, 0x41));
    const r = readArtifactChunk(ws, 'big', 0, 1000, 8);
    if ('error' in r) throw new Error(r.error);
    expect(r.length).toBe(8);
    expect(r.eof).toBe(false);
  });

  it('denies a ../ escape and a non-file, with typed errors', () => {
    writeFileSync(join(outside, 'secret'), 'x');
    expect(readArtifactChunk(ws, '../rwe-out-does-not-matter/secret')).toEqual({ error: 'PATH_OUTSIDE_WORKSPACE' });
    expect(readArtifactChunk(ws, 'nope.txt')).toEqual({ error: 'NOT_A_FILE' });
    mkdirSync(join(ws, 'adir'));
    expect(readArtifactChunk(ws, 'adir')).toEqual({ error: 'NOT_A_FILE' });
  });

  it('DEFAULT_MAX_CHUNK is a sane 1 MiB ceiling', () => {
    expect(DEFAULT_MAX_CHUNK).toBe(1024 * 1024);
  });
});

describe('materializeSeed (REQ-025: seed + strip .claude RCE + reject escapes)', () => {
  it('writes ordinary files into the workspace', () => {
    const r = materializeSeed(ws, [
      { path: 'snake.py', contentB64: Buffer.from('import curses\n').toString('base64') },
      { path: 'src/util.py', contentB64: Buffer.from('X').toString('base64') },
    ]);
    expect(r.written.sort()).toEqual(['snake.py', 'src/util.py']);
    expect(readFileSync(join(ws, 'snake.py'), 'utf8')).toBe('import curses\n');
  });

  it('STRIPS .claude/settings*.json and .claude/hooks/** (never written — RCE guard)', () => {
    const r = materializeSeed(ws, [
      { path: '.claude/settings.json', contentB64: Buffer.from('{"hooks":{}}').toString('base64') },
      { path: '.claude/settings.local.json', contentB64: 'e30=' },
      { path: '.claude/hooks/pre.sh', contentB64: Buffer.from('rm -rf /').toString('base64') },
      { path: '.claude/skills/x/SKILL.md', contentB64: Buffer.from('ok').toString('base64') },
    ]);
    expect(r.stripped.sort()).toEqual(['.claude/hooks/pre.sh', '.claude/settings.json', '.claude/settings.local.json']);
    expect(r.written).toEqual(['.claude/skills/x/SKILL.md']); // skills are the intended surface, kept
    expect(isStrippedSeedPath('.claude/settings.json')).toBe(true);
    expect(isStrippedSeedPath('.claude/skills/x/SKILL.md')).toBe(false);
  });

  it('REJECTS a ../ escape and .git internals (never written)', () => {
    const r = materializeSeed(ws, [
      { path: '../escape.txt', contentB64: 'eA==' },
      { path: '.git/hooks/pre-commit', contentB64: 'eA==' },
      { path: 'ok.txt', contentB64: 'eA==' },
    ]);
    expect(r.rejected.sort()).toEqual(['../escape.txt', '.git/hooks/pre-commit']);
    expect(r.written).toEqual(['ok.txt']);
  });
});
