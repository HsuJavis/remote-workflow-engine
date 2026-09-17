// UT-245 (DES-202, ARCH-124/125/130, TASK-206, REQ-131): `lib/connection.js` — a reducer
// (`nextConnection`), a `worstOf`, and a response classifier (`classifyResponse`) — all pure.
// `offline` only after >= 2 CONSECUTIVE all-fail ticks (one transient miss during a self-update
// restart must not paint the whole team's tabs red).
// [housekeeping, v28 Gate 5] this header used to say "UT-244" (a copy-paste off-by-one from the
// sibling `dashboard-lib-strings.test.js`, the same class of drift UT-244's own header already
// records having been caught and fixed once) — corrected to UT-245 to match 05-tests.md, which is
// what `trace.py` reads; harmless until now because nothing greps this comment.
//
// Tier: unit, `.js` — a literal-fixture transition table (mock policy v27, never the function's
// own output as the oracle).
//
// [stale, kept as history per this ledger's convention] original v27 red reason: `src/dashboard/
// lib/connection.js` did not exist (whole-file import failure). The three functions above are
// green at HEAD; see the v28 note below for what is red NOW.
//
// [v28 Gate 5, DES-211/DES-212, TASK-218/220, REQ-142/143] two pure additions to this SAME file,
// beside the three functions above (`nextConnection`/`worstOf`/`classifyResponse` stay
// byte-unchanged per DES-211's own boundary clause): `resumeReset(prev)` (REQ-142 — a pause
// invalidates a PARTIAL fail streak but never a DECLARED offline verdict) and `demoEngages(verdict,
// reachedFlags, datasetLoaded)` (REQ-143 — demo engages only when NOTHING was reached AND the
// dataset is loaded AND the verdict already reads offline). Red reason (measured against HEAD):
// neither export exists on `src/dashboard/lib/connection.js` today — vitest/esbuild's transform
// resolves the missing names to `undefined` at import time rather than throwing at link time (no
// strict-ESM enforcement here), so each new case fails individually with `TypeError: resumeReset
// is not a function` / `TypeError: demoEngages is not a function` at its own call site: 26 total,
// 14 failed (exactly the 5 resumeReset + 9 demoEngages cases below), 12 pre-existing pass unchanged.
import { describe, it, expect } from 'vitest';
import { nextConnection, worstOf, classifyResponse, resumeReset, demoEngages } from '../../src/dashboard/lib/connection.js';

const INITIAL = { status: 'checking', consecutiveFails: 0, perRoute: {} };

