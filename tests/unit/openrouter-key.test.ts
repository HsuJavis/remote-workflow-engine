// UT-340 (DES-265, ARCH-184, TASK-261): `resolveOpenrouterKey(secretSource)` lifted to
// `src/gateway/openrouter-key.ts` — a pure function, body moved verbatim from
// `pi-gateway-client.ts:528-530`. Resolution order: `secretSource.resolve('OPENROUTER_API_KEY')` ->
// `RWE_SECRET_OPENROUTER_API_KEY` env -> `OPENROUTER_API_KEY` env -> `undefined`.
//
// Mock policy (unit): a fake `SecretSource`, real `process.env`.
// Red reason: `src/gateway/openrouter-key.ts` does not exist yet — module-not-found.
import { describe, it, expect, afterEach } from 'vitest';
import { resolveOpenrouterKey } from '../../src/gateway/openrouter-key.js';
import type { SecretSource } from '../../src/secret-resolver.js';

const ENV_KEYS = ['RWE_SECRET_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};

function fakeSource(value: string | undefined): SecretSource {
  return { resolve: () => value } as unknown as SecretSource;
}

describe('UT-340: resolveOpenrouterKey (DES-265)', () => {
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('prefers secretSource.resolve() over both env vars', () => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; process.env[k] = 'env-value'; }
    expect(resolveOpenrouterKey(fakeSource('from-secret-source'))).toBe('from-secret-source');
  });

  it('falls back to RWE_SECRET_OPENROUTER_API_KEY when secretSource resolves nothing', () => {
    saved['RWE_SECRET_OPENROUTER_API_KEY'] = process.env['RWE_SECRET_OPENROUTER_API_KEY'];
    saved['OPENROUTER_API_KEY'] = process.env['OPENROUTER_API_KEY'];
    process.env['RWE_SECRET_OPENROUTER_API_KEY'] = 'rwe-secret-value';
    delete process.env['OPENROUTER_API_KEY'];
    expect(resolveOpenrouterKey(fakeSource(undefined))).toBe('rwe-secret-value');
  });

  it('falls back to bare OPENROUTER_API_KEY when neither secretSource nor RWE_SECRET_* resolve', () => {
    saved['RWE_SECRET_OPENROUTER_API_KEY'] = process.env['RWE_SECRET_OPENROUTER_API_KEY'];
    saved['OPENROUTER_API_KEY'] = process.env['OPENROUTER_API_KEY'];
    delete process.env['RWE_SECRET_OPENROUTER_API_KEY'];
    process.env['OPENROUTER_API_KEY'] = 'bare-env-value';
    expect(resolveOpenrouterKey(fakeSource(undefined))).toBe('bare-env-value');
  });

  it('returns undefined when nothing resolves anywhere', () => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    expect(resolveOpenrouterKey(fakeSource(undefined))).toBeUndefined();
  });
});
