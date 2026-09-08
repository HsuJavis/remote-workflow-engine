// UT-188 (DES-179, ARCH-117, TASK-179, v26, issue #73): `models_list` rows carry
// `toolUseDeclared: boolean|'unknown'`, `effortDeclared: boolean|'unknown'`,
// `declaredSource: 'upstream'|'static'|'unknown'`, and a per-row `catalogFetchedAt: string|null` —
// `toolUse` is RENAMED to `toolUseDeclared` (no alias window, per the standing v24 ruling), on BOTH
// the output field and the `CatalogFilter` input. Written test-first (Gate 5, RED): today's
// `EnrichedModelEntry`/`enrichModelEntry` carry `toolUse` and no `effortDeclared`/`declaredSource`/
// `catalogFetchedAt` at all.
// Mock policy (unit): pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { enrichModelEntry } from '../../src/models/model-catalog.js';
import type { ModelEntry } from '../../src/models/model-catalog.js';

const BASE: ModelEntry = {
  provider: 'openrouter', model: 'x', description: 'desc',
  modalities: { in: ['text'], out: ['text'] }, contextWindow: 8000, price: 'unknown',
  toolUse: true, location: 'remote',
};

describe('EnrichedModelEntry carries declared-not-probed capability fields (UT-188, DES-179)', () => {
  it('carries toolUseDeclared (renamed from toolUse) rather than a bare toolUse boolean', () => {
    const enriched = enrichModelEntry(BASE) as any;
    expect(enriched.toolUseDeclared).toBe(true);
  });

  it('carries effortDeclared', () => {
    const enriched = enrichModelEntry(BASE) as any;
    expect(['boolean', 'string']).toContain(typeof enriched.effortDeclared);
  });

  it('carries declaredSource as one of upstream|static|unknown', () => {
    const enriched = enrichModelEntry(BASE) as any;
    expect(['upstream', 'static', 'unknown']).toContain(enriched.declaredSource);
  });

  it('carries a per-row catalogFetchedAt (string | null)', () => {
    const enriched = enrichModelEntry(BASE) as any;
    expect('catalogFetchedAt' in enriched).toBe(true);
  });
});
