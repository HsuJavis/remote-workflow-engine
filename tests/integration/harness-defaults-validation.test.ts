// IT-081 (DES-099, DES-100, ARCH-062, TASK-089): harness defaults bound at registration —
// register-time validation depth [D-AUTH-5 named assertions: do not simplify].
//
// Cases (D-AUTH-5 named assertions per DES-099/ARCH-062):
//   D-AUTH-5-A: unknown key in defaults → HARNESS_DEFAULTS_INVALID + store nothing
//   D-AUTH-5-B: model alias unresolvable (not in alias table) → HARNESS_DEFAULTS_INVALID + store nothing
//   D-AUTH-5-C: tool name not in curated static allowlist → HARNESS_DEFAULTS_INVALID + store nothing
//   D-AUTH-5-D: skills existence DEFERRED to run time (register with unknown skill succeeds)
//   D-AUTH-5-E: no partial write on invalid (invalid model + valid timeoutMs → nothing stored)
//   backward-compat: defaults absent (pre-v15 shape) → registers exactly as before
//   valid defaults: known alias + allowed tool → registers; workflow_get returns defaults
//   run-time merge: workflow_run with per-run override wins per-param; missing keys fall back
//
// Named assertion IDs per D-AUTH-5 (trace.py parseable):
//   D-AUTH-5-A (unknown-key-reject), D-AUTH-5-B (model-alias-resolvable-reject),
//   D-AUTH-5-C (unknown-tool-reject), D-AUTH-5-D (skills-deferred-to-run),
//   D-AUTH-5-E (no-partial-write-on-invalid)
//
// Red reason: `workflow_register` does not yet accept a `defaults` field → HARNESS_DEFAULTS_INVALID
//   never returned → assertions for invalid defaults fail (success when failure expected). Correct RED.
//
// Mock policy (integration): real server + real SQLite catalog; injected aliases for alias-resolvable test.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it081-'));
  // Inject a known alias set for predictable validation testing
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    aliases: {
      sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
      opus: { provider: 'anthropic', model: 'claude-opus-4-5' },
      default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    },
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

const SCRIPT = 'return "test";';

