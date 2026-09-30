// Issue #104: the models_list tool description is the ONLY documentation a cold MCP client sees
// (the client plugin is gone), so it must explain every new field's meaning, source and null
// semantics, the observed-vs-benchmark distinction, the page wrapper, and how to pick a model with
// filters/sorts — and every new input must carry its own description.
import { describe, it, expect } from 'vitest';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { ALL_FIELDS, COMPACT_FIELDS, SORT_KEYS } from '../../src/models/models-query.js';

const spec = TOOL_SPECS.find((t) => t.name === 'models_list')!;
const d = spec.description;
const props = (spec.inputSchema as { properties: Record<string, { description?: string; enum?: unknown[]; items?: { enum?: unknown[] } }> }).properties;

describe('models_list description is self-contained (issue #104)', () => {
  it('names the page wrapper and pagination contract', () => {
    for (const w of ['models', 'nextCursor', 'total', 'cursor', 'limit']) expect(d).toContain(w);
  });

  it('documents every new row field by name', () => {
    for (const f of ['modelType', 'limits', 'maxOutputTokens', 'capabilities', 'effortAppliedOnTransport', 'pricingDetail', 'local', 'lifecycle', 'benchmarks', 'sameModelAs', 'borrowedFrom', 'observed', 'probeFailureReason']) {
      expect(d, f).toContain(f);
    }
  });

  it('explains null semantics, sources, and observed vs benchmark', () => {
    expect(d).toMatch(/null/);
    expect(d).toMatch(/OpenRouter/);
    expect(d).toMatch(/Artificial ?Analysis/i);
    expect(d).toMatch(/Design ?Arena/i);
    expect(d).toMatch(/this (engine|host)/i);
    expect(d).toMatch(/third-party/i);
    expect(d).toMatch(/nulls? (sort )?last/i);
  });

  it('lists the compact default fields and how to get all', () => {
    for (const f of COMPACT_FIELDS) expect(d).toContain(f);
    expect(d).toContain("['*']");
  });

  it('gives selection examples', () => {
    expect(d).toMatch(/sortBy/);
    expect(d).toMatch(/e\.g\.|example/i);
  });

  it('keeps the drift-locked words (capability, stability, costLevel scale, ref)', () => {
    for (const w of ['capability', 'stability', 'costLevel', 'ref']) expect(d).toContain(w);
  });

  it('every input property carries a description; enums match the implementation', () => {
    for (const [k, v] of Object.entries(props)) expect(v.description, k).toBeTruthy();
    expect(props['sortBy']!.enum).toEqual([...SORT_KEYS]);
    expect(props['fields']!.items!.enum).toEqual(['*', ...ALL_FIELDS]);
  });
});
