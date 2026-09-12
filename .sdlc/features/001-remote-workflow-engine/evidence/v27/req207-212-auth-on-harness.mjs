// v27 Gate 7.5 (VAL-207 case 3 / VAL-212 / dag.lanes-under-auth): real deployed instance A
// (auth.enabled:true). Mints a bearer directly against the real TokenStore over the server's own
// auth-tokens.db (same technique as tests/integration/dag-masking-auth.test.ts's mintBearer — the
// real production TokenStore class, not a mock; the interactive Google OAuth consent screen is not
// automatable in this environment, and the acceptance clause under test is the READ path's
// behaviour under auth, not the OAuth login flow itself, which is already validated elsewhere).
// Registration/run_start need the bearer; the dashboard page and every /api/* GET need NONE
// (ADR-051's own "mintBearer trap" — the case must not pass vacuously on 404).
import Database from 'better-sqlite3';
import { TokenStore } from '../../../../../src/auth/token-store.ts';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
}

const WORKROOT = '/home/user/rwe-val-v27/A/workroot';
const BASE = 'http://127.0.0.1:8936';
const EMAIL = 'hsuhungjung@gmail.com';

function mintBearer(workRoot, email) {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  const store = new TokenStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) });
  const { token } = store.issue(email, 7 * 24 * 3600_000);
  db.close();
  return token;
}

async function mcp(name, args, bearer) {
  const headers = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }) });
  const body = await res.json();
  if (body.error) throw new Error(`${name} -> ${JSON.stringify(body.error)}`);
  return JSON.parse(body.result.content[0].text);
}

const bearer = mintBearer(WORKROOT, EMAIL);
console.log('minted bearer for', EMAIL, '(len', bearer.length, ')');

// register/run WITHOUT a bearer first -> must be refused (auth genuinely gates writes)
let refused = false;
try { await mcp('workflow_register', { name: 'val27-auth-noauth-probe', script: 'phase("x"); return 1;', mermaid: 'graph LR' }, undefined); }
catch (e) { refused = true; console.log('register with NO bearer refused (expected):', e.message.slice(0, 200)); }

const MERMAID = `graph LR
subgraph "REQUIREMENTS"
a1(["a1"])
a2(["a2"])
end
subgraph "ARCHITECTURE"
b1(["b1"])
end
subgraph "DESIGN"
c1(["c1"])
c2(["c2"])
c3(["c3"])
end
subgraph "IMPLEMENTATION"
d1(["d1"])
end
subgraph "VERIFICATION"
e1(["e1"])
e2(["e2"])
end
a1-->a2
a2-->b1
b1-->c1
c1-->c2
c2-->c3
c3-->d1
d1-->e1
e1-->e2`;

function decl(model) { return { model: { type: 'string', default: model }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }; }
const SCRIPT = `
export const meta = {
  description: 'v27 Gate 7.5 auth-ON probe (VAL-207 case 3 / dag.lanes under auth)',
  phases: [ { title: 'REQUIREMENTS' }, { title: 'ARCHITECTURE' }, { title: 'DESIGN' }, { title: 'IMPLEMENTATION' }, { title: 'VERIFICATION' } ],
  params: { agents: {
    a1: ${JSON.stringify(decl('local'))}, a2: ${JSON.stringify(decl('local'))}, b1: ${JSON.stringify(decl('local'))},
    c1: ${JSON.stringify(decl('local'))}, c2: ${JSON.stringify(decl('local'))}, c3: ${JSON.stringify(decl('local'))},
    d1: ${JSON.stringify(decl('local'))}, e1: ${JSON.stringify(decl('local'))},
    e2: ${JSON.stringify(decl('local'))},
  } },
};
phase('REQUIREMENTS');
await agent('a1', { prompt: 'val27-auth-marker-agent says hi' });
await agent('a2', { prompt: 'p' });
phase('ARCHITECTURE');
await agent('b1', { prompt: 'p' });
phase('DESIGN');
await agent('c1', { prompt: 'p' }); await agent('c2', { prompt: 'p' }); await agent('c3', { prompt: 'p' });
phase('IMPLEMENTATION');
await agent('d1', { prompt: 'p' });
phase('VERIFICATION');
await agent('e1', { prompt: 'p' }); await agent('e2', { prompt: 'p' });
return 'ok';
`;

