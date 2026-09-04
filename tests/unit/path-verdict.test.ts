// UT-144 (DES-142, v24): pathVerdict — lexical verdict pure, containment through an injected
// realpath; the three caller-typed namespaces removed. Written test-first (Gate 5, RED) —
// src/path-verdict.ts does not exist yet.
import { describe, it, expect } from 'vitest';
import { lexicalVerdict, pathVerdict, type Dest } from '../../src/path-verdict.js';

describe('pathVerdict — lexical + injected containment (UT-144, DES-142)', () => {
  const STRIPPED_ROWS = [
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.claude/hooks/x',
    'a/.claude/hooks/x',
  ];
  const NOT_STRIPPED_ROWS = ['.claude/skills/s/SKILL.md', 'CLAUDE.md'];
  const REJECTED_ROWS = ['/etc/x', '../x', 'a/../../x'];
  const ACCEPTED_ROWS = ['./data/assets', 'a/b'];

  it.each(STRIPPED_ROWS)('run-workspace destination strips %s', (rel) => {
    expect(lexicalVerdict('run-workspace', rel).kind).toBe('stripped');
  });

  it.each(NOT_STRIPPED_ROWS)('run-workspace destination does NOT strip %s', (rel) => {
    expect(lexicalVerdict('run-workspace', rel).kind).not.toBe('stripped');
  });

  it.each(REJECTED_ROWS)('%s is rejected on any destination (absolute/traversal)', (rel) => {
    const verdict = lexicalVerdict('run-workspace', rel);
    expect(verdict.kind).toBe('reject');
  });

  it.each(ACCEPTED_ROWS)('%s is accepted (regression: relative-root still works)', (rel) => {
    expect(lexicalVerdict('run-workspace', rel).kind).toBe('ok');
  });

  it('an asset-tree destination rejects a reserved rwe- first segment', () => {
    expect(lexicalVerdict('asset-tree', 'rwe-internal/x').kind).toBe('reject');
  });

  it('empty string is rejected with reason EMPTY', () => {
    const verdict = lexicalVerdict('run-workspace', '');
    expect(verdict.kind).toBe('reject');
    expect(verdict.reason).toBe('EMPTY');
  });

  it('a NUL byte is rejected with reason NUL', () => {
    const verdict = lexicalVerdict('run-workspace', 'a\0b');
    expect(verdict.reason).toBe('NUL');
  });

  it('a fake realpath that resolves outside root is rejected as SYMLINK', () => {
    const fakeRealpath = (p: string) => (p.includes('escape') ? '/outside/escape' : p);
    const verdict = pathVerdict('/workroot/run1', 'escape', fakeRealpath);
    expect(verdict.kind).toBe('reject');
    expect(verdict.reason).toBe('SYMLINK');
  });

  // ---------------------------------------------------------------------------------------------
  // Gate 6.5+7 round 2 (verifier): TASK-134's dod asks for >=30 rows covering "every former
  // STRIP_RE and safeRelPath case … Windows separators and NUL rejected"; the shipped file carried
  // 15 and left five decision arms of `lexicalVerdict` (GIT_INTERNAL, the CLAUDE_SETTINGS/
  // CLAUDE_HOOKS reason split, the drive-letter ABSOLUTE arm, backslash normalisation, and the
  // `rwe-` prefix being asset-tree-ONLY) plus `pathVerdict`'s ok/`abs` arm unexercised. The rows
  // below close them — same table style, no assertion weakened.
  // ---------------------------------------------------------------------------------------------

  const REASON_ROWS: Array<[Dest, string, string]> = [
    ['run-workspace', '', 'EMPTY'],
    ['run-workspace', 'a\0b', 'NUL'],
    ['run-workspace', '/etc/passwd', 'ABSOLUTE'],
    ['run-workspace', 'C:\\Windows\\x', 'ABSOLUTE'],   // drive letter, Windows separators
    ['run-workspace', 'c:/windows/x', 'ABSOLUTE'],     // lower-case drive letter
    ['run-workspace', '..', 'ESCAPE'],
    ['run-workspace', 'a/../../x', 'ESCAPE'],
    ['run-workspace', 'a\\..\\..\\x', 'ESCAPE'],     // backslashes normalise BEFORE the .. scan
    ['run-workspace', '.git/config', 'GIT_INTERNAL'],
    ['run-workspace', 'a/.git/HEAD', 'GIT_INTERNAL'],
    ['asset-tree', 'rwe-internal/x', 'RESERVED_PREFIX'],
    ['asset-tree', 'rwe-notes.txt', 'RESERVED_PREFIX'], // a FILE, not just a directory
  ];
  it.each(REASON_ROWS)('%s + %s is rejected with reason %s', (dest, rel, reason) => {
    const verdict = lexicalVerdict(dest, rel);
    expect(verdict.kind).toBe('reject');
    expect(verdict.reason).toBe(reason);
  });

  const STRIP_REASON_ROWS: Array<[string, string]> = [
    ['.claude/settings.json', 'CLAUDE_SETTINGS'],
    ['.claude/settings.local.json', 'CLAUDE_SETTINGS'],
    ['a/b/.claude/settings.json', 'CLAUDE_SETTINGS'],
    ['.claude/hooks/pre.sh', 'CLAUDE_HOOKS'],
    ['a/.claude/hooks/deep/x.sh', 'CLAUDE_HOOKS'],
  ];
  it.each(STRIP_REASON_ROWS)('%s is stripped with reason %s', (rel, reason) => {
    const verdict = lexicalVerdict('run-workspace', rel);
    expect(verdict.kind).toBe('stripped');
    expect(verdict.reason).toBe(reason);
  });

  const OK_ROWS: Array<[Dest, string]> = [
    ['run-workspace', 'rwe-notes.txt'],          // the reserved prefix is asset-tree-ONLY
    ['run-workspace', 'a\\b\\c.txt'],            // backslashes are separators, not an escape
    ['asset-tree', '.claude/settings.json'],     // the strip rule is run-workspace-ONLY
    ['asset-tree', '.git-notes/x'],              // `.git` matches a SEGMENT, not a prefix
    ['run-workspace', './a/./b'],                // '.' segments are dropped, not rejected
  ];
  it.each(OK_ROWS)('%s + %s is accepted', (dest, rel) => {
    expect(lexicalVerdict(dest, rel).kind).toBe('ok');
  });

  it('pathVerdict returns the joined absolute path when containment holds', () => {
    const verdict = pathVerdict('/workroot/run1', 'a/b.txt', (p) => p);
    expect(verdict.kind).toBe('ok');
    expect(verdict.kind === 'ok' && verdict.abs).toBe('/workroot/run1/a/b.txt');
  });

  it('pathVerdict short-circuits on the lexical verdict — realpath is never called on a rejected path', () => {
    let calls = 0;
    const verdict = pathVerdict('/workroot/run1', '../escape', (p) => { calls += 1; return p; });
    expect(verdict.reason).toBe('ESCAPE');
    expect(calls).toBe(0);
  });

  it('pathVerdict defaults to the run-workspace destination — an asset-tree rule does not apply', () => {
    expect(pathVerdict('/workroot/run1', 'rwe-notes.txt', (p) => p).kind).toBe('ok');
    expect(pathVerdict('/workroot/run1', 'rwe-notes.txt', (p) => p, 'asset-tree').reason).toBe('RESERVED_PREFIX');
  });
});
