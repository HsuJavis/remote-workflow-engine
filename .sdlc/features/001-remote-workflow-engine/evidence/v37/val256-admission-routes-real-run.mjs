// VAL-256 real-tier exercise script: schedule + webhook admission routes (ARCH-182/DES-263).
// Talks to the scratch engine booted via ./deploy.sh --background on 127.0.0.1:8791.
import { createHmac } from 'node:crypto';

const BASE = 'http://127.0.0.1:8791';

async function mcpCall(name, args = {}, extraHeaders = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

// Headers that flip `isLoopbackPeer` -> false even though the TCP peer really is loopback —
// exactly the "X-Forwarded-For shape the door treats as remote" the dispatch names.
const REMOTE_HEADERS = { 'X-Forwarded-For': '203.0.113.7' };

function uniq(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

async function registerPublish(call, name, script, triggers) {
  const reg = await call('workflow_register', {
    name, script,
    mermaid: 'graph LR',
    triggers,
  });
  const version = reg.result?.version;
  if (typeof version !== 'string') throw new Error(`register failed for ${name}: ${JSON.stringify(reg)}`);
  const pub = await call('workflow_publish', { name, version, channel: 'release' });
  if (pub.error) throw new Error(`publish failed for ${name}: ${JSON.stringify(pub)}`);
  return version;
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const out = { schedule: {}, webhook: {} };

// ---------- SCHEDULE CELLS ----------
async function scheduleCell(label, headersAtCreate) {
  const created = await mcpCall('schedule_create', { kind: 'once', at: new Date(Date.now() - 2000).toISOString(), enabled: false }, headersAtCreate);
  const id = created.result?.id;
  if (!id) throw new Error(`schedule_create(${label}) failed: ${JSON.stringify(created)}`);
  const wfName = uniq(`val256-sched-${label}`);
  await registerPublish(mcpCall, wfName, 'return 1;', [id]);
  const en = await mcpCall('schedule_setEnabled', { id, enabled: true });
  if (en.error) throw new Error(`schedule_setEnabled(${label}) failed: ${JSON.stringify(en)}`);

  const deadline = Date.now() + 15000;
  let row;
  for (;;) {
    const list = await mcpCall('schedule_list');
    row = (list.result ?? []).find((s) => s.id === id);
    if (row && (row.lastRunId || row.lastRefusalReason || row.enabled === false)) break;
    if (Date.now() > deadline) break;
    await sleep(300);
  }
  return { id, wfName, row };
}

console.log('--- SCHEDULE: creating remote-created trigger ---');
const schedRemote = await scheduleCell('remote', REMOTE_HEADERS);
console.log(JSON.stringify(schedRemote, null, 2));

console.log('--- SCHEDULE: creating local-created trigger ---');
const schedLocal = await scheduleCell('local', {});
console.log(JSON.stringify(schedLocal, null, 2));

out.schedule.remote = schedRemote;
out.schedule.local = schedLocal;

// ---------- WEBHOOK CELLS ----------
async function webhookCell(label, headersAtCreate) {
  const created = await mcpCall('webhook_create', {}, headersAtCreate);
  const { webhookId, url, secret } = created.result ?? {};
  if (!webhookId) throw new Error(`webhook_create(${label}) failed: ${JSON.stringify(created)}`);
  const wfName = uniq(`val256-hook-${label}`);
  await registerPublish(mcpCall, wfName, 'return { hooked: args.event ?? null };', [webhookId]);

  // Delivery peer is deliberately identical (plain loopback, NO tunnel headers) for BOTH cells —
  // what must decide the outcome is who ATTACHED the trigger (headersAtCreate above), not who delivers.
  const body = JSON.stringify({ event: label });
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RWE-Signature': sig,
      'X-RWE-Timestamp': new Date().toISOString(),
      'X-RWE-Delivery': uniq('d'),
    },
    body,
  });
  const status = res.status;
  const respBody = await res.json().catch(() => ({}));
  return { webhookId, wfName, status, respBody };
}

console.log('--- WEBHOOK: creating remote-created trigger, delivering over plain loopback ---');
const hookRemote = await webhookCell('remote', REMOTE_HEADERS);
console.log(JSON.stringify(hookRemote, null, 2));

console.log('--- WEBHOOK: creating local-created trigger, delivering over plain loopback ---');
const hookLocal = await webhookCell('local', {});
console.log(JSON.stringify(hookLocal, null, 2));

out.webhook.remote = hookRemote;
out.webhook.local = hookLocal;

console.log('=== FULL RESULT ===');
console.log(JSON.stringify(out, null, 2));
