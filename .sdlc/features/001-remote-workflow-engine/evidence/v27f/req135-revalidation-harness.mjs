// v27 Gate 7.5 round 3 (validator) independent re-measurement of VAL-209 / REQ-135, against the
// REAL deployed instance booted by `./deploy.sh --background` (documented one-command deploy, not a
// self-booted in-process server, and NOT a FAKE_GATEWAY — every agent() call below is a real local
// Ollama call through the real gateway:"sdk" wiring). Re-checks the SAME four signals VAL-209
// recorded as failing at the prior round, on the SAME primary route, so the flip is like-for-like:
//   (1) .cell-layer.onSelectAgent is now a function on /dashboard/workflow/:name
//   (2) a real click on [data-node-cell][data-agent-id] fires a real
//       /api/runs/:id/agents/:agentId request
//   (3) [data-agent-panel] appears with 6 [data-stat-card]
//   (4) slide side follows real click position: leftmost lane -> no `from-left`,
//       rightmost lane -> `from-left` (needs >=4 lanes so left/right straddle the graph midpoint)
// Also takes one REQ-136 measurement of opportunity: since the panel now genuinely fetches
// /api/runs/:id/agents/:agentId on this route (it never did before), confirm that response still
// carries no systemPrompt/prompt-template field.
import puppeteer from 'puppeteer';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BASE = process.env.RWE_BASE_URL || 'http://127.0.0.1:8937';

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no chrome found');
}

