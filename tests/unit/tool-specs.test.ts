// UT-175 (DES-170, ARCH-110, TASK-175, v26): `tools/list`'s `run_start` schema describes all three
// seed shapes with real item schemas (today `seed`/`seedManifest` are bare `{type:'array'}` with no
// `items`, which is exactly how issue #64's `[{path, sha256}]` slipped past — a caller reading
// `tools/list` alone cannot tell `contentB64` is required). Written test-first (Gate 5, RED): the
// current schema carries no `items` key on `seed`/`seedManifest` and no `pattern` on
// `seedManifestRef`.
// Mock policy (unit): pure data assertion over TOOL_SPECS, no I/O.
import { describe, it, expect } from 'vitest';
import { TOOL_SPECS, projectToolsList } from '../../src/tool-specs.js';

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

// UT-213 (v26 Gate 7.5 round 1, defect D1): every array-typed property ANYWHERE in TOOL_SPECS
// declares `items`. A bare `{type:'array'}` is not merely under-documented — Google/Gemini-family
// clients reject the WHOLE `tools/list` payload with
// `400 … function_declarations[0].parameters.properties[triggers].items: missing field`, so one
// missing key costs every tool on the surface for a whole client family (observed for real: the
// round-1 cold-model probe died before its first tool call). REQ-121/DES-170 closed this for
// `run_start.seed`; this walk is the drift-lock so the fifth site cannot be added in silence.
// The walk recurses through `properties`/`items`/`oneOf`/`anyOf`/`allOf` — `workspace_push`'s
// `files` lives inside a `oneOf` branch, which a flat top-level scan would miss.
// Mock policy (unit): pure data assertion over TOOL_SPECS, no I/O.
function arraysWithoutItems(node: unknown, path: string): string[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as Record<string, unknown>;
  const found: string[] = [];
  if (n['type'] === 'array' && n['items'] === undefined) found.push(path);
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const branches = n[key];
    if (Array.isArray(branches)) {
      branches.forEach((b, i) => found.push(...arraysWithoutItems(b, `${path}.${key}[${i}]`)));
    }
  }
  const props = n['properties'];
  if (props && typeof props === 'object') {
    for (const [name, sub] of Object.entries(props as Record<string, unknown>)) {
      found.push(...arraysWithoutItems(sub, `${path}.${name}`));
    }
  }
  if (n['items'] !== undefined) found.push(...arraysWithoutItems(n['items'], `${path}[]`));
  return found;
}

describe('every array-typed property in TOOL_SPECS declares items (UT-213, defect D1)', () => {
  it('no tool advertises a bare {type:"array"} on any input schema, at any depth', () => {
    const offenders = TOOL_SPECS.flatMap((s) => arraysWithoutItems(s.inputSchema, s.name));
    expect(offenders).toEqual([]);
  });

  it('the four named round-1 sites each carry an items schema', () => {
    const props = (name: string) =>
      (TOOL_SPECS.find((s) => s.name === name)!.inputSchema as any).properties;
    expect(props('workflow_register').triggers.items.type).toBe('string');
    expect(props('workspace_diff').manifest.items.required).toEqual(expect.arrayContaining(['sha256']));
    expect(props('workspace_delete').paths.items.type).toBe('string');
    const pushModeB = (TOOL_SPECS.find((s) => s.name === 'workspace_push')!.inputSchema as any).oneOf[1];
    expect(pushModeB.properties.files.items.required).toEqual(expect.arrayContaining(['path', 'contentB64']));
  });
});

// UT-266 (v33, REQ-201, TASK-227, DES-222, ARCH-087/091): two SERVED descriptions must teach the
// version loop, because ARCH-087's own rule is "the description text *is* the API" — a cold client
// registered four names in 45 minutes and published every one to `release` within seconds because
// nothing on the tool surface said re-registering a name STACKS a version, and `run_start`'s row
// taught `workflow_publish` first with `{version}` as the fallback (the opposite of the loop a
// just-registered author actually wants). Written test-first (Gate 5, RED): today
// `workflow_register`'s description is "Register a new workflow version under a name; the caller
// becomes its owner." (no "append"/"overwrite" wording) and `run_start`'s description has
// `workflow_publish` BEFORE `{version}` — confirmed by reading src/tool-specs.ts:216,395.
// Mock policy (unit): pure data assertion over projectToolsList()'s SERVED projection, no I/O.
describe('workflow_register/run_start descriptions teach the version loop (UT-266, DES-222, REQ-201)', () => {
  const desc = (name: string) => projectToolsList().find((t) => t.name === name)!.description;

  it('workflow_register states that registering the SAME name appends a version and overwrites nothing', () => {
    // Loose on phrasing deliberately: DES-222 (2) says "registering the SAME name appends a NEW
    // version… overwrites nothing" (no "re-"); ARCH-087/TASK-227 say "re-registering". Pinning the
    // "re-" prefix would fail an implementation that follows DES-222's own wording verbatim.
    const text = desc('workflow_register');
    expect(text).toMatch(/same name/i);
    expect(text).toMatch(/append/i);
    expect(text).toMatch(/overwrite/i);
  });

  it('the derived "See also: workflow_authoring_guide" pointer survives the rewrite (regression guard, not re-typed)', () => {
    expect(desc('workflow_register')).toContain('workflow_authoring_guide');
  });

  it('run_start mentions {version} at a LOWER index than workflow_publish (order, not presence — today both are present in the wrong order)', () => {
    const text = desc('run_start');
    const versionIdx = text.indexOf('{version}');
    const publishIdx = text.indexOf('workflow_publish');
    expect(versionIdx).toBeGreaterThanOrEqual(0);
    expect(publishIdx).toBeGreaterThanOrEqual(0);
    expect(versionIdx).toBeLessThan(publishIdx);
  });

  it('run_start still carries the no-result trap sentence (regression guard)', () => {
    const text = desc('run_start');
    expect(text).toMatch(/returns no result/i);
    expect(text).toMatch(/run_status/);
    expect(text).toMatch(/run_result/);
  });
});
