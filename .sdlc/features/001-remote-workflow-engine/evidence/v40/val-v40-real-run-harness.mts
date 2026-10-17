// Gate 7.5 (v40) real-run harness — REQ-220..230. Hits a real scratch engine (port from env
// RWE_VAL_PORT) over real HTTP MCP, with real OpenRouter behind decide()/generateImage(). No SUT
// boundary is mocked here; the only "fake" in this file is never used (we import nothing from
// tests/helpers/stub-fetch.js). Prints one JSON line per phase to stdout; a phase name of PHASE_X
// marks progress for the harness operator to grep.
import { registerPublishedVia, runScriptVia, uniqueWorkflowName } from '/home/user/Documents/remote-workflow/tests/helpers/workflow-fixtures.js';

const PORT = Number(process.env['RWE_VAL_PORT'] ?? '8794');
const BASE = `http://127.0.0.1:${PORT}`;

async function call(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> }; error?: unknown };
  if (body.error) return { __rpcError: body.error };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}
const caller = (tool: string, args: Record<string, unknown>) => call(tool, args);

async function poll(runId: string, maxMs = 60000): Promise<any> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const st = await call('run_status', { runId });
    if (['completed', 'failed', 'stopped', 'suspended'].includes(st.status)) return st;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`run ${runId} did not settle within ${maxMs}ms`);
}

