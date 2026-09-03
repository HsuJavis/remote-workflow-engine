// UT-109 (TASK-115, DES-128, ARCH-078): `getTriggerBindings(name, ports)` — one projected
// cross-store snapshot over three narrow ports (schedules/webhooks/continuations) plus a `runs` port
// for the chain-upstream join, composed into `{bindings, bindingsFp}`. The webhooks port type carries
// NO `secret`, NO `id` (security invariant: the snapshot feeds an LLM prompt) — enforced in the TYPE.
//
// Mock policy (unit, DES-119): plain object-literal ports, no SQLite (per TASK-115's own dod) — pure
// composition + fingerprint, no I/O.
//
// Red reason: `src/trigger-bindings.ts` does not exist yet → MODULE NOT FOUND at collect time.
import { describe, it, expect } from 'vitest';
import { getTriggerBindings, type TriggerPorts } from '../../src/trigger-bindings.js';

function ports(overrides: Partial<TriggerPorts> = {}): TriggerPorts {
  return {
    schedules: { listByWorkflow: () => [] },
    webhooks: { listByWorkflow: () => [] },
    continuations: { listPendingByWorkflow: () => [] },
    runs: { getWorkflowName: () => null },
    ...overrides,
  };
}

describe('getTriggerBindings — composition (UT-109, DES-128, ARCH-078)', () => {
  it('cron + webhook + chain compose into one array', () => {
    const { bindings } = getTriggerBindings('wf', ports({
      schedules: { listByWorkflow: () => [{ cron: '0 3 * * *', tz: 'UTC', enabled: true }] },
      webhooks: { listByWorkflow: () => [{ enabled: true }] },
      continuations: { listPendingByWorkflow: () => [{ afterRunId: 'run-1' }] },
      runs: { getWorkflowName: () => 'upstream-wf' },
    }));
    expect(bindings).toEqual([
      { kind: 'cron', cron: '0 3 * * *', tz: 'UTC', enabled: true },
      { kind: 'webhook', enabled: true },
      { kind: 'chain', upstreamWorkflow: 'upstream-wf' },
    ]);
  });

  it('a `runs` port returning null still emits {kind:"chain", upstreamWorkflow:null} — never an invented name', () => {
    const { bindings } = getTriggerBindings('wf', ports({
      continuations: { listPendingByWorkflow: () => [{ afterRunId: 'run-purged' }] },
      runs: { getWorkflowName: () => null },
    }));
    expect(bindings).toEqual([{ kind: 'chain', upstreamWorkflow: null }]);
  });

  it('no bindings at all yields an empty array', () => {
    const { bindings } = getTriggerBindings('wf', ports());
    expect(bindings).toEqual([]);
  });
});

describe('getTriggerBindings — canonical fingerprint (UT-109, DES-128)', () => {
  it('the same rows returned in a DIFFERENT ORDER produce the IDENTICAL bindingsFp', () => {
    const a = getTriggerBindings('wf', ports({
      schedules: { listByWorkflow: () => [{ cron: '0 3 * * *', enabled: true }, { cron: '0 4 * * *', enabled: false }] },
    }));
    const b = getTriggerBindings('wf', ports({
      schedules: { listByWorkflow: () => [{ cron: '0 4 * * *', enabled: false }, { cron: '0 3 * * *', enabled: true }] },
    }));
    expect(a.bindingsFp).toBe(b.bindingsFp);
  });

  it('adding a schedule changes bindingsFp', () => {
    const before = getTriggerBindings('wf', ports());
    const after = getTriggerBindings('wf', ports({
      schedules: { listByWorkflow: () => [{ cron: '0 3 * * *', enabled: true }] },
    }));
    expect(after.bindingsFp).not.toBe(before.bindingsFp);
  });

  it('a null vs a named upstreamWorkflow produce DIFFERENT fingerprints — null is serialised, not omitted', () => {
    const withNull = getTriggerBindings('wf', ports({
      continuations: { listPendingByWorkflow: () => [{ afterRunId: 'r1' }] },
      runs: { getWorkflowName: () => null },
    }));
    const withName = getTriggerBindings('wf', ports({
      continuations: { listPendingByWorkflow: () => [{ afterRunId: 'r1' }] },
      runs: { getWorkflowName: () => 'upstream' },
    }));
    expect(withNull.bindingsFp).not.toBe(withName.bindingsFp);
  });
});

describe('getTriggerBindings — type-level security invariant (DES-128)', () => {
  it('a webhooks port whose element type carries `secret` or `id` is a tsc error (compile-time only; asserted here as a documentation case)', () => {
    // @ts-expect-error — TriggerPorts['webhooks'] must NOT accept an element shape with `secret`/`id`;
    // if this ever type-checks, the security invariant (no secret reaches the LLM prompt) has regressed.
    const bad: TriggerPorts['webhooks'] = { listByWorkflow: () => [{ enabled: true, secret: 'hmac-secret', id: 'wh-1' }] };
    expect(bad).toBeDefined();
  });
});
