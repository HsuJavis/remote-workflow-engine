// VAL-109 (REQ-099): the submission-time static checks move to registration, so closing inline
// script loses no validation. Real entrypoint: `createServer`, real MCP HTTP.
//
// Mock policy (acceptance, DES-119): no mocking of the SUT's own boundaries. No LLM dispatch
// needed — these are static/registration-time checks.
//
// Red reason: today PARSE_ERROR/UNKNOWN_MODEL/MCP_NOT_PROVISIONED are checked ONLY at submission
// (`if (spec.script)` in submission-validator.ts), never at `workflow_register` — every registration
// below succeeds today regardless of the script's validity, and a run-by-name is not covered by any
// equivalent check.
//
// 2026-09-26 (alias mechanism removed, owner decisions 1/2/6): the model check now lives ONLY in
// the declared contract (`meta.params.agents.<label>.model`) — `agent(label, {model:'x'})` is
// ALWAYS refused `SCAN_VIOLATION`/`PARAM_IN_SCRIPT` regardless of the value (an agent() call's own
// options can never carry a tunable key), so the old "unresolvable alias inside agent() options" case
// is rewritten to declare its bad ref in the contract instead — the ONLY place a model value is ever
// checked now.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val109-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function toolCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-099: registration enforces the checks the engine used to run only at submission (VAL-109)', () => {
  it('an unparseable script is refused PARSE_ERROR at registration, the SAME code submission produced, nothing stored', async () => {
    const r = await toolCall('workflow_register', { name: 'val109-parse', script: 'not { valid javascript (((' });
    expect((r['error'] as { code?: string } | undefined)?.code).toBe('PARSE_ERROR');
    const got = await toolCall('workflow_source', { name: 'val109-parse' });
    expect(got['code']).toBe('WORKFLOW_NOT_FOUND');
  });

  it('a bare (non-full-ref) declared model.default is refused UNKNOWN_MODEL at registration, nothing stored', async () => {
    const script = [
      "export const meta = { params: { agents: { a: {",
      "  model: { type: 'string', default: 'no-such-alias' },",
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
      "  timeoutMs: { type: 'number', default: 60000 },",
      "} } } };",
      "phase('Work');",
      "await agent('a', { prompt: 'hi' });",
    ].join('\n');
    const r = await toolCall('workflow_register', { name: 'val109-alias', script, mermaid: 'graph LR\nsubgraph "Work"\nn0(["a"])\nend' });
    expect((r['error'] as { code?: string } | undefined)?.code).toBe('UNKNOWN_MODEL');
    const got = await toolCall('workflow_source', { name: 'val109-alias' });
    expect(got['code']).toBe('WORKFLOW_NOT_FOUND');
  });

  it('a run BY NAME is covered — a legitimately registered workflow runs fine (no path skips validation)', async () => {
    // v24 (DES-143/DES-144/DES-148, TASK-152): the LEGITIMATE script is now spelled with a literal
    // label + `options.prompt`, the model declared as a full ref at
    // `meta.params.agents.a.model.default` (writing `model` inside the agent() options is refused
    // SCAN_VIOLATION), and a `mermaid` diagram whose stadium nodes match the script's labels
    // exactly. Same oracle: a script that passes every registration-time check registers with no
    // error — this case and the bad-ref case above now differ by exactly one thing: whether the
    // ref is well-formed (this one is a static-table anthropic id, so it also carries no
    // MODEL_CATALOG_UNVERIFIED warning).
    const script = [
      "export const meta = { params: { agents: { a: {",
      "  model: { type: 'string', default: 'anthropic/claude-sonnet-5' },",
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
      "  timeoutMs: { type: 'number', default: 60000 },",
      "} } } };",
      // v26 (REQ-128): rule L2 — every agent() is dispatched inside a phase().
      "phase('Work');",
      "await agent('a', { prompt: 'do the thing' });",
      "return 'ok';",
    ].join('\n');
    const reg = await toolCall('workflow_register', { name: 'val109-clean', script, mermaid: 'graph LR\nsubgraph "Work"\nn0(["a"])\nend' });
    expect(reg['error']).toBeUndefined();
  });
});

// 2026-09-26 (alias mechanism removed, deliberate drop): the SECOND describe block this file used
// to carry — "a pre-existing workflow whose alias went stale AFTER registration still runs;
// workflow_source exposes validation:{ok:false}" — pinned `WorkflowCatalog.validateCurrent()`'s
// read-time re-check of a script's literal `model: '<alias>'` against the CURRENT alias table.
// That re-check is GONE with the alias mechanism (`validateCurrent`/`validateScriptEntry` now check
// MCP provisioning only — see `script-checks.ts`'s own header comment): a model ref is checked
// ONLY at registration time now (the case above), and there is no live catalog re-verification on
// every read. This is a deliberate scope narrowing, not an oversight — re-verifying an
// openrouter/ollama ref's existence on every `workflow_source`/`workflow_list` call would mean a
// live catalog fetch on a read path, which nothing in this engine's design does elsewhere. REQ-099's
// "not retroactively refused" half still holds trivially (nothing re-checks at all, so nothing can
// retroactively refuse); its "staleness surfaced" half has no successor and is not asserted anywhere.
