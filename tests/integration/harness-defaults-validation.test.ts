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
  it('(e) discover -> edit -> re-register round-trip succeeds on the engine\'s OWN served defaults, including an author-declared effort default (P-A3, review §P2 (c))', async () => {
    const script = `export const meta = { params: { knobs: { effort: { type: 'enum', enum: ['low','max'], default: 'max' } } } };\nreturn 1;`;
    const first = await callTool('workflow_register', { name: 'it081-pa3-roundtrip', script });
    expect(first.error).toBeUndefined();

    const got = await callTool('workflow_get', { name: 'it081-pa3-roundtrip' });
    const servedDefaults = (got as { defaults?: Record<string, unknown> }).defaults;
    expect(servedDefaults?.['effort']).toBe('max'); // sanity: the normalized default IS served

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
