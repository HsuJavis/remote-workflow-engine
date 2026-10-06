// Robustness: some MCP clients serialize the untyped `args` object into a JSON STRING before it
// reaches run_start (observed with the Claude Code plugin). The facade parses a JSON-string `args`
// back into an object so a workflow's `args.field` reads work; an object passes through unchanged.
// A non-JSON string used to be left as-is and delivered verbatim to the script — issue #161 B6
// (owner-approved) changed that: admission (`validateDeclaredArgs`) now refuses ANY non-object
// top-level `args` (array/string/number) with `PARAM_OUT_OF_RANGE`, whether or not the workflow
// declares any `args` keys, so a non-JSON string is refused before the run is even admitted.
import { describe, it, expect } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { facadeCaller, runScriptVia, AUTH_DISABLED } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function facade() {
  const store = new InMemoryRunStore(CLOCK);
  return new McpFacade({ clock: CLOCK, store, runManager: new RunManager({ store, clock: CLOCK }) });
}

async function runAndGet(f: McpFacade, script: string, args: unknown): Promise<unknown> {
  const run = await runScriptVia(facadeCaller(f), script, { args });
  const runId = run.result!.runId;
  let s = await f.runStatus({ runId }, AUTH_DISABLED, false, null);
  for (let i = 0; i < 60 && (s.status === 'running' || s.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 20));
    s = await f.runStatus({ runId }, AUTH_DISABLED, false, null);
  }
  const res = await f.runResult({ runId }, AUTH_DISABLED, false, null);
  return res.result;
}

describe('run_start args normalization (MCP-boundary robustness)', () => {
  const REPORT = 'return { typeofArgs: typeof args, inquiry: args && args.inquiry };';

  it('a JSON-string args is parsed back into the object the caller intended', async () => {
    const out = await runAndGet(facade(), REPORT, '{"inquiry":"hi there","n":2}') as { typeofArgs: string; inquiry: unknown };
    expect(out.typeofArgs).toBe('object');
    expect(out.inquiry).toBe('hi there');
  });

  it('an object args passes through unchanged', async () => {
    const out = await runAndGet(facade(), REPORT, { inquiry: 'direct object' }) as { typeofArgs: string; inquiry: unknown };
    expect(out.typeofArgs).toBe('object');
    expect(out.inquiry).toBe('direct object');
  });

  // issue #161 B6 (owner-approved, 2026-10-07): this used to assert the opposite — a non-JSON
  // string reached the script verbatim as `typeof args === 'string'`. Admission now refuses any
  // non-object top-level `args` outright, so the run is never even admitted; there is no script
  // result to read.
  it('a non-JSON string arg is refused before the run is admitted (issue #161 B6, PARAM_OUT_OF_RANGE)', async () => {
    const run = await runScriptVia(facadeCaller(facade()), 'return { typeofArgs: typeof args, val: args };', { args: 'just a plain string' });
    expect(run.error?.code).toBe('PARAM_OUT_OF_RANGE');
    expect(run.error?.detail?.['suppliedType']).toBe('string');
  });
});
