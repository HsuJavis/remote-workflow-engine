// UT-139 (DES-138, v24): TOOL_SPECS — the 35-row array, args-dependent authz via mode(), fixtures.
// Written test-first (Gate 5, RED) — src/tool-specs.ts does not exist yet.
//
// Mock policy: pure unit, no mocks — TOOL_SPECS is pure data + one projection.
import { describe, it, expect } from 'vitest';
import { TOOL_SPECS, projectToolsList } from '../../src/tool-specs.js';

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
});
