// VAL-169 (v25, REQ-119, DES-166, TASK-166) — REAL TIER. No fake anywhere in this file: a booted
// `createServer()` with its PRODUCTION renderer (a real `mmdc` child process driving a real headless
// Chrome), a real registration through real MCP HTTP, and the real bytes the dashboard's <img> would
// load.
//
// It carries the RED TEST adjudication (v24) #11 required regardless of which rendering option won:
// a workflow whose diagram node labels carry a hostile payload. The assertions are what "nothing
// executes and nothing is injected" means concretely — the payload comes back as ESCAPED TEXT inside
// an SVG <tspan>, with no <script>, no event handler, no <img> and no <foreignObject> anywhere in
// the served document.
//
// Two engine-side properties are proven here and NOWHERE else:
//   1. `htmlLabels:false` (diagram-render.ts) — with mermaid's default HTML labels the node text
//      becomes real HTML in a <foreignObject> and a label of `<img src="http://…">` is FETCHED by
//      the engine's own Chrome at render time. This test asserts the foreignObject is gone.
//   2. REQ-119's display clause: `label<br/>model · effort · timeoutMs` must render on TWO LINES.
//      That is asserted structurally (two `text-outer-tspan row` rows in the node's <text>), which is
//      the difference server-side rendering buys over the client-side option.
//
// Skips (loudly, never silently green) when the optionalDependency or a Chrome is absent — which is
// itself the deployment story: a box without them degrades to the source display (IT-134 covers the
// degradation path).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { renderWithMmdc, resolveMmdcCli } from '../../src/diagram-render.js';

let server: Server;
let tmpDir: string;
const base = (): string => `http://127.0.0.1:${server.port}`;
const WF = 'val152-hostile';

// The payloads. Both sit in nodes whose text `checkMermaid` deliberately leaves FREE (a trapezoid
// trigger/output and a rectangle black box) — the agent (stadium) label is constrained by
// AGENT_LABEL_RE, so free text is exactly where an author could try this.
const IMG_PAYLOAD = '<img src=x onerror=alert(1)>';
const SCRIPT_PAYLOAD = '</svg><script>alert(2)</script>';
const MERMAID = [
  'graph TD;',
  `trig[/"${IMG_PAYLOAD}"/]`,
  `xss["${SCRIPT_PAYLOAD}"]`,
  'writer(["writer<br/>sonnet · low · 60000"])',
  'trig-->writer',
  'xss-->writer',
].join('\n');
const SCRIPT = [
  "export const meta = { description: 'hostile labels', params: { agents: {",
  "  writer: { model: { type: 'string', default: 'sonnet' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },",
  '} } };',
  "if (false) { await agent('writer', {}); }",
  "return 'ok';",
].join('\n');

/** puppeteer finds its own bundled Chrome when the optionalDependency's postinstall downloaded one.
 *  A box that installed with PUPPETEER_SKIP_DOWNLOAD=1 (this one) has a Chrome in puppeteer's cache
 *  under a different revision, and `PUPPETEER_EXECUTABLE_PATH` — puppeteer's own native override,
 *  which the engine simply inherits — is how a deployment points at it. */
