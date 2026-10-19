// src/dashboard/ui/poll.js
// DES-206, ARCH-125, TASK-208 — `endpointsFor(view)` is the VISIBLE view's fetch set only (the
// polling budget: a hidden view's endpoints are never fetched).
//
// [v28, DES-210, ADR-057, TASK-217] `getJSON(url)` and `getViewJSON(url)` share ONE result shape,
// every field always present: `{ status, body, reached, source }` (DES-210). `getJSON` never
// throws and never resolves to `null`; `reached` is `false` only in its outer network-failure
// `catch`, `source` is always `'live'`. `getViewJSON` IS `getJSON` unless a demo map is installed
// via `setDemoBodies` — while installed it makes no network call at all (see below).
//
// View-name contract for sibling `ui/` modules (TASK-209..212 — none of them list this file and
// must not edit it; extend ROUTES below instead of the call sites): 'home' (the Workflows tab),
// 'run' (the swimlane at /dashboard/:runId), 'workflow' (the detail page at
// /dashboard/workflow/:name), 'issues' | 'models' | 'system' (the ported tabs, TASK-212).

import { classifyResponse } from '../lib/connection.js';
import { loginUrlFor } from '../lib/principals.js';

const ROUTES = {
  home: () => ['/api/home'],
  run: (ctx) => [
    ctx && ctx.runId ? `/api/runs/${encodeURIComponent(ctx.runId)}/dag` : '/api/runs/:id/dag',
  ],
  workflow: (ctx) => {
    const name = ctx && ctx.name ? encodeURIComponent(ctx.name) : ':name';
    return [`/api/workflows/${name}/describe`, '/api/runs'];
  },
  issues: () => ['/api/issues'],
  models: () => ['/api/models'],
  // [v28, ADR-057] three routes so the System tab's counts card can fold `/api/workflows` +
  // `/api/runs` client-side, with NO new server route — the same fold `/api/runs`'s own run-history
  // table already reads, so the two can never disagree.
  system: () => ['/api/system', '/api/workflows', '/api/runs'],
  // Dashboard auth spec §A2: the admin page fetches /api/principals itself (on mount and after each
  // change) — never re-fetched by the 3s poll, which would repaint a selector mid-edit.
  admin: () => [],
};

/** The VISIBLE view's own fetch set (DES-206) — never the whole app's endpoints. `ctx` carries the
 *  route params (`runId` / `name`) a view needs to build concrete URLs; omitted, a route template
 *  is returned instead (still shaped enough for a caller to detect which endpoint family it is).
 *  @param {string} view
 *  @param {{ runId?: string, name?: string }} [ctx]
 *  @returns {string[]} */
export function endpointsFor(view, ctx) {
  const fn = ROUTES[view];
  return fn ? fn(ctx) : [];
}

/** Fetches `url` and ALWAYS resolves to `{ status, body, reached, source }` (DES-210) — `status` is
 *  one of `classifyResponse`'s three outcomes; never throws, never resolves to `null`. `reached` is
 *  `true` for every HTTP response of any status and `false` only when `fetch` itself rejects (a
 *  real network drop, never a 4xx/5xx — those still "reached" a server). `source` is always
 *  `'live'`. */
export async function getJSON(url) {
  try {
    const res = await fetch(url);
    // Dashboard auth spec §A: a 401 means the session is gone (expired / signed out) — go sign in
    // again, carrying this page back, rather than letting repeated failures read as an outage.
    if (res.status === 401 && typeof location !== 'undefined') {
      location.assign(loginUrlFor(location.pathname, location.search));
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: classifyResponse(res.status, body), body, reached: true, source: 'live' };
  } catch {
    return { status: 'fail', body: null, reached: false, source: 'live' };
  }
}

// Issue #117: the dashboard's admin page POSTs (role/quota changes, service-account management)
// used a bare `fetch` each with their own copy-pasted try/catch — none of them checked for a 401,
// so a session that expired mid-edit just showed a generic "unavailable" error instead of sending
// the browser back to sign in (the SAME 401 -> login-redirect rule `getJSON` above already applies
// to every GET poll). `postJSON(url, body)` is the ONE POST-with-401-redirect helper every admin.js
// write now goes through — same redirect call as `getJSON`'s, same `typeof location !== 'undefined'`
// guard (so this is still safe to import under a test runner with no `location` global). Never
// throws: a network failure (fetch itself rejects) resolves `{httpStatus: 0, ok: false, body: null}`,
// matching `getJSON`'s own never-throws contract above. `body` is the parsed JSON reply, or `null`
// when the response was not JSON (or the fetch failed outright) — the caller reads `body.error`/
// `body.code` for its own error text exactly as it already did when the fetch was inline.
//
// Defect fix (independent-verifier review, 2026-10-10): this result's numeric field is named
// `httpStatus`, deliberately NOT `status` — `getJSON` above also returns a field named `status`,
// but that one is `classifyResponse`'s classified string ('ok'/'degraded'/'fail'), a different kind
// of value under the same name. Reusing the `getJSON` idiom (`r.status === 'ok'`) against a
// `postJSON` result would silently always take the false branch, since `httpStatus` is a raw HTTP
// code (200, 401, 0 on network failure) and never the string 'ok'. `httpStatus` makes the two
// shapes impossible to confuse by field name alone.
export async function postJSON(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'rwe-dashboard' },
      body: JSON.stringify(body),
    });
    if (res.status === 401 && typeof location !== 'undefined') {
      location.assign(loginUrlFor(location.pathname, location.search));
    }
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { httpStatus: res.status, ok: res.ok, body: parsed };
  } catch {
    return { httpStatus: 0, ok: false, body: null };
  }
}

// [v28, DES-210, TASK-217] `demoBodies` is the ONE installer's state: `null` (the default) makes
// `getViewJSON` behave exactly like `getJSON`; a `Map` installed via `setDemoBodies` makes it
// answer from the map with NO network call.
let demoBodies = null;

/** Installs (or clears, with `null`) the demo response map `getViewJSON` answers from. */
export function setDemoBodies(map) {
  demoBodies = map;
}

/** Same result shape as `getJSON` (DES-210). While a demo map is installed (`setDemoBodies`), makes
 *  NO network call: a map hit resolves `{status:'ok', body, reached:true, source:'demo'}`, a map
 *  miss resolves `{status:'fail', body:null, reached:true, source:'demo'}` (the route is still
 *  reached — the whole page — even though this one url is not in the fiction). Otherwise `IS`
 *  `getJSON`. */
export async function getViewJSON(url) {
  if (demoBodies) {
    return demoBodies.has(url)
      ? { status: 'ok', body: demoBodies.get(url), reached: true, source: 'demo' }
      : { status: 'fail', body: null, reached: true, source: 'demo' };
  }
  return getJSON(url);
}
