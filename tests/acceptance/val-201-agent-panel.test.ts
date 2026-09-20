// VAL-201 (REQ-135, REQ-136; DES-205/206; 04-design.md's own v27 real-tier path): real Chromium —
// clicking a real agent node opens the slide-in panel: six stat cards, the user prompt in a
// `<pre>`, the three tag columns, the event list, Esc/backdrop close — and REQ-136's own proof that
// the prompt shown is the SCRIPT prompt, never the agentType systemPrompt.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP, real Chromium, a real agentType
// composition root with a distinctive systemPrompt marker (same technique as IT-165). The
// `.event-kind.is-tool`/`.is-message` SPEC_ROWS below need one more real thing this file did not
// have before: a real `ClaudeAgentSdkGatewayClient` session (only the third-party
// `@anthropic-ai/claude-agent-sdk` `query` export is faked — same seam IT-027 already uses) on a
// SECOND server, so a real tool_use/tool_result/message turn reaches a real panel — the plain
// ollama-stub run every other test in this file opens never produces either event kind.
//
// Red reason (measured): today's `#detail` pane shows the transcript inline with no slide-in panel
// and no stat cards at all (`dashboard-page.ts`'s `renderTranscript`) — none of the panel selectors
// below exist.
//
// [v27 Gate 7.5 round 2 fix] Every case above only ever opens the panel via the LEGACY
// `/dashboard/<runId>` route. The validator measured that route and the product's PRIMARY route,
// `/dashboard/workflow/:name` (`ui/workflow.js`), diverge: the latter's `paintSwimlane` calls never
// passed `onSelectAgent`, so a click there opened nothing. The two cases at the end of this file
// close that gap — one proves the panel opens on the primary route, the other proves the slide
// SIDE (left half of the graph -> slides from the left, right half -> from the right) really
// follows the clicked node, a clause this file never asserted before (see `agent-panel.js`'s own
// banner: the previous side computation read `window.event` after an `await`, always `undefined`).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer } from '../../src/server.js';
import type { Server, ServerConfig } from '../../src/server.js';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { runScriptVia, registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';
import { SPEC_ROWS } from '../fixtures/dashboard-spec.js';
import { specRowFailuresAcrossThemeAndHue } from '../helpers/spec-rows.js';

// Same technique as IT-027 (tests/integration/agent-transcript-message-stream.test.ts): only the
// SDK's own `query` export is faked, never anything this product owns. `vi.hoisted` is required
// here (unlike IT-027) because THIS file statically imports `../../src/server.js`, which imports
// the real `claude-agent-sdk-client.ts` at module-eval time — a bare `const queryMock = vi.fn()`
// referenced from the (hoisted-above-imports) `vi.mock` factory would still be in its temporal
// dead zone when that import chain runs. Spreading `...(await orig())` keeps every OTHER real
// export of the SDK module intact — the factory below replaces `query` only.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', async (orig) => ({ ...(await orig<object>()), query: queryMock }));

/** A realistic assistant-text -> tool_use -> tool_result -> result session (IT-027's own fixture,
 *  distinct uuids/ids so a failure message never gets confused with that file's). */
function fakeToolUseSession() {
  return (async function* () {
    yield {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'checking the file now' }] },
      parent_tool_use_id: null, uuid: 'val201-u1', session_id: 'val201-s1',
    };
    yield {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'val201-tu-1', name: 'Read', input: { path: 'x.txt' } }] },
      parent_tool_use_id: null, uuid: 'val201-u2', session_id: 'val201-s1',
    };
    yield {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'val201-tu-1', content: 'file contents' }] },
      parent_tool_use_id: null, uuid: 'val201-u3', session_id: 'val201-s1',
    };
    yield { type: 'result', subtype: 'success', is_error: false, result: 'done reading', usage: { input_tokens: 4, output_tokens: 4 } };
  })();
}

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
// [v27c gate 6] a prompt carrying this token gets a real 404 from the stub — `terminalHttpFailure`
// (`src/gateway/client.ts:257/361`) classifies a 404 as `reason:'terminal', retryable:false` and
// stamps `AgentRecord.detail = "404 Not Found"`, which is the ONLY way `agent.js`'s `panelModel`
// ever sets `vm.detail` (DES-205 §6's "failed with detail" fixture). The `panel-agent` run every
// other test in this file opens never fails, so `.detail-block` needs its own run.
const FAIL_MARKER = 'RWE-V27-VAL201-FAIL-MARKER';

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
      let prompt: unknown;
      try { prompt = JSON.parse(raw).prompt; } catch { prompt = undefined; }
      if (typeof prompt === 'string' && prompt.includes(FAIL_MARKER)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'model not found (planted for VAL-201)' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ response: 'ack', prompt_eval_count: 1, eval_count: 1 }));
    });
  });
}

