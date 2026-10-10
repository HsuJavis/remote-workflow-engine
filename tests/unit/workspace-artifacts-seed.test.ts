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
import { prepareDispatchMountTargets, prepareReadonlyMountTargets } from '../../src/gateway/project-config-guard.js';

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

  it("issue #159: hides the pi gateway's untouched 0-byte PROJECT_CONFIG_MOUNT_TARGETS placeholders (.claude/settings.json, .mcp.json, ...), but lists a real file at the same path", () => {
    writeFileSync(join(ws, 'real.txt'), 'hello');
    prepareDispatchMountTargets(ws); // same call pi-gateway-client.ts makes before every dispatch
    const paths = listArtifacts(ws).map((a) => a.path);
    expect(paths).toEqual(['real.txt']); // every 0-byte placeholder is hidden
    // A placeholder an agent later wrote real content into is no longer hidden.
    writeFileSync(join(ws, '.mcp.json'), '{}');
    const paths2 = listArtifacts(ws).map((a) => a.path);
    expect(paths2).toEqual(['.mcp.json', 'real.txt']);
  });

  // Issue #119: the SDK gateway's `prepareReadonlyMountTargets` (bash-confinement.ts's
  // READONLY_MOUNT_TARGETS, a DIFFERENT list from PROJECT_CONFIG_MOUNT_TARGETS above, pre-created
  // before a `bashMode:'readonly'` dispatch) pre-creates the SAME shape of untouched 0-byte
  // placeholder (.gitconfig, .bashrc, ...) — af54cee/02a040c only exempted the pi-gateway's list,
  // so these still showed up in workspace_list/workspace_pull. Same exemption, same rule: hidden
  // only while untouched; a file an agent actually wrote content into is still listed/pullable.
  it("issue #119: hides the SDK gateway's untouched 0-byte READONLY_MOUNT_TARGETS placeholders (.gitconfig, .bashrc, ...), but lists a real file at the same path", () => {
    writeFileSync(join(ws, 'real.txt'), 'hello');
    prepareReadonlyMountTargets(ws); // same call claude-agent-sdk-client.ts makes before a readonly-Bash dispatch
    const paths = listArtifacts(ws).map((a) => a.path);
    expect(paths).toEqual(['real.txt']); // every 0-byte placeholder is hidden
    // A placeholder an agent later wrote real content into is no longer hidden.
    writeFileSync(join(ws, '.gitconfig'), '[user]\n');
    const paths2 = listArtifacts(ws).map((a) => a.path);
    expect(paths2).toEqual(['.gitconfig', 'real.txt']);
  });

  // Issue #159 (round-3, RUNNING-run row): `.idea`/`.vscode` are `kind:'dir'` entries in
  // `READONLY_MOUNT_TARGETS` (bash-confinement.ts) — this engine always pre-creates them as real
  // empty DIRECTORIES (project-config-guard.ts's `createMountTargets`, `kind:'dir'` branch:
  // `mkdirSync`). But neither gateway's OWN dispatch-prep ever pre-creates `.idea`/`.vscode` for pi:
  // `prepareDispatchMountTargets` only covers `PROJECT_CONFIG_MOUNT_TARGETS`, which has no
  // `.idea`/`.vscode` entry, and `prepareReadonlyMountTargets` (the one that WOULD pre-create them)
  // is only ever called by the SDK gateway's `bashMode:'readonly'` branch — pi's own dispatch path
  // never calls it at all (grep confirms no `prepareReadonlyMountTargets`/`READONLY_MOUNT_TARGETS`
  // reference anywhere in pi-gateway-client.ts).
  // Root cause (traced into the vendored dependency, @anthropic-ai/sandbox-runtime 0.0.78, the ONLY
  // srt copy the pi gateway loads — bash-confinement.ts's own HOME_CONVENIENCE_WRITE_DIRS doc
  // comment has the "bundled CLI embeds its own compiled copy, pi loads the npm package" precedent
  // this reuses): `getDangerousDirectories()` (sandbox-utils.js) hardcodes `.vscode`/`.idea` into
  // the MANDATORY write-deny set for EVERY sandboxed Bash call regardless of bashMode
  // (`linuxGetCwdMandatoryDenyPaths`, unconditional — not gated on `readonly` the way this engine's
  // OWN `settingsFiles` denyWrite is). `linux-sandbox-utils.js`'s deny-path loop, when a deny target
  // is ABSENT and is the leaf (not an intermediate path component, i.e. no `.idea/<child>` below it
  // is ALSO denied), mounts `/dev/null` directly onto it ("Handle non-existent paths by mounting
  // /dev/null to block creation" — that function's own comment) — and since `/dev/null` is a file,
  // bwrap creates the destination AS A REAL 0-BYTE FILE on the host for the live duration of that
  // sandboxed child process, tracked in `bwrapMountPoints` and removed by `cleanupBwrapMountPoints()`
  // only once the process exits. That is exactly the tester's observed shape: present while the run
  // is RUNNING (the sandboxed Bash call is still alive), gone once it completes — and exactly why
  // `.idea`/`.vscode` need the SAME "untouched 0-byte placeholder, regardless of file-or-dir kind"
  // exemption `MOUNT_PLACEHOLDER_FILES` already gives every `kind:'file'` entry: the on-disk node
  // this specific race produces is a FILE even though this engine's own (unrelated) pre-creation
  // path for the same relative path is a DIRECTORY.
  it("issue #159 (round-3): hides a 0-byte FILE materialized at a dir-kind READONLY_MOUNT_TARGETS path (.idea, .vscode — the shape pi's vendored sandbox-runtime's own mandatory dangerous-directory deny leaves behind on the host while a sandboxed Bash call is still running), but lists a real file written at the same path", () => {
    writeFileSync(join(ws, 'real.txt'), 'hello');
    // Simulates bwrap's own lazy `--ro-bind /dev/null <dest>` mount-point creation for an absent
    // leaf deny target — a real 0-byte FILE at a path this engine otherwise only ever pre-creates
    // as a directory.
    writeFileSync(join(ws, '.idea'), '');
    writeFileSync(join(ws, '.vscode'), '');
    const paths = listArtifacts(ws).map((a) => a.path);
    expect(paths).toEqual(['real.txt']); // the untouched 0-byte file placeholders are hidden
    expect(readArtifactChunk(ws, '.idea')).toEqual({ error: 'NOT_A_FILE' });
    expect(readArtifactChunk(ws, '.vscode')).toEqual({ error: 'NOT_A_FILE' });
    // A placeholder an agent later wrote real content into is no longer hidden — same rule as
    // every other MOUNT_PLACEHOLDER_FILES entry (listArtifacts/readArtifactChunk's own "0 bytes at
    // this exact path" test, not the declared `kind`, is what exempts it).
    writeFileSync(join(ws, '.idea'), 'not an engine placeholder any more');
    const paths2 = listArtifacts(ws).map((a) => a.path);
    expect(paths2).toEqual(['.idea', 'real.txt']);
    const r = readArtifactChunk(ws, '.idea');
    if ('error' in r) throw new Error(r.error);
    expect(r.size).toBe('not an engine placeholder any more'.length);
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

  it("issue #159 (reverify-3): an untouched 0-byte pi mount placeholder is NOT_A_FILE, consistent with listArtifacts hiding it", () => {
    prepareDispatchMountTargets(ws); // same call pi-gateway-client.ts makes before every dispatch
    expect(readArtifactChunk(ws, '.claude/settings.json')).toEqual({ error: 'NOT_A_FILE' });
    expect(readArtifactChunk(ws, '.mcp.json')).toEqual({ error: 'NOT_A_FILE' });
    // A placeholder an agent later wrote real content into is pullable normally, same as listArtifacts.
    writeFileSync(join(ws, '.mcp.json'), '{}');
    const r = readArtifactChunk(ws, '.mcp.json');
    if ('error' in r) throw new Error(r.error);
    expect(r.size).toBe(2);
  });

  it("issue #119: an untouched 0-byte SDK readonly mount placeholder is NOT_A_FILE, consistent with listArtifacts hiding it", () => {
    prepareReadonlyMountTargets(ws);
    expect(readArtifactChunk(ws, '.gitconfig')).toEqual({ error: 'NOT_A_FILE' });
    expect(readArtifactChunk(ws, '.bashrc')).toEqual({ error: 'NOT_A_FILE' });
    // A placeholder an agent later wrote real content into is pullable normally, same as listArtifacts.
    writeFileSync(join(ws, '.bashrc'), '# hi\n');
    const r = readArtifactChunk(ws, '.bashrc');
    if ('error' in r) throw new Error(r.error);
    expect(r.size).toBe(5);
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
