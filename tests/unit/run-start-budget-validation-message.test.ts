// UT (issue #158 F1): run_start's `budget` schema is `anyOf: [{type:'null'}, {object shape}]`.
// ajv (`allErrors:false`) still records one error per anyOf branch it tried plus the summary
// `anyOf` error, IN BRANCH ORDER — so `validate.errors[0]` is ALWAYS whichever branch is listed
// FIRST in the schema (here, the trivial `{type:'null'}` branch), never the branch the caller's
// payload was actually closer to satisfying. `call-tool.ts`'s `validateArgs()` naively took
// `errors[0]`, so EVERY budget validation failure reported the identical, useless message
// "/budget must be null" — whether the caller passed a negative token count, a float, an unknown
// key, or a string where a number belongs.
//
// Mock policy (unit — real facade, no mock of the tool-dispatch boundary; mirrors
// call-tool-budget-migration.test.ts): real createServer(), real MCP HTTP.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

let server: Server;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); });
afterAll(async () => { await server?.close(); });

async function budgetError(budget: unknown, nameSuffix: string): Promise<{ code?: string; message?: string }> {
  const res = await runScriptVia(mcpCall, `agent('a', { prompt: 'p' });`, { name: uniqueWorkflowName(`ut158f1-${nameSuffix}`), budget });
  const err = (res as any).error ?? res;
  return err;
}

describe('run_start budget validation message names the REAL violation, never a blind errors[0] (issue #158 F1, UT)', () => {
  it('{tokens: -5} names tokens/minimum, never "must be null"', async () => {
    const err = await budgetError({ tokens: -5 }, 'neg');
    expect(err.message?.toLowerCase()).not.toContain('must be null');
    expect(err.message).toMatch(/tokens/);
  });

  it('{usd: -0.01} names usd/minimum, never "must be null"', async () => {
    const err = await budgetError({ usd: -0.01 }, 'usdneg');
    expect(err.message?.toLowerCase()).not.toContain('must be null');
    expect(err.message).toMatch(/usd/);
  });

  it('{tokens: 1000.5} names the integer violation, never "must be null"', async () => {
    const err = await budgetError({ tokens: 1000.5 }, 'float');
    expect(err.message?.toLowerCase()).not.toContain('must be null');
    expect(err.message).toMatch(/tokens|integer/);
  });

  it('{foo: 1} (unknown key) names the additional-property violation, never "must be null"', async () => {
    const err = await budgetError({ foo: 1 }, 'extra');
    expect(err.message?.toLowerCase()).not.toContain('must be null');
    expect(err.message?.toLowerCase()).toMatch(/additional|foo/);
  });

  it('{tokens: "500"} (wrong type) names tokens, never "must be null"', async () => {
    const err = await budgetError({ tokens: '500' }, 'strtype');
    expect(err.message?.toLowerCase()).not.toContain('must be null');
    expect(err.message).toMatch(/tokens/);
  });

  it('{} (empty object) names the minProperties violation, never "must be null"', async () => {
    const err = await budgetError({}, 'empty');
    expect(err.message?.toLowerCase()).not.toContain('must be null');
    expect(err.message?.toLowerCase()).toMatch(/propert/);
  });
});
