// Issue #154 B3: a declared `.default` for model/effort/timeoutMs is never checked against the SAME
// agent's own declared `enum`/`min`/`max` — register succeeds, then the IDENTICAL value as a
// run-time override is refused `PARAM_OUT_OF_RANGE`, a self-contradictory contract. `args.*` defaults
// ARE checked against their own spec (`checkValueAgainstSpec`, materializeArgDefaults path) — this
// asymmetry is specifically in the agent model/effort/timeoutMs path (`validateOneAgentSpec`), which
// checks `.default` against the ENGINE ceiling and basic type shape only, never the agent's OWN
// enum/min/max.
//
// RED before the fix: all three cases register `ok: true`.
//
// Mock policy (unit): pure parseParamContract, zero I/O (same tier as params-contract.test.ts).
import { describe, it, expect } from 'vitest';
import { parseParamContract } from '../../src/params/contract.js';
import type { AgentParamSpec } from '../../src/params/contract.js';
import { EMPTY_MODEL_CATALOG } from '../../src/providers.js';

const CATALOG = EMPTY_MODEL_CATALOG;

function baseAgentSpec(overrides: Partial<AgentParamSpec> = {}): AgentParamSpec {
  return {
    model: { type: 'string', default: 'anthropic/claude-sonnet-5' },
    effort: { type: 'enum', default: 'low' },
    timeoutMs: { type: 'number', default: 10_000 },
    ...overrides,
  };
}

describe('#154 B3: an agent\'s model/effort/timeoutMs default must satisfy its OWN declared enum/min/max', () => {
  it('model.default not in the agent\'s OWN enum is refused at registration (not just as a later override)', () => {
    const r = parseParamContract(
      { agents: { plan: baseAgentSpec({ model: { type: 'enum', enum: ['anthropic/claude-haiku-4-5-20251001'], default: 'anthropic/claude-sonnet-5' } }) } },
      ['plan'],
      CATALOG,
    );
    expect(r.ok, 'a default outside the agent\'s own declared model.enum must be refused at registration').toBe(false);
  });

  it('effort.default below the agent\'s OWN enum floor is refused at registration', () => {
    const r = parseParamContract(
      { agents: { plan: baseAgentSpec({ effort: { type: 'enum', enum: ['medium', 'high'], default: 'low' } }) } },
      ['plan'],
      CATALOG,
    );
    expect(r.ok, 'effort.default "low" is not in its own enum ["medium","high"]').toBe(false);
  });

  it('timeoutMs.default below the agent\'s OWN min is refused at registration', () => {
    const r = parseParamContract(
      { agents: { plan: baseAgentSpec({ timeoutMs: { type: 'number', default: 60_000, min: 70_000 } }) } },
      ['plan'],
      CATALOG,
    );
    expect(r.ok, 'timeoutMs.default 60000 is below its own declared min 70000').toBe(false);
  });

  it('timeoutMs.default above the agent\'s OWN max is refused at registration', () => {
    const r = parseParamContract(
      { agents: { plan: baseAgentSpec({ timeoutMs: { type: 'number', default: 500_000, max: 100_000 } }) } },
      ['plan'],
      CATALOG,
    );
    expect(r.ok, 'timeoutMs.default 500000 is above its own declared max 100000').toBe(false);
  });

  it('a default that DOES satisfy its own enum/min/max still registers fine (no false positive)', () => {
    const r = parseParamContract(
      {
        agents: {
          plan: baseAgentSpec({
            model: { type: 'enum', enum: ['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4-5-20251001'], default: 'anthropic/claude-sonnet-5' },
            effort: { type: 'enum', enum: ['low', 'medium', 'high'], default: 'medium' },
            timeoutMs: { type: 'number', default: 50_000, min: 10_000, max: 100_000 },
          }),
        },
      },
      ['plan'],
      CATALOG,
    );
    expect(r.ok).toBe(true);
  });

  it('a spec with no enum/min/max at all (just .default) still registers fine (no false positive)', () => {
    const r = parseParamContract({ agents: { plan: baseAgentSpec() } }, ['plan'], CATALOG);
    expect(r.ok).toBe(true);
  });
});