describe('lib/connection.js: nextConnection transition table (UT-245, DES-202)', () => {
  it('checking -> live on any ok result', () => {
    const next = nextConnection(INITIAL, { results: { runs: 'ok' } });
    expect(next.status).toBe('live');
    expect(next.consecutiveFails).toBe(0);
  });

  // [v27c AC-4 Gate 8 repair] this case used to assert "an ok result still wins" — that reading of
  // ARCH-124's api let a genuinely degraded route hide behind an unrelated healthy one (worstOf's
  // export at :9-15 had no caller). The tag now shows the WORST status among the routes the
  // visible view depends on. Shape is the WORKFLOW view's own tick (`poll.js`'s
  // `endpointsFor('workflow', ctx)`: `describe` + `/api/runs`) — the exact scenario that crashed
  // `ui/workflow.js`'s `onTick` before the AC-4 repair (val-199-workflow-detail.test.ts).
  it('degraded wins over a healthy sibling route (describe ok, runs degraded -> tag degraded)', () => {
    const live = { status: 'live', consecutiveFails: 0, perRoute: {} };
    const next = nextConnection(live, { results: { '/api/workflows/wf/describe': 'ok', '/api/runs': 'degraded' } });
    expect(next.status).toBe('degraded');
    expect(next.consecutiveFails).toBe(0);
  });

  it('a failing route beside a healthy or degraded one reports degraded, not offline-tracked (only a UNANIMOUS fail counts)', () => {
    const live = { status: 'live', consecutiveFails: 0, perRoute: {} };
    const mixedOkFail = nextConnection(live, { results: { runs: 'ok', issues: 'fail' } });
    expect(mixedOkFail.status).toBe('degraded');
    expect(mixedOkFail.consecutiveFails).toBe(0);
  });

  it('live -> degraded on a worst-degraded tick (no ok, at least one degraded)', () => {
    const live = { status: 'live', consecutiveFails: 0, perRoute: {} };
    const next = nextConnection(live, { results: { runs: 'degraded' } });
    expect(next.status).toBe('degraded');
  });

  // [BF-1 Gate 8 repair] this case used to assert "live -> live (not offline)" on one all-fail
  // tick — that reading let a page keep claiming 「連線中 / Live」 for a full 3s interval where
  // EVERY route failed (ARCH-124's api as amended: `live` only when EVERY route is `ok`). The
  // debounce clause constrains the transition to `offline`, not the retention of `live`: the
  // counter still advances, but the FIRST unanimous-fail tick reports `degraded`.
  it('live -> degraded (consecutiveFails 1) on ONE all-fail tick', () => {
    const live = { status: 'live', consecutiveFails: 0, perRoute: {} };
    const next = nextConnection(live, { results: { runs: 'fail' } });
    expect(next.status).toBe('degraded');
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

describe('lib/connection.js: classifyResponse (UT-245, DES-202)', () => {
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

// UT-245 [v28 Gate 5, DES-211, TASK-218, REQ-142]: `resumeReset(prev)` — REQ-142's "切回立即輪詢
// 一次,並恢復 3 秒節奏" needs the RESUMED streak to start clean, but never at the cost of forgetting
// a verdict `nextConnection` already declared (a page hidden for an hour must not paint "連線中"
// over a genuinely dead engine the moment it is re-shown). These three sequences are the exact
// scenarios DES-211's own boundary names, driven through the REAL `nextConnection` above rather
// than asserted as isolated calls, because the bug this guards is a WIRING bug (calling
// `resumeReset` at the wrong point in the tick), not a bug in `resumeReset` read alone.
describe('lib/connection.js: resumeReset(prev) — a pause invalidates a PARTIAL streak, never a DECLARED offline verdict (UT-245, DES-211)', () => {
  it('fail -> pause -> fail: the streak restarts, so ONE more fail after a pause reads degraded, not offline', () => {
    let state = { status: 'live', consecutiveFails: 0, perRoute: {} };
    state = nextConnection(state, { results: { a: 'fail' } }); // degraded, consecutiveFails:1
    state = resumeReset(state); // pause — partial streak invalidated
    state = nextConnection(state, { results: { a: 'fail' } });
    expect(state.status).toBe('degraded');
    expect(state.consecutiveFails).toBe(1);
  });

  it('fail -> fail -> pause -> fail: offline is a DECLARED verdict — a pause does not un-declare it, so the next fail stays offline', () => {
    let state = { status: 'live', consecutiveFails: 0, perRoute: {} };
    state = nextConnection(state, { results: { a: 'fail' } }); // degraded, 1
    state = nextConnection(state, { results: { a: 'fail' } }); // offline, 2
    expect(state.status).toBe('offline');
    state = resumeReset(state); // pause — offline is NOT reset
    state = nextConnection(state, { results: { a: 'fail' } });
    expect(state.status).toBe('offline');
  });

  it('fail -> fail -> pause -> ok: a real recovery still reads live regardless of the pause', () => {
    let state = { status: 'live', consecutiveFails: 0, perRoute: {} };
    state = nextConnection(state, { results: { a: 'fail' } });
    state = nextConnection(state, { results: { a: 'fail' } }); // offline
    state = resumeReset(state);
    state = nextConnection(state, { results: { a: 'ok' } });
    expect(state.status).toBe('live');
    expect(state.consecutiveFails).toBe(0);
  });

  it('an offline input is returned as the SAME object — status is never touched, not even reassigned to its own value', () => {
    const offline = { status: 'offline', consecutiveFails: 5, perRoute: { a: 'fail' } };
    expect(resumeReset(offline)).toBe(offline);
  });

  it('a live/degraded/checking input gets a NEW object with consecutiveFails reset to 0 and status left alone', () => {
    const degraded = { status: 'degraded', consecutiveFails: 1, perRoute: { a: 'fail' } };
    const reset = resumeReset(degraded);
    expect(reset).not.toBe(degraded);
    expect(reset).toEqual({ status: 'degraded', consecutiveFails: 0, perRoute: { a: 'fail' } });
  });
});

// UT-245 [v28 Gate 5, DES-212, TASK-220, REQ-143]: `demoEngages(verdict, reachedFlags,
// datasetLoaded)` — ADR-058's all-or-nothing entry gate. The one corner that "bites" (an empty
// route set) is named separately per TASK-220's own dod: `nextConnection`'s sibling guard at
// `connection.js:30` needed the identical `values.length > 0` fix once already, and a vacuous
// `[].every(...)` returning `true` would let a view with NO endpoints of its own engage demo mode
// on the very first tick.
describe('lib/connection.js: demoEngages(verdict, reachedFlags, datasetLoaded) — the 2^3 corners (UT-245, DES-212)', () => {
  it('offline + every route unreached + dataset loaded -> true (the ONE true corner)', () => {
    expect(demoEngages('offline', [false, false], true)).toBe(true);
  });
  it('offline + every route unreached + dataset NOT loaded -> false', () => {
    expect(demoEngages('offline', [false, false], false)).toBe(false);
  });
  it('offline + one route WAS reached (a real fail, not a network drop) + loaded -> false', () => {
    expect(demoEngages('offline', [false, true], true)).toBe(false);
  });
  it('offline + one route reached + not loaded -> false', () => {
    expect(demoEngages('offline', [false, true], false)).toBe(false);
  });
  it('not offline (degraded) + every route unreached + loaded -> false', () => {
    expect(demoEngages('degraded', [false, false], true)).toBe(false);
  });
  it('not offline (live) + every route unreached + not loaded -> false', () => {
    expect(demoEngages('live', [false, false], false)).toBe(false);
  });
  it('not offline + one route reached + loaded -> false', () => {
    expect(demoEngages('degraded', [false, true], true)).toBe(false);
  });
  it('not offline + one route reached + not loaded -> false', () => {
    expect(demoEngages('live', [false, true], false)).toBe(false);
  });
  it('an EMPTY route set never engages demo, even offline + loaded (the vacuous-every hazard)', () => {
    expect(demoEngages('offline', [], true)).toBe(false);
  });
});