describe('Harness defaults register-time validation — D-AUTH-5 named assertions (DES-099, IT-081)', () => {
  // D-AUTH-5-A: unknown key in defaults → HARNESS_DEFAULTS_INVALID + store nothing
  it('D-AUTH-5-A (unknown-key-reject): unknown defaults key → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-unknown-key',
      script: SCRIPT,
      defaults: { unknownField: 'bad-value' },  // not in HarnessDefaults schema
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  it('D-AUTH-5-A: after invalid registration, workflow is NOT stored', async () => {
    const r = await callTool('workflow_get', { name: 'it081-unknown-key' });
    expect(r.code).toBe('WORKFLOW_NOT_FOUND');
  });

  // D-AUTH-5-B: model alias unresolvable → HARNESS_DEFAULTS_INVALID + store nothing
  it('D-AUTH-5-B (model-alias-resolvable-reject): unknown model alias → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-bad-alias',
      script: SCRIPT,
      defaults: { model: 'gpt-99-ultra' },  // not in the alias table
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  it('D-AUTH-5-B: after invalid model registration, workflow is NOT stored', async () => {
    const r = await callTool('workflow_get', { name: 'it081-bad-alias' });
    expect(r.code).toBe('WORKFLOW_NOT_FOUND');
  });

  // D-AUTH-5-C: tool not in curated static allowlist → HARNESS_DEFAULTS_INVALID + store nothing
  it('D-AUTH-5-C (unknown-tool-reject): non-allowlisted tool → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-bad-tool',
      script: SCRIPT,
      defaults: { tools: ['bash_exec'] },  // not in the curated tool allowlist
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  // D-AUTH-5-D: skill existence deferred to run time → register succeeds
  it('D-AUTH-5-D (skills-deferred-to-run): unknown skill name → register SUCCEEDS', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-skill-deferred',
      script: SCRIPT,
      defaults: { skills: ['skill-that-does-not-exist-yet'] },
    });
    // Skills are mutable per-run uploaded assets; existence is deferred, not rejected
    expect(r.code).not.toBe('HARNESS_DEFAULTS_INVALID');
    expect(r.error).toBeUndefined();
  });

  // D-AUTH-5-E: no partial write on invalid (invalid model + valid timeoutMs → nothing stored)
  it('D-AUTH-5-E (no-partial-write-on-invalid): mixed valid+invalid → HARNESS_DEFAULTS_INVALID, nothing stored', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-partial-write',
      script: SCRIPT,
      defaults: { timeoutMs: 30_000, model: 'gpt-99-ultra' },  // timeoutMs valid, model invalid
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
    // Nothing stored — not even the valid fields
    const check = await callTool('workflow_get', { name: 'it081-partial-write' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });

  // v21 Gate 6.5+7 coverage-gate extension (adjudication #6 F-1 widen, 35e6994): the `effort`/
  // `appendPrompt` shape guards added alongside `HarnessDefaults`'s two new keys had no covering
  // case for the top-level `defaults.appendPrompt` door specifically (as opposed to the
  // `meta.params.knobs.appendPrompt.default` door IMPL-146's probe already covers) — a non-string
  // value must be refused here too, not just accepted and crash later at dispatch.
  it('v21 F-1: defaults.appendPrompt must be a string → HARNESS_DEFAULTS_INVALID, nothing stored', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-append-not-string',
      script: SCRIPT,
      defaults: { appendPrompt: 7 },  // number, not a string
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
    const check = await callTool('workflow_get', { name: 'it081-append-not-string' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });

  // v21 Gate 6.5+7 coverage-gate extension: `validateHarnessDefaults` (v15, `harness-defaults.ts`)
  // is a function this round's diff (`2e58d86`'s `isKnownAlias` swap) modified, so the whole-function
  // 95% bar applies — its other pre-existing shape guards (model/timeoutMs/prompt/tools/skills) had
  // never had a covering case either (a pre-v21 gap, never caught because this file was never in a
  // prior round's diff). One case per guard, same shape-rejection pattern as the appendPrompt case above.
  it('defaults.model must be a string → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', { name: 'it081-model-not-string', script: SCRIPT, defaults: { model: 7 } });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  it('defaults.timeoutMs must be a number → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', { name: 'it081-timeout-not-number', script: SCRIPT, defaults: { timeoutMs: 'soon' } });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  it('defaults.prompt must be a string → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', { name: 'it081-prompt-not-string', script: SCRIPT, defaults: { prompt: 7 } });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  it('defaults.tools must be an array → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', { name: 'it081-tools-not-array', script: SCRIPT, defaults: { tools: 'Read' } });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  it('defaults.skills must be an array → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', { name: 'it081-skills-not-array', script: SCRIPT, defaults: { skills: 'my-skill' } });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  // Backward-compat: defaults absent (pre-v15 shape) registers normally
  it('backward-compat: defaults absent (pre-v15) → registers exactly as before', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-no-defaults',
      script: SCRIPT,
      // no `defaults` field
    });
    expect(r.error).toBeUndefined();
    expect(r.code).not.toBe('HARNESS_DEFAULTS_INVALID');
    expect(typeof r.version).toBe('number');
  });

  // Valid defaults: known alias + known tool → registers; workflow_get returns defaults
  it('valid defaults with known alias + allowed tool → registers and is queryable', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-valid-defaults',
      script: SCRIPT,
      defaults: { model: 'sonnet', timeoutMs: 60_000, tools: ['read_file'] },
    });
    expect(r.error).toBeUndefined();
    expect(r.code).not.toBe('HARNESS_DEFAULTS_INVALID');

    const got = await callTool('workflow_get', { name: 'it081-valid-defaults' });
    const defaults = (got as { defaults?: { model?: string; timeoutMs?: number; tools?: string[] } }).defaults;
    expect(defaults?.model).toBe('sonnet');
    expect(defaults?.timeoutMs).toBe(60_000);
    expect(defaults?.tools).toContain('read_file');
  });

  // Run-time merge: per-run override wins per-param; missing keys fall back to registered
  it('run-time merge: per-run timeoutMs wins; model falls back to registered', async () => {
    // Register with defaults
    await callTool('workflow_register', {
      name: 'it081-merge-test',
      script: `return {model: args.__harnessModel, timeout: args.__harnessTimeout};`,
      defaults: { model: 'opus', timeoutMs: 120_000 },
    });

    // Run with timeoutMs override but no model override
    const runResult = await callTool('workflow_run', {
      name: 'it081-merge-test',
      timeoutMs: 5_000,  // per-run override
      // model not overridden → should fall back to 'opus'
    });
    expect(typeof runResult.runId).toBe('string');
    // (Full merge verification via workflow_status is an acceptance-tier concern — IT verifies the
    //  register endpoint returns the stored defaults correctly and run doesn't HARNESS_DEFAULTS_INVALID)
    expect(runResult.code).not.toBe('HARNESS_DEFAULTS_INVALID');
  });
});

