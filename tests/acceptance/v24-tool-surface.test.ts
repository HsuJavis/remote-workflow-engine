// VAL-129 / IT-119 (DES-158, v24 REQ-118): EVERY TOOL_SPECS row exercised over a real booted
// engine — one it per fixture.happy, one per constructible fixture.errors[code], each asserting
// the typed error.code and validating the happy response against outputSchema; an afterAll writes
// v24-tool-surface.md (tool, arguments, observed response, pass/fail/unverified), only when the
// run covered all 35 rows.
//
// v24 adjudication #4 C-1 — the two defects that made this file unable to do its job, and how they
// are closed here (the previous pass reported them and stopped; the integrator was dispatched to
// close them):
//
//   [29] `workflow_register`'s own happy fixture was invalid (`workflow(async () => {})` against a
//        diagram declaring nodes A and B), so the `demo` workflow every other row keys off never
//        existed and seven rows cascaded red. Fixed in `src/tool-specs.ts` (FIXTURE_SCRIPT /
//        FIXTURE_MERMAID).
//   [30] Twelve rows hard-coded `runId:'r1'` / `id:'s1'` for objects that only exist once a real
//        call mints a UUID. Recording them UNVERIFIED was REFUSED: they are exactly the tools the
//        iteration goal requires verified. So this file now runs a SETUP SEQUENCE first — register,
//        publish, FOUR runs driven into four different states (a terminal one, a live one nothing
//        mutates, one to suspend, one to stop) plus a pre-suspended one for run_resume, a schedule
//        and a webhook — and `TOOL_SPECS.fixture` carries `ref('…')` slots that `resolveFixture`
//        fills from what the setup actually observed. One run cannot satisfy every precondition at
//        once, which is exactly why the sequence starts more than one.
//   [31] Every row's `fixture.errors` was empty against DES-158's own floor of >=30. The error path
//        is the only place the authorization row is actually exercised (v22's H2 was a read-only
//        check that never asked), so the surface is now verified on both paths.
//
// THE PROVIDER. The four live runs must STAY live for the length of this file, and with no provider
// configured `agent()` rejects in ~150ms (see e2e/suspend-resume-replay.test.ts's measured note),
// so every run would be terminal before the first fixture ran. This file therefore boots the engine
// against a REAL LiteLLMGatewayClient (the engine's own production direct-fetch client, not a stub)
// pointed at a local HTTP server that accepts the connection and never answers. Nothing inside the
// SUT is mocked or replaced: the substituted component is the external model provider, the same
// substitution val-019 makes with a real Ollama. A stalled provider is also the only way to observe
// `run_suspend` on genuinely in-flight work rather than on a race.
//
// Mock policy (acceptance/VAL tier — MUST NOT mock the SUT's own boundary): real createServer(),
// real MCP HTTP tools/call round trip for every fixture.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TOOL_SPECS, resolveFixture, FIXTURE_SCRIPT, FIXTURE_MERMAID, FIXTURE_AGENT_LABEL, type SetupKey } from '../../src/tool-specs.js';

const REPORT_PATH = join(process.cwd(), '.sdlc/features/001-remote-workflow-engine/v24-tool-surface.md');
const ajv = new Ajv();

// Credential-gated per DES-158's boundary — verified live: all five need
// `RWE_SECRET_GITHUB_TOKEN` (issue_report additionally has its own fixture defect, reported below:
// its happy args lack `reproSteps`/`analysis`, which `issue-reporter.ts`'s own `REQUIRED_FIELDS`
// demands but `issue_report`'s `inputSchema` does not). `models_list` is deliberately NOT skipped:
// verified live it succeeds from the curated static catalog with no key at all, contradicting
// DES-158's boundary text there — reported, not silently overridden.
const CREDENTIAL_GATED = new Set(['issue_report', 'issue_get', 'issue_list', 'issue_get_comments', 'issue_comment_post']);

// Destructive-last (DES-158 boundary): run over their own fixture workflow only after every
// read/list fixture has had its turn. `workspace_purge` destroys the workspace `workspace_pull`
// and `workspace_delete` read; `workflow_deregister` destroys the workflow everything keys off.
const DESTRUCTIVE_LAST = new Set(['workflow_deregister', 'workspace_purge']);
function orderedSpecs<T extends { name: string }>(specs: readonly T[]): T[] {
  return [...specs.filter((s) => !DESTRUCTIVE_LAST.has(s.name)), ...specs.filter((s) => DESTRUCTIVE_LAST.has(s.name))];
}

type Row = { tool: string; args: unknown; observed: unknown; status: 'pass' | 'fail' | 'unverified' };
type Spec = { name: string; fixture: { happy: Record<string, unknown>; errors: Record<string, Record<string, unknown>> }; outputSchema: Record<string, unknown> };

const SEEDED_FILE = 'output.txt';
/** A workflow with no `agent()` call at all: it runs to completion without dialling anything, which
 *  is what makes `terminalRunId` deterministic rather than a race against the provider. */
const QUICK_SCRIPT = "export const meta = { description: 'terminates immediately' };\nreturn 'ok';";
const QUICK_MERMAID = 'graph TD;';

