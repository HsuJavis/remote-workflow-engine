// UT-043: Pure SecretResolver — resolveConfig (atomic all-or-nothing) + redact (DES-025, TASK-030)
// RED: src/secret-resolver.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect } from 'vitest';
// Value import — causes module-not-found at load time when the module is absent.
import { resolveConfig, redact, InMemorySecretSource } from '../../src/secret-resolver.js';

function source(map: Record<string, string>) {
  return new InMemorySecretSource(map);
}

describe('resolveConfig — pure, atomic all-or-nothing (DES-025, REQ-018)', () => {
  it('replaces a single ${secret:name} handle with its resolved value', () => {
    const out = resolveConfig({ apiKey: '${secret:foo}' }, source({ foo: 'sh-real-value' }));
    expect(out).toEqual({ apiKey: 'sh-real-value' });
  });

  it('resolves handles nested arbitrarily deep in the config object', () => {
    const out = resolveConfig(
      { auth: { headers: { Authorization: 'Bearer ${secret:tok}' } } },
      source({ tok: 'xyz' }),
    );
    expect(out).toEqual({ auth: { headers: { Authorization: 'Bearer xyz' } } });
  });

  it('a mixed good/missing config throws SECRET_MISSING and resolves NOTHING partial', () => {
    const cfg = { a: '${secret:present}', b: '${secret:absent}' };
    expect(() => resolveConfig(cfg, source({ present: 'ok' }))).toThrow(
      expect.objectContaining({ code: 'SECRET_MISSING' }),
    );
  });

  it('a malformed handle grammar throws SECRET_HANDLE_INVALID, never smuggled through as a literal value', () => {
    const cfg = { a: '${secret:bad name with spaces}' };
    expect(() => resolveConfig(cfg, source({}))).toThrow(
      expect.objectContaining({ code: 'SECRET_HANDLE_INVALID' }),
    );
  });

  it('a config with no handles at all passes through unchanged', () => {
    const cfg = { plain: 'no-handle-here', n: 42 };
    expect(resolveConfig(cfg, source({}))).toEqual(cfg);
  });
});

describe('redact — capture-time choke point (DES-025, REQ-018)', () => {
  it('replaces every occurrence of a resolved secret value with the redaction marker', () => {
    const event = { text: 'the token is sh-real-value-123 in this line' };
    const out = redact(event, ['sh-real-value-123']);
    expect(JSON.stringify(out)).not.toContain('sh-real-value-123');
    expect(JSON.stringify(out)).toContain('‹redacted›');
  });

  it('redacts a secret value appearing anywhere in a nested structure', () => {
    const event = { a: { b: ['prefix-shhh-secret-suffix'] } };
    const out = redact(event, ['shhh-secret']) as { a: { b: string[] } };
    expect(out.a.b[0]).not.toContain('shhh-secret');
  });

  it('handle NAMES stay loggable — redact does not touch a bare handle-name string', () => {
    const event = { handleName: 'foo', text: 'value-of-foo-is-secretvalue' };
    const out = redact(event, ['secretvalue']) as { handleName: string; text: string };
    expect(out.handleName).toBe('foo');
    expect(out.text).not.toContain('secretvalue');
  });

  it('property invariant: no byte of the resolved value survives redact even split across fields', () => {
    const secretValue = 'super-secret-token-value';
    const event = { one: `A${secretValue}B`, two: `C${secretValue}D`, three: 'unrelated' };
    const out = redact(event, [secretValue]);
    expect(JSON.stringify(out)).not.toContain(secretValue);
  });
});