// v21 (ARCH-067, DES-103, TASK-099): meta.params contract declaration + discoverability (REQ-090),
// the ON CONFLICT stale-contract trap, ceiling-bounded read surfaces, pre-eval source-size guard.
//
// Red reason: `catalog.register()`/`meta.params` parsing does not exist yet — a `params` block is
// silently ignored (no PARAM_CONTRACT_INVALID ever returned, workflow_get never returns `.params`).
describe('meta.params contract — registration, discoverability, ceilings (REQ-090, IT-081 v21)', () => {
  it('a script whose meta.params constrains model to an enum registers and is queryable via workflow_get', async () => {
    const script = `export const meta = { description: 'x', params: { knobs: { model: { type: 'enum', enum: ['sonnet','haiku'] } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'it081-params-model-enum', script });
    expect(r.code).not.toBe('HARNESS_DEFAULTS_INVALID');
    expect(r.error).toBeUndefined();

    const got = await callTool('workflow_get', { name: 'it081-params-model-enum' });
    const params = (got as { params?: { knobs?: Record<string, { enum?: string[] }> } }).params;
    expect(params?.knobs?.['model']?.enum).toEqual(['sonnet', 'haiku']);
  });

  it('a meta.params block naming a LOCKED key (tools) → registration rejected, nothing stored', async () => {
    const script = `export const meta = { description: 'x', params: { knobs: { tools: { type: 'string' } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'it081-params-locked-key', script });
    expect(r.error).toBeDefined();

    const check = await callTool('workflow_get', { name: 'it081-params-locked-key' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('a script with NO params block reads back workflow_get.params as the canonical 4-knob contract, ceiling-bounded (never null/unbounded)', async () => {
    await callTool('workflow_register', { name: 'it081-no-params-block', script: 'return 1;' });
    const got = await callTool('workflow_get', { name: 'it081-no-params-block' });
    const params = (got as { params?: { knobs?: Record<string, unknown> } }).params;
    expect(params).toBeDefined();
    expect(Object.keys(params?.knobs ?? {}).sort()).toEqual(['appendPrompt', 'effort', 'model', 'timeoutMs'].sort());
  });

  // ON CONFLICT trap (DES-103): the existing UPSERT updates script/version/createdAt/defaults and
  // deliberately omits owner — copying that pattern without adding `params` leaves a STALE contract
  // on re-register (silent, no error). Pinned: re-register with a CHANGED params block must show
  // the NEW contract, not the old one.
  it('re-registering with a CHANGED params block updates the stored contract (ON CONFLICT trap)', async () => {
    const v1 = `export const meta = { params: { knobs: { model: { type: 'enum', enum: ['sonnet'] } } } };\nreturn 1;`;
    await callTool('workflow_register', { name: 'it081-params-reregister', script: v1 });
    const v2 = `export const meta = { params: { knobs: { model: { type: 'enum', enum: ['sonnet','opus'] } } } };\nreturn 2;`;
    await callTool('workflow_register', { name: 'it081-params-reregister', script: v2 });

    const got = await callTool('workflow_get', { name: 'it081-params-reregister' });
    const params = (got as { params?: { knobs?: Record<string, { enum?: string[] }> } }).params;
    expect(params?.knobs?.['model']?.enum).toEqual(['sonnet', 'opus']);
  });

  // Pre-eval source-size guard (DES-103/DES-101): measured on the matched meta LITERAL TEXT before
  // runInNewContext — an oversized params block is rejected at registration, never silently truncated.
  it('an oversized meta.params block (> 4KB literal text) is rejected at registration, nothing stored', async () => {
    const hugeEnum = Array.from({ length: 400 }, (_, i) => `"alias-${i}-${'x'.repeat(6)}"`).join(',');
    const script = `export const meta = { params: { knobs: { model: { type: 'enum', enum: [${hugeEnum}] } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'it081-params-oversized', script });
    expect(r.error).toBeDefined();

    const check = await callTool('workflow_get', { name: 'it081-params-oversized' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });
});

// RETIRED (2026-09-01, orchestrator adjudication #6, 04-design.md "Orchestrator adjudication #6"):
// this describe block ("meta.params model-enum vs a default-alias (unconfigured) server —
// registration vocabulary parity (DES-101, B4)") asserted that a model-enum entry absent from the
// alias table SHOULD register on an unconfigured/default server. `tests/integration/
// params-admission.test.ts`'s newer P-A2 describe block ("registration is fed the SAME alias table
// admission enforces") pins the adjudicated-correct, OPPOSITE outcome for the identical scenario
// (registration and admission now share DEFAULT_ALIASES, so an unresolvable alias is rejected at
// registration on the default deployment too — "register succeeds, every run fails" is exactly the
// defect P-A2 exists to kill). Two suites pinning contradictory expectations for the same setup make
// the green suite stop meaning anything; removed per the adjudication rather than left to bit-rot.

// v21 Gate 5 re-run (2026-08-31, A-2 / 04-design.md "Orchestrator adjudication — v21 Gate 6
// send-back"): cross-validated defaults. `spec.default` is read NOWHERE in src/params/contract.ts
// today, so the whole `default` vocabulary is inert end-to-end — registration neither cross-checks
// a declared default against `defaults.<knob>` nor normalizes an unpaired declared default into the
// stored `defaults` column. Genuine v21 red (not yet implemented).
describe('meta.params default cross-validation (DES-103, REQ-090, v21 Gate 5 re-run A-2)', () => {
  it('(a) a declared default that DISAGREES with defaults.<knob> -> typed rejection, nothing stored', async () => {
    const script = `export const meta = { params: { knobs: { timeoutMs: { type: 'number', default: 5000 } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', {
      name: 'it081-a2-default-mismatch', script, defaults: { timeoutMs: 6000 },
    });
    expect(r.error).toBeDefined();

    const check = await callTool('workflow_get', { name: 'it081-a2-default-mismatch' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('(b) a declared default violating that knob\'s OWN declared enum -> typed rejection, nothing stored', async () => {
    // effort's declared enum is ['low','medium']; the declared default 'max' is outside it.
    const script = `export const meta = { params: { knobs: { effort: { type: 'enum', enum: ['low','medium'], default: 'max' } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'it081-a2-default-out-of-range', script });
    expect(r.error).toBeDefined();

    const check = await callTool('workflow_get', { name: 'it081-a2-default-out-of-range' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('(c) a declared default with NO corresponding defaults.<knob> -> accepted, normalized into the stored defaults column', async () => {
    const script = `export const meta = { params: { knobs: { timeoutMs: { type: 'number', default: 5000 } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'it081-a2-default-normalize', script });
    expect(r.error).toBeUndefined();

    const got = await callTool('workflow_get', { name: 'it081-a2-default-normalize' });
    const defaults = (got as { defaults?: { timeoutMs?: number } }).defaults;
    // The served default must be DERIVED from the defaults column (so the two can never diverge) —
    // not merely echoed back from params.knobs.timeoutMs.default.
    expect(defaults?.timeoutMs).toBe(5000);
  });

  // v21 GATE 8 RE-REVIEW #3 re-run (2026-09-01, review §P2 P-A3 ≡ adversarial A3, re-run scope (c)
  // — registration/round-trip half; the dispatch-inertness half lives in
  // `tests/integration/params-admission.test.ts`'s own P-A3 describe block): `effort`/`appendPrompt`
  // are NOT in `harness-defaults.ts`'s `KNOWN_KEYS` (`{model,tools,skills,timeoutMs,prompt}`), yet
  // the effectiveDefaults loop (workflow-catalog.ts:130-142) stores them in the SAME `defaults`
  // column and `workflow_get` serves them back verbatim — a real author/UI performing the
  // documented discover -> edit -> re-register workflow on the engine's OWN served `defaults`
  // hits `HARNESS_DEFAULTS_INVALID: Unknown harness defaults key: "effort"`.
  //
  // Value note (2026-09-01 integrator closeout, adjudication #7): this case was authored with
  // `enum: ['low','max'], default: 'max'` and run against the shared `beforeAll` server, whose
  // `maxEffort` is the compiled-in default `'high'` — so once adjudication #6's ceiling wiring
  // landed, `'max'` could never round-trip HERE, and the case failed for a reason it does not
  // exist to test. The ceiling behaviour is pinned by its own dedicated pair below, on a server
  // configured `maxEffort:'low'` ("above the ceiling is rejected" / "at or below registers fine").
  // Only the literals changed — `'high'` is the highest effort this server's declared ceiling
  // admits, so every assertion below keeps its original strength and still exercises exactly the
  // P-A3 defect (an author `effort` default through KNOWN_KEYS, normalized, served, re-registered).
  it('(e) discover -> edit -> re-register round-trip succeeds on the engine\'s OWN served defaults, including an author-declared effort default (P-A3, review §P2 (c))', async () => {
    const script = `export const meta = { params: { knobs: { effort: { type: 'enum', enum: ['low','high'], default: 'high' } } } };\nreturn 1;`;
    const first = await callTool('workflow_register', { name: 'it081-pa3-roundtrip', script });
    expect(first.error).toBeUndefined();

    const got = await callTool('workflow_get', { name: 'it081-pa3-roundtrip' });
    const servedDefaults = (got as { defaults?: Record<string, unknown> }).defaults;
    expect(servedDefaults?.['effort']).toBe('high'); // sanity: the normalized default IS served

    // Re-register using the engine's OWN served `defaults` verbatim — the exact discover -> edit ->
    // save round-trip a real author/UI performs. Must succeed, never HARNESS_DEFAULTS_INVALID.
    const second = await callTool('workflow_register', { name: 'it081-pa3-roundtrip', script, defaults: servedDefaults });
    expect(second.error).toBeUndefined();
    expect((second as { code?: string }).code).not.toBe('HARNESS_DEFAULTS_INVALID');
  });
});

// v21 GATE 8 RE-REVIEW #3 re-run (2026-09-01, review §P2 P-A4 ≡ adversarial A4, re-run scope (d)):
// a declared `knobs.model.default` bypasses D-AUTH-5-B alias validation because knob-default
// normalization (workflow-catalog.ts:130-142) runs AFTER `validateHarnessDefaults` — the CALLER's
// own `defaults` argument is alias-checked, but a `model.default` with NO corresponding
// `defaults.model` (declared only via `params.knobs.model.default`, no `enum`) is injected into
// `effectiveDefaults` afterward with no alias check at all. On a configured-alias deployment, a
// non-alias `model.default` registers successfully and every named run of it is refused only later
// (run-manager.ts:424's post-merge R-G2 backstop) — the register-time control that should make this
// impossible-by-construction never fires.
describe('meta.params model.default bypasses D-AUTH-5-B alias validation (DES-101, P-A4, review §P2 (d))', () => {
  it('a model.default naming an alias absent from a CONFIGURED alias table is rejected AT REGISTRATION, not admitted then refused only at run time', async () => {
    const script = `export const meta = { params: { knobs: { model: { type: 'string', default: 'not-a-real-alias-xyz' } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'it081-pa4-bad-model-default', script });
    expect(r.error).toBeDefined();

    const got = await callTool('workflow_get', { name: 'it081-pa4-bad-model-default' });
    expect(got.code).toBe('WORKFLOW_NOT_FOUND'); // fail-closed: nothing stored
  });

  // Regression pin: a model.default naming a REAL configured alias must keep registering fine.
  it('regression pin: a model.default naming a real configured alias registers fine', async () => {
    const script = `export const meta = { params: { knobs: { model: { type: 'string', default: 'sonnet' } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'it081-pa4-good-model-default', script });
    expect(r.error).toBeUndefined();
  });
});

// v21 orchestrator adjudication #6 (2026-09-01, 04-design.md "Orchestrator adjudication #6" F-1
// "Ceiling interaction"): "an author `effort` default above the configured `maxEffort` … is bounded
// exactly like any other declared value — no special case for author-side defaults." Today's
// `WorkflowCatalog.register()` never receives `Ceilings` at all (only `violatesOwnSpec` — a knob's
// OWN declared enum/range — is checked; `server.ts`'s `ceilings` object is threaded only to
// `RunManager`/`McpFacade`, never to the catalog) — a declared default can exceed the engine's own
// ceiling and still register. Genuine v21 red: not yet implemented.
//
// Note: the "over ceiling" case below currently PASSES too, but for the WRONG reason — the
// still-present adjudication-#5 E-3 rejection at workflow-catalog.ts:142 rejects EVERY `effort`
// default outright (P-A3), regardless of any ceiling. Its companion "at/below ceiling" case is what
// isolates genuine ceiling behavior (RED today): once Gate 6 removes the E-3 rejection AND wires
// ceilings into registration, "over" must stay rejected (now specifically by the ceiling) while
// "at/below" must newly succeed — the pair only means something correct together.
describe('meta.params declared default vs the ENGINE ceiling (not just its own spec) — F-1 ceiling interaction (2026-09-01 adjudication #6)', () => {
  it('an effort.default above the server\'s configured maxEffort ceiling is rejected at registration, not silently stored above the ceiling', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rwe-it081-ceiling-'));
    const lowCeilingServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmp, maxEffort: 'low' });
    try {
      const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
        const res = await fetch(`http://127.0.0.1:${lowCeilingServer.port}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        });
        const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
        return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      };
      const script = `export const meta = { params: { knobs: { effort: { type: 'enum', enum: ['low','max'], default: 'max' } } } };\nreturn 1;`;
      const r = await call('workflow_register', { name: 'it081-ceiling-effort-over', script });
      expect(r.error).toBeDefined(); // passes today, but only because E-3 rejects every effort default

      const got = await call('workflow_get', { name: 'it081-ceiling-effort-over' });
      expect(got.code).toBe('WORKFLOW_NOT_FOUND'); // fail-closed: nothing stored
    } finally {
      await lowCeilingServer.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Genuine red (isolates ceiling behavior from the E-3 blanket rejection above): an effort.default
  // AT OR BELOW the ceiling must register fine once E-3 is removed per adjudication #6.
  it('an effort.default at or below the ceiling registers fine', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rwe-it081-ceiling-ok-'));
    const lowCeilingServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmp, maxEffort: 'low' });
    try {
      const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
        const res = await fetch(`http://127.0.0.1:${lowCeilingServer.port}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        });
        const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
        return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      };
      const script = `export const meta = { params: { knobs: { effort: { type: 'enum', enum: ['low'], default: 'low' } } } };\nreturn 1;`;
      const r = await call('workflow_register', { name: 'it081-ceiling-effort-ok', script });
      expect(r.error).toBeUndefined();
    } finally {
      await lowCeilingServer.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// v21 orchestrator adjudication #7 G-1 (2026-09-01, 04-design.md "Orchestrator adjudication #7"):
// THE CEILING HOLE THE F-1 WIDENING OPENED. The registration-time ceiling check runs only inside the
// loop over *declared* knobs (`params.knobs.<key>.default`), so a CALLER-supplied
// `defaults: { effort: 'max' }` — or an over-byte `defaults.appendPrompt` — passed to
// `workflow_register` with NO `params.knobs` block at all bypasses it entirely.
// `validateHarnessDefaults` cannot close it either: it validates shape and enum membership and has
// no access to the ceilings. Admission never re-checks it (`validateUserOverrides` loops over the
// CALLER's `overrides`, never over the registered `defaults`), so the value is enforced nowhere and
// the run dispatches above the engine's own ceiling — the advertised-bound ≠ enforced-bound class
// for the third time this iteration (P-A2, R-G3).
//
// Oracle: the ceilings are the ones this test's own `createServer({ maxEffort, maxAppendPromptBytes })`
// config declares — the external contract — never a value read back out of the code under test. Each
// case pins BOTH ends against that same configured number *behaviourally*: the identical value is
// refused at registration AND at admission, and the value AT the bound is accepted at both. (The
// bound cannot be compared field-by-field across the two rungs: `toErrEnvelope` (mcp-facade.ts:38)
// serializes only `{code, message}`, so the `detail.maxBytes` admission reports never crosses the
// MCP boundary. Refusing/accepting at the same boundary value is the strongest pin this surface
// supports, and it is what "advertised bound == enforced bound" actually means to a caller.)
describe('caller-supplied `defaults` are bounded by the engine ceilings even with NO params block — G-1 (2026-09-01 adjudication #7)', () => {
  let g1Server: Server;
  let g1Tmp: string;
  // The configured ceilings — this test's contract, asserted literally at both rungs below.
  const MAX_EFFORT = 'low';
  const MAX_APPEND_BYTES = 64;
  const NO_PARAMS_SCRIPT = 'return await agent("hi");'; // deliberately NO `meta.params` block

  beforeAll(async () => {
    g1Tmp = mkdtempSync(join(tmpdir(), 'rwe-it081-g1-'));
    g1Server = await createServer({
      port: 0,
      bind: '127.0.0.1',
      workRoot: g1Tmp,
      maxEffort: MAX_EFFORT,
      maxAppendPromptBytes: MAX_APPEND_BYTES,
      aliases: {
        sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      },
    });
  });

  afterAll(async () => {
    await g1Server?.close();
    rmSync(g1Tmp, { recursive: true, force: true });
  });

  async function g1Call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`http://127.0.0.1:${g1Server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
  }

  it('a caller-supplied defaults.effort above maxEffort, with no params block, is refused at registration — the SAME ceiling admission enforces', async () => {
    const r = await g1Call('workflow_register', {
      name: 'it081-g1-effort-over', script: NO_PARAMS_SCRIPT, defaults: { effort: 'max' },
    });
    expect(r.error).toBeDefined();

    const got = await g1Call('workflow_get', { name: 'it081-g1-effort-over' });
    expect(got.code).toBe('WORKFLOW_NOT_FOUND'); // fail-closed: nothing stored

    // The other end of the same bound: the identical value is refused at the admission rung, and
    // the value AT the configured ceiling is accepted there — the same boundary, both rungs.
    await g1Call('workflow_register', { name: 'it081-g1-admission-pin', script: 'return 1;' });
    const over = await g1Call('workflow_run', { name: 'it081-g1-admission-pin', overrides: { effort: 'max' } });
    expect(over.code ?? (over.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');
    const atBound = await g1Call('workflow_run', { name: 'it081-g1-admission-pin', overrides: { effort: MAX_EFFORT } });
    expect(atBound.code).not.toBe('PARAM_OUT_OF_RANGE');
  });

  it('a caller-supplied defaults.effort AT the ceiling still registers fine (isolates the ceiling from a blanket rejection)', async () => {
    const r = await g1Call('workflow_register', {
      name: 'it081-g1-effort-ok', script: NO_PARAMS_SCRIPT, defaults: { effort: MAX_EFFORT },
    });
    expect(r.error).toBeUndefined();

    const got = await g1Call('workflow_get', { name: 'it081-g1-effort-ok' });
    expect((got as { defaults?: Record<string, unknown> }).defaults?.['effort']).toBe(MAX_EFFORT);
  });

  it('a caller-supplied defaults.appendPrompt over maxAppendPromptBytes, with no params block, is refused at registration against the SAME byte bound admission reports', async () => {
    const overByOne = 'x'.repeat(MAX_APPEND_BYTES + 1); // ASCII: 1 char == 1 byte
    const r = await g1Call('workflow_register', {
      name: 'it081-g1-append-over', script: NO_PARAMS_SCRIPT, defaults: { appendPrompt: overByOne },
    });
    expect(r.error).toBeDefined();

    const got = await g1Call('workflow_get', { name: 'it081-g1-append-over' });
    expect(got.code).toBe('WORKFLOW_NOT_FOUND'); // fail-closed: nothing stored

    // Admission enforces the same byte bound registration just refused against: over-by-one is
    // refused there too, and exactly-at-the-bound is accepted at both rungs.
    await g1Call('workflow_register', { name: 'it081-g1-append-admission-pin', script: 'return 1;' });
    const over = await g1Call('workflow_run', {
      name: 'it081-g1-append-admission-pin', overrides: { appendPrompt: overByOne },
    });
    expect(over.code ?? (over.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');
    const atBound = await g1Call('workflow_run', {
      name: 'it081-g1-append-admission-pin', overrides: { appendPrompt: 'x'.repeat(MAX_APPEND_BYTES) },
    });
    expect(atBound.code).not.toBe('PARAM_OUT_OF_RANGE');
  });

  it('a caller-supplied defaults.appendPrompt AT the byte ceiling still registers fine', async () => {
    const r = await g1Call('workflow_register', {
      name: 'it081-g1-append-ok', script: NO_PARAMS_SCRIPT, defaults: { appendPrompt: 'x'.repeat(MAX_APPEND_BYTES) },
    });
    expect(r.error).toBeUndefined();
  });
});

// v21 Gate 8 RE-REVIEW #5 (F1, MED, review §S7 (a) — "the red case must construct the
// post-normalization object"): the SAME `openrouter/<id>` passthrough string gets OPPOSITE answers
// depending on which door it registers through. Door 1 — a script-declared `params.knobs.model.
// default` — is validated by `contract.ts`'s `isKnownAlias` (has the `openrouter/*` passthrough
// carve-out) and already accepts it (regression pin below). Door 2 — a caller-supplied top-level
// `defaults.model` field — is validated by `harness-defaults.ts`'s own hand-rolled strict
// `aliasNames.has()` check (D-AUTH-5-B, NO passthrough carve-out) and rejects the identical string
// today. Both doors register a "declared default for model" against the SAME non-empty, configured
// alias table this file's `beforeAll` sets up — they must agree.
describe('meta.params.model.default vs top-level defaults.model — the SAME alias predicate on both doors (v21 Gate 8 RE-REVIEW #5, F1)', () => {
  const OPENROUTER_MODEL = 'openrouter/anthropic/claude-3.5-sonnet';

  it('regression pin: the openrouter passthrough string as a DECLARED KNOB default (params.knobs.model.default) already registers fine', async () => {
    const script = `export const meta = { params: { knobs: { model: { type: 'string', default: '${OPENROUTER_MODEL}' } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'it081-f1-openrouter-knob-default', script });
    expect(r.error).toBeUndefined();
  });

  it('the SAME openrouter passthrough string as a caller-supplied top-level defaults.model must give the SAME answer (today: HARNESS_DEFAULTS_INVALID — no passthrough carve-out on this door)', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-f1-openrouter-defaults-field',
      script: SCRIPT,
      defaults: { model: OPENROUTER_MODEL },
    });
    expect(r.error).toBeUndefined();
    expect(r.code).not.toBe('HARNESS_DEFAULTS_INVALID');
  });
});

// v21 Gate 8 closeout (2026-09-01, integrator): §S7's F1 prescription had a SECOND half — delete
// the early `validateHarnessDefaults(defaults)` call and re-run it unconditionally over
// `effectiveDefaults` after the knob-default normalization loop. Measured at HEAD with half 1
// (`isKnownAlias` in `harness-defaults.ts`) already in the tree, the reorder closes NO hole in the
// production composition and BREAKS the origin-keyed rejection convention §S7 itself says to
// preserve (`workflow-catalog.ts:175-180`). This block pins the measurement so the reorder cannot
// be re-applied silently on a future pass — the reason two implementers reached opposite answers
// was that neither conclusion was pinned by a test.
//
// The two facts pinned, and why each is the real contract rather than an echo of the code:
//   1. NO HOLE. `effectiveDefaults` ⊇ `defaults` by construction: the normalization loop only ever
//      writes a key ABSENT from `defaults` (`if (key in effectiveDefaults)` throws on disagreement
//      instead of overwriting), so every caller-supplied key is exactly what the early call already
//      validated. The only values `validateHarnessDefaults` never sees are params-origin knob
//      defaults — and `parseParamContract` confines those to TUNABLE_KEYS ⊂ KNOWN_KEYS, so
//      D-AUTH-5-A can never fire on them, while type/membership is covered by the ceiling loop
//      (`effectiveBounds(canonicalContract(), ceilings)` carries the canonical per-knob type and
//      the effort enum) and the model alias by `contract.ts`'s own `model.default` check.
//   2. ORIGIN-KEYED CODES. The convention is stated in `workflow-catalog.ts:175-180` and restated
//      as a constraint in review §S7 ("preserving the origin-keyed rejection codes"): a value the
//      CALLER supplied in `defaults` answers under the D-AUTH-5 family's HARNESS_DEFAULTS_INVALID
//      naming `defaults.<k>`; a value the AUTHOR declared in the script answers under
//      PARAM_CONTRACT_INVALID naming `params.knobs.<k>.default`. The rejection must name back an
//      input the caller actually sent. Applying the reorder was measured to flip every
//      params-origin rejection below to HARNESS_DEFAULTS_INVALID / "defaults.effort …" — telling a
//      script author about a `defaults` field they never wrote — with the full suite still green,
//      because nothing pinned it. Now something does.
describe('a declared knob default is refused under its OWN origin code, not the caller-defaults one (v21 Gate 8 closeout — §S7 F1 half 2 superseded by measurement)', () => {
  // Asserted literally against the two documented rejection codes, not against whatever
  // register() happens to emit: DES-099's D-AUTH-5 family vs DES-101's contract-parse family.
  const CALLER_ORIGIN_CODE = 'HARNESS_DEFAULTS_INVALID';
  const AUTHOR_ORIGIN_CODE = 'PARAM_CONTRACT_INVALID';
  const codeOf = (r: Record<string, unknown>): string | undefined =>
    (r.code as string | undefined) ?? (r.error as { code?: string } | undefined)?.code;

  // `'ultra'` is not a member of EFFORT_RANK at any ceiling, and the spec's own `type:'string'`
  // declaration admits it — so it reaches `effectiveDefaults` having passed `violatesOwnSpec`.
  // This is precisely the value class `validateHarnessDefaults` would catch and never sees.
  const JUNK_EFFORT_SCRIPT =
    `export const meta = { params: { knobs: { effort: { type: 'string', default: 'ultra' } } } };\nreturn 1;`;

  it('a params-origin effort default outside the effort enum is refused at registration, nothing stored (no hole for half 2 to close)', async () => {
    const r = await callTool('workflow_register', { name: 'it081-f1h2-effort-junk', script: JUNK_EFFORT_SCRIPT });
    expect(r.error).toBeDefined();

    const got = await callTool('workflow_get', { name: 'it081-f1h2-effort-junk' });
    expect(got.code).toBe('WORKFLOW_NOT_FOUND'); // fail-closed: nothing stored
  });

  it('...and it answers under the AUTHOR origin code naming params.knobs.effort.default, never the caller-defaults code', async () => {
    const r = await callTool('workflow_register', { name: 'it081-f1h2-effort-junk-code', script: JUNK_EFFORT_SCRIPT });
    expect(codeOf(r)).toBe(AUTHOR_ORIGIN_CODE);
    expect(codeOf(r)).not.toBe(CALLER_ORIGIN_CODE);
    expect(JSON.stringify(r)).toContain('params.knobs.effort.default');
    expect(JSON.stringify(r)).not.toContain('defaults.effort');
  });

  it('the SAME junk supplied as a caller `defaults.effort` answers under the CALLER origin code — the two doors stay distinguishable', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-f1h2-effort-junk-caller', script: SCRIPT, defaults: { effort: 'ultra' },
    });
    expect(codeOf(r)).toBe(CALLER_ORIGIN_CODE);
    expect(JSON.stringify(r)).toContain('defaults.effort');

    const got = await callTool('workflow_get', { name: 'it081-f1h2-effort-junk-caller' });
    expect(got.code).toBe('WORKFLOW_NOT_FOUND'); // fail-closed: nothing stored
  });
});
