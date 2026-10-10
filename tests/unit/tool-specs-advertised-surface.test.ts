// Issue #98 (guard for the whole class): `tools/list` drifted from actual server behaviour four
// separate times (items 1-9 of the issue) because nothing walked TOOL_SPECS checking its OWN three
// promises against itself: (a) a property it advertises in `inputSchema` is one the server-side
// validator actually accepts (never silently refused "additional properties" — the #98 item 1
// shape: `models_probe`'s advertised `alias` param the server rejected); (b) a code listed in a
// tool's `errors[]` is a real, catalogued code; (c) an UPPER_SNAKE code named in a tool's hand-
// written description prose is a real, catalogued code (never a typo'd/retired one a cold client
// would learn to branch on and then never see).
//
// Deliberately NOT the `call-tool.ts` `validateArgs` function itself (that file is out of this
// task's edited-file scope) — this mirrors its Ajv construction byte-for-byte (`allErrors: false,
// strict: false`, `call-tool.ts:27`) and compiles the SAME `spec.inputSchema` objects it compiles,
// so it exercises identical ajv behaviour without importing across the scope line.
//
// Mock policy (unit): pure data assertions over TOOL_SPECS/ERROR_CATALOG — no I/O, no server boot,
// deterministic and fast (the issue's own requirement for this guard).
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { ERROR_CATALOG } from '../../src/errors.js';

const ajv = new Ajv({ allErrors: false, strict: false });

type JSONSchema = Record<string, unknown>;

/** A type/shape-conforming dummy value for ONE property's own schema — just enough to satisfy
 *  ajv's structural keywords (type/enum/const/pattern/nested required) so a validation failure can
 *  only be attributed to `additionalProperties`, never to an unrelated type mismatch this generator
 *  introduced itself. Not a general JSON-Schema fuzzer — TOOL_SPECS' property schemas are simple
 *  enough (no `$ref`, no numeric `pattern`-only strings besides the one hex-64 case) that a small
 *  fixed table covers every real site; a schema shape this cannot handle fails LOUD (a thrown
 *  error), not silently, so a new shape does not slip past unnoticed.
 */
function dummyFor(propSchema: unknown): unknown {
  if (propSchema === null || typeof propSchema !== 'object') return {};
  const s = propSchema as JSONSchema;
  if (Array.isArray(s['enum']) && (s['enum'] as unknown[]).length > 0) return (s['enum'] as unknown[])[0];
  if ('const' in s) return s['const'];
  if (Array.isArray(s['oneOf']) && (s['oneOf'] as unknown[]).length > 0) return dummyFor((s['oneOf'] as unknown[])[0]);
  if (Array.isArray(s['anyOf']) && (s['anyOf'] as unknown[]).length > 0) return dummyFor((s['anyOf'] as unknown[])[0]);
  if (Array.isArray(s['allOf']) && (s['allOf'] as unknown[]).length > 0) return dummyFor((s['allOf'] as unknown[])[0]);
  const type = s['type'];
  if (type === 'null') return null;
  if (type === 'boolean') return true;
  if (type === 'integer' || type === 'number') {
    return typeof s['minimum'] === 'number' ? s['minimum'] : 1;
  }
  if (type === 'string') {
    const pattern = s['pattern'];
    if (pattern === '^[0-9a-f]{64}$') return '0'.repeat(64);
    // Service accounts spec (owner decision 2026-10-03): service_account_create's name grammar.
    if (pattern === '^[a-z0-9][a-z0-9-]{1,40}$') return 'xx';
    if (typeof pattern === 'string') throw new Error(`tool-specs-advertised-surface.test.ts: unhandled string pattern "${pattern}" — add a dummyFor() case for it`);
    return 'x';
  }
  if (type === 'array') return []; // TOOL_SPECS declares no minItems anywhere (UT-213's own floor).
  if (type === 'object') {
    const required = Array.isArray(s['required']) ? (s['required'] as string[]) : [];
    const props = (s['properties'] as Record<string, unknown> | undefined) ?? {};
    const obj: Record<string, unknown> = {};
    for (const key of required) obj[key] = dummyFor(props[key]);
    return obj;
  }
  // No `type` keyword at all (e.g. run_start's `args`/`overrides`) — ajv's `type` check is simply
  // absent, so any JSON value satisfies it; `{}` is always valid there.
  return {};
}

/** The branches a whole-schema validation must be checked against — `workspace_push`'s two CLOSED
 *  `oneOf` arms have almost disjoint `properties`/`required` (DES-155), so a payload built to
 *  satisfy arm A and then tested with an arm-B-only property added would fail as "additional
 *  properties" against EVERY arm — a false positive this walk must not produce (a payload for
 *  testing a given property must be minimal-valid FOR THE BRANCH THAT DECLARES IT, never the
 *  tool's single `fixture.happy`, which only ever satisfies one arm). A schema with no top-level
 *  `oneOf` is its own one branch. */
function branchesOf(schema: JSONSchema): JSONSchema[] {
  return Array.isArray(schema['oneOf']) ? (schema['oneOf'] as JSONSchema[]) : [schema];
}

function minimalPayloadFor(branch: JSONSchema): Record<string, unknown> {
  const required = Array.isArray(branch['required']) ? (branch['required'] as string[]) : [];
  const props = (branch['properties'] as Record<string, unknown> | undefined) ?? {};
  const obj: Record<string, unknown> = {};
  for (const key of required) obj[key] = dummyFor(props[key]);
  return obj;
}

