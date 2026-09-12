// v27e Gate 7.5 RE-VALIDATION — instance A (auth.enabled:true, port 8936). Mints a bearer directly
// against the real TokenStore over the server's own auth-tokens.db (same technique as
// tests/integration/dag-masking-auth.test.ts's mintBearer / the prior v27 round's own
// req207-212-auth-on-harness.mjs) — the real production TokenStore class, never a mock.
import Database from 'better-sqlite3';
import { TokenStore } from '../../../../../src/auth/token-store.ts';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const WORKROOT = '/home/user/.local/share/rwe-scratch-a-v27e';
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
console.log('minted bearer, len', bearer.length);

let noAuthRefused = false;
try {
  await mcp('workflow_register', { name: 'val27e-auth-probe', script: 'phase("x"); return 1;', mermaid: 'graph LR' }, undefined);
} catch (e) {
  noAuthRefused = true;
  console.log('register with NO bearer refused (expected):', e.message.slice(0, 200));
}

const MERMAID = `graph LR\nsubgraph "X"\na1(["a1"])\nend`;
const SCRIPT = `export const meta = { description: 'v27e auth-on probe', phases: [{title:'X'}], params: { agents: { a1: { model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };\nphase('X');\nconst r = await agent('a1', { prompt: 'RWE-V27E-USERPROMPT-MARKER: say hi', agentType: 'echoer' });\nreturn { ok: true, r };`;

const reg = await mcp('workflow_register', { name: 'val27e-authrun', script: SCRIPT, mermaid: MERMAID }, bearer);
if (reg.status === 'failed') throw new Error('register failed: ' + JSON.stringify(reg.error));
console.log('registered', reg.result);
await mcp('workflow_publish', { name: 'val27e-authrun', version: reg.result.version, channel: 'release' }, bearer);
const started = await mcp('run_start', { name: 'val27e-authrun' }, bearer);
console.log('run_start', started);
const deadline = Date.now() + 30000;
let status;
while (Date.now() < deadline) {
  status = await mcp('run_status', { runId: started.runId }, bearer);
  if (['completed', 'failed'].includes(status.status)) break;
  await new Promise((r) => setTimeout(r, 300));
}
console.log('final status', status.status);

// ungated GET reads (DES-162: /api/runs/:id and /api/runs are ungated even with auth on).
const dagRes = await fetch(`${BASE}/api/runs/${started.runId}/dag`);
const dag = await dagRes.json();
console.log('dag (no bearer) http', dagRes.status, 'cells', dag.cells?.length, 'lanes', JSON.stringify(dag.lanes));

const runsRes = await fetch(`${BASE}/api/runs`);
const runs = await runsRes.json();
const thisRun = runs.find((r) => r.runId === started.runId);
console.log('runs-list (no bearer) http', runsRes.status, 'costUSD', thisRun?.costUSD);

const detailRes = await fetch(`${BASE}/api/runs/${started.runId}`);
const detail = await detailRes.json();
console.log('detail (no bearer) http', detailRes.status, 'usage.costUSD', detail.usage?.costUSD, 'IDENTICAL:', detail.usage?.costUSD === thisRun?.costUSD);

// REQ-136 marker check via MCP WITH bearer.
const log = await mcp('run_agent_log', { runId: started.runId, label: 'a1' }, bearer);
const promptHasMarker = (log.harness?.prompt || '').includes('RWE-V27E-USERPROMPT-MARKER');
const sysPromptLeaked = JSON.stringify(log).includes('RWE-V27-VALIDATOR-SYSTEMPROMPT-MARKER-DO-NOT-LEAK');
console.log('REQ-136 (auth-on, MCP transport): promptHasMarker', promptHasMarker, 'sysPromptLeaked', sysPromptLeaked, 'systemPrompt meta', JSON.stringify(log.harness?.systemPrompt));

// dashboard-HTTP transport, no bearer (ungated per DES-162).
const httpLogRes = await fetch(`${BASE}/api/runs/${started.runId}/agents/agent-1`);
const httpLog = await httpLogRes.json();
const httpPromptHasMarker = (httpLog.harness?.prompt || '').includes('RWE-V27E-USERPROMPT-MARKER');
const httpSysLeaked = JSON.stringify(httpLog).includes('RWE-V27-VALIDATOR-SYSTEMPROMPT-MARKER-DO-NOT-LEAK');
console.log('REQ-136 (auth-on, dashboard-HTTP transport): http', httpLogRes.status, 'promptHasMarker', httpPromptHasMarker, 'sysPromptLeaked', httpSysLeaked);

console.log(JSON.stringify({ noAuthRefused, runStatus: status.status, dagOk: dagRes.status === 200, runsListOk: runsRes.status === 200, costUSDMatch: detail.usage?.costUSD === thisRun?.costUSD }));