let server: Server;
let baseUrl: string;
let runId: string;
let failRunId: string;
let stub: HttpServer;
// The second server (real ClaudeAgentSdkGatewayClient, SDK `query` mocked) — its ONE run is the
// SPEC_ROWS oracle's `.event-kind.is-tool`/`.is-message` anchor.
let toolServer: Server;
let toolBaseUrl: string;
let toolRunId: string;
// [v27 Gate 7.5 round 2 fix] Registered under an EXPLICIT name (needed to navigate
// `/dashboard/workflow/:name` — `runScriptVia`'s auto-generated name above is never returned to
// the caller), four phases/lanes wide so the swimlane places a real agent cell in EACH half of the
// graph (`SWIMLANE_BOX`'s own constants: with 4 lanes, lane 0's cell center sits at ~21% of the
// total width and lane 3's at ~89%) — the fixture the side-assertion case below needs.
let sideWorkflowName: string;
let sideRunId: string;
const ORIGINAL_OLLAMA_BASE_URL = process.env['OLLAMA_BASE_URL'];

function makeCaller(base: string) {
  return async (tool: string, args: unknown) => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name: tool, arguments: args } }) });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  };
}

async function waitTerminal(base: string, id: string): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/runs/${id}`);
    const s = (await res.json()) as { status?: string };
    if (['completed', 'failed'].includes(s.status ?? '')) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

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
  const caller = makeCaller(baseUrl);
  const run = await runScriptVia(caller, `return agent('panel-agent', { agentType: 'marked', prompt: 'the visible script prompt' });`);
  runId = run.runId as string;
  await waitTerminal(baseUrl, runId);
  // A failed `agent()` call resolves to `null` and the SCRIPT keeps going (same rule as
  // `failed-call-unmapped-meta.test.ts`), so this run's own status is `completed` — it is the
  // ONE agent record inside it that is `state:'failed'` with a `detail`.
  const failRun = await runScriptVia(caller, `return agent('panel-agent-failing', { prompt: '${FAIL_MARKER}' });`);
  failRunId = failRun.runId as string;
  await waitTerminal(baseUrl, failRunId);

  // [v27 Gate 7.5 round 2 fix, REQ-135] see the `sideWorkflowName`/`sideRunId` comment above.
  sideWorkflowName = uniqueWorkflowName('val201-side');
  await registerPublishedVia(caller, sideWorkflowName,
    `phase('one'); await agent('leftAgent', { prompt: 'p' });\n` +
    `phase('two'); await agent('midAgentA', { prompt: 'p' });\n` +
    `phase('three'); await agent('midAgentB', { prompt: 'p' });\n` +
    `phase('four'); await agent('rightAgent', { prompt: 'p' });\n` +
    `return 'ok';`);
  const sideRun = await caller('run_start', { name: sideWorkflowName });
  sideRunId = sideRun.runId as string;
  await waitTerminal(baseUrl, sideRunId);

  // The tool-call run: a SEPARATE server (no ollama stub involved) whose ONE gateway is a real
  // ClaudeAgentSdkGatewayClient — `query()` is mocked (module-level, above) to yield one real
  // assistant-text turn and one real tool_use/tool_result pair, so the panel's event list gets a
  // genuine `message` kind and a genuine `tool_call`/`tool_result` kind, closing the fixture gap
  // the previous audit pass measured and reported (SPEC_ROWS comment above the two rows).
  queryMock.mockImplementation(() => fakeToolUseSession());
  toolServer = await createServer({
    port: 0, bind: '127.0.0.1',
    gateway: new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' }),
  });
  toolBaseUrl = `http://127.0.0.1:${toolServer.port}`;
  const toolRun = await runScriptVia(makeCaller(toolBaseUrl), `return agent('toolcall-agent', { prompt: 'inspect the file' });`);
  toolRunId = toolRun.runId as string;
  await waitTerminal(toolBaseUrl, toolRunId);
}, 30000);

