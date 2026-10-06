// IT-118 (DES-157, v24): every GUIDE_EXAMPLES[] entry is registered against a REAL booted engine
// over MCP HTTP and asserted accepted (the oracle for "a guide that teaches an invalid example is
// worse than no guide" — v23's AUTHORING.md defect, found only because Gate 7.5 ran it). Written
// test-first (Gate 5, RED) — GUIDE_EXAMPLES does not exist yet.
// Mock policy: real HTTP MCP server, real workflow_register round trip — no mock of the SUT boundary.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { GUIDE_EXAMPLES, GUIDE_EXAMPLES_PI } from '../../src/authoring-guide.js';
import { extractDocPairs } from '../helpers/doc-examples.js';

// issue #154 B4 sanitizer, shared by both gateway suites below.
function safeName(prefix: string, title: string): string {
  return `${prefix}-${title.replace(/[/\\]/g, '-')}`;
}

async function registerOverHttp(server: Server, name: string, script: string, mermaid: string): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'workflow_register', arguments: { name, script, mermaid } },
    }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as { version?: unknown; result?: { version?: unknown } };
}

describe('every GUIDE_EXAMPLES entry registers over real MCP HTTP (IT-118, DES-157)', () => {
  let server: Server;

  beforeAll(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
  });

  afterAll(async () => {
    await server?.close();
  });

  it.each((GUIDE_EXAMPLES ?? []) as Array<{ title: string; script: string; mermaid: string }>)(
    'registers "%s" and asserts {version}',
    async (ex) => {
      // Issue #154 B4: a workflow name may no longer contain '/' (it is joined as a single real
      // path segment — see workflow-catalog.ts's validateRegistration). `ex.title` is a human
      // label for THIS test's parametrization only ("fan-out/fan-in" reads fine as a title); it
      // is not itself guide content an author would ever register verbatim, so sanitizing it
      // here changes nothing about what GUIDE_EXAMPLES teaches.
      const parsed = (await registerOverHttp(server, safeName('guide', ex.title), ex.script, ex.mermaid)) as { version?: unknown; result?: { version?: unknown } };
      expect(parsed.version ?? parsed.result?.version).toBeDefined();
    },
  );

  it('at least one example is exercised (the it.each above is not silently empty)', () => {
    expect(GUIDE_EXAMPLES.length).toBeGreaterThan(0);
  });
});

// issue #154 B4 + #153 L2 (owner-approved, 2026-10-07): under `gateway:"pi"` every `GUIDE_EXAMPLES`
// entry's `anthropic/*` model ref is refused `PROVIDER_UNSUPPORTED_BY_HARNESS` — the worked examples
// must be harness-aware. `GUIDE_EXAMPLES_PI` (authoring-guide.ts) is the SAME thirteen patterns with
// an `openrouter/anthropic/...` ref pi actually accepts, and must register clean under a pi-mode
// server exactly like `GUIDE_EXAMPLES` does under the default sdk one above — this is the "register
// every example under BOTH gateways" guard.
describe('every GUIDE_EXAMPLES_PI entry registers over real MCP HTTP under gateway:"pi" (issue #154 B4, #153 L2)', () => {
  let piServer: Server;

  beforeAll(async () => {
    // Same seam `tests/integration/pi-harness-disclosure.test.ts` uses: no real pi child is
    // spawned, only the provider allow-list composeConfig() derives from `gateway:"pi"`.
    piServer = await createServer({ port: 0, bind: '127.0.0.1', harnessProviders: ['openrouter', 'ollama'] });
  });

  afterAll(async () => {
    await piServer?.close();
  });

  it.each((GUIDE_EXAMPLES_PI ?? []) as Array<{ title: string; script: string; mermaid: string }>)(
    'registers "%s" under gateway:"pi" and asserts {version}',
    async (ex) => {
      const parsed = (await registerOverHttp(piServer, safeName('guide-pi', ex.title), ex.script, ex.mermaid)) as { version?: unknown; result?: { version?: unknown }; error?: unknown };
      expect(parsed.version ?? parsed.result?.version, JSON.stringify(parsed.error ?? parsed)).toBeDefined();
    },
  );

  it('at least one example is exercised (the it.each above is not silently empty)', () => {
    expect(GUIDE_EXAMPLES_PI.length).toBeGreaterThan(0);
  });

  it('GUIDE_EXAMPLES_PI is the same corpus as GUIDE_EXAMPLES, titles and count, model ref swapped only', () => {
    expect(GUIDE_EXAMPLES_PI.map((e) => e.title)).toEqual(GUIDE_EXAMPLES.map((e) => e.title));
    for (const ex of GUIDE_EXAMPLES_PI as Array<{ script: string }>) {
      expect(ex.script).not.toContain('anthropic/claude-haiku-4-5-20251001');
    }
  });
});

