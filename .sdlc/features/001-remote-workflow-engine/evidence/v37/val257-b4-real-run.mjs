// VAL-257 real-run script: re-proves VAL-256 Cell 3/4 against the FIXED wire shape (finding B4)
// on a genuinely `unconfined` scratch boot (port 8792). See 08-validation.md VAL-256's own
// amendment for why this re-run is needed: the 403 body shape changed (static hint + code, no
// err.message) and _recordRefusal now fires on this path (webhook_list.refusalCount/lastRefusalReason).
import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';

const BASE = 'http://127.0.0.1:8792';

async function callTool(name, args, headers = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

function sign(secret, rawBody) {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

const log = (label, x) => console.log(`\n=== ${label} ===\n` + JSON.stringify(x, null, 2));

// --- Cell 3 (remote-created webhook) ---
const wfRemote = `val257-remote-${randomUUID().slice(0, 8)}`;
const created3 = await callTool('webhook_create', {}, { 'X-Forwarded-For': '203.0.113.9' });
log('webhook_create (remote, X-Forwarded-For)', created3);
const id3 = created3.result.webhookId;
const secret3 = created3.result.secret;
const reg3 = await callTool('workflow_register', { name: wfRemote, script: 'return {hooked:"remote"};', mermaid: 'graph LR', triggers: [id3] });
log('workflow_register (remote)', reg3);
const pub3 = await callTool('workflow_publish', { name: wfRemote, version: reg3.result.version, channel: 'release' });
log('workflow_publish (remote)', pub3);

const rawBody3 = '{}';
const deliverRes3 = await fetch(`${BASE}/hooks/${id3}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-RWE-Signature': sign(secret3, rawBody3),
    'X-RWE-Timestamp': new Date().toISOString(),
    'X-RWE-Delivery': `d-${randomUUID()}`,
  },
  body: rawBody3,
});
const deliverJson3 = await deliverRes3.json();
log('CELL 3 — POST /hooks/:id delivery (remote-created, plain loopback delivery)', {
  status: deliverRes3.status,
  body: deliverJson3,
});

const list3 = await callTool('webhook_list', {});
const row3 = list3.result.find((w) => w.id === id3);
log('CELL 3 — webhook_list row after refused delivery', row3);

// --- Cell 4 (local-created webhook) ---
const wfLocal = `val257-local-${randomUUID().slice(0, 8)}`;
const created4 = await callTool('webhook_create', {});
log('webhook_create (local, no headers)', created4);
const id4 = created4.result.webhookId;
const secret4 = created4.result.secret;
const reg4 = await callTool('workflow_register', { name: wfLocal, script: 'return {hooked:"local"};', mermaid: 'graph LR', triggers: [id4] });
const pub4 = await callTool('workflow_publish', { name: wfLocal, version: reg4.result.version, channel: 'release' });
log('workflow_publish (local)', pub4);

const rawBody4 = '{}';
const deliverRes4 = await fetch(`${BASE}/hooks/${id4}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-RWE-Signature': sign(secret4, rawBody4),
    'X-RWE-Timestamp': new Date().toISOString(),
    'X-RWE-Delivery': `d-${randomUUID()}`,
  },
  body: rawBody4,
});
const deliverJson4 = await deliverRes4.json();
log('CELL 4 — POST /hooks/:id delivery (local-created, plain loopback delivery)', {
  status: deliverRes4.status,
  body: deliverJson4,
});

// give the run a moment to complete
await new Promise((r) => setTimeout(r, 1500));
const runResult4 = deliverJson4.runId ? await callTool('run_result', { runId: deliverJson4.runId }) : { result: { status: 'NO RUNID (delivery not 202)' } };
log('CELL 4 — run_result', runResult4);

const list4 = await callTool('webhook_list', {});
const row4 = list4.result.find((w) => w.id === id4);
log('CELL 4 — webhook_list row after successful delivery', row4);

console.log('\n=== SUMMARY ===');
console.log('Cell3 status', deliverRes3.status, 'code', deliverJson3.code, 'error===hint(not err.message)?', deliverJson3.error);
console.log('Cell3 webhook_list createdRemote', row3.createdRemote, 'refusalCount', row3.refusalCount, 'lastRefusalReason', row3.lastRefusalReason);
console.log('Cell4 status', deliverRes4.status, 'runId', deliverJson4.runId, 'run status', runResult4.result?.status);
console.log('Cell4 webhook_list createdRemote', row4.createdRemote, 'refusalCount', row4.refusalCount);
