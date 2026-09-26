// src/dashboard/demo/dataset.js
// DES-212, ARCH-132, TASK-220, REQ-143 — the demo fiction `ui/app.js` fires ONE boot-time
// `import()` for. Keys are the EXACT URLs `ui/poll.js`'s `endpointsFor` can produce for the routes
// this dataset covers, plus the parametric routes for the dataset's OWN ids (`demo0001`); lookup is
// `Map.get`, never a parse or a path build. Every body's key set is type-locked against
// `tests/fixtures/dashboard-wire.ts`'s ALLOWED_*/REQUIRED_* tables (UT-259) — hand written literals
// only, never produced by running the code under test.
//
// Not built here:
// - `/api/workflows` (bare) and `/api/workflows/:name/describe` — both routes exist in
//   `endpointsFor`, but their wire shape (`runManager.catalog.list()` / `workflowDescribe`'s
//   unwrapped `result`) has no ALLOWED_*/REQUIRED_* key-set oracle in `dashboard-wire.ts` today, so
//   a hand-authored literal here would be untested behavior (Gate 6 exit-gate rule 3).
// - `/api/issues` — IT HAS a type oracle (`ISSUES_OK`/`ALLOWED_ISSUES_KEYS`), but a real
//   `IssueSummary.url` is an `https://github.com/...` string, and `tests/unit/
//   dashboard-no-external-host.test.ts` (UT-231, REQ-131) forbids ANY `https?://` byte anywhere
//   under `src/dashboard/**/*.{css,js}` — the client ships offline-capable, no external host,
//   ever. A fabricated issue link cannot satisfy both `safeIssueHref`'s `https:`-only rule and this
//   guard at once, so this route is left out rather than shipping a literal that trips a REQ-131
//   guard for a route no test in this task's dod exercises.
// A demo tick that visits the Workflow-detail page, the Issues tab, or the System tab's
// `/api/workflows` fold gets a `DEMO.has()` miss on just that one URL — `ui/app.js`'s tick already
// degrades that to `status: 'fail'` for the one route, never a crash — same as any other real fetch
// failure. Both gaps are flagged to the orchestrator as `needs_clarification` rather than silently
// patched in.
//
// Self-labelling lives in the DATA, not only the chrome (ARCH-132/DES-212 — a banner crops out of a
// screenshot; a run id pasted into an issue does not): every workflow name starts `demo-`, the run
// id is `demo0001`, every process pid sits in the fixed `99xxx` band. `diagram.svg` is deliberately
// NOT in the map (DES-212's own boundary: demo shows `paintFigureUnavailable`, a fetch-to-blob is
// not this dataset's shape to fake).

const DEMO_RUN = {
  runId: 'demo0001',
  name: 'demo-nightly-build',
  status: 'completed',
  scriptVersion: 'v1',
  createdAt: '2026-09-17T00:00:00.000Z',
  terminalAt: '2026-09-17T00:04:12.000Z',
  costUSD: 0.18,
  unpricedCalls: 0,
  tokensTotal: 4200,
  agentCount: 3,
};

const DEMO_CARD = {
  name: 'demo-nightly-build',
  description: '示範資料 · Demo data (not a real workflow)',
  group: 'other',
  metrics: { successRate: 1, avgDurationMs: 252000, terminalCount: 1, avgCostUSD: 0.18, unpricedRuns: 0 },
  latestRunId: 'demo0001',
  latestRunAt: '2026-09-17T00:04:12.000Z',
};

export const DEMO = new Map([
  ['/api/home', { running: [], registered: [], other: [DEMO_CARD] }],

  ['/api/runs', [DEMO_RUN]],

  ['/api/runs/demo0001/dag', {
    kind: 'run',
    cells: [],
    edges: [],
    warnings: [],
    startedBy: { type: 'unknown' },
    lanes: [{ index: 0, title: null }],
    current: null,
  }],

  ['/api/system', {
    cpu: { cores: 8, loadAvg: [0.4, 0.3, 0.2], utilizationPct: 12 },
    memory: { totalBytes: 17179869184, usedBytes: 4294967296, freeBytes: 12884901888, usedPct: 25 },
    disk: { path: '/', totalBytes: 500000000000, usedBytes: 100000000000, freeBytes: 400000000000, usedPct: 20 },
    process: {
      self: { pid: 99001, uptimeSec: 7200, rssBytes: 83886080, cpuPct: 0.8, threads: 6, fdCount: 24 },
      topN: [
        { pid: 99001, name: 'node', cpuPct: 0.8, memBytes: 83886080 },
        { pid: 99002, name: 'node', cpuPct: 0.2, memBytes: 41943040 },
      ],
      system: { total: 180, byState: { S: 170, R: 10 } },
    },
    sampledAt: '2026-09-17T00:05:00.000Z',
    windowMs: 3000,
  }],

  ['/api/models', [
    {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      // 2026-09-26 (alias mechanism removed, spec rule 9): `ref` is the exact string to paste into
      // `model.default` — no `aliases` field/overlay any more.
      ref: 'anthropic/claude-3-5-sonnet-20241022',
      description: '示範模型資料 · demo model row',
      modalities: { in: ['text'], out: ['text'] },
      contextWindow: 200000,
      price: { in: '3', out: '15' },
      toolUseDeclared: true,
      location: 'remote',
      capability: 'general-purpose reasoning and tool use',
      stability: 'stable',
      costLevel: 8,
      catalogFetchedAt: '2026-09-17T00:00:00.000Z',
      // Issue #73: probe-backed fields (this demo row was never probed).
      toolUseVerified: null,
      proseVerified: null,
      lastProbedAt: null,
      probeDetail: null,
      stabilitySource: 'rule',
    },
  ]],
]);