// v26 (DES-185, ARCH-119/107, ADR-039, TASK-190, REQ-128/116/117): the guide examples ARE the v2
// conformance corpus — every v2 construct (phase lane, parallel slot, alt slot, tools:none,
// tools:default, dynamic title, nested workflow() rectangle) plus the five ADR-039 narrowings in
// their LEGAL rewritten form must register GREEN, and NO NEGATIVE fixture belongs in the guide (an
// example a model might copy is worse than none). Written test-first (Gate 5, RED): today's
// GUIDE_EXAMPLES are `graph TD` diagrams (pre-v26), not LR swimlanes, so this coverage claim is not
// yet true, and no v2 rule codes exist to check the guide text against.
describe('the guide examples are the v2 conformance corpus (DES-185, v26)', () => {
  it('every example is an LR swimlane (graph LR / flowchart LR), not graph TD', () => {
    for (const ex of GUIDE_EXAMPLES as Array<{ title: string; mermaid: string }>) {
      expect(ex.mermaid.trim()).toMatch(/^(graph|flowchart)\s+LR\b/);
    }
  });

  it('none of the four v2 negative rule codes appear as literal text anywhere in the guide corpus', () => {
    const text = (GUIDE_EXAMPLES as Array<{ script: string; mermaid: string }>).map((e) => e.script + e.mermaid).join('\n');
    for (const code of ['DIAGRAM_DIRECTION', 'LANE_MISMATCH', 'TOOLS_MISMATCH', 'EDGE_MISMATCH']) {
      expect(text).not.toContain(code);
    }
  });
});

// v35 (DES-239(e), ARCH-151, TASK-237, REQ-209): the guard EXTENDED to `docs/AUTHORING.md`,
// `DEPLOY.md` and `README.md` — every "a reader will copy this" script+mermaid pair, extracted per
// the DES-239(e) rule (`tests/helpers/doc-examples.ts`), registers through the REAL
// `workflow_register`, not merely through `scanAgentCalls`/`checkMermaid` static checks. Each
// source file declares a MINIMUM pair count; a silently-empty extractor (the guard's only failure
// mode) fails here rather than passing vacuously.
//
// Honesty note (measured on the current tree, not fabricated): DEPLOY.md's role-prompt recipe was
// already fixed end-to-end at v34 (commit f1b44be) and README's two heredoc examples already
// register clean — this describe block is therefore a REGRESSION LOCK for that content (green
// today), not a new red defect. What is genuinely new/red here is the AUTOMATED guard itself: before
// this file, no test extracted or re-registered DEPLOY.md/README.md's examples at all, so a future
// edit to either doc could silently reintroduce the v34 defect with nothing to catch it.
const DOC_MIN_PAIRS: Record<string, number> = {
  'docs/AUTHORING.md': 10,
  'DEPLOY.md': 1,
  'README.md': 2,
};

describe('doc-example guard extended to docs/AUTHORING.md, DEPLOY.md, README.md (DES-239e, v35, REQ-209)', () => {
  let server: Server;
  beforeAll(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); });
  afterAll(async () => { await server?.close(); });

  for (const [file, minPairs] of Object.entries(DOC_MIN_PAIRS)) {
    const pairs = extractDocPairs(readFileSync(join(process.cwd(), file), 'utf8'));

    it(`${file} yields at least ${minPairs} extracted pair(s) (extractor is not silently empty)`, () => {
      expect(pairs.length).toBeGreaterThanOrEqual(minPairs);
    });

    it.each(pairs.map((p, idx) => ({ ...p, idx })))(`${file} pair #%# registers through the REAL workflow_register`, async (p) => {
      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: 'workflow_register', arguments: { name: `docext-${file.replace(/[^a-z0-9]/gi, '')}-${p.idx}`, script: p.script, mermaid: p.mermaid } },
        }),
      });
      const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> }; error?: unknown };
      const parsed = body.result ? JSON.parse(body.result.content?.[0]?.text ?? '{}') as { version?: unknown; error?: unknown } : undefined;
      expect(parsed?.version, `expected a version, got: ${JSON.stringify(body.error ?? parsed?.error ?? body)}`).toBeDefined();
    });
  }
});
