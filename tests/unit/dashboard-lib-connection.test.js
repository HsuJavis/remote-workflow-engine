// UT-244 (DES-202, ARCH-124/125/130, TASK-206, REQ-131): `lib/connection.js` — a reducer
// (`nextConnection`), a `worstOf`, and a response classifier (`classifyResponse`) — all pure.
// `offline` only after >= 2 CONSECUTIVE all-fail ticks (one transient miss during a self-update
// restart must not paint the whole team's tabs red).
//
// Tier: unit, `.js` — a literal-fixture transition table (mock policy v27, never the function's
// own output as the oracle).
//
// Red reason (measured): `src/dashboard/lib/connection.js` does not exist (whole-file import
// failure).
import { describe, it, expect } from 'vitest';
import { nextConnection, worstOf, classifyResponse } from '../../src/dashboard/lib/connection.js';

const INITIAL = { status: 'checking', consecutiveFails: 0, perRoute: {} };

describe('lib/connection.js: nextConnection transition table (UT-244, DES-202)', () => {
  it('checking -> live on any ok result', () => {
    const next = nextConnection(INITIAL, { results: { runs: 'ok' } });
    expect(next.status).toBe('live');
    expect(next.consecutiveFails).toBe(0);
  });

  it('live -> live on a degraded-plus-ok tick (an ok result still wins)', () => {
    const live = { status: 'live', consecutiveFails: 0, perRoute: {} };
    const next = nextConnection(live, { results: { runs: 'ok', issues: 'degraded' } });
    expect(next.status).toBe('live');
  });

  it('live -> degraded on a worst-degraded tick (no ok, at least one degraded)', () => {
    const live = { status: 'live', consecutiveFails: 0, perRoute: {} };
    const next = nextConnection(live, { results: { runs: 'degraded' } });
    expect(next.status).toBe('degraded');
  });

  it('live -> live (not offline) after ONE all-fail tick', () => {
    const live = { status: 'live', consecutiveFails: 0, perRoute: {} };
    const next = nextConnection(live, { results: { runs: 'fail' } });
    expect(next.status).toBe('live');
    expect(next.consecutiveFails).toBe(1);
  });

  it('-> offline on the SECOND consecutive all-fail tick', () => {
    const live = { status: 'live', consecutiveFails: 0, perRoute: {} };
    const once = nextConnection(live, { results: { runs: 'fail' } });
    const twice = nextConnection(once, { results: { runs: 'fail' } });
    expect(twice.status).toBe('offline');
  });

  it('offline -> live on a single recovery (an ok result)', () => {
    const offline = { status: 'offline', consecutiveFails: 2, perRoute: {} };
    const next = nextConnection(offline, { results: { runs: 'ok' } });
    expect(next.status).toBe('live');
    expect(next.consecutiveFails).toBe(0);
  });

  it('worstOf over a three-way mix returns the worst of {ok,degraded,fail}', () => {
    expect(worstOf({ a: 'ok', b: 'degraded', c: 'fail' })).toBe('fail');
    expect(worstOf({ a: 'ok', b: 'degraded' })).toBe('degraded');
    expect(worstOf({ a: 'ok' })).toBe('ok');
  });
});

describe('lib/connection.js: classifyResponse (UT-244, DES-202)', () => {
  it('a 200 body carrying a "degraded" string classifies as degraded, never rendered as data', () => {
    expect(classifyResponse(200, { degraded: 'internal dashboard error' })).toBe('degraded');
  });

  it('a plain 200 body classifies as ok', () => {
    expect(classifyResponse(200, { runs: [] })).toBe('ok');
  });

  it('a 404/500 classifies as fail', () => {
    expect(classifyResponse(404, null)).toBe('fail');
    expect(classifyResponse(500, null)).toBe('fail');
  });

  it('an unparseable body never throws — classifies as fail', () => {
    expect(() => classifyResponse(200, undefined)).not.toThrow();
    expect(classifyResponse(200, undefined)).toBe('fail');
  });
});
