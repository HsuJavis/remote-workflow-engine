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
  const status = consecutiveFails >= 2 ? 'offline' : prev.status;
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