afterAll(async () => {
  await server?.close();
  await toolServer?.close();
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
      const node = await page.$('#dag-zoom [data-node-cell]');
      expect(node).not.toBeNull();
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
      const node = await page.$('#dag-zoom [data-node-cell]');
      expect(node).not.toBeNull();
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
      const node = await page.$('#dag-zoom [data-node-cell]');
      expect(node).not.toBeNull();
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

  // [v27c] DES-209's own promised oracle (ADR-053 「規格逐條核」): every SPEC_ROWS row for the
  // 'panel' view, checked under BOTH data-theme values and once more after a hue-slider move. A row
  // whose anchor matches no element FAILS (never skips) — see spec-rows.ts.
  itReal('SPEC_ROWS (panel view, REQ-135) hold under both themes and a hue move', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const rows = SPEC_ROWS.filter((r) => r.view === 'panel');
      // `.detail-block` (REQ-135) only exists on a FAILED agent's panel (DES-205 §6) — the
      // `panel-agent` run every other test opens never fails, so that one row is checked against
      // `failRunId`'s panel. `.event-kind.is-tool`/`.is-message` only exist on a panel whose
      // transcript actually contains a tool_call/tool_result/message event — the plain ollama-stub
      // `panel-agent`/`panel-agent-failing` runs never produce either, so those two rows are
      // checked against the separate `toolRunId` panel (real ClaudeAgentSdkGatewayClient session,
      // mocked SDK `query()` — see the file banner). Everything else stays on the successful
      // ollama-stub run, same as before.
      const detailRows = rows.filter((r) => r.anchor.includes('.detail-block'));
      const toolKindRows = rows.filter((r) => r.anchor.includes('.event-kind.is-tool') || r.anchor.includes('.event-kind.is-message'));
      const otherRows = rows.filter((r) => !detailRows.includes(r) && !toolKindRows.includes(r));

      await page.goto(`${baseUrl}/dashboard/${failRunId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const failNode = await page.$('#dag-zoom [data-node-cell]');
      expect(failNode).not.toBeNull();
      if (failNode) await failNode.click();
      await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
      const detailFailures = await specRowFailuresAcrossThemeAndHue(page, detailRows);

      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const node = await page.$('#dag-zoom [data-node-cell]');
      expect(node).not.toBeNull();
      if (node) await node.click();
      await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
      const otherFailures = await specRowFailuresAcrossThemeAndHue(page, otherRows);

      await page.goto(`${toolBaseUrl}/dashboard/${toolRunId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const toolNode = await page.$('#dag-zoom [data-node-cell]');
      expect(toolNode).not.toBeNull();
      if (toolNode) await toolNode.click();
      await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
      const toolKindFailures = await specRowFailuresAcrossThemeAndHue(page, toolKindRows);

      expect([...detailFailures, ...otherFailures, ...toolKindFailures]).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 40000);

  // [v27 Gate 7.5 round 2 fix, REQ-135] Every case above opens the panel on the LEGACY
  // `/dashboard/<runId>` route. This is the PRIMARY route (`ui/workflow.js`) — the one that was
  // measured broken (`ui/workflow.js`'s two `paintSwimlane` calls never passed `onSelectAgent`).
  itReal('clicking a real agent node on /dashboard/workflow/:name (the primary route) opens the slide-in panel', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/${sideWorkflowName}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('[data-node-cell]', { timeout: 3000 });
      const node = await page.$('[data-node-cell]');
      expect(node).not.toBeNull();
      if (node) await node.click();
      await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
      const statCardCount = await page.$$eval('[data-agent-panel] [data-stat-card]', (els) => els.length);
      expect(statCardCount).toBe(6);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v27 Gate 7.5 round 2 fix, REQ-135] The slide SIDE — never asserted anywhere before this case
  // (the previous side computation read `window.event` after an `await`, always `undefined`, so it
  // always defaulted to 'right'; see `agent-panel.js`'s own banner). `sideWorkflowName`'s 4-lane
  // fixture places `leftAgent` in the graph's LEFT half (-> slides in from the RIGHT, no
  // `.from-left`) and `rightAgent` in the RIGHT half (-> slides in from the LEFT, `.from-left`).
  itReal('the slide side follows the clicked node\'s real position on /dashboard/workflow/:name (REQ-135)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/${sideWorkflowName}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('[data-node-cell]', { timeout: 3000 });
      const nodes = await page.$$('[data-node-cell]');
      expect(nodes.length).toBeGreaterThanOrEqual(2);

      await nodes[0]!.click();
      await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
      const leftHalfClass = await page.$eval('[data-agent-panel]', (el) => el.className);
      expect(leftHalfClass).not.toContain('from-left');

      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-agent-panel]', { hidden: true, timeout: 3000 });

      await nodes[nodes.length - 1]!.click();
      await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
      const rightHalfClass = await page.$eval('[data-agent-panel]', (el) => el.className);
      expect(rightHalfClass).toContain('from-left');
    } finally {
      await browser.close();
    }
  }, 20000);
  // [v32, REQ-200, F14] REQ-150 already fixed this class one level up ("the six labels were English
  // literals in both languages") and stopped there: the token breakdown UNDER the Tokens card is
  // still `in N · out N · cache read N · cache write N`, hardcoded identically for both languages
  // (`lib/agent.js:22-24`), and the effort card still prefixes `not applied:` (`:41` — the `reason`
  // that follows it IS wire text and stays). The reference renders the same breakdown as
  // `輸入 · 輸出 · 快取讀取 · 快取寫入`.
  itReal('the zh agent panel carries no English UI literals in its token/effort cards (REQ-200)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const node = await page.$('#dag-zoom [data-node-cell]');
      expect(node).not.toBeNull();
      if (node) await node.click();
      await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
      const text = await page.$eval('[data-agent-panel]', (el) => (el as HTMLElement).innerText);
      const leaks = ['in ', 'out ', 'cache read', 'cache write', 'not applied:'].filter((w) => text.includes(w));
      expect(leaks).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);
  // [v32, REQ-199, F13] the unit tier can assert `stats[i].meta` exists; only a browser can say the
  // panel actually paints it. README §3: "Duration (start → end)".
  itReal('the Duration card paints its start → end sub-line (REQ-199)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const node = await page.$('#dag-zoom [data-node-cell]');
      expect(node).not.toBeNull();
      if (node) await node.click();
      await page.waitForSelector('[data-agent-panel] [data-stat-card]', { timeout: 3000 });
      const durationCard = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[data-agent-panel] [data-stat-card]'));
        const card = cards.find((c) => /耗時|Duration/.test((c.querySelector('.stat-label') as HTMLElement)?.innerText ?? ''));
        if (!card) return null;
        return {
          value: (card.querySelector('.stat-value') as HTMLElement)?.innerText ?? null,
          meta: (card.querySelector('.stat-meta') as HTMLElement)?.innerText ?? null,
        };
      });
      expect(durationCard).not.toBeNull();
      expect(durationCard!.meta, 'README §3: "Duration (start → end)"').toMatch(/\d+\/\d+ \d{2}:\d{2}:\d{2} → \d+\/\d+ \d{2}:\d{2}:\d{2}/);
    } finally {
      await browser.close();
    }
  }, 20000);
});