function out(phase: string, data: unknown) {
  console.log(`===PHASE ${phase}===`);
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const phase = process.argv[2];

  if (phase === 'catalog') {
    const r = await call('models_list', { query: 'typesafe' });
    out('catalog', r);
    return;
  }

  if (phase === 'guide') {
    const g = await call('workflow_authoring_guide', {});
    const text = JSON.stringify(g);
    out('guide', { hasDecide: /decide\(/.test(text), hasGenerateImage: /generateImage\(/.test(text) });
    return;
  }

  if (phase === 'reg-mismatch') {
    const name = uniqueWorkflowName('valv40-mismatch');
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/anthropic/claude-sonnet-5' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
      await decide('gate', { state: {}, questions: {} });
      return 'x';
    `;
    try {
      await registerPublishedVia(caller as any, name, script);
      out('reg-mismatch', { unexpectedSuccess: true });
    } catch (e: any) {
      out('reg-mismatch', { refused: true, message: String(e?.message ?? e) });
    }
    return;
  }

  if (phase === 'reg-alias') {
    const name = uniqueWorkflowName('valv40-alias');
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
      const d = decide;
      await d('gate', { state: {}, questions: {} });
      return 'x';
    `;
    try {
      await registerPublishedVia(caller as any, name, script);
      out('reg-alias', { unexpectedSuccess: true });
    } catch (e: any) {
      out('reg-alias', { refused: true, message: String(e?.message ?? e) });
    }
    return;
  }

  if (phase === 'decide-real') {
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 15000 }, retries: { type: 'number', default: 1 } } } } };
      const r = await decide('gate', { state: { status: 'VALV40SENTINEL' }, questions: { order: { type: 'bool', instructions: 'is it ready', criteria: { true: 'yes', false: 'no' } } } });
      return r;
    `;
    const t0 = Date.now();
    const started: any = await runScriptVia(caller as any, script, {});
    const runId = started.runId ?? started.result?.runId;
    const view = await poll(runId);
    const rr = await call('run_result', { runId });
    out('decide-real', { elapsedMs: Date.now() - t0, status: view.status, result: rr.result, error: view.result?.error });
    return;
  }

  if (phase === 'image-real') {
    const script = `
      export const meta = { phases: [], params: { images: { hero: { model: { type: 'string', default: 'openrouter/google/gemini-2.5-flash-image' }, timeoutMs: { type: 'number', default: 30000 }, retries: { type: 'number', default: 1 } } } } };
      const r = await generateImage('hero', { prompt: 'a small red circle on white background, minimal' });
      return r;
    `;
    const t0 = Date.now();
    const started: any = await runScriptVia(caller as any, script, {});
    const runId = started.runId ?? started.result?.runId;
    const view = await poll(runId, 60000);
    const rr = await call('run_result', { runId });
    const listed = await call('workspace_list', { runId });
    out('image-real', {
      elapsedMs: Date.now() - t0, status: view.status, error: view.result?.error,
      files: rr.result?.files, repliedTextHasBase64: /data:image\/|base64/.test(JSON.stringify(rr.result)),
      listed,
    });
    return;
  }

  if (phase === 'journey2') {
    // Resume-replay, done right: suspend only AFTER the log shows d1's `ok` for THIS run (so at
    // least one primitive has genuinely completed+persisted before the abort), then resume and
    // prove d1 is NOT re-called (no NEW d1 `ok`/attempt line after resume) while image+d2 do run.
    const fs = await import('node:fs');
    const logPath = process.env['RWE_VAL_LOG']!;
    const script = `
      export const meta = { phases: [], params: {
        decisions: { d1: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 15000 }, retries: { type: 'number', default: 1 } },
                      d2: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 15000 }, retries: { type: 'number', default: 1 } } },
        images: { hero: { model: { type: 'string', default: 'openrouter/google/gemini-2.5-flash-image' }, timeoutMs: { type: 'number', default: 30000 }, retries: { type: 'number', default: 1 } } }
      } };
      const d1 = await decide('d1', { state: { status: 'VALV40JOURNEY2-D1' }, questions: { order: { type: 'bool', instructions: 'ready?', criteria: { true: 'y', false: 'n' } } } });
      const img = await generateImage('hero', { prompt: 'a small green triangle on white background, minimal' });
      const d2 = await decide('d2', { state: { status: 'VALV40JOURNEY2-D2' }, questions: { order: { type: 'bool', instructions: 'ready again?', criteria: { true: 'y', false: 'n' } } } });
      return { d1, img, d2 };
    `;
    const name = uniqueWorkflowName('valv40-journey2');
    await registerPublishedVia(caller as any, name, script);
    const started: any = await call('run_start', { name });
    const runId = started.runId ?? started.result?.runId;

    const sizeBefore = fs.statSync(logPath).size;
    // d1 alone (measured separately, decide-real phase) completes in ~1-1.2s; wait comfortably
    // past that but well before the image call (~5-6s) finishes, so the suspend lands between d1
    // (completed+persisted) and image (not yet started/finished).
    await new Promise((r) => setTimeout(r, 2500));
    const susp = await call('run_suspend', { runId });
    await new Promise((r) => setTimeout(r, 300));
    const stAfterSuspend = await call('run_status', { runId });
    const res = await call('run_resume', { runId });
    const view = await poll(runId, 90000);
    const rr = await call('run_result', { runId });

    const afterResumeLines = fs.readFileSync(logPath, 'utf8').slice(sizeBefore).split('\n')
      .filter((l) => l.includes(runId) && l.includes('"primitive.call"'))
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    out('journey2', {
      runId, suspendResponse: susp, statusAfterSuspend: stAfterSuspend.status, resumeResponse: res, finalStatus: view.status, result: rr.result,
      allPrimitiveCallLines: afterResumeLines.map((d: any) => ({ primitive: d.primitive, label: d.label, outcome: d.outcome, attempt: d.attempt, callSeq: d.callSeq })),
    });
    return;
  }

  if (phase === 'journey') {
    // REQ-220/221/225/226/229 — decide -> image -> decide, run to completion for real, then a
    // SECOND identical run suspended after it's all done is pointless; instead suspend EARLY (poll
    // run_status until agents/primitives first show progress) then resume, and diff primitive.call
    // counts before/after via the caller's own run_result + run_status (no internal log dependency
    // needed for the completion-and-answer assertions; the log diff is done separately by the
    // orchestrator via grep, see journey-log-check).
    const script = `
      export const meta = { phases: [], params: {
        decisions: { d1: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 15000 }, retries: { type: 'number', default: 1 } },
                      d2: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 15000 }, retries: { type: 'number', default: 1 } } },
        images: { hero: { model: { type: 'string', default: 'openrouter/google/gemini-2.5-flash-image' }, timeoutMs: { type: 'number', default: 30000 }, retries: { type: 'number', default: 1 } } }
      } };
      const d1 = await decide('d1', { state: { status: 'VALV40JOURNEY-D1' }, questions: { order: { type: 'bool', instructions: 'ready?', criteria: { true: 'y', false: 'n' } } } });
      const img = await generateImage('hero', { prompt: 'a small blue square on white background, minimal' });
      const d2 = await decide('d2', { state: { status: 'VALV40JOURNEY-D2' }, questions: { order: { type: 'bool', instructions: 'ready again?', criteria: { true: 'y', false: 'n' } } } });
      return { d1, img, d2 };
    `;
    const name = uniqueWorkflowName('valv40-journey');
    await registerPublishedVia(caller as any, name, script);

    // Run A: straight through, no suspend (negative control / baseline completion).
    const startedA: any = await call('run_start', { name });
    const runIdA = startedA.runId ?? startedA.result?.runId;
    const viewA = await poll(runIdA, 90000);
    const rrA = await call('run_result', { runId: runIdA });

    // Run B: suspend shortly after start, then resume — zero EXTRA provider calls expected for
    // whatever had already completed before suspend; full completion after resume either way.
    const startedB: any = await call('run_start', { name });
    const runIdB = startedB.runId ?? startedB.result?.runId;
    await new Promise((r) => setTimeout(r, 400)); // let at least the first primitive get in flight
    const susp = await call('run_suspend', { runId: runIdB });
    await new Promise((r) => setTimeout(r, 300));
    const stAfterSuspend = await call('run_status', { runId: runIdB });
    const res = await call('run_resume', { runId: runIdB });
    const viewB = await poll(runIdB, 90000);
    const rrB = await call('run_result', { runId: runIdB });

    out('journey', {
      runIdA, statusA: viewA.status, resultA: rrA.result,
      runIdB, suspendResponse: susp, statusAfterSuspend: stAfterSuspend.status, resumeResponse: res, statusB: viewB.status, resultB: rrB.result,
    });
    return;
  }

  if (phase === 'overhead') {
    // REQ-230 — N real decide() calls in one run (sequential loop inside the sandboxed script —
    // Date.now() is refused by the determinism guard, so no in-script timing; p95 is computed by
    // the orchestrator from the ENGINE's own primitive.call `engineMs` field in the real log).
    const N = Number(process.argv[3] ?? '24');
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 15000 }, retries: { type: 'number', default: 1 } } } } };
      const out = [];
      for (let i = 0; i < ${N}; i++) {
        out.push(await decide('gate', { state: { i }, questions: { order: { type: 'bool', instructions: 'ready', criteria: { true: 'y', false: 'n' } } } }));
      }
      return { count: out.length };
    `;
    const t0 = Date.now();
    const started: any = await runScriptVia(caller as any, script, {});
    const runId = started.runId ?? started.result?.runId;
    const view = await poll(runId, 10 * 60000);
    const rr = await call('run_result', { runId });
    out('overhead', { runId, elapsedMs: Date.now() - t0, status: view.status, result: rr.result, error: view.result?.error });
    return;
  }

  if (phase === 'concurrency') {
    // REQ-228 — fired from the ORCHESTRATOR (this process), two concurrent run_start calls against
    // whatever single instance this is pointed at (decideSlots:1 vs decideSlots:16, two different
    // ports compared by the orchestrator, not inside this phase).
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 15000 }, retries: { type: 'number', default: 1 } } } } };
      const r = await decide('gate', { state: { tag: 'CONC' }, questions: { order: { type: 'bool', instructions: 'ready', criteria: { true: 'y', false: 'n' } } } });
      return r;
    `;
    const name1 = uniqueWorkflowName('valv40-conc1');
    const name2 = uniqueWorkflowName('valv40-conc2');
    await registerPublishedVia(caller as any, name1, script);
    await registerPublishedVia(caller as any, name2, script);
    const t0 = Date.now();
    const [s1, s2]: any = await Promise.all([call('run_start', { name: name1 }), call('run_start', { name: name2 })]);
    const [v1, v2] = await Promise.all([poll(s1.runId ?? s1.result?.runId), poll(s2.runId ?? s2.result?.runId)]);
    out('concurrency', { elapsedMs: Date.now() - t0, status1: v1.status, status2: v2.status });
    return;
  }

  if (phase === 'retry-4xx') {
    // REQ-227 (non-retryable 4xx arm, real): run against an instance booted with a deliberately
    // WRONG OpenRouter key — a genuine 401 from the real provider, not simulated. retries:1 but
    // classifyAttempt() marks any non-429 4xx non-retryable, so this must fail after EXACTLY 1
    // attempt (status 401 named in the error), never attempt 2.
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 15000 }, retries: { type: 'number', default: 1 } } } } };
      const r = await decide('gate', { state: {}, questions: { order: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
      return r;
    `;
    const started: any = await runScriptVia(caller as any, script, {});
    const runId = started.runId ?? started.result?.runId;
    const view = await poll(runId, 60000);
    out('retry-4xx', { runId, status: view.status, error: view.result?.error });
    return;
  }

  if (phase === 'retry-timeout') {
    // REQ-227 (retryable arm, real): timeoutMs set impossibly low against a REAL provider call —
    // a genuine network/provider round trip cannot complete in 1ms, so this is a real timeout, not
    // a simulated one. retries:1 -> expect exactly 2 attempts then PRIMITIVE_FAILED(timeout).
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 1 }, retries: { type: 'number', default: 1 } } } } };
      const r = await decide('gate', { state: {}, questions: { order: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
      return r;
    `;
    const started: any = await runScriptVia(caller as any, script, {});
    const runId = started.runId ?? started.result?.runId;
    const view = await poll(runId, 60000);
    out('retry-timeout', { runId, status: view.status, error: view.result?.error });
    return;
  }

  throw new Error(`unknown phase ${phase}`);
}

main().catch((e) => { console.error('HARNESS_ERROR', e); process.exit(1); });