async function mcpCall(name, args) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${name} -> ${JSON.stringify(body.error)}`);
  return JSON.parse(body.result.content[0].text);
}

const REUSE_WF = process.env.RWE_REUSE_WF;
const REUSE_RUN = process.env.RWE_REUSE_RUN;
const WF_NAME = REUSE_WF || `val209-round3-${Date.now()}`;
const LABELS = ['leftAgent', 'midA', 'midB', 'rightAgent'];
const agentsDecl = LABELS
  .map((l) => `${JSON.stringify(l)}: { model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }`)
  .join(', ');
const script = [
  `export const meta = { description: 'REQ-135 round-3 validator re-check', params: { agents: { ${agentsDecl} } } };`,
  `phase('one'); await agent('leftAgent', { prompt: 'Reply with exactly one word: left.' });`,
  `phase('two'); await agent('midA', { prompt: 'Reply with exactly one word: midA.' });`,
  `phase('three'); await agent('midB', { prompt: 'Reply with exactly one word: midB.' });`,
  `phase('four'); await agent('rightAgent', { prompt: 'Reply with exactly one word: right.' });`,
  `return 'ok';`,
].join('\n');

let runId = REUSE_RUN;
if (!runId) {
  console.log('=== registering', WF_NAME, '===');
  const PHASES = ['one', 'two', 'three', 'four'];
  const mermaid = ['graph LR']
    .concat(PHASES.flatMap((p, i) => [`subgraph "${p}"`, `n${i}(["${LABELS[i]}"])`, 'end']))
    .concat(LABELS.slice(1).map((_, i) => `n${i} --> n${i + 1}`))
    .join('\n');
  const reg = await mcpCall('workflow_register', { name: WF_NAME, script, mermaid });
  const version = reg?.result?.version ?? (typeof reg?.version === 'number' ? `v${reg.version}` : undefined);
  if (reg.error || !version) throw new Error(`workflow_register failed: ${JSON.stringify(reg)}`);
  const pub = await mcpCall('workflow_publish', { name: WF_NAME, version, channel: 'release' });
  if (pub.error) throw new Error(`workflow_publish failed: ${JSON.stringify(pub)}`);

  console.log('=== run_start ===');
  const run = await mcpCall('run_start', { name: WF_NAME });
  if (run.error || !run.runId) throw new Error(`run_start failed: ${JSON.stringify(run)}`);
  runId = run.runId;
  console.log('runId', runId);

  const deadline = Date.now() + 400000;
  let status;
  while (Date.now() < deadline) {
    status = await mcpCall('run_status', { runId });
    if (['completed', 'failed'].includes(status.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('=== final run status ===', status.status);
  if (status.status !== 'completed') throw new Error(`run did not complete: ${JSON.stringify(status)}`);
} else {
  console.log('=== reusing existing workflow/run ===', WF_NAME, runId);
}

const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });

const seenAgentRequests = [];
page.on('request', (req) => {
  const u = req.url();
  if (/\/api\/runs\/[^/]+\/agents\/[^/]+/.test(u)) seenAgentRequests.push(u);
});

const url = `${BASE}/dashboard/workflow/${WF_NAME}`;
console.log('=== navigating', url, '===');
await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
await page.waitForSelector('[data-node-cell]', { timeout: 5000 });

const nodeCount = await page.$$eval('[data-node-cell]', (els) => els.length);
const onSelectAgentIsFunction = await page.$eval('.cell-layer', (el) => typeof el.onSelectAgent === 'function');

// (1)+(2)+(3): click the FIRST (leftmost lane) cell.
const nodesA = await page.$$('[data-node-cell]');
await nodesA[0].click();
await page.waitForSelector('[data-agent-panel]', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 200)); // let the intercepted request list settle
const statCardCountLeft = await page.$$eval('[data-agent-panel] [data-stat-card]', (els) => els.length);
const leftClickClass = await page.$eval('[data-agent-panel]', (el) => el.className);
await page.screenshot({ path: new URL('./req135-round3-left-lane-click.png', import.meta.url).pathname, fullPage: true });
const agentIdInPanel = await page.$eval('[data-agent-panel]', (el) => el.getAttribute('data-agent-id') || '');

await page.keyboard.press('Escape');
await page.waitForSelector('[data-agent-panel]', { hidden: true, timeout: 3000 });

// (4): click the LAST (rightmost lane) cell.
const nodesB = await page.$$('[data-node-cell]');
await nodesB[nodesB.length - 1].click();
await page.waitForSelector('[data-agent-panel]', { timeout: 5000 });
const rightClickClass = await page.$eval('[data-agent-panel]', (el) => el.className);
await page.screenshot({ path: new URL('./req135-round3-right-lane-click.png', import.meta.url).pathname, fullPage: true });

// REQ-136 measurement of opportunity: the /agents/:id response this panel just fetched on THIS
// route (it fetched nothing here before the fix) carries no systemPrompt/prompt-template field.
const lastAgentUrl = seenAgentRequests[seenAgentRequests.length - 1];
const agentResp = lastAgentUrl ? await (await fetch(lastAgentUrl)).json() : null;
const agentRespKeys = agentResp ? Object.keys(agentResp) : [];
const hasSystemPromptKey = agentRespKeys.some((k) => /systemprompt/i.test(k));

console.log('=== node cell count (want 4) ===', nodeCount);
console.log('=== .cell-layer.onSelectAgent is a function (want true) ===', onSelectAgentIsFunction);
console.log('=== agent-panel requests observed ===', seenAgentRequests);
console.log('=== stat card count on left-lane click (want 6) ===', statCardCountLeft);
console.log('=== agent id shown in panel ===', agentIdInPanel);
console.log('=== left-lane click panel class (want NOT to contain from-left) ===', leftClickClass);
console.log('=== right-lane click panel class (want to contain from-left) ===', rightClickClass);
console.log('=== last /agents/:id response keys (REQ-136, want no systemPrompt-ish key) ===', agentRespKeys);
console.log('=== hasSystemPromptKey (want false) ===', hasSystemPromptKey);

const pass =
  nodeCount === 4 &&
  onSelectAgentIsFunction === true &&
  seenAgentRequests.length >= 2 &&
  statCardCountLeft === 6 &&
  !leftClickClass.includes('from-left') &&
  rightClickClass.includes('from-left') &&
  hasSystemPromptKey === false;

console.log('=== PASS ===', pass);

await browser.close();
if (!pass) process.exit(1);
