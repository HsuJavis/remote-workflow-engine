// UT-348 (DES-271, ARCH-188/189, TASK-268): the params contract for `decisions`/`images` blocks —
// `PrimitiveParamSpec` (model/timeoutMs/retries, all required, no `effort`), `MAX_PRIMITIVE_RETRIES`,
// declared⇔used per block with ITS OWN code, `model.default` must start `openrouter/`.
//
// Interface note (this file PROPOSES the extension point, per TDD's "the test specifies the
// interface" — DES-271 names the data shapes but not `parseParamContract`'s exact call signature
// for primitive script-labels): a 4th, OPTIONAL parameter `primitiveLabels: {decide: string[];
// generateImage: string[]}`, defaulting to `{decide: [], generateImage: []}` so every EXISTING
// 3-arg call site (agent-only contracts) is untouched — the INV-V40-1 "no edit to any pre-existing
// agent test" rule this ledger's other v40 entries also follow.
//
// Red reason: `parseParamContract` takes no 4th argument yet and `ParamContract` has no
// `decisions`/`images` fields — every case below either gets `undefined` back for `.decisions`/
// `.images` or the DES-271 refusal never fires; `MAX_PRIMITIVE_RETRIES` is not exported.
import { describe, it, expect } from 'vitest';
import { parseParamContract, MAX_PRIMITIVE_RETRIES } from '../../src/params/contract.js';

const VALID_AGENT_SPEC = { model: { type: 'string' as const, default: 'anthropic/claude-sonnet-5' }, effort: { type: 'enum' as const, default: 'medium' }, timeoutMs: { type: 'number' as const, default: 60000 } };

describe('UT-348: MAX_PRIMITIVE_RETRIES (DES-271)', () => {
  it('is exported and equals 5 (a code constant, not a Ceilings field)', () => {
    expect(MAX_PRIMITIVE_RETRIES).toBe(5);
  });
});

describe('UT-348: decisions/images declared<=>used (DES-271)', () => {
  it('a decide() call with no params.decisions.<label> declaration is refused DECISION_UNDECLARED', () => {
    const r = parseParamContract({ agents: {} }, [], { decide: ['gate'], generateImage: [] } as never) as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DECISION_UNDECLARED');
  });

  it('a declared decisions.<label> with no matching decide() call is refused DECISION_DECLARED_NOT_IN_SCRIPT', () => {
    const r = parseParamContract(
      { agents: {}, decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 2 } } } },
      [], { decide: [], generateImage: [] } as never,
    ) as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DECISION_DECLARED_NOT_IN_SCRIPT');
  });

  it('a generateImage() call with no params.images.<label> declaration is refused IMAGE_UNDECLARED', () => {
    const r = parseParamContract({ agents: {} }, [], { decide: [], generateImage: ['hero'] } as never) as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe('IMAGE_UNDECLARED');
  });

  it('a declared+used decide label parses into value.decisions', () => {
    const r = parseParamContract(
      { agents: {}, decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 2 } } } },
      [], { decide: ['gate'], generateImage: [] } as never,
    ) as { ok: true; value: { decisions?: Record<string, unknown> } };
    expect(r.ok).toBe(true);
    expect(r.value.decisions?.['gate']).toBeDefined();
  });

  it('a declared+used image label parses into value.images', () => {
    const r = parseParamContract(
      { agents: {}, images: { hero: { model: { type: 'string', default: 'openrouter/black-forest-labs/flux-1.1-pro' }, timeoutMs: { type: 'number', default: 120000 }, retries: { type: 'number', default: 0 } } } },
      [], { decide: [], generateImage: ['hero'] } as never,
    ) as { ok: true; value: { images?: Record<string, unknown> } };
    expect(r.ok).toBe(true);
    expect(r.value.images?.['hero']).toBeDefined();
  });

  it('an agent-only contract with no decide()/generateImage() calls at all behaves exactly as before (backward compat)', () => {
    const r = parseParamContract({ agents: { a: VALID_AGENT_SPEC } }, ['a']) as { ok: true; value: { agents: Record<string, unknown> } };
    expect(r.ok).toBe(true);
    expect(r.value.agents['a']).toBeDefined();
  });
});

describe('UT-348: model.default must start "openrouter/" (DES-271)', () => {
  it('refuses a decisions.<label>.model.default that is not an openrouter/* ref: PRIMITIVE_PROVIDER_UNSUPPORTED', () => {
    const r = parseParamContract(
      { agents: {}, decisions: { gate: { model: { type: 'string', default: 'anthropic/claude-sonnet-5' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 2 } } } },
      [], { decide: ['gate'], generateImage: [] } as never,
    ) as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PRIMITIVE_PROVIDER_UNSUPPORTED');
  });
});

describe('UT-348: retries bound 0..MAX_PRIMITIVE_RETRIES (DES-271)', () => {
  it('refuses retries.default over MAX_PRIMITIVE_RETRIES, naming "maxRetries 5"', () => {
    const r = parseParamContract(
      { agents: {}, decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 6 } } } },
      [], { decide: ['gate'], generateImage: [] } as never,
    ) as { ok: false; message: string };
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/maxRetries 5/);
  });

  it('accepts retries.default at the boundary (5)', () => {
    const r = parseParamContract(
      { agents: {}, decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 5 } } } },
      [], { decide: ['gate'], generateImage: [] } as never,
    ) as { ok: true };
    expect(r.ok).toBe(true);
  });
});
