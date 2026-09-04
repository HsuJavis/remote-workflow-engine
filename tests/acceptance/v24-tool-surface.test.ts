// VAL-129 / IT-119 (DES-158, v24 REQ-118): EVERY TOOL_SPECS row exercised over a real booted
// engine — one it per fixture.happy, one per constructible fixture.errors[code], each asserting
// the typed error.code and validating the happy response against outputSchema; an afterAll writes
// v24-tool-surface.md (tool, arguments, observed response, pass/fail/unverified), only when the
// run covered all 35 rows.
//
// Rewritten at Gate 6 (implementer, TASK-151): the Gate 5 skeleton asserted the JSON-RPC envelope's
// top-level `error`, which this server only sets for ONE case (unknown tool name, DES-140 —
// call-tool.ts's `{code:number}` lift); every real tool refusal (schema/authz/handler) is wrapped
// in `result.content[0].text` as JSON instead. That made every happy-path `it` vacuously green
// regardless of the actual tool outcome — verified live against a booted engine (count as of this
// pass, will move as TASK-132 lands, so read `v24-tool-surface.md`'s `rows:` stamp for the current
// truth, not this number): 20 of 30 non-credential-gated TOOL_SPECS happy fixtures actually error.
// Two distinct causes, neither this task's file scope: (1) fixture-DATA defects in
// `src/tool-specs.ts` (TASK-132) — `workflow_register`'s fixture mermaid is `UNDECLARED_NODE`,
// cascading to `workflow_publish`/`describe`/`source`/`run_start`/`schedule_create`/
// `webhook_create`, all keyed off the `demo` workflow that registration never creates; also every
// `fixture.errors` map is empty across all 35 rows, so zero error-path `it`s are generated where
// DES-158 calls for ≥30. (2) a DES-158 design gap: `run_status`/`run_result`/`run_suspend`/
// `run_resume`/`run_stop`/`run_agent_log`/`workspace_pull`/`workspace_list`/`workspace_delete`/
// `workspace_purge`/`schedule_delete`/`schedule_setEnabled` fixtures hard-code `runId:'r1'` /
// `id:'s1'`, but `run-store.ts:168` mints real run ids via `randomUUID()` — no static fixture
// value can ever match, so no fixture-data fix alone closes these rows. Threading the minted id
// through was considered and rejected: one `demo` run cannot satisfy every row's precondition at
// once (`run_suspend` needs *running*, `run_resume` needs *suspended*, `run_result` needs
// *terminal*, `workspace_pull` needs `output.txt` to exist, `run_agent_log` needs an agent labelled
// `main` — the fixture script `workflow(async () => {})` produces none of that), so threading would
// still leave several rows red while making the table's `args=` diverge from `TOOL_SPECS`, i.e. it
// solves a third of the problem while inventing a mechanism DES-158 never specified. All of this is
// reported to the orchestrator (needs_clarification), not silently patched here or laundered by
// weakening this assertion back to the vacuous check.
//
// Mock policy (acceptance/VAL tier — MUST NOT mock the SUT's own boundary): real createServer(),
// real MCP HTTP tools/call round trip for every fixture.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';

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
// read/list fixture has had its turn.
const DESTRUCTIVE_LAST = new Set(['workflow_deregister', 'workspace_purge']);
function orderedSpecs<T extends { name: string }>(specs: readonly T[]): T[] {
  return [...specs.filter((s) => !DESTRUCTIVE_LAST.has(s.name)), ...specs.filter((s) => DESTRUCTIVE_LAST.has(s.name))];
}

type Row = { tool: string; args: unknown; observed: unknown; status: 'pass' | 'fail' | 'unverified' };
type Spec = { name: string; fixture: { happy: unknown; errors?: Record<string, unknown> }; outputSchema: Record<string, unknown> };

describe('REQ-118 — every MCP tool interface exercised once against a live engine (VAL-129, DES-158)', () => {
  let server: Server;
  const rows: Row[] = [];

  beforeAll(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
  });

  afterAll(async () => {
    await server?.close();
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
  });

  /** Unwraps this server's actual envelope (DES-140): the ONE lift-to-top-level case is an unknown
   *  tool name (`error.code` numeric); every other outcome — schema refusal, authz refusal, a
   *  handler's own `{error:{code,message}}` envelope — is JSON text inside `result.content[0].text`. */
  async function call(name: string, args: unknown): Promise<{ code?: string | number; body: unknown }> {
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

  for (const spec of orderedSpecs(TOOL_SPECS as unknown as Spec[])) {
    if (CREDENTIAL_GATED.has(spec.name)) {
      it.skip(`${spec.name} — happy path (UNVERIFIED: no GitHub token configured)`, () => {});
      rows.push({ tool: spec.name, args: spec.fixture.happy, observed: 'UNVERIFIED(no GitHub token)', status: 'unverified' });
      continue;
    }

    it(`${spec.name} — happy path matches outputSchema`, async () => {
      const { code, body } = await call(spec.name, spec.fixture.happy);
      const validate = ajv.compile(spec.outputSchema);
      const schemaOk = code === undefined ? Boolean(validate(body)) : true; // schema is moot once refused
      rows.push({ tool: spec.name, args: spec.fixture.happy, observed: body, status: code === undefined && schemaOk ? 'pass' : 'fail' });
      expect(code, `${spec.name} happy fixture refused: ${code} ${JSON.stringify(body)}`).toBeUndefined();
      expect(schemaOk, `${spec.name} response failed its outputSchema: ${ajv.errorsText(validate.errors)}`).toBe(true);
    });

    for (const [errCode, errArgs] of Object.entries(spec.fixture.errors ?? {})) {
      it(`${spec.name} — error path ${errCode}`, async () => {
        const { code } = await call(spec.name, errArgs);
        expect(code).toBe(errCode);
      });
    }
  }

  it('every TOOL_SPECS row produced exactly one summary row (REQ-118 requires the full surface, not a subset)', () => {
    expect(TOOL_SPECS.length).toBeGreaterThanOrEqual(35);
    expect(rows.length).toBe(TOOL_SPECS.length);
  });
});
