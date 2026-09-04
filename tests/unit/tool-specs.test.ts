// UT-139 (DES-138, v24): TOOL_SPECS — the 35-row array, args-dependent authz via mode(), fixtures.
// Written test-first (Gate 5, RED) — src/tool-specs.ts does not exist yet.
//
// Mock policy: pure unit, no mocks — TOOL_SPECS is pure data + one projection.
import { describe, it, expect } from 'vitest';
import { TOOL_SPECS, projectToolsList } from '../../src/tool-specs.js';
import { ERROR_CATALOG } from '../../src/errors.js';

const OLD_NAMES = [
  'workflow_run', 'workflow_get', 'blob_put', 'seed_plan', 'asset_push', 'asset_list',
  'asset_delete', 'workflow_artifacts', 'workflow_artifact_get', 'workspace_purge_old',
  'chain_status', 'workflow_trigger', 'mcp_provision', 'workflow_regenerate_diagram',
  'issue_comments',
];

describe('TOOL_SPECS — the v24 tool surface (UT-139, DES-138)', () => {
  it('has exactly 35 rows (REQ-107/ARCH-087/DES-138 — the literal lives here and in 02-architecture only)', () => {
    expect(Array.isArray(TOOL_SPECS)).toBe(true);
    expect(TOOL_SPECS.length).toBe(35);
  });

  it('[T3] every name begins with its own entity prefix (REQ-107)', () => {
    for (const spec of TOOL_SPECS as unknown as Array<{ name: string; entity: string }>) {
      expect(spec.name.startsWith(`${spec.entity}_`)).toBe(true);
    }
  });

  it('every run_* tool with a non-null key is keyed by runId (creators excepted, key: null)', () => {
    for (const spec of TOOL_SPECS as unknown as Array<{ name: string; entity: string; key: string | null }>) {
      if (spec.entity === 'run' && spec.key !== null) {
        expect(spec.key).toBe('runId');
      }
    }
  });

  it('[T3] none of the 15 retired old tool names appear in the array', () => {
    const names = (TOOL_SPECS as unknown as Array<{ name: string }>).map((s) => s.name);
    for (const old of OLD_NAMES) {
      expect(names).not.toContain(old);
    }
  });

  it('[T4] run_start\'s description carries both REQ-117 first-try trap sentences', () => {
    const runStart = (TOOL_SPECS as unknown as Array<{ name: string; description: string }>).find((s) => s.name === 'run_start');
    expect(runStart).toBeDefined();
    expect(runStart!.description).toMatch(/no release/i);
    expect(runStart!.description).toMatch(/poll run_status until terminal/i);
  });

  it('mode() is total for workspace_push — an unrecognized arg shape resolves to \'invalid\', not a crash', () => {
    const push = (TOOL_SPECS as unknown as Array<{ name: string; authz: unknown }>).find((s) => s.name === 'workspace_push');
    expect(push).toBeDefined();
    const authz = push!.authz as { mode?: (args: unknown) => string; rows: Record<string, { minRole: string; ownership: string }> };
    expect(typeof authz.mode).toBe('function');
    const mode = authz.mode!({ nonsense: true });
    expect(mode).toBe('invalid');
    expect(authz.rows[mode]).toEqual({ minRole: 'user', ownership: 'none' });
  });

  it('projectToolsList() is deterministic and appends Errors:/See also: text', () => {
    const a = projectToolsList();
    const b = projectToolsList();
    expect(a).toEqual(b);
    const runStart = a.find((t: { name: string }) => t.name === 'run_start');
    expect(runStart!.description).toContain('Errors:');
  });

  it('every fixture arg-set resolves to a named mode (no fixture hits \'invalid\')', () => {
    for (const spec of TOOL_SPECS as unknown as Array<{ name: string; authz: any; fixture: { happy: unknown } }>) {
      if (spec.authz?.mode) {
        expect(spec.authz.mode(spec.fixture.happy)).not.toBe('invalid');
      }
    }
  });

  it('[B-1, adjudication #3] `version` is a string (the value workflow_register returns), not a number, on workflow_publish/workflow_source/run_start', () => {
    const byName = (n: string) =>
      (TOOL_SPECS as unknown as Array<{ name: string; inputSchema: { properties?: Record<string, { type?: string; description?: string }> } }>).find((s) => s.name === n)!;
    for (const name of ['workflow_publish', 'workflow_source', 'run_start']) {
      const versionProp = byName(name).inputSchema.properties!.version;
      expect(versionProp.type).toBe('string');
      expect(versionProp.description).toMatch(/workflow_register/);
    }
  });

  // v24 (integrator; adjudication (v24) #4 C-6 [21]): DES-137's orphan-code lock ran ONE way — it
  // checked that every code the source throws is a catalog key. It never checked the other
  // direction: a code a tool really can answer but does NOT declare in its own `errors[]`.
  // `workspace_delete` was the found example (`withTerminalRun` throws RUN_NOT_TERMINAL; the row
  // never said so). The consequence is specific and matters for REQ-117: a cold model that only
  // reads `tools/list` cannot anticipate a refusal it will certainly meet. This is the STATIC half
  // — every error fixture's code must be declared by its own row. The RUNTIME half lives in
  // tests/acceptance/v24-tool-surface.test.ts: every code OBSERVED from a real call must be
  // declared too, which is the direction static analysis cannot see.
  it('[C-6] every code a row has an error fixture for is declared in that row\'s own errors[]', () => {
    const undeclared: Array<{ tool: string; code: string }> = [];
    for (const spec of TOOL_SPECS as unknown as Array<{ name: string; errors: readonly string[]; fixture: { errors: Record<string, unknown> } }>) {
      for (const code of Object.keys(spec.fixture.errors)) {
        if (!spec.errors.includes(code)) undeclared.push({ tool: spec.name, code });
      }
    }
    expect(undeclared).toEqual([]);
  });

  it('[C-6] no row declares a code that is not a member of the closed ErrorCode catalog', () => {
    const strays: Array<{ tool: string; code: string }> = [];
    for (const spec of TOOL_SPECS as unknown as Array<{ name: string; errors: readonly string[] }>) {
      for (const code of spec.errors) {
        if (!(code in ERROR_CATALOG)) strays.push({ tool: spec.name, code });
      }
    }
    expect(strays).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// UT-139 (Gate 6.5+7, verifier): the OTHER two mode() functions. `workspace_push`'s is pinned
// above; `workspace_list`'s and `workspace_delete`'s were only ever reached through their happy
// fixtures, so every non-matching arm (including the 'invalid' fall-through that makes them TOTAL)
// was uncovered. Each row asserts BOTH the resolved mode and the authz row it selects — the mode
// name alone proves nothing about who is allowed through.
// ---------------------------------------------------------------------------
type ModedAuthz = { mode: (args: unknown) => string; rows: Record<string, { minRole: string; ownership: string }> };
const moded = (name: string): ModedAuthz => {
  const spec = TOOL_SPECS.find((s) => s.name === name)!;
  const authz = spec.authz as unknown as ModedAuthz;
  expect(typeof authz.mode).toBe('function');
  return authz;
};

describe('TOOL_SPECS — mode() is total on every workspace_* tool (UT-139, DES-138/DES-139)', () => {
  it.each([
    ['workspace_list', { runId: 'r1' }, 'run', { minRole: 'user', ownership: 'run', adminCrossRead: true }],
    ['workspace_list', { workflow: 'w', kind: 'skill' }, 'workflow', { minRole: 'author', ownership: 'workflow' }],
    ['workspace_list', { workflow: 'w' }, 'invalid', { minRole: 'user', ownership: 'none' }],
    ['workspace_list', {}, 'invalid', { minRole: 'user', ownership: 'none' }],
    ['workspace_delete', { runId: 'r1' }, 'run', { minRole: 'user', ownership: 'run' }],
    ['workspace_delete', { scope: 'global', kind: 'skill', name: 'n' }, 'global', { minRole: 'admin', ownership: 'none' }],
    ['workspace_delete', { workflow: 'w', kind: 'skill', name: 'n' }, 'workflow', { minRole: 'author', ownership: 'workflow' }],
    ['workspace_delete', { workflow: 'w', kind: 'skill' }, 'invalid', { minRole: 'user', ownership: 'none' }],
    ['workspace_delete', {}, 'invalid', { minRole: 'user', ownership: 'none' }],
  ])('%s %o resolves to mode %s', (tool, args, expectedMode, expectedRow) => {
    const authz = moded(tool as string);
    const mode = authz.mode(args);
    expect(mode).toBe(expectedMode);
    expect(authz.rows[mode]).toEqual(expectedRow);
  });

  it.each(['workspace_push', 'workspace_list', 'workspace_delete'])('%s mode() never throws on a hostile arg shape and always names a declared row', (tool) => {
    const authz = moded(tool);
    for (const args of [null, undefined, 'a string', 42, [], { runId: undefined }, { scope: 'global' }]) {
      const mode = authz.mode(args);
      expect(Object.keys(authz.rows)).toContain(mode);
    }
  });
});