function validateArgs(schema: JSONSchema, args: unknown): string | null {
  const validate = ajv.compile(schema);
  if (validate(args)) return null;
  const err = validate.errors?.[0];
  return err ? `${err.instancePath || '(root)'} ${err.message}` : 'invalid arguments';
}

describe('(a) every advertised inputSchema property is accepted by server-side validation, never "additional properties" (issue #98 guard)', () => {
  for (const spec of TOOL_SPECS) {
    const branches = branchesOf(spec.inputSchema as JSONSchema);
    for (const [branchIndex, branch] of branches.entries()) {
      const props = (branch['properties'] as Record<string, unknown> | undefined) ?? {};
      for (const propName of Object.keys(props)) {
        const label = branches.length > 1 ? `${spec.name} (oneOf[${branchIndex}])` : spec.name;
        it(`${label}.${propName} is accepted, not refused as an unknown/additional property`, () => {
          const payload = { ...minimalPayloadFor(branch), [propName]: dummyFor(props[propName]) };
          const error = validateArgs(spec.inputSchema as JSONSchema, payload);
          const flaggedAsAdditional = error !== null && /additional propert/i.test(error);
          expect(flaggedAsAdditional, `${label}.${propName}: ${error}`).toBe(false);
        });
      }
    }
  }
});

describe('(b) every code in a tool\'s errors[] is a real ERROR_CATALOG key (issue #98 guard)', () => {
  it('no tool advertises an uncatalogued error code', () => {
    const offenders: Array<{ tool: string; code: string }> = [];
    for (const spec of TOOL_SPECS) {
      for (const code of spec.errors) {
        if (!(code in ERROR_CATALOG)) offenders.push({ tool: spec.name, code });
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('(c) every UPPER_SNAKE token in a tool\'s hand-written description is a real code (issue #98 guard)', () => {
  // Multi-segment only (>=2 underscore-joined parts) — a bare acronym (POST, CAS, LR, JSON, USD,
  // MCP, HTTP) is not code-shaped and must not be flagged.
  const UPPER_SNAKE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
  // Genuine non-codes that are still multi-segment UPPER_SNAKE tokens in hand-written prose:
  // `RegistrationWarning` codes (a DIFFERENT closed union from `ErrorCode` — `result.warnings`,
  // never `result.error.code`) and schema/type vocabulary named for the reader's benefit, not
  // thrown anywhere.
  const ALLOWLIST = new Set([
    'BASH_SUBSUMES_FILE_TOOLS', 'BASH_READONLY_UNENFORCEABLE', // RegistrationWarning codes
    'MODEL_CATALOG_UNVERIFIED', 'MODEL_TOOL_USE_UNVERIFIED',   // ditto (run_start/workflow_register warnings)
    'AGENT_FAILED', // dash-auth-spec.md section C (2026-09-30): a run_result.meta.warnings code —
    // same "different closed union from ErrorCode" shape as the RegistrationWarning codes above.
    'AGENT_STILL_RUNNING', // issue #162(1) (2026-10-10): a run_result/run_status meta.warnings
    // code, same shape as AGENT_FAILED immediately above — not an ErrorCode.
    'MCP_SERVER_NOT_CONNECTED', // issue #106: a harness warning (run_agent_log harness.warnings,
    // run_status.warnings) — same "not an ErrorCode" shape.
    'MEMORY_FILE_PATH', // issue #126 B: @modelcontextprotocol/server-memory's own env var name,
    // used in workspace_push's description as the ${run:dir} worked example — not an engine code.
    'ASSET_CLEANUP_INCOMPLETE', // issue #166 decision 1: a `result.warning` literal on an
    // otherwise-successful workflow_deregister/workspace_delete — same "not an ErrorCode" shape
    // as the RegistrationWarning codes above.
  ]);
  for (const spec of TOOL_SPECS) {
    it(`${spec.name}: every UPPER_SNAKE token in its description is a catalogued code or allowlisted`, () => {
      const tokens = new Set(spec.description.match(UPPER_SNAKE) ?? []);
      const offenders = [...tokens].filter((t) => !(t in ERROR_CATALOG) && !ALLOWLIST.has(t));
      expect(offenders, `${spec.name} description names unknown token(s): ${offenders.join(', ')}`).toEqual([]);
    });
  }
});

// DOC-1 (issue #160/#162, independent-verifier finding, 2026-10-10 reverify-3): run_result's
// description must also document a run_suspend/run_stop-aborted attempt (reason:'aborted') — the
// prior round's test change only added AGENT_STILL_RUNNING to the allowlist above, pinning
// nothing about this specific sentence. Without a pin, a later edit that drops it regresses
// silently (no test goes red), which is exactly what the tester kept re-finding.
describe('(d) DOC-1 guard: run_result documents the aborted-attempt reason, same as run_status already does (issue #160/#162 reverify finding)', () => {
  it("run_result's description literally mentions reason:'aborted'", () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'run_result')!;
    expect(spec.description).toMatch(/reason:'aborted'/);
  });

  it("run_status's description literally mentions reason:'aborted' too (regression guard, already true)", () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'run_status')!;
    expect(spec.description).toMatch(/reason:'aborted'/);
  });
});
