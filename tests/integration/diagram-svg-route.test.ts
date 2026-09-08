// IT-134 (v25, REQ-119, DES-166, TASK-166): `GET /api/workflows/:name/diagram.svg` — the anonymous
// route that renders the author's diagram, over real HTTP against a booted `createServer()`.
//
// What is real here: the server, the HTTP transport, the SQLite catalog, the registration path
// (`workflow_register` over real MCP) and the whole route including its headers. What is faked:
// the RENDER function, injected as `ServerConfig.diagramRender.render` — a COUNTING fake. That is
// the point of the file: REQ-119's three defences are statements about HOW MANY RENDERS HAPPEN,
// and counting them is only possible with a countable renderer. Real mmdc + real Chrome (including
// the hostile-label case adjudication #11 requires) is VAL-169, real tier.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { RenderOutcome } from '../../src/diagram-render.js';

let server: Server;
let tmpDir: string;
const base = (): string => `http://127.0.0.1:${server.port}`;

// The counting fake: every call is recorded, and the SVG it returns EMBEDS the source it was given,
// so a stale cache entry is visible as content, not merely as a call count.
let renderCalls: string[] = [];
let gate: Promise<void> | null = null;
let outcome: (src: string) => RenderOutcome = (src) => ({ ok: true, svg: `<svg xmlns="http://www.w3.org/2000/svg"><desc>${src.length}</desc></svg>` });

const SCRIPT = [
  "export const meta = { description: 'diagram route', params: { agents: {",
  "  writer: { model: { type: 'string', default: 'sonnet' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },",
  '} } };',
  "if (false) { await agent('writer', {}); }",
  "return 'ok';",
].join('\n');
const mermaidFor = (note: string): string => ['graph LR', `trig[/"${note}"/]`, 'writer(["writer"])', 'trig-->writer'].join('\n');

