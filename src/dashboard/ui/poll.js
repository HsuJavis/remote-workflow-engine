// src/dashboard/ui/poll.js
// DES-206, ARCH-125, TASK-208 — `endpointsFor(view)` is the VISIBLE view's fetch set only (the
// polling budget: a hidden view's endpoints are never fetched), and `getJSON(url)` fetches and
// hands `(status, body)` to `classifyResponse` (DES-202) — it never throws and never returns
// `null`, so a caller can feed the result straight into `nextConnection` with no try/catch of its
// own.
//
// View-name contract for sibling `ui/` modules (TASK-209..212 — none of them list this file and
// must not edit it; extend ROUTES below instead of the call sites): 'home' (the Workflows tab),
// 'run' (the swimlane at /dashboard/:runId), 'workflow' (the detail page at
// /dashboard/workflow/:name), 'issues' | 'models' | 'system' (the ported tabs, TASK-212).

import { classifyResponse } from '../lib/connection.js';

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
  system: () => ['/api/system'],
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

/** Fetches `url` and ALWAYS resolves to `{ status, body }` — `status` is one of
 *  `classifyResponse`'s three outcomes; never throws, never resolves to `null`. */
export async function getJSON(url) {
  try {
    const res = await fetch(url);
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: classifyResponse(res.status, body), body };
  } catch {
    return { status: 'fail', body: null };
  }
}
