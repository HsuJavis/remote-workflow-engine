// src/dashboard/lib/connection.js
// DES-202, ARCH-124/125/130, TASK-206, REQ-131 — a reducer, a worstOf, and a response classifier.
// All pure: no fetch, no system-clock read, no timestamp field kept — `live` requires an `ok`
// THIS tick and therefore cannot go stale by itself.

const RANK = { ok: 0, degraded: 1, fail: 2 };

// The nav tag reads this: the single worst status across a set of routes.
export function worstOf(perRoute) {
  let worst = 'ok';
  for (const status of Object.values(perRoute)) {
    if (RANK[status] > RANK[worst]) worst = status;
  }
  return worst;
}

// [v27c AC-4 Gate 8 repair] The tag shows the WORST status among the routes the visible view
// depends on (ARCH-124's api), via `worstOf` — not "any `ok` wins outright" (the pre-repair
// behaviour, which let one healthy route mask a degraded/failing sibling the tag is supposed to
// report on). Only when EVERY route in the tick failed does the consecutive-failure counter move:
// `offline` only at >= 2 in a row, so one transient miss (e.g. a self-update restart) does not
// paint the whole team's tabs red — a mix of `fail` and something better than `fail` (`ok` or
// `degraded`) is reported as `degraded` immediately, never counted toward the offline streak.
export function nextConnection(prev, tick) {
  const values = Object.values(tick.results);
  const worst = worstOf(tick.results);
  if (worst === 'ok') {
    return { status: 'live', consecutiveFails: 0, perRoute: tick.results };
  }
  const allFail = values.length > 0 && values.every((s) => s === 'fail');
  if (!allFail) {
    return { status: 'degraded', consecutiveFails: 0, perRoute: tick.results };
  }
  const consecutiveFails = prev.consecutiveFails + 1;
  // [BF-1 Gate 8 repair] the counter alone tracks the offline streak — `status` reports what THIS
  // tick observed (`degraded` at 1, matching the not-all-fail branch above), never `prev.status`
  // carried forward. A page that was `live` must not keep claiming it through a whole 3s interval
  // where EVERY route failed (ARCH-124's api: `live` only when EVERY route is `ok`).
  const status = consecutiveFails >= 2 ? 'offline' : 'degraded';
  return { status, consecutiveFails, perRoute: tick.results };
}

// A 200 whose body carries a `degraded` string classifies as `degraded` — never an exception and
// never rendered as data (the bug this guards: a degraded shape reaching a render function).
export function classifyResponse(status, body) {
  if (status < 200 || status >= 300) return 'fail';
  if (body === undefined || body === null) return 'fail';
  if (typeof body === 'object' && 'degraded' in body) return 'degraded';
  return 'ok';
}

// [v28, DES-211, TASK-218, REQ-142] "切回立即輪詢一次,並恢復 3 秒節奏" — a resume must start the
// consecutive-fail streak clean (so ONE more fail after a pause reads `degraded`, not a leftover
// count away from `offline`), but never at the cost of forgetting a verdict `nextConnection` already
// DECLARED: `offline` is returned unchanged, by reference, so a page hidden for an hour cannot paint
// "連線中" over a genuinely dead engine the moment it is re-shown.
export function resumeReset(prev) {
  if (prev.status === 'offline') return prev;
  return { ...prev, consecutiveFails: 0 };
}

// [v28, DES-212, TASK-220, REQ-143, ADR-058] demo mode's all-or-nothing entry gate — engages ONLY
// when the connection verdict already reads `offline` (a real, declared verdict, never a preview
// this tick alone would produce) AND every one of the visible view's own routes was UNREACHED this
// tick (a network drop, `poll.js`'s `reached: false` — never a real 4xx/5xx, which still "reached" a
// server and is REQ-131's Offline case, not this one) AND the demo dataset has actually resolved.
// `reachedFlags.length > 0` guards the same vacuous-`every` hazard `nextConnection:30` already
// needed once: a view with NO endpoints of its own must never engage demo on its very first tick.
export function demoEngages(verdict, reachedFlags, datasetLoaded) {
  return verdict === 'offline' && reachedFlags.length > 0 && reachedFlags.every((r) => r === false) && datasetLoaded === true;
}
