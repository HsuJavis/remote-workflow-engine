// UT-174 (DES-170, ARCH-110, TASK-175, v26, issue #64): `validateSeedSpec` — the ONE door for
// `INVALID_SEED_SPEC`, refusing the FIRST offending element before any byte is written. Also locks
// `SEED_ITEM_HINT` as the single string both the schema description and the validator message read
// (drift lock). Written test-first (Gate 5, RED): `validateSeedSpec`/`SEED_ITEM_HINT` do not exist
// yet in src/workspace-seed.ts — whole-file import failure.
// Mock policy (unit): pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { validateSeedSpec, SEED_ITEM_HINT } from '../../src/workspace-seed.js';

describe('validateSeedSpec — one door, refuses the first offender, never throws (UT-174, DES-170)', () => {
  const rows: Array<[string, 'seed' | 'seedManifest', unknown, boolean]> = [
    ['seed with only sha256 (issue #64) is refused, not silently accepted as an empty file', 'seed', [{ path: 'a.txt', sha256: '0'.repeat(64) }], false],
    ['contentB64: null is refused', 'seed', [{ path: 'a.txt', contentB64: null }], false],
    ['contentB64: number is refused', 'seed', [{ path: 'a.txt', contentB64: 42 }], false],
    ['contentB64 absent is refused', 'seed', [{ path: 'a.txt' }], false],
    ['missing path is refused', 'seed', [{ contentB64: 'AAAA' }], false],
    ['a non-array seed is refused (index -1)', 'seed', { path: 'a.txt', contentB64: 'AAAA' }, false],
    ['an empty array is accepted (zero files)', 'seed', [], true],
    ['a bare string element is refused', 'seed', ['a.txt'], false],
    ['a valid {path, contentB64} pair is accepted', 'seed', [{ path: 'a.txt', contentB64: 'AAAA' }], true],
    ['two valid pairs are accepted', 'seed', [{ path: 'a.txt', contentB64: 'AAAA' }, { path: 'b.txt', contentB64: 'BBBB' }], true],
    ['seedManifest: a valid {path, sha256} pair is accepted', 'seedManifest', [{ path: 'a.txt', sha256: '0'.repeat(64) }], true],
    ['seedManifest: a 63-hex sha is refused', 'seedManifest', [{ path: 'a.txt', sha256: '0'.repeat(63) }], false],
    ['seedManifest: exec:true is accepted', 'seedManifest', [{ path: 'a.txt', sha256: '0'.repeat(64), exec: true }], true],
    ['seedManifest: missing sha256 is refused', 'seedManifest', [{ path: 'a.txt' }], false],
    // issue #103(c): an escaping/absolute seed path used to pass validateSeedSpec (structural
    // shape only) and get silently STRIPPED/REJECTED, invisible, at materialize time — never
    // refused INVALID_SEED_SPEC at admission, so a caller had no way to learn its seed was
    // partially dropped.
    ['seed: a "../" escaping path is refused', 'seed', [{ path: '../escape.txt', contentB64: 'AAAA' }], false],
    ['seed: an absolute path is refused', 'seed', [{ path: '/etc/passwd', contentB64: 'AAAA' }], false],
    ['seed: a nested "../" escaping path is refused', 'seed', [{ path: 'a/../../escape.txt', contentB64: 'AAAA' }], false],
    ['seedManifest: a "../" escaping path is refused', 'seedManifest', [{ path: '../escape.txt', sha256: '0'.repeat(64) }], false],
    ['seedManifest: an absolute path is refused', 'seedManifest', [{ path: '/etc/passwd', sha256: '0'.repeat(64) }], false],
    // a former .claude settings/hooks path is a silent STRIP at materialize time, not a refusal —
    // it must stay accepted here (policy, not an escape).
    ['seed: a .claude/settings.json path is still ACCEPTED (stripped at materialize, not refused)', 'seed', [{ path: '.claude/settings.json', contentB64: 'AAAA' }], true],
  ];

  it.each(rows)('%s', (_desc, source, value, expectOk) => {
    const result = validateSeedSpec(source, value);
    expect(result.ok).toBe(expectOk);
  });

  it('refuses the FIRST offending element, naming its path and index', () => {
    const result = validateSeedSpec('seed', [
      { path: 'good.txt', contentB64: 'AAAA' },
      { path: 'bad.txt', sha256: '0'.repeat(64) },
    ]) as any;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_SEED_SPEC');
    expect(result.index).toBe(1);
    expect(result.path).toBe('bad.txt');
  });

  it('a non-array value refuses with index -1 and no path', () => {
    const result = validateSeedSpec('seed', 'not-an-array') as any;
    expect(result.ok).toBe(false);
    expect(result.index).toBe(-1);
  });

  it('never throws on garbage input', () => {
    expect(() => validateSeedSpec('seed', null)).not.toThrow();
    expect(() => validateSeedSpec('seed', undefined)).not.toThrow();
    expect(() => validateSeedSpec('seedManifest', 42)).not.toThrow();
  });

  it('the refusal message names the offending path', () => {
    const result = validateSeedSpec('seed', [{ path: 'a.txt', sha256: '0'.repeat(64) }]) as any;
    expect(result.ok).toBe(false);
    expect(result.message).toContain('a.txt');
  });

  it('an escaping path is refused naming the path and the escape reason', () => {
    const result = validateSeedSpec('seed', [{ path: '../escape.txt', contentB64: 'AAAA' }]) as any;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_SEED_SPEC');
    expect(result.path).toBe('../escape.txt');
    expect(result.message).toMatch(/escape/i);
  });

  it('a seed path with a reserved rwe- first segment is refused naming the path and RESERVED_PREFIX (#159 C6)', () => {
    const result = validateSeedSpec('seed', [{ path: 'rwe-x/y', contentB64: 'aGk=' }]) as any;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_SEED_SPEC');
    expect(result.path).toBe('rwe-x/y');
    expect(result.message).toMatch(/RESERVED_PREFIX/);
  });

  it('a seedManifest path with a reserved rwe- first segment is refused naming the path and RESERVED_PREFIX (#159 C6)', () => {
    const result = validateSeedSpec('seedManifest', [{ path: 'rwe-y/z.txt', sha256: '0'.repeat(64) }]) as any;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_SEED_SPEC');
    expect(result.path).toBe('rwe-y/z.txt');
    expect(result.message).toMatch(/RESERVED_PREFIX/);
  });

  it('SEED_ITEM_HINT is the ONE string the validator message and the schema description both read (drift lock)', () => {
    const result = validateSeedSpec('seed', [{ path: 'a.txt', sha256: '0'.repeat(64) }]) as any;
    expect(typeof SEED_ITEM_HINT).toBe('string');
    expect(SEED_ITEM_HINT.length).toBeGreaterThan(0);
    expect(result.message).toContain(SEED_ITEM_HINT);
  });
});