async function call(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
  if (body.error) throw new Error(`rpc error: ${body.error.message}`);
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

/** Register + publish to `release`: `workflow_describe` (and so this route) resolves the release
 *  channel when no `?version=` is given, and an unpublished name answers CHANNEL_UNPUBLISHED. */
async function register(name: string, note: string): Promise<string> {
  const reg = await call('workflow_register', { name, script: SCRIPT, mermaid: mermaidFor(note) });
  expect(reg.error).toBeUndefined();
  const version = reg.result.version as string;
  const pub = await call('workflow_publish', { name, version, channel: 'release' });
  expect(pub.error).toBeUndefined();
  return version;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it134-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    diagramRender: {
      maxConcurrent: 4,
      render: async (src) => {
        renderCalls.push(src);
        if (gate) await gate;
        return outcome(src);
      },
    },
  });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('(a) cache-first — the second request spawns nothing (IT-134, REQ-119)', () => {
  it('renders on first view, serves the cached SVG afterwards, and says which it was', async () => {
    const wf = 'it134-cache';
    await register(wf, 'first');
    renderCalls = [];

    const first = await fetch(`${base()}/api/workflows/${wf}/diagram.svg`);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toMatch(/^image\/svg\+xml/);
    const firstBody = await first.text();
    expect(firstBody.startsWith('<svg')).toBe(true);
    expect(renderCalls).toHaveLength(1);
    expect(renderCalls[0]).toContain('first'); // the AUTHOR's diagram reached the renderer

    const second = await fetch(`${base()}/api/workflows/${wf}/diagram.svg`);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(firstBody);
    // THE clause: a cache hit invoked no render at all.
    expect(renderCalls).toHaveLength(1);
    expect(first.headers.get('x-diagram-cache')).toBe('miss');
    expect(second.headers.get('x-diagram-cache')).toBe('hit');
  });

  it('the response is safe to load in an <img>: image/svg+xml + nosniff + a no-privilege CSP', async () => {
    const wf = 'it134-headers';
    await register(wf, 'headers');
    const res = await fetch(`${base()}/api/workflows/${wf}/diagram.svg`);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    // A direct navigation to this URL loads the SVG as a DOCUMENT, where script inside an SVG does
    // run — the CSP is what makes that inert too.
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('is keyed by the RESOLVED version — v1 and v2 of one name are different pictures', async () => {
    const wf = 'it134-versions';
    const v1 = await register(wf, 'diagram-one');
    const v2 = await register(wf, 'diagram-two');
    renderCalls = [];

    const one = await fetch(`${base()}/api/workflows/${wf}/diagram.svg?version=${v1}`);
    const two = await fetch(`${base()}/api/workflows/${wf}/diagram.svg?version=${v2}`);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(renderCalls.map((s) => s.includes('diagram-one'))).toEqual([true, false]);
    expect(renderCalls[1]).toContain('diagram-two');

    // …and each version's own second request is a hit.
    await fetch(`${base()}/api/workflows/${wf}/diagram.svg?version=${v1}`);
    await fetch(`${base()}/api/workflows/${wf}/diagram.svg?version=${v2}`);
    expect(renderCalls).toHaveLength(2);
  });
});

describe('(b) single-flight — ten concurrent requests, ONE render (IT-134, REQ-119)', () => {
  it('all ten receive the same bytes and the renderer ran once', async () => {
    const wf = 'it134-singleflight';
    await register(wf, 'concurrent');
    renderCalls = [];
    let open!: () => void;
    gate = new Promise<void>((res) => { open = () => res(); });

    // Genuinely concurrent: every request is in flight before any of them can be answered.
    const inFlight = Array.from({ length: 10 }, () => fetch(`${base()}/api/workflows/${wf}/diagram.svg`));
    await new Promise((r) => setTimeout(r, 150));
    expect(renderCalls).toHaveLength(1);
    open();

    const bodies = await Promise.all((await Promise.all(inFlight)).map((r) => { expect(r.status).toBe(200); return r.text(); }));
    gate = null;
    expect(renderCalls).toHaveLength(1);
    expect(new Set(bodies).size).toBe(1);
  });
});

describe('(c) a render failure degrades to the source display with an observable reason (IT-134, REQ-119)', () => {
  it('answers a typed reason, never a blank 200 and never a fake SVG', async () => {
    const wf = 'it134-busy';
    await register(wf, 'busy');
    renderCalls = [];
    outcome = () => ({ ok: false, reason: 'RENDER_BUSY' });
    try {
      const res = await fetch(`${base()}/api/workflows/${wf}/diagram.svg`);
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      expect(await res.json()).toMatchObject({ code: 'DIAGRAM_RENDER_UNAVAILABLE', reason: 'RENDER_BUSY' });
    } finally {
      outcome = (src) => ({ ok: true, svg: `<svg xmlns="http://www.w3.org/2000/svg"><desc>${src.length}</desc></svg>` });
    }
  });

  it('an unknown workflow is 404 and never reaches the renderer', async () => {
    renderCalls = [];
    const res = await fetch(`${base()}/api/workflows/it134-nope/diagram.svg`);
    expect(res.status).toBe(404);
    expect(renderCalls).toHaveLength(0);
  });

  it('a legacy row with no diagram is 404 LEGACY_NO_DIAGRAM — nothing to render, so nothing spawns', async () => {
    const wf = 'it134-legacy';
    await register(wf, 'legacy');
    // A pre-v24 row is exactly this: a version row whose `mermaid` column is NULL (ADR-025 — a boot
    // migration cannot invent diagrams, so the column is nullable and legacy rows read back null).
    const db = new Database(join(tmpDir, 'catalog.db'));
    db.prepare('UPDATE workflow_versions SET mermaid = NULL WHERE name = ?').run(wf);
    db.close();
    renderCalls = [];

    const res = await fetch(`${base()}/api/workflows/${wf}/diagram.svg`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: 'LEGACY_NO_DIAGRAM' });
    expect(renderCalls).toHaveLength(0);
  });

  it('is read-only: POST is refused', async () => {
    const res = await fetch(`${base()}/api/workflows/it134-cache/diagram.svg`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('cache invalidation — deregister is the ONLY thing that can stale this cache (IT-134, REQ-119)', () => {
  it('deregister → re-register under the same name serves the NEW diagram, not the deleted one', async () => {
    // Why this is a correctness test and not hygiene: `insertVersion` allocates `v${max+1}` over the
    // NAME'S OWN rows and `deregister` deletes them all — so deregister+re-register reuses the very
    // same (name, 'v1') cache key with a different diagram. REQ-111's immutability makes every OTHER
    // invalidation unnecessary; this one it does not cover.
    const wf = 'it134-deregister';
    const v1 = await register(wf, 'before-deregister');
    expect(v1).toBe('v1');
    renderCalls = [];
    const before = await (await fetch(`${base()}/api/workflows/${wf}/diagram.svg`)).text();
    expect(renderCalls).toHaveLength(1);

    const dereg = await call('workflow_deregister', { name: wf });
    expect(dereg.error).toBeUndefined();
    const v1again = await register(wf, 'after-a-much-longer-deregister-note');
    expect(v1again).toBe('v1'); // the SAME key as the deleted workflow's

    const after = await fetch(`${base()}/api/workflows/${wf}/diagram.svg`);
    expect(after.status).toBe(200);
    expect(renderCalls).toHaveLength(2);
    expect(renderCalls[1]).toContain('after-a-much-longer-deregister-note');
    expect(await after.text()).not.toBe(before);
  });
});