function findChrome(): string | null {
  const explicit = process.env['PUPPETEER_EXECUTABLE_PATH'];
  if (explicit && existsSync(explicit)) return explicit;
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (!existsSync(root)) return null;
  for (const rev of readdirSync(root)) {
    for (const layout of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, rev, layout);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const cli = resolveMmdcCli();
const chrome = findChrome();
// The gate is a LIVE PROBE (below, in beforeAll), not the presence of files. `deploy/rwe-update.sh`
// runs this suite as its restart gate and REVERTS the release when it fails: a host where `npm ci`
// installed Chrome but the binary cannot LAUNCH (missing libnss3/libatk — the normal state of a
// server that never had a browser) would look "renderer available" to a presence check and then
// fail here, turning an optionalDependency that deliberately cannot break the install into a test
// that breaks the deploy. So the probe RENDERS something trivial first and skips on any failure,
// printing the real reason. Trade-off, stated rather than hidden: on such a host a genuine
// regression that turns every render into RENDER_FAILED is masked at THIS tier — UT-168 and IT-134
// catch that class, and they need no browser.
let reason: string | null = !cli
  ? 'SKIPPED: @mermaid-js/mermaid-cli (optionalDependency) is not installed on this host'
  : !chrome
    ? 'SKIPPED: no puppeteer Chrome found (set PUPPETEER_EXECUTABLE_PATH or run puppeteer\'s browser install)'
    : null;
/** An `it` that becomes a no-op when the probe said this host cannot render — never a silent green:
 *  `beforeAll` prints the reason once, and the skip is visible in the run's stdout. */
const itReal = (name: string, fn: () => void | Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

async function call(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
  if (body.error) throw new Error(`rpc error: ${body.error.message}`);
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

let svg = '';

beforeAll(async () => {
  if (chrome) process.env['PUPPETEER_EXECUTABLE_PATH'] = chrome; // inherited by the render child
  if (!reason) {
    const probe = await renderWithMmdc('graph TD;\nA(["a"])', new AbortController().signal);
    if (!probe.ok) reason = `SKIPPED: the renderer is installed but cannot render on this host — ${probe.reason}: ${probe.detail ?? ''}`;
  }
  if (reason) console.warn(`[VAL-169] ${reason} — the render path is NOT verified in this run.`);
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val169-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  const reg = await call('workflow_register', { name: WF, script: SCRIPT, mermaid: MERMAID });
  expect(reg.error).toBeUndefined(); // the hostile labels are ACCEPTED by checkMermaid — free text
  await call('workflow_publish', { name: WF, version: reg.result.version, channel: 'release' });
  if (!reason) {
    const res = await fetch(`${base()}/api/workflows/${WF}/diagram.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    svg = await res.text();
  }
}, 120000);
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('VAL-169 — the diagram is really drawn, server-side, by a real headless Chrome (REQ-119)', () => {
  itReal('serves a real SVG document, not the Mermaid source', () => {
    expect(svg.trimStart().startsWith('<svg')).toBe(true);
    expect(svg.length).toBeGreaterThan(5000); // a real rendered flowchart, not a stub
    expect(svg).not.toContain('graph TD;');
  });

  itReal('renders the REQ-112 value triple on TWO lines — the display server-side rendering buys', () => {
    // `writer` on row 1, `sonnet · low · 60000` on row 2. Client-side rendering could not do this and
    // stay safe: it needs securityLevel:'strict', under which the <br/> prints literally (04-design
    // adjudication #12 L-1).
    const texts = svg.match(/<text[^>]*>[\s\S]*?<\/text>/g) ?? [];
    const writerText = texts.find((t) => t.includes('writer'));
    expect(writerText, 'the agent node was not rendered at all').toBeDefined();
    const rows = writerText!.match(/class="text-outer-tspan row"/g) ?? [];
    expect(rows.length).toBe(2);
    expect(writerText).toContain('sonnet');
    expect(writerText).not.toContain('<br/>'); // the separator became a line break, not literal text
  });

  itReal('a cache HIT serves the same bytes without starting a browser (REQ-119 defence a, real tier)', async () => {
    const res = await fetch(`${base()}/api/workflows/${WF}/diagram.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-diagram-cache')).toBe('hit');
    expect(await res.text()).toBe(svg);
  });
});

describe('VAL-169 — the hostile-label red test (adjudication (v24) #11, REQ-119)', () => {
  itReal('nothing executable survives into the served document', () => {
    expect(svg).not.toContain('onerror');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('alert(1)');
    expect(svg).not.toContain('alert(2)');
    // No <img> and no <foreignObject>: with mermaid's DEFAULT html labels the payload becomes a real
    // <img> inside a <foreignObject> and the ENGINE's Chrome fetches its src while rendering.
    expect(svg).not.toContain('<img');
    expect(svg).not.toContain('foreignObject');
  });

  itReal('the payload is displayed as escaped TEXT — the author still sees what they wrote', () => {
    // Not silently dropped (which would hide an author's mistake) — entity-escaped inside a <tspan>.
    expect(svg).toContain('&lt;img');
    expect(svg).toMatch(/<tspan[^>]*>[^<]*&lt;img/);
  });

  itReal('the SVG document itself is not a way back into the page', () => {
    // Belt and suspenders for a viewer who navigates straight to the URL (where an SVG loads as a
    // DOCUMENT): the response carries a CSP that grants it nothing.
    expect(svg).not.toMatch(/javascript:/i);
    expect(svg).not.toMatch(/\son\w+=/); // no inline event handler attributes at all
  });
});
