// VAL-259 ITEM 4: webhook delivery is refused (403 CONFINEMENT_UNAVAILABLE), then recovered by a
// LOOPBACK (no remote header) workflow_register({triggers:[same webhook id]}) + workflow_publish —
// and the ORIGINAL secret still HMAC-validates the second (recovered) delivery, proving the trigger
// row (id + secret) was never touched, only the version was replaced.
import { createHmac } from 'node:crypto';

const BASE = 'http://127.0.0.1:8901';
const REMOTE_HEADERS = { 'X-Forwarded-For': '203.0.113.11' };

async function mcpCall(name, args = {}, extraHeaders = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  let parsed;
  try { parsed = JSON.parse(body.result?.content?.[0]?.text ?? '{}'); } catch { parsed = { rawResultBody: body }; }
  return { httpStatus: res.status, ...parsed };
}
function uniq(prefix) { return `${prefix}-${Math.random().toString(36).slice(2, 8)}`; }

async function deliver(url, secret, payload) {
  const body = JSON.stringify(payload);
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
  return { status, respBody };
}

const out = {};

console.log('--- webhook_create (LOCAL, no headers) ---');
const created = await mcpCall('webhook_create', {});
console.log(JSON.stringify(created, null, 2));
const { webhookId, url, secret: originalSecret } = created.result ?? {};
if (!webhookId) throw new Error(`webhook_create failed: ${JSON.stringify(created)}`);
out.webhookId = webhookId;
out.originalSecret = originalSecret;
out.url = url;

const wfName = uniq('val259-item4-wf');
console.log('--- workflow_register (REMOTE headers), triggers:[webhookId] ---');
const reg1 = await mcpCall('workflow_register', { name: wfName, script: 'return { hooked: args.event ?? null, phase: "remote-v1" };', mermaid: 'graph LR', triggers: [webhookId] }, REMOTE_HEADERS);
console.log(JSON.stringify(reg1, null, 2));
const v1 = reg1.result?.version;
if (!v1) throw new Error(`register(remote) failed: ${JSON.stringify(reg1)}`);

console.log('--- workflow_publish v1 to release ---');
const pub1 = await mcpCall('workflow_publish', { name: wfName, version: v1, channel: 'release' });
console.log(JSON.stringify(pub1, null, 2));
if (pub1.error) throw new Error(`publish(v1) failed: ${JSON.stringify(pub1)}`);

console.log('--- FIRST delivery: correctly HMAC-signed with the ORIGINAL secret, expect 403 CONFINEMENT_UNAVAILABLE ---');
const delivery1 = await deliver(url, originalSecret, { event: 'before-recovery' });
console.log(JSON.stringify(delivery1, null, 2));
out.delivery1 = delivery1;

console.log('--- webhook_list: confirm secretFingerprint + createdRemote BEFORE recovery ---');
const listBefore = await mcpCall('webhook_list');
const rowBefore = (listBefore.result ?? []).find((w) => w.id === webhookId);
console.log(JSON.stringify(rowBefore, null, 2));
out.rowBefore = rowBefore;

console.log('--- RECOVERY: LOOPBACK (no remote header) workflow_register({name, script, mermaid, triggers:[SAME webhookId]}) ---');
const reg2 = await mcpCall('workflow_register', { name: wfName, script: 'return { hooked: args.event ?? null, phase: "local-v2-recovered" };', mermaid: 'graph LR', triggers: [webhookId] });
console.log(JSON.stringify(reg2, null, 2));
const v2 = reg2.result?.version;
if (!v2) throw new Error(`register(local recovery) failed: ${JSON.stringify(reg2)}`);
out.recoveredVersion = v2;

console.log('--- RECOVERY: workflow_publish v2 to release ---');
const pub2 = await mcpCall('workflow_publish', { name: wfName, version: v2, channel: 'release' });
console.log(JSON.stringify(pub2, null, 2));
if (pub2.error) throw new Error(`publish(v2) failed: ${JSON.stringify(pub2)}`);

console.log('--- workflow_describe v2: confirm registeredRemote:false on the recovered version ---');
const desc2 = await mcpCall('workflow_describe', { name: wfName, version: v2 });
console.log(JSON.stringify(desc2, null, 2));
out.desc2 = desc2;

console.log('--- webhook_list: id + secretFingerprint + createdRemote AFTER recovery (must be UNCHANGED vs rowBefore) ---');
const listAfter = await mcpCall('webhook_list');
const rowAfter = (listAfter.result ?? []).find((w) => w.id === webhookId);
console.log(JSON.stringify(rowAfter, null, 2));
out.rowAfter = rowAfter;

console.log('--- SECOND delivery: signed with the ORIGINAL secret (never rotated), expect 202 ---');
const delivery2 = await deliver(url, originalSecret, { event: 'after-recovery' });
console.log(JSON.stringify(delivery2, null, 2));
out.delivery2 = delivery2;

console.log('--- Sanity: a delivery signed with a WRONG secret should fail HMAC (401), confirming 202 above is not a fluke of unauthenticated delivery ---');
const delivery3 = await deliver(url, 'deliberately-wrong-secret-0000000000000000000000000000000000', { event: 'wrong-secret-check' });
console.log(JSON.stringify(delivery3, null, 2));
out.delivery3_wrongSecretSanity = delivery3;

console.log('=== FULL RESULT ===');
console.log(JSON.stringify(out, null, 2));
