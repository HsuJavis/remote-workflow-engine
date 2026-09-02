// IT-098 (TASK-126, DES-125/127/131/134, ARCH-078/079/081): the unowned composition root
// (v23 adjudication #2, R-1/R-2). `GraphAnalyzer` and real `TriggerPorts` are built and exported but
// `createServer()` never constructs/wires either into `new McpFacade(...)` (server.ts:1398) — an
// unwired call site that trace.py cannot see because an unowned construction site is not a broken
// link. R-2 additionally rules that `McpFacadeDeps.triggerPorts`/`.graphAnalyzer` must become
// REQUIRED (not `?:`), and `triggerPorts ?? NO_TRIGGER_PORTS` deleted, so the NEXT unwired call site
// is a `tsc` error instead of this same silent degrade recurring a third time.
//
// Mock policy (integration, DES-119): real `createServer`, real `/mcp` over live HTTP for the
// behavioral case (no live LLM needed — `workflow_regenerate_diagram` only has to return its
// immediate `{queued, status:'pending'}` envelope, per its own advertised contract of never waiting
// for the draw; the background draw itself is REQ-102/VAL-113's own concern). The two structural
// cases are pure static-text reads over `src/**`, same convention as UT-115/UT-117.
//
// Red reason: TODAY `new GraphAnalyzer(` appears zero times in `src/` (case 1 fails: 0 !== 1);
// `McpFacadeDeps.triggerPorts`/`.graphAnalyzer` are both still declared optional and
// `?? NO_TRIGGER_PORTS` is still present in `mcp-facade.ts` (case 2 fails); and with
// `graphAnalyzer.enabled:true` on `createServer`'s own config, `workflow_regenerate_diagram` STILL
// returns `ANALYZER_DISABLED` — the facade's `graphAnalyzer` dep is `undefined` regardless of what
// the config says, because nothing ever constructs and passes it (case 3 fails for the genuine
// unimplemented reason, not a config or auth mistake).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listTsFiles(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('TASK-126: composition root — structural (grep-level, no server boot)', () => {
  it('`new GraphAnalyzer(` appears EXACTLY ONCE across src/** — the one construction site `createServer()` owns', () => {
    const hits: string[] = [];
    for (const file of listTsFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      const matches = text.match(/new GraphAnalyzer\(/g);
      if (matches) hits.push(...matches.map(() => file));
    }
    expect(hits.length).toBe(1);
  });

  it('`McpFacadeDeps.triggerPorts`/`.graphAnalyzer` are REQUIRED (not `?:`), and the `?? NO_TRIGGER_PORTS` degrade is gone', () => {
    const text = readFileSync(join(SRC_ROOT, 'mcp-facade.ts'), 'utf8');
    expect(/\btriggerPorts\?:/.test(text)).toBe(false);
    expect(/\bgraphAnalyzer\?:/.test(text)).toBe(false);
    expect(text.includes('?? NO_TRIGGER_PORTS')).toBe(false);
  });
});

describe('TASK-126: composition root — behavioral (real createServer, real /mcp, no live LLM needed)', () => {
  let server: Server;
  let workRoot: string;

  async function call(name: string, args: unknown): Promise<any> {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
  }

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it098-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot, graphAnalyzer: { enabled: true } } as never);
  });
  afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it('with graphAnalyzer.enabled:true in config, workflow_regenerate_diagram is NOT ANALYZER_DISABLED — the config actually reaches the facade', async () => {
    const { version } = await registerPublishedVia(call, 'it098-flow', `return 1;`);
    const resp = await call('workflow_regenerate_diagram', { name: 'it098-flow', version });
    expect(resp.code).not.toBe('ANALYZER_DISABLED');
    expect(resp.queued).toBe(true);
    expect(resp.status).toBe('pending');
  });
});
