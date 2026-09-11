// VAL-201 (REQ-135, REQ-136; DES-205/206; 04-design.md's own v27 real-tier path): real Chromium —
// clicking a real agent node opens the slide-in panel: six stat cards, the user prompt in a
// `<pre>`, the three tag columns, the event list, Esc/backdrop close — and REQ-136's own proof that
// the prompt shown is the SCRIPT prompt, never the agentType systemPrompt.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP, real Chromium, a real agentType
// composition root with a distinctive systemPrompt marker (same technique as IT-165).
//
// Red reason (measured): today's `#detail` pane shows the transcript inline with no slide-in panel
// and no stat cards at all (`dashboard-page.ts`'s `renderTranscript`) — none of the panel selectors
// below exist.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer } from '../../src/server.js';
import type { Server, ServerConfig } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';

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
const chrome = findChrome();
const reason = chrome ? null : 'SKIPPED: no puppeteer Chrome found (set PUPPETEER_EXECUTABLE_PATH)';
throwIfBrowserRequired(chrome);

const STUB_PORT = 38201;
const MARKER = 'RWE-V27-VAL201-MARKER';

function startStubOllamaServer(): HttpServer {
  return createHttpServer((req, res) => {
    if ((req.url ?? '').startsWith('/api/tags')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ response: 'ack', prompt_eval_count: 1, eval_count: 1 }));
    });
  });
}

let server: Server;
let baseUrl: string;
let runId: string;
let stub: HttpServer;
const ORIGINAL_OLLAMA_BASE_URL = process.env['OLLAMA_BASE_URL'];

beforeAll(async () => {
  if (reason) { console.log(`[val-201] ${reason}`); return; }
  const workRoot = mkdtempSync(join(tmpdir(), 'rwe-val201-'));
  const definitionsDir = join(workRoot, 'agents');
  mkdirSync(definitionsDir, { recursive: true });
  writeFileSync(join(definitionsDir, 'marked.md'), ['---', 'name: marked', 'model: marked-alias', '---', MARKER, ''].join('\n'), 'utf8');
  stub = startStubOllamaServer();
  await new Promise<void>((resolve) => stub.listen(STUB_PORT, '127.0.0.1', resolve));
  process.env['OLLAMA_BASE_URL'] = `http://127.0.0.1:${STUB_PORT}`;
  server = await createServer({
    port: 0, bind: '127.0.0.1', useLiteLLMProxy: false, agentDefinitionsDir: definitionsDir,
    aliases: { default: { provider: 'ollama', model: 'default-model' }, 'marked-alias': { provider: 'ollama', model: 'marked-model' } },
    graphAnalyzer: { enabled: false },
  } as ServerConfig & { agentDefinitionsDir: string });
  baseUrl = `http://127.0.0.1:${server.port}`;
  const run = await runScriptVia(async (tool, args) => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name: tool, arguments: args } }) });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  }, `return agent('panel-agent', { agentType: 'marked', prompt: 'the visible script prompt' });`);
  runId = run.runId as string;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/runs/${runId}`);
    const s = (await res.json()) as { status?: string };
    if (['completed', 'failed'].includes(s.status ?? '')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}, 30000);

afterAll(async () => {
  await server?.close();
  await new Promise<void>((resolve) => stub?.close(() => resolve()));
  if (ORIGINAL_OLLAMA_BASE_URL === undefined) delete process.env['OLLAMA_BASE_URL'];
  else process.env['OLLAMA_BASE_URL'] = ORIGINAL_OLLAMA_BASE_URL;
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('the agent slide-in panel, real Chromium (VAL-201, REQ-135/136)', () => {
  itReal('clicking a real agent node opens a slide-in panel with six stat cards', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const node = await page.$('#dag-graph [data-node-cell]');
      if (node) await node.click();
      await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
      const statCardCount = await page.$$eval('[data-agent-panel] [data-stat-card]', (els) => els.length);
      expect(statCardCount).toBe(6);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('the panel <pre> prompt contains the script prompt but NEVER the agentType systemPrompt marker (REQ-136)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const node = await page.$('#dag-graph [data-node-cell]');
      if (node) await node.click();
      await page.waitForSelector('[data-agent-panel] pre', { timeout: 3000 });
      const promptText = await page.$eval('[data-agent-panel] pre', (el) => el.textContent ?? '');
      expect(promptText).toContain('the visible script prompt');
      expect(promptText).not.toContain(MARKER);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('Esc closes the panel', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const node = await page.$('#dag-graph [data-node-cell]');
      if (node) await node.click();
      await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 300));
      const stillOpen = await page.$('[data-agent-panel]');
      expect(stillOpen).toBeNull();
    } finally {
      await browser.close();
    }
  }, 20000);
});
