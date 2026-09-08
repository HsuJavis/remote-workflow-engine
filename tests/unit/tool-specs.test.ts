// UT-175 (DES-170, ARCH-110, TASK-175, v26): `tools/list`'s `run_start` schema describes all three
// seed shapes with real item schemas (today `seed`/`seedManifest` are bare `{type:'array'}` with no
// `items`, which is exactly how issue #64's `[{path, sha256}]` slipped past — a caller reading
// `tools/list` alone cannot tell `contentB64` is required). Written test-first (Gate 5, RED): the
// current schema carries no `items` key on `seed`/`seedManifest` and no `pattern` on
// `seedManifestRef`.
// Mock policy (unit): pure data assertion over TOOL_SPECS, no I/O.
import { describe, it, expect } from 'vitest';
import { TOOL_SPECS } from '../../src/tool-specs.js';

function runStartSchema() {
  const spec = TOOL_SPECS.find((s) => s.name === 'run_start');
  if (!spec) throw new Error('run_start not found in TOOL_SPECS');
  return (spec.inputSchema as any).properties;
}

describe('run_start tools/list schema describes all three seed shapes (UT-175, DES-170)', () => {
  it('seed.items requires path and describes contentB64 as REQUIRED base64', () => {
    const props = runStartSchema();
    const items = props.seed?.items;
    expect(items).toBeDefined();
    expect(items.required).toContain('path');
    expect(items.properties?.contentB64?.description).toMatch(/base64/i);
  });

  it('seedManifest.items requires path and sha256 with a hex-64 pattern', () => {
    const props = runStartSchema();
    const items = props.seedManifest?.items;
    expect(items).toBeDefined();
    expect(items.required).toEqual(expect.arrayContaining(['path', 'sha256']));
    expect(items.properties?.sha256?.pattern).toBe('^[0-9a-f]{64}$');
  });

  it('seedManifest.items exec is an optional boolean', () => {
    const props = runStartSchema();
    const items = props.seedManifest?.items;
    expect(items.properties?.exec?.type).toBe('boolean');
  });

  it('seedManifestRef is a hex-64 string pattern', () => {
    const props = runStartSchema();
    expect(props.seedManifestRef?.type).toBe('string');
    expect(props.seedManifestRef?.pattern).toBe('^[0-9a-f]{64}$');
  });

  it('budget schema description says "seed elements carry bytes inline as contentB64" pointing seed-only callers at seedManifest', () => {
    const props = runStartSchema();
    expect(props.seed?.items?.properties?.contentB64?.description).toMatch(/seedManifest/);
  });
});
