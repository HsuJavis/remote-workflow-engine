// UT-299 (DES-243, ARCH-159, TASK-241, REQ-213): `src/event-log.ts` — a `kind`-keyed discriminated
// `EngineEvent` union (exactly the four v36 kinds), `createEventSink({secrets?, write?, now?})`
// emitting ONE `JSON.stringify(redact({...event, at: now()}, secrets))` line per call. Redaction
// lives in the SINK, not the emitters — the only way two emitters in two modules share one audited
// path. `now` is injected (no bare `new Date()`).
//
// Red reason: `src/event-log.ts` does not exist yet — every import below fails module resolution,
// failing the whole file (suite-level red: the module is entirely unimplemented, not a per-case
// logic gap).
//
// Mock policy (unit): pure module — no clock/store/manager; a REAL SecretValueProvider so the
// redaction assertion is not the vacuous "no secrets configured" trap.
import { describe, it, expect } from 'vitest';
import { createEventSink, type EngineEvent } from '../../src/event-log.js';

describe('UT-299: createEventSink — one typed sink, redaction inside it, injected clock', () => {
  it('emits exactly one JSON line per call, with `at` exactly the injected value', () => {
    const lines: string[] = [];
    const sink = createEventSink({ write: (l: string) => lines.push(l), now: () => '2026-09-21T00:00:00.000Z' });
    sink({ kind: 'catalog.register', name: 'wf-a', version: 'v1', actor: { id: 'alice', bypass: false, idSource: 'authenticated' } });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.at).toBe('2026-09-21T00:00:00.000Z');
    expect(parsed.kind).toBe('catalog.register');
  });

  it('a REAL SecretValueProvider redacts a value inside an event field — marker PRESENT, raw value absent', () => {
    const lines: string[] = [];
    const sink = createEventSink({
      write: (l: string) => lines.push(l),
      now: () => '2026-09-21T00:00:00.000Z',
      secrets: { entries: () => [{ name: 'GH_TOKEN', value: 'sekrit-abc' }] },
    });
    sink({ kind: 'catalog.deregister', name: 'sekrit-abc-workflow', version: 'v1', actor: { id: null, bypass: true, idSource: 'none' } });
    expect(lines[0]).toContain('‹secret:GH_TOKEN›');
    expect(lines[0]).not.toContain('sekrit-abc');
  });

  it('defaults to a bare console sink when write/now are omitted (never throws)', () => {
    const sink = createEventSink({});
    expect(() => sink({ kind: 'run.terminal', runId: 'r1', name: null, version: 'v1', outcome: 'completed', principal: null })).not.toThrow();
  });

  it('the four v36 kinds are all constructible and carry their documented fields', () => {
    const lines: string[] = [];
    const sink = createEventSink({ write: (l: string) => lines.push(l), now: () => 't' });
    const events: EngineEvent[] = [
      { kind: 'catalog.register', name: 'a', version: 'v1', actor: { id: 'x', bypass: false, idSource: 'authenticated' } },
      { kind: 'catalog.publish', name: 'a', version: 'v1', channel: 'release', fromVersion: null, actor: { id: 'x', bypass: false, idSource: 'authenticated' } },
      { kind: 'catalog.deregister', name: 'a', version: 'v1', actor: { id: 'x', bypass: true, idSource: 'authenticated' } },
      { kind: 'run.terminal', runId: 'r1', name: 'a', version: 'v1', outcome: 'failed', principal: 'x', code: 'SCRIPT_ERROR' },
    ];
    for (const e of events) sink(e);
    expect(lines).toHaveLength(4);
  });

});

// TYPE GUARANTEE (checked by `tsc --noEmit`, not by vitest — kept as a standalone type-only
// assertion so it does not produce an "unused @ts-expect-error" false-fail while `EngineEvent`
// resolves to `any` pre-implementation, e.g. during this Gate-5 RED baseline): a `kind` missing its
// required `actor` field must be a compile error once `src/event-log.ts` exists.
// @ts-expect-error — 'catalog.register' requires `actor`.
const _typeGuarantee: EngineEvent = { kind: 'catalog.register', name: 'a', version: 'v1' };
void _typeGuarantee;