// UT-211 (DES-170, ARCH-110, TASK-175, v26, issue #64): the two refusal/guard lines per-function
// coverage showed unreached — `validateSeedSpec`'s `exec` type check on the seedManifest arm, and
// `materializeSeed`'s DEFENCE-IN-DEPTH throw. The latter is the line that replaced `contentB64 ?? ''`,
// i.e. the exact bug issue #64 was filed about: with no test, a regression there re-introduces a
// silently-empty seeded file, the one outcome the design says seeding must never have.
// Mock policy (unit): pure functions; `materializeSeed` writes to a real temp dir (its own I/O, not
// a mocked boundary).
describe('the seed guards with no reader (UT-211, DES-170)', () => {
  it('seedManifest: a non-boolean exec is refused BY NAME', () => {
    const result = validateSeedSpec('seedManifest', [{ path: 'a.sh', sha256: '0'.repeat(64), exec: 'yes' }]) as any;
    expect(result.ok).toBe(false);
    expect(result.message).toContain('exec must be a boolean');
    expect(result.path).toBe('a.sh');
  });

  it('seedManifest: exec omitted, true and false are all accepted', () => {
    for (const exec of [undefined, true, false]) {
      const el: Record<string, unknown> = { path: 'a.sh', sha256: '0'.repeat(64) };
      if (exec !== undefined) el['exec'] = exec;
      expect((validateSeedSpec('seedManifest', [el]) as any).ok).toBe(true);
    }
  });

  it('materializeSeed THROWS INVALID_SEED_SPEC rather than writing a 0-byte file for a contentless element', async () => {
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { materializeSeed } = await import('../../src/workspace-seed.js');
    const ws = mkdtempSync(join(tmpdir(), 'ut211-'));
    try {
      expect(() => materializeSeed(ws, [{ path: 'a.txt', sha256: '0'.repeat(64) } as any]))
        .toThrow(/INVALID_SEED_SPEC.*a\.txt.*no contentB64/);
      expect(existsSync(join(ws, 'a.txt'))).toBe(false);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
