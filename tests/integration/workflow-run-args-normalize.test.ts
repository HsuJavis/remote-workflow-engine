// Robustness: some MCP clients serialize the untyped `args` object into a JSON STRING before it
// reaches workflow_run (observed with the Claude Code plugin). The facade now parses a JSON-string
// `args` back into an object so a workflow's `args.field` reads work; a non-JSON string is left
// as-is; an object passes through unchanged.
import { describe, it, expect } from 'vitest';
import { McpFacade, NO_TRIGGER_PORTS, NO_GRAPH_ANALYZER } from '../../src/mcp-facade.js';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { facadeCaller, runScriptVia } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function facade() {
  const store = new InMemoryRunStore(CLOCK);
  return new McpFacade({ clock: CLOCK, store, runManager: new RunManager({ store, clock: CLOCK }), triggerPorts: NO_TRIGGER_PORTS, graphAnalyzer: NO_GRAPH_ANALYZER });
}

async function runAndGet(f: McpFacade, script: string, args: unknown): Promise<unknown> {
  const run = await runScriptVia(facadeCaller(f), script, { args });
  const runId = run.result!.runId;
  let s = await f.workflow_status({ runId });
  for (let i = 0; i < 60 && (s.status === 'running' || s.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 20));
    s = await f.workflow_status({ runId });
  }
  const res = await f.workflow_result({ runId });
  return res.result;
}

describe('workflow_run args normalization (MCP-boundary robustness)', () => {
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

  it('a non-JSON string arg is left as a string (a workflow that wants a string still gets it)', async () => {
    const out = await runAndGet(facade(), 'return { typeofArgs: typeof args, val: args };', 'just a plain string') as { typeofArgs: string; val: unknown };
    expect(out.typeofArgs).toBe('string');
    expect(out.val).toBe('just a plain string');
  });
});
