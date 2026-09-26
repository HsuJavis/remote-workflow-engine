// IT-033: Dashboard read-only HTTP endpoints serve real RunStore data (DES-018, ARCH-011, TASK-025)
// RED: /api/runs HTTP endpoint does not exist yet — server returns 404 → assertions fail.
// No mock of the SUT boundary: real HTTP server, real fetch, real createServer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia, registerPublishedVia, type ToolCaller } from '../helpers/workflow-fixtures.js';
import { DAG_WARNING_EXAMPLES } from '../fixtures/dashboard-wire.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it-dash-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const callTool: ToolCaller = async (name, args) => {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
};

async function submitRun(script: string): Promise<string> {
  const env = await runScriptVia(callTool, script) as { runId?: string };
  return env.runId ?? '';
}

async function registerWorkflow(name: string, script: string): Promise<void> {
  await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'workflow_register', arguments: { name, script, mermaid: 'graph LR' } } }),
  });
}

describe('Dashboard read-only HTTP endpoints (DES-018, ARCH-011)', () => {
  it('GET /api/runs returns 200 with a JSON array', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs`);
    // Forcing RED: endpoint returns 404 (not yet implemented), but must be 200 after impl.
    expect(res.status).toBe(200);
    const body = await res.json() as unknown;
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/runs includes a run that was submitted via MCP run_start', async () => {
    const runId = await submitRun('return {dashboard:true}');
    expect(typeof runId).toBe('string');

    // Poll /api/runs until the run appears (at most 5s)
    let found = false;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const res = await fetch(`http://127.0.0.1:${server.port}/api/runs`);
      if (res.status === 200) {
        const list = await res.json() as Array<{ runId?: string }>;
        if (list.some((r) => r.runId === runId)) { found = true; break; }
      }
    }
    expect(found).toBe(true);
  });

  it('GET /api/runs/:id returns RunStatusView JSON for a known run', async () => {
    const runId = await submitRun('phase("p1"); return 1;');
    // Poll the MCP tool until the run is terminal (so we know the run exists)
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const statusRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
          params: { name: 'run_status', arguments: { runId } } }),
      });
      const sb = await statusRes.json() as { result?: { content?: Array<{ text?: string }> } };
      const view = JSON.parse(sb.result?.content?.[0]?.text ?? '{}') as { result?: { status?: string } };
      if (['completed', 'failed'].includes(view.result?.status ?? '')) break;
    }
    // Now GET via the dashboard HTTP API
    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}`);
    // Forcing RED: endpoint returns 404 now, must return 200 after impl.
    expect(res.status).toBe(200);
    const view = await res.json() as { runId: string; status: string; phases: unknown[] };
    expect(view.runId).toBe(runId);
    expect(['completed', 'failed']).toContain(view.status);
    expect(Array.isArray(view.phases)).toBe(true);
  });

  it('GET /api/runs/:id/agents/:aid returns 200 JSON for an agent in a completed run', async () => {
    // The endpoint returning 404 for unknown agents AFTER the dashboard is implemented is correct,
    // but we can't test that here without a real agent-executing run.
    // This case instead verifies the route pattern is registered (non-existent agent → 404 from the
    // dashboard logic, not 404 from the router itself being absent).
    // RED: currently the entire /api prefix is unregistered → 404 from the router.
    // After implementation: /api/runs/:id/agents/:aid unregistered agent → 404 from dashboard logic.
    // We test the route EXISTS by submitting a real run and checking the path.
    const runId = await submitRun('return 1');
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const statusRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call',
          params: { name: 'run_status', arguments: { runId } } }),
      });
      const sb = await statusRes.json() as { result?: { content?: Array<{ text?: string }> } };
      const v = JSON.parse(sb.result?.content?.[0]?.text ?? '{}') as { result?: { status?: string } };
      if (['completed', 'failed'].includes(v.result?.status ?? '')) break;
    }
    // The endpoint must be registered: unknown agent on a real run → 404 from dashboard logic (not router)
    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/agents/no-such-agent`);
    // RED: route not registered → 404 from router (no response body we can distinguish)
    // After impl: 404 from dashboard logic with a JSON error body
    expect(res.status).toBe(404);
    const body = await res.json() as { error?: string };
    // Dashboard logic returns a JSON body with an error field; router 404 may not
    expect(typeof body.error).toBe('string');
  });

  // v8 Slice 3 (REQ-049): registered-workflow cards endpoint (routing gap caught at Gate 7.5 real-run).
  it('GET /api/workflows returns 200 with the registered catalog', async () => {
    await registerWorkflow('dash-wf-a', 'return 1;');
    const res = await fetch(`http://127.0.0.1:${server.port}/api/workflows`);
    expect(res.status).toBe(200); // was router-404 before the top-level /api/workflows dispatch fix
    const list = await res.json() as Array<{ name: string; version: string }>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((w) => w.name === 'dash-wf-a')).toBe(true);
  });

  // v11 Sprint 3 (DES-064 / IT-048 updated): endpoint now returns GraphPayload (kind:'run', flat cells/edges).
  it('GET /api/runs/:id/dag returns GraphPayload (kind:"run", cells, edges, startedBy)', async () => {
    const runId = await submitRun('return {dag:true};');
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
      if (res.status === 200) {
        const payload = await res.json() as { kind?: string; cells?: unknown[]; edges?: unknown[]; startedBy?: unknown };
        expect(payload.kind).toBe('run');
        expect(Array.isArray(payload.cells)).toBe(true);
        expect(Array.isArray(payload.edges)).toBe(true);
        expect(payload.startedBy).toBeDefined();
        return;
      }
    }
    throw new Error('/api/runs/:id/dag never returned 200');
  });

  // v22 Gate 6.5+7 (coverage gate, IT-033 extended in place): `handleDashboardRequest` was touched
  // by this round's H2 fix (server.ts, DAG masking) — the standing whole-function coverage bar
  // (v21 harness-defaults.ts precedent) applies to the whole function, not just the new line. These
  // 3 cases close its 3 pre-existing gaps: the unmatched-route default, the outer degrade-not-500
  // catch, and the DAG route's double catalog-resolve fallback.
  it('GET an unmatched /api/* path returns 404 { error: "Not found" } (dashboard-handler default, not the top-level JSON-RPC 404)', async () => {
    // Must start with a routed prefix (`/api/issues`) to actually reach `handleDashboardRequest` —
    // an unrelated `/api/*` prefix falls through to the top-level `/mcp`-style JSON-RPC 404 instead
    // (server.ts:1719-1731), which is a different code path entirely.
    const res = await fetch(`http://127.0.0.1:${server.port}/api/issues/not-a-number`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('Not found');
  });

  // [RE-POINTED v23, adjudication #2 R-3(b)] Was driven through the now-deleted
  // `/api/workflows/:name/skeleton` route (404s since REQ-105/TASK-120). The DES-018 guarantee this
  // pins — a malformed %-encoded path segment never propagates as a 500 — is untouched by that
  // deletion; `/api/workflows/:name/describe` (DES-125/132) decodes the same path segment the same
  // way, so it is the surviving route through the same failure mode. Expectation is read from the
  // handler's own contract, not from running the route: `decodeURIComponent` at server.ts:1174 throws
  // a URIError inside the handler's try block, caught by the SAME outer catch (server.ts:1279-1282)
  // that produced this test's original 200.
  it('a malformed %-encoded path segment degrades to 200 + a partial view (DES-018: never a 500)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/workflows/%/describe`);
    expect(res.status).toBe(200);
    const body = await res.json() as { degraded?: string };
    expect(typeof body.degraded).toBe('string');
  });

  it('DAG of a run whose workflow was deregistered after it started falls back to an empty skeleton, not a crash', async () => {
    const name = 'dash-deregistered-dag';
    await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'workflow_register', arguments: { name, script: 'return 1;', mermaid: 'graph LR' } } }),
    });
    const pub = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'workflow_publish', arguments: { name, version: 'v1', channel: 'release' } } }),
    });
    expect((await pub.json() as { result?: { content?: Array<{ text?: string }> } }).result).toBeDefined();
    const run = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'run_start', arguments: { name } } }),
    });
    const runBody = JSON.parse((await run.json() as { result: { content: Array<{ text: string }> } }).result.content[0]!.text) as { runId?: string };
    const runId = runBody.runId!;
    expect(typeof runId).toBe('string');
    // Deregister removes EVERY version — the pinned-version resolve AND the release-channel
    // fallback resolve (server.ts:1118/1121) both now throw CatalogNotFoundError.
    await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'workflow_deregister', arguments: { name } } }),
    });
    // v27b (IT-169, DES-198, TASK-203, Round v27b owner ruling ADR-051): this IS "arm (iii)" — the
    // deregister recipe reachable-producer for `PREDICTED_OVERLAY_UNAVAILABLE: reason=catalog-resolve-failed`.
    // The push must sit INSIDE the catch that assigns `skeletonScript = ''` — an implementer who puts
    // it downstream (where `parseWorkflowSkeleton('')` does NOT throw) pushes nothing, forever, with
    // every OTHER test green; this is the single most likely silent failure in the delta (DES-198's
    // own words). Spy `console.warn` only around this ONE GET, filtered to a JSON-parseable line with
    // `event === 'dashboard_api_degraded'` (other unrelated `console.warn` call sites exist in
    // server.ts — scheduler firings, diagram render — none of which this flow can reach).
    const warnLines: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnLines.push(args.map(String).join(' ')); };
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    } finally {
      console.warn = originalWarn;
    }
    expect(res.status).toBe(200);
    const payload = await res.json() as { kind?: string; cells?: unknown[]; warnings?: string[] };
    expect(payload.kind).toBe('run');
    // No __skel_* placeholder cells — the skeleton derives from an empty script, only the live
    // trigger/agent cells (if any) remain.
    expect((payload.cells ?? []).some((c) => String((c as { id?: string }).id ?? '').startsWith('__skel_'))).toBe(false);
    // Exactly ONE token warning, the UNAVAILABLE one, byte-for-byte the fixture literal — a
    // whole-array `toEqual` would go red for the WRONG reason if a `layoutGraph` prose warning ever
    // legitimately rode along; `filter` isolates the token vocabulary first.
    expect((payload.warnings ?? []).filter((w) => /^PREDICTED_/.test(w))).toEqual([DAG_WARNING_EXAMPLES.unavailable]);
    const degradeLines = warnLines
      .map((l) => { try { return JSON.parse(l) as { event?: string; route?: string; runId?: string; reason?: string }; } catch { return null; } })
      .filter((p): p is { event?: string; route?: string; runId?: string; reason?: string } => p !== null && p.event === 'dashboard_api_degraded');
    expect(degradeLines).toHaveLength(1);
    expect(degradeLines[0]!.reason).toBe('catalog-resolve-failed'); // byte-for-byte the warning's `reason=` value
  });

  it('v27b (IT-169, DES-198, TASK-203): a reused-then-relineaged name resolves to a SUBSTITUTE version — exactly one PREDICTED_FROM_FALLBACK_VERSION warning, and NO degrade log line (FALLBACK is a STATE, never logged)', async () => {
    const name = 'dash-fallback-dag';
    // arm (ii)'s reachable-producer recipe (DES-198's own words): register+publish TWICE under
    // `release` (pins v2 on run_start), deregister (removes EVERY version), register+publish ONCE
    // more under a NEW lineage. Issue #87 (2026-09-26): the new lineage now allocates 'v3' (the
    // per-name high-water mark survives the whole-name deregister; it never restarts at 'v1' again)
    // — still numerically distinct from the pin ('v2'), which is the only property this case
    // actually needs: arm (i)'s `resolve(name, {version: 'v2'})` must find NO surviving row named
    // 'v2', or the case would prove nothing (a same-numbered new row would mask the fallback path
    // entirely, matching `DAG_WARNING_EXAMPLES.fallback`'s pinned literal, `dashboard-wire.ts`).
    await registerPublishedVia(callTool, name, 'return 1;');
    await registerPublishedVia(callTool, name, 'return 2;');
    const started = await callTool('run_start', { name }) as { runId?: string };
    const runId = started.runId!;
    expect(typeof runId).toBe('string');
    await callTool('workflow_deregister', { name });
    await registerPublishedVia(callTool, name, 'return 3;');

    const warnLines: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnLines.push(args.map(String).join(' ')); };
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    } finally {
      console.warn = originalWarn;
    }
    expect(res.status).toBe(200);
    const payload = await res.json() as { warnings?: string[] };
    expect((payload.warnings ?? []).filter((w) => /^PREDICTED_/.test(w))).toEqual([DAG_WARNING_EXAMPLES.fallback]);
    const degradeLines = warnLines.filter((l) => { try { return (JSON.parse(l) as { event?: string }).event === 'dashboard_api_degraded'; } catch { return false; } });
    expect(degradeLines).toHaveLength(0); // FALLBACK is a state, never logged — only the two fault arms log
  });

  // v27 (IT-169, DES-197/198, ARCH-130/131, TASK-202/203, REQ-140/131): three v27 wire additions —
  // `record` on the agent-detail route, `lanes`/`current` on the DAG payload (byte-compatible with
  // the pre-v27 keys), and a real CSP on GET /dashboard.
  //
  // Red reason (measured): `GET /api/runs/:id/agents/:agentId` returns `{harness,events,hasMore}`
  // only (`server.ts`'s `agentMatch` handler forwards `facade.runAgentLog`'s current return object
  // verbatim, which has no `record`); the DAG payload has no `lanes`/`current` key at all; `GET
  // /dashboard` sets no `Content-Security-Policy` header today (`server.ts:1251-1257`).
  it('v27: GET /api/runs/:id/agents/:agentId includes `record` (the AgentRecord) beside harness/events/hasMore', async () => {
    const runId = await submitRun("return agent('rec', { prompt: 'p' });");
    let agentId: string | undefined;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const statusRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'run_status', arguments: { runId } } }),
      });
      const sb = await statusRes.json() as { result?: { content?: Array<{ text?: string }> } };
      const view = JSON.parse(sb.result?.content?.[0]?.text ?? '{}') as { result?: { status?: string; agents?: Array<{ agentId: string }> } };
      if (['completed', 'failed'].includes(view.result?.status ?? '') && (view.result?.agents?.length ?? 0) > 0) {
        agentId = view.result!.agents![0]!.agentId;
        break;
      }
    }
    expect(agentId).toBeDefined();
    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/agents/${agentId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { record?: { agentId?: string } };
    expect(body.record?.agentId).toBe(agentId);
  }, 15000);

  it('v27: GET /api/runs/:id/dag gains lanes+current, with the pre-v27 keys BYTE-COMPATIBLE', async () => {
    const runId = await submitRun("phase('p1'); return {dag:true};");
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
      if (res.status === 200) {
        const payload = await res.json() as { kind?: string; cells?: unknown[]; edges?: unknown[]; startedBy?: unknown; lanes?: unknown; current?: unknown };
        // pre-v27 keys unchanged
        expect(payload.kind).toBe('run');
        expect(Array.isArray(payload.cells)).toBe(true);
        expect(Array.isArray(payload.edges)).toBe(true);
        expect(payload.startedBy).toBeDefined();
        // v27 additions
        expect(Array.isArray(payload.lanes)).toBe(true);
        expect('current' in payload).toBe(true);
        return;
      }
    }
    throw new Error('/api/runs/:id/dag never returned 200');
  });

  it('v27: GET /dashboard carries the real Content-Security-Policy header (ARCH-130)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/dashboard`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
  });
});