describe('REQ-118 — every MCP tool interface exercised once against a live engine (VAL-129, DES-158)', () => {
  let server: Server;
  let stalledProvider: HttpServer;
  /** Sockets the stalled provider is holding open. `HttpServer.close()` waits for in-flight
   *  requests, and every one of ours is in flight FOREVER by construction — so they are destroyed
   *  explicitly or afterAll hangs until vitest's hook timeout. */
  const stalledSockets: import('node:net').Socket[] = [];
  let workRoot: string;
  let prevOllamaBaseUrl: string | undefined;
  const rows: Row[] = [];
  const setup: Partial<Record<SetupKey, string>> = {};
  /** Every run this file starts, so afterAll can stop them before closing the server. */
  const startedRuns: string[] = [];
  let setupError: unknown = null;

  beforeAll(async () => {
    // A provider that accepts the socket and never answers. `agent()` then stays in flight for its
    // whole timeout, so a run started here is still `running` when the fixtures reach it.
    stalledProvider = createHttpServer(() => { /* deliberately never responds */ });
    stalledProvider.on('connection', (sock) => { stalledSockets.push(sock); });
    await new Promise<void>((resolve) => stalledProvider.listen(0, '127.0.0.1', resolve));
    const stallPort = (stalledProvider.address() as { port: number }).port;
    prevOllamaBaseUrl = process.env['OLLAMA_BASE_URL'];
    process.env['OLLAMA_BASE_URL'] = `http://127.0.0.1:${stallPort}`;

    // A FRESH workRoot per run. The default is a shared `os.tmpdir()/remote-workflow-runs` that
    // survives across suite runs, so a fixed workflow name ('demo') would accumulate a version per
    // run and eventually register VERSION_CEILING_EXCEEDED — a conformance table that goes red on
    // its Nth execution is worse than none.
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-v24-surface-'));
    server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot,
      // The real production gateway client, direct-fetch (no managed LiteLLM subprocess), routed at
      // the stalled provider above. `default` is the alias FIXTURE_SCRIPT's contract declares.
      aliases: { default: { provider: 'ollama', model: 'stall' } },
      useLiteLLMProxy: false,
      timeoutMs: 120000,
    });

    try {
      await runSetupSequence();
    } catch (err) {
      // Never swallow: a broken setup must fail every dependent `it` loudly with this message
      // rather than silently degrade them into "refused" rows.
      setupError = err;
    }
  }, 60000);

  afterAll(async () => {
    for (const runId of startedRuns) {
      await call('run_stop', { runId }).catch(() => undefined);
    }
    await server?.close();
    for (const sock of stalledSockets) sock.destroy();
    await new Promise<void>((resolve) => stalledProvider?.close(() => resolve()));
    if (prevOllamaBaseUrl === undefined) delete process.env['OLLAMA_BASE_URL'];
    else process.env['OLLAMA_BASE_URL'] = prevOllamaBaseUrl;
    rmSync(workRoot, { recursive: true, force: true });
    // The table is written ONLY when the run covered all 35 rows (one summary row per TOOL_SPECS
    // entry) — a filtered run must not silently truncate a conformance artifact that then looks
    // complete. Written on COVERAGE, not on passing: a 35/35 table with `fail` rows is the honest
    // artifact this exists to produce.
    if (rows.length === TOOL_SPECS.length) {
      const lines = ['# v24 tool surface — REQ-118', '', `rows: ${rows.length}/${TOOL_SPECS.length}`, ''];
      for (const r of rows) {
        lines.push(`- ${r.tool}: ${r.status} — args=${JSON.stringify(r.args)} observed=${JSON.stringify(r.observed).slice(0, 200)}`);
      }
      writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
    }
  }, 60000);

  /** Unwraps this server's actual envelope (DES-140): the ONE lift-to-top-level case is an unknown
   *  tool name (`error.code` numeric); every other outcome — schema refusal, authz refusal, a
   *  handler's own `{error:{code,message}}` envelope — is JSON text inside `result.content[0].text`. */
  async function call(name: string, args: unknown): Promise<{ code?: string | number; body: any }> {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const json = (await res.json()) as { error?: { code: number; message: string }; result?: { content?: Array<{ text?: string }> } };
    if (json.error) return { code: json.error.code, body: json };
    const text = json.result?.content?.[0]?.text;
    let parsed: unknown = json;
    try { if (text !== undefined) parsed = JSON.parse(text); } catch { /* keep the raw envelope */ }
    const err = (parsed as { error?: { code?: string } } | undefined)?.error;
    return { code: err?.code, body: parsed };
  }

  async function callOk(name: string, args: unknown): Promise<any> {
    const { code, body } = await call(name, args);
    if (code !== undefined) throw new Error(`setup: ${name} refused (${code}): ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  }

  async function pollStatus(runId: string, want: (s: string) => boolean, maxMs = 20000): Promise<string> {
    const deadline = Date.now() + maxMs;
    let last = '(never observed)';
    while (Date.now() < deadline) {
      const { body } = await call('run_status', { runId });
      last = String(body?.status ?? body?.result?.status ?? '?');
      if (want(last)) return last;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`setup: run ${runId} never reached the wanted state (last=${last})`);
  }

  const TERMINAL = (s: string) => s === 'completed' || s === 'failed' || s === 'stopped';

  async function startLiveRun(): Promise<string> {
    const started = await callOk('run_start', { name: setup.workflow });
    const runId = started.runId as string;
    startedRuns.push(runId);
    await pollStatus(runId, (s) => s === 'running');
    return runId;
  }

  /** register -> publish -> the run states the twelve id-bearing rows need. */
  async function runSetupSequence(): Promise<void> {
    const registered = await callOk('workflow_register', { name: 'demo', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID });
    setup.workflow = 'demo';
    setup.version = String(registered.result?.version ?? registered.version);
    setup.agentLabel = FIXTURE_AGENT_LABEL;
    await callOk('workflow_publish', { name: setup.workflow, version: setup.version, channel: 'release' });

    // The terminal run comes from a SEPARATE agent-free workflow so it terminates on its own,
    // seeded with one file so workspace_pull/workspace_delete have something real to address.
    const quickName = 'demo-quick';
    const quick = await callOk('workflow_register', { name: quickName, script: QUICK_SCRIPT, mermaid: QUICK_MERMAID });
    await callOk('workflow_publish', { name: quickName, version: String(quick.result?.version ?? quick.version), channel: 'release' });
    const terminal = await callOk('run_start', {
      name: quickName,
      seed: [{ path: SEEDED_FILE, contentB64: Buffer.from('hello from the seed\n').toString('base64') }],
    });
    setup.terminalRunId = terminal.runId as string;
    setup.seededPath = SEEDED_FILE;
    await pollStatus(setup.terminalRunId, TERMINAL);

    setup.liveRunId = await startLiveRun();
    setup.suspendTargetRunId = await startLiveRun();
    setup.stopTargetRunId = await startLiveRun();

    const toSuspend = await startLiveRun();
    await callOk('run_suspend', { runId: toSuspend });
    await pollStatus(toSuspend, (s) => s === 'suspended');
    setup.suspendedRunId = toSuspend;

    const schedule = await callOk('schedule_create', { workflow: setup.workflow, cron: '0 0 1 1 *' });
    setup.scheduleId = String(schedule.result?.id ?? schedule.id);
    // schedule_delete's happy fixture DESTROYS its target, and it sorts before schedule_setEnabled
    // in TOOL_SPECS — one shared id would make the later row fail for the earlier row's reason.
    const deletable = await callOk('schedule_create', { workflow: setup.workflow, cron: '0 0 2 1 *' });
    setup.deletableScheduleId = String(deletable.result?.id ?? deletable.id);
    const webhook = await callOk('webhook_create', { workflow: setup.workflow });
    setup.webhookId = String(webhook.result?.webhookId ?? webhook.webhookId);
  }

  function requireSetup(): void {
    if (setupError) throw setupError;
  }

  for (const spec of orderedSpecs(TOOL_SPECS as unknown as Spec[])) {
    if (CREDENTIAL_GATED.has(spec.name)) {
      it.skip(`${spec.name} — happy path (UNVERIFIED: no GitHub token configured)`, () => {});
      rows.push({ tool: spec.name, args: spec.fixture.happy, observed: 'UNVERIFIED(no GitHub token)', status: 'unverified' });
      continue;
    }

    it(`${spec.name} — happy path matches outputSchema`, async () => {
      requireSetup();
      const args = resolveFixture(spec.fixture.happy, setup);
      const { code, body } = await call(spec.name, args);
      const validate = ajv.compile(spec.outputSchema);
      const schemaOk = code === undefined ? Boolean(validate(body)) : true; // schema is moot once refused
      rows.push({ tool: spec.name, args, observed: body, status: code === undefined && schemaOk ? 'pass' : 'fail' });
      expect(code, `${spec.name} happy fixture refused: ${code} ${JSON.stringify(body)}`).toBeUndefined();
      expect(schemaOk, `${spec.name} response failed its outputSchema: ${ajv.errorsText(validate.errors)}`).toBe(true);
    });

    for (const [errCode, errArgs] of Object.entries(spec.fixture.errors)) {
      it(`${spec.name} — error path ${errCode}`, async () => {
        requireSetup();
        const { code, body } = await call(spec.name, resolveFixture(errArgs, setup));
        expect(code, `${spec.name}/${errCode}: observed ${JSON.stringify(body).slice(0, 300)}`).toBe(errCode);
      });
    }
  }

  it('every TOOL_SPECS row produced exactly one summary row (REQ-118 requires the full surface, not a subset)', () => {
    expect(TOOL_SPECS.length).toBeGreaterThanOrEqual(35);
    expect(rows.length).toBe(TOOL_SPECS.length);
  });

  it('the error surface is exercised at DES-158\'s floor (>=30 constructible error fixtures)', () => {
    const total = TOOL_SPECS.reduce((n, s) => n + Object.keys(s.fixture.errors).length, 0);
    expect(total).toBeGreaterThanOrEqual(30);
  });
});
