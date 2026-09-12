// VAL-018: REQ-008 acceptance — a literal browser-renderable dashboard page (D-V2V-2, binding ORCH
// ruling on 08-validation.md's Gate 7.5 round-1 finding: DES-018 shipped a JSON-only transport with
// "no HTML page/DOM to open in a literal browser tab" — the user's own Gate-1 choice was explicit:
// 瀏覽器即時儀表板 (browser live dashboard) with run list / agent tree / transcript / token usage).
// Ships a minimal self-contained static HTML/JS dashboard at `GET /dashboard` on the SAME
// server/port as `/mcp` and `/api/runs*` (one data model, two transports — now genuinely two): a
// run list, a drill-in phase/agent-tree view with per-agent state + token usage, a transcript
// view, and an auto-updating mechanism (SSE or polling JS) that needs no manual reload.
//
// Mock policy (DES-015, acceptance tier — E2E/VAL must NOT mock the SUT's own boundary): real
// `createServer()`, real HTTP GET requests against the real running server; no fakes at all (the
// dashboard route needs no LLM/gateway call to exercise — DES-018's read-only HTTP transport is
// pure store-reads, and this test only needs to observe the SERVED PAGE itself, not live run data).
//
// Red reason: `src/server.ts`'s HTTP handler only ever routes `/api/runs*` (JSON) or `/mcp`
// (JSON-RPC) — any other path, including `/dashboard`, falls through to the generic 404 JSON
// response (confirmed by reading the file: no `req.url?.startsWith('/dashboard')` branch exists
// anywhere) — not an import/syntax error.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

describe('GET /dashboard — real browser-renderable HTML page on the same port (VAL-018, REQ-008, D-V2V-2)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('returns a real HTML page (not the JSON API) whose client-side JS fetches the run list from /api/runs', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');

    const body = await res.text();
    expect(body).toMatch(/<html/i);
    // "one data model, two transports" (DES-018): the page's own client JS must call the SAME
    // read-only JSON API the MCP tools/dashboard already share, not a parallel dashboard DTO.
    expect(body).toMatch(/\/api\/runs/);
    expect(body).toMatch(/fetch\s*\(/);
  });

  it('exposes a drill-in view rendering the phase/agent tree with per-agent state + token usage', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const body = await res.text();
    // Client-side rendering logic for a selected run's agent tree must reference the real
    // RunStatusView/AgentRecord fields it drills into (agentId/state/tokens) — not just a static
    // run-list shell with no per-agent detail view at all.
    expect(body).toMatch(/agentId/);
    expect(body).toMatch(/tokens/);
    expect(body).toMatch(/state/);
  });

  it('a drill-in run URL is served (not a hard 404) — SPA-style routing for a specific run', async () => {
    const res = await fetch(`${baseUrl}/dashboard/some-run-id`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
  });

  it('has an auto-update mechanism (SSE or polling) so agent state/tokens refresh without a manual page reload', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const body = await res.text();
    expect(/new EventSource\(|setInterval\(/.test(body)).toBe(true);
  });

  it('exposes a transcript view referencing the per-agent transcript endpoint', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const body = await res.text();
    expect(body).toMatch(/\/api\/runs\/.*\/agents\//);
  });

  // v26 (DES-186, ARCH-120, ADR-044, TASK-191, REQ-129/119): both figures scale with their
  // container and support zoom/pan/fit, via a `viewBox` + `.zoomable` wrapper this real-tier
  // readability clause depends on.
  //
  // [Gate 5 oracle fix, 2026-09-12] `.zoomable` IS still a literal class on the STATIC `/dashboard`
  // shell (measured in this same file's other cases' output: `<div id="dag-zoom" class="zoomable">`
  // / `<div id="diagram-zoom" class="zoomable" ...>`) — DES-200/DES-206 did not move that marker
  // client-side, and UT-200 (`dashboard-zoom-source.test.ts:18-19`) already pins it there to stay,
  // so that half of the original assertion is kept as-is. `viewBox`, however, is NOT in the shell —
  // `<svg id="dag-graph" ...></svg>` ships with no `viewBox` attribute; `ui/run.js:186` sets it
  // programmatically (`svgEl.setAttribute('viewBox', ...)`) only after a run is selected and the
  // graph is built, so a static GET can never contain it even given a correct implementation. Only
  // that half is re-pointed to the real server's own `/static/dashboard/ui/run.js` response (the
  // same file `ui/app.js` loads into the browser and the same route IT-170 exercises, real HTTP, no
  // fakes) — REQ-129's guarantee (the SVG carries a viewBox) is unchanged, only WHERE it is
  // observable moved.
  it('the served page carries the .zoomable marker, and the served client code carries the viewBox it sets at render time (REQ-129)', async () => {
    const shell = await (await fetch(`${baseUrl}/dashboard`)).text();
    expect(shell).toMatch(/zoomable/);
    const res = await fetch(`${baseUrl}/static/dashboard/ui/run.js`);
    expect(res.status).toBe(200);
    const runJs = await res.text();
    expect(runJs).toMatch(/viewBox/);
  });
});
