// UT-144 (DES-142, v24): pathVerdict — lexical verdict pure, containment through an injected
// realpath; the three caller-typed namespaces removed. Written test-first (Gate 5, RED) —
// src/path-verdict.ts does not exist yet.
import { describe, it, expect } from 'vitest';
import { lexicalVerdict, pathVerdict } from '../../src/path-verdict.js';

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
});