// IT-171 (ARCH-135, DES-218, TASK-225, REQ-138): `GET /api/system` calls `systemInfo.get({topN:20})`
// — a literal, never a value derived from the URL (ARCH-135's own refusal of a `?topN=` knob: a
// knob on an unauthenticated route is both a recon-widening AND a per-request-cost control).
//
// Mock policy (integration): real createServer() + real HTTP — `SystemInfoSampler`'s topN slice is
// applied over the REAL host process table (`system-info.ts:199-221`), so this asserts the actual
// served row count, not a stub's.
//
// Red reason (measured): `server.ts:370` calls `systemInfo.get({ topN: 5 })` today — this host has
// well over 20 processes in any CI/dev container, so the served `process.topN` array length is 5,
// never up to 20.
describe('v28: GET /api/system serves up to 20 process rows, not 5 (IT-171, ARCH-135)', () => {
  it('process.topN.length can exceed 5 (bounded at 20), and the source carries no ?topN= derivation', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/system`);
    const body = await res.json() as { process: { topN: unknown[] } };
    expect(body.process.topN.length).toBeLessThanOrEqual(20);
    // This host must genuinely have more than 5 processes for the assertion above to be
    // non-vacuous — true of any real dev/CI machine (measured: this environment reports 300+).
    expect(body.process.topN.length).toBeGreaterThan(5);
  });

  it('src/server.ts names the topN value as a LITERAL, never a URL-derived value (ARCH-135\'s own check)', async () => {
    const src = await import('node:fs').then((fs) => fs.promises.readFile('src/server.ts', 'utf8'));
    const topNLines = src.split('\n').filter((l) => l.includes('topN'));
    expect(topNLines.some((l) => /topN:\s*20/.test(l))).toBe(true);
    expect(topNLines.some((l) => l.includes('req.url') || l.includes('searchParams') || l.includes('?topN'))).toBe(false);
  });
});
