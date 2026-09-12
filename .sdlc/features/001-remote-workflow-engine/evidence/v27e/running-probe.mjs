import puppeteer from 'puppeteer';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root).sort().reverse()) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no chrome found');
}

const BASE = process.env.RWE_BASE || 'http://127.0.0.1:8935';
const EVDIR = '/home/user/Documents/remote-workflow/.sdlc/features/001-remote-workflow-engine/evidence/v27e';

async function mcp(name, args) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${name} -> ${JSON.stringify(body.error)}`);
  return JSON.parse(body.result.content[0].text);
}

const reg = await mcp('workflow_register', {
  name: 'val27e-slow2',
  script: `export const meta = { description: 'v27e running-state probe 2', phases: [{title:'X'}], params: { agents: { s1: { model: { type:'string', default:'local' }, effort:{type:'enum',enum:['low','medium','high'],default:'low'}, timeoutMs:{type:'number',default:60000} } } } };\nphase('X');\nawait agent('s1', { prompt: 'Write a detailed 200 word paragraph about distributed systems, covering consensus, replication and partition tolerance.' });\nreturn { ok: true };`,
  mermaid: 'graph LR\nsubgraph "X"\ns1(["s1"])\nend',
});
if (reg.status === 'failed') throw new Error(JSON.stringify(reg.error));
await mcp('workflow_publish', { name: 'val27e-slow2', version: reg.result.version, channel: 'release' });
const started = await mcp('run_start', { name: 'val27e-slow2' });
console.log('started', started.runId);

const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.goto(`${BASE}/dashboard/workflow/val27e-slow2`, { waitUntil: 'networkidle0', timeout: 15000 });
await page.waitForSelector('[data-node-cell]', { timeout: 10000 });

let caught = null;
const deadline = Date.now() + 40000;
while (Date.now() < deadline) {
  const found = await page.evaluate(() => {
    const el = document.querySelector('.cell.is-running');
    if (!el) return null;
    const dot = el.querySelector('.cell-dot');
    const cs = getComputedStyle(dot);
    return { bg: cs.backgroundColor, animation: cs.animationName, cellClass: el.className };
  });
  if (found) { caught = found; await page.screenshot({ path: `${EVDIR}/req134-running-cell.png`, fullPage: true }); break; }
  await new Promise((r) => setTimeout(r, 300));
}
console.log('caught:', JSON.stringify(caught));
const finalStatus = await mcp('run_status', { runId: started.runId });
console.log('finalStatus:', finalStatus.status);
await browser.close();
