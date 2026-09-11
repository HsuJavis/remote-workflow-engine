// src/dashboard/lib/connection.js
// DES-202, ARCH-124/125/130, TASK-206, REQ-131 — a reducer, a worstOf, and a response classifier.
// All pure: no fetch, no Date.now()/new Date(), no timestamp field kept — `live` requires an `ok`
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

// Any `ok` in the tick wins outright (a run page whose /api/issues is degraded is still `live`).
// Failing that, any `degraded` in the tick makes the view `degraded`. Only when every route in
// the tick failed does the consecutive-failure counter move: `offline` only at >= 2 in a row, so
// one transient miss (e.g. a self-update restart) does not paint the whole team's tabs red.
export function nextConnection(prev, tick) {
  const values = Object.values(tick.results);
  const hasOk = values.includes('ok');
  const hasDegraded = values.includes('degraded');

  if (hasOk) {
    return { status: 'live', consecutiveFails: 0, perRoute: tick.results };
  }
  if (hasDegraded) {
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