async function registerAndPublish(name, withRun) {
  const reg = await mcp('workflow_register', { name, script: SCRIPT, mermaid: MERMAID }, bearer);
  if (reg.status === 'failed') throw new Error(`register failed: ${JSON.stringify(reg.error)}`);
  const version = reg.result.version;
  await mcp('workflow_publish', { name, version, channel: 'release' }, bearer);
  console.log(`registered+published ${name}@${version} (WITH bearer)`);
  if (!withRun) return { version, runId: null };
  const started = await mcp('run_start', { name }, bearer);
  const runId = started.runId;
  const deadline = Date.now() + 60000;
  let status;
  while (Date.now() < deadline) {
    status = await mcp('run_status', { runId }, bearer);
    if (['completed', 'failed'].includes(status.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`run ${runId} -> ${status.status}`);
  return { version, runId };
}

const { runId } = await registerAndPublish('val27-auth-run', true);
await registerAndPublish('val27-auth-neverrun', false);

console.log('AUTH_RUN_ID=' + runId);

// ---- Now the actual proof: anonymous GET (no bearer at all) must show the real overlay ----
async function anonGet(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, text: await res.text() };
}

const dashPage = await anonGet(`/dashboard/workflow/val27-auth-neverrun`);
console.log('anonymous GET /dashboard/workflow/val27-auth-neverrun (raw HTML, pre-JS) -> status', dashPage.status);

// The dashboard is a shell + JSON data island + client module script (ARCH-122) -- the rendered
// "predicted structure" text is produced BY THE CLIENT JS, not present in the raw server HTML. A
// real browser (no bearer at all -- anonymous session) is the correct oracle here.
const EVIDENCE_DIR = '/home/user/Documents/remote-workflow/.sdlc/features/001-remote-workflow-engine/evidence/v27';
const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.goto(`${BASE}/dashboard/workflow/val27-auth-neverrun`, { waitUntil: 'networkidle0', timeout: 15000 });
const clone = await page.evaluate(() => {
  const c = document.body.cloneNode(true);
  c.querySelectorAll('script, style').forEach((el) => el.remove());
  return c.textContent ?? '';
});
const hasPredicted = /predicted|預測結構/i.test(clone);
const hasAgentLabels = /a1|a2|b1|c1|c2|c3|d1|e1|e2/.test(clone);
await page.screenshot({ path: `${EVIDENCE_DIR}/req133-req134-auth-on-neverrun.png`, fullPage: true });
console.log('anonymous real-browser GET (auth ON, no bearer) /dashboard/workflow/val27-auth-neverrun:');
console.log('  hasPredicted:', hasPredicted, ' hasAgentLabels:', hasAgentLabels);
await browser.close();

const dagRes = await fetch(`${BASE}/api/runs/${runId}/dag`);
const dag = await dagRes.json();
console.log('anonymous GET /api/runs/:id/dag (auth ON) -> status', dagRes.status, ' lanes:', JSON.stringify(dag.lanes));
console.log('  has cells:', Array.isArray(dag.cells), 'cell count:', dag.cells?.length);
const cellLabels = (dag.cells || []).map((c) => c.label);
console.log('  cell labels (real agent names, not masked):', JSON.stringify(cellLabels));

// the DASHBOARD's own REST describe route (server.ts's describeMatch) is genuinely anonymous
// ({kind:'auth-disabled'} regardless of authEnabled) -- distinct from the generic /mcp tools/call
// envelope, which DOES require a bearer under auth (confirmed above: workflow_describe over /mcp
// with no bearer -> {"error":"unauthorized"}). This is the route the dashboard's own client JS calls.
const describeRes = await fetch(`${BASE}/api/workflows/val27-auth-neverrun/describe`);
const describe = await describeRes.json();
console.log('anonymous GET /api/workflows/:name/describe (no bearer) -> status', describeRes.status, 'phases[].agents:', JSON.stringify(describe.phases));

// ---- p95 measurement (ADR-051): GET /api/runs/:id/dag, auth ON, 200 sequential GETs ----
const durations = [];
for (let i = 0; i < 200; i++) {
  const t0 = performance.now();
  await fetch(`${BASE}/api/runs/${runId}/dag`);
  durations.push(performance.now() - t0);
}
durations.sort((a, b) => a - b);
const p50 = durations[Math.floor(0.50 * durations.length)];
const p95 = durations[Math.floor(0.95 * durations.length)];
console.log(`p95 measurement: N=200 sequential GET /api/runs/:id/dag (auth ON) p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
