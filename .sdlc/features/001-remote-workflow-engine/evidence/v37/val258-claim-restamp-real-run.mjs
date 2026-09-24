// VAL-258 real-tier exercise script (v37 Gate 8 round-3 send-back, finding 12/(8g)(ii)):
// claim()'s local->remote monotone re-stamp (ADR-086's second ruling, 3e3c331+2cf5f32).
// Talks to the scratch engine booted via ./deploy.sh --background on 127.0.0.1:8793.
import { createHmac } from 'node:crypto';

const BASE = 'http://127.0.0.1:8793';

async function mcpCall(name, args = {}, extraHeaders = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

const REMOTE_HEADERS = { 'X-Forwarded-For': '203.0.113.9' };

function uniq(prefix) { return `${prefix}-${Math.random().toString(36).slice(2, 8)}`; }

async function register(call, name, script, triggers, headers = {}) {
  return call('workflow_register', { name, script, mermaid: 'graph LR', triggers }, headers);
}
async function publish(call, name, version) {
  return call('workflow_publish', { name, version, channel: 'release' });
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const out = {};

// ========== (a) local create -> local register(v1,claimed) -> REMOTE re-register(v2,held) upgrades, then refuses ==========
console.log('=== (a) SCHEDULE: local create, local claim, then REMOTE re-register (held) upgrades createdRemote ===');
{
  const created = await mcpCall('schedule_create', { kind: 'once', at: new Date(Date.now() - 2000).toISOString(), enabled: false });
  const id = created.result?.id;
  if (!id) throw new Error(`schedule_create failed: ${JSON.stringify(created)}`);
  const wfName = uniq('val258-sched-a');

  const reg1 = await register(mcpCall, wfName, 'return 1;', [id]); // LOCAL register -> claim(id, wf, false) -> 'claimed'
  const v1 = reg1.result?.version;
  if (!v1) throw new Error(`register v1 failed: ${JSON.stringify(reg1)}`);
  await publish(mcpCall, wfName, v1);

  const afterClaim = (await mcpCall('schedule_list')).result.find((s) => s.id === id);
  console.log('after LOCAL claim (should be createdRemote:false):', JSON.stringify({ createdRemote: afterClaim.createdRemote, claimedBy: afterClaim.claimedBy }));

  // REMOTE re-register of the SAME workflow name, re-listing the SAME trigger id -> claim(id, wf, true) -> 'held' arm
  const reg2 = await register(mcpCall, wfName, 'return 2;', [id], REMOTE_HEADERS);
  const v2 = reg2.result?.version;
  if (!v2) throw new Error(`register v2 (remote) failed: ${JSON.stringify(reg2)}`);
  await publish(mcpCall, wfName, v2); // workflow_publish takes no isRemoteSubmission (only workflow_register does) — the claim() re-stamp already happened inside the register(v2) call above

  const afterHeld = (await mcpCall('schedule_list')).result.find((s) => s.id === id);
  console.log('after REMOTE re-register (held) (should be createdRemote:true):', JSON.stringify({ createdRemote: afterHeld.createdRemote, claimedBy: afterHeld.claimedBy }));

  // fire it and confirm refusal now that createdRemote:true
  await mcpCall('schedule_setEnabled', { id, enabled: true });
  const deadline = Date.now() + 15000;
  let row;
  for (;;) {
    row = (await mcpCall('schedule_list')).result.find((s) => s.id === id);
    if (row.lastError || row.lastRunId) break;
    if (Date.now() > deadline) break;
    await sleep(300);
  }
  console.log('final row after fire attempt:', JSON.stringify(row));
  out.a_schedule = { id, wfName, createdRemote_after_local_claim: afterClaim.createdRemote, createdRemote_after_remote_held: afterHeld.createdRemote, final: row };
}

console.log('=== (a) WEBHOOK: local create, local claim, then REMOTE re-register (held) upgrades createdRemote ===');
{
  const created = await mcpCall('webhook_create', {});
  const { webhookId: id, url, secret } = created.result ?? {};
  if (!id) throw new Error(`webhook_create failed: ${JSON.stringify(created)}`);
  const wfName = uniq('val258-hook-a');

  const reg1 = await register(mcpCall, wfName, 'return { hooked: args.event ?? null };', [id]);
  const v1 = reg1.result?.version;
  if (!v1) throw new Error(`register v1 failed: ${JSON.stringify(reg1)}`);
  await publish(mcpCall, wfName, v1);

  const afterClaim = (await mcpCall('webhook_list')).result.find((w) => w.id === id);
  console.log('after LOCAL claim (should be createdRemote:false):', JSON.stringify({ createdRemote: afterClaim.createdRemote }));

  const reg2 = await register(mcpCall, wfName, 'return { hooked: 2 };', [id], REMOTE_HEADERS);
  const v2 = reg2.result?.version;
  if (!v2) throw new Error(`register v2 (remote) failed: ${JSON.stringify(reg2)}`);
  await mcpCall('workflow_publish', { name: wfName, version: v2, channel: 'release' }, REMOTE_HEADERS);

  const afterHeld = (await mcpCall('webhook_list')).result.find((w) => w.id === id);
  console.log('after REMOTE re-register (held) (should be createdRemote:true):', JSON.stringify({ createdRemote: afterHeld.createdRemote }));

  // deliver over plain loopback (no tunnel header) - delivery peer is not the test
  const body = JSON.stringify({ event: 'a' });
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RWE-Signature': sig, 'X-RWE-Timestamp': new Date().toISOString(), 'X-RWE-Delivery': uniq('d') },
    body,
  });
  const status = res.status;
  const respBody = await res.json().catch(() => ({}));
  console.log('delivery after upgrade to remote:', status, JSON.stringify(respBody));
  out.a_webhook = { id, wfName, createdRemote_after_local_claim: afterClaim.createdRemote, createdRemote_after_remote_held: afterHeld.createdRemote, deliveryStatus: status, deliveryBody: respBody };
}

// ========== (b) remote create -> local register(claimed) -> local re-register(held) does NOT downgrade ==========
console.log('=== (b) SCHEDULE: remote create, local claim, local re-register (held) — must stay createdRemote:true ===');
{
  const created = await mcpCall('schedule_create', { kind: 'once', at: new Date(Date.now() - 2000).toISOString(), enabled: false }, REMOTE_HEADERS);
  const id = created.result?.id;
  if (!id) throw new Error(`schedule_create(remote) failed: ${JSON.stringify(created)}`);
  const wfName = uniq('val258-sched-b');

  const beforeClaim = (await mcpCall('schedule_list')).result.find((s) => s.id === id);
  console.log('immediately after remote create (should be createdRemote:true, unclaimed):', JSON.stringify({ createdRemote: beforeClaim.createdRemote, claimedBy: beforeClaim.claimedBy }));

  const reg1 = await register(mcpCall, wfName, 'return 1;', [id]); // LOCAL claim -> 'claimed'
  const v1 = reg1.result?.version;
  if (!v1) throw new Error(`register v1 failed: ${JSON.stringify(reg1)}`);
  await publish(mcpCall, wfName, v1);
  const afterClaim = (await mcpCall('schedule_list')).result.find((s) => s.id === id);
  console.log('after LOCAL claim (must STAY createdRemote:true, INV-V37-6):', JSON.stringify({ createdRemote: afterClaim.createdRemote }));

  const reg2 = await register(mcpCall, wfName, 'return 2;', [id]); // LOCAL re-register -> 'held'
  const v2 = reg2.result?.version;
  if (!v2) throw new Error(`register v2 failed: ${JSON.stringify(reg2)}`);
  await publish(mcpCall, wfName, v2);
  const afterHeld = (await mcpCall('schedule_list')).result.find((s) => s.id === id);
  console.log('after LOCAL re-register/held (must STAY createdRemote:true, no downgrade):', JSON.stringify({ createdRemote: afterHeld.createdRemote }));

  out.b_schedule = { id, wfName, createdRemote_at_creation: beforeClaim.createdRemote, createdRemote_after_local_claimed: afterClaim.createdRemote, createdRemote_after_local_held: afterHeld.createdRemote };
}

console.log('=== (b) WEBHOOK: remote create, local claim, local re-register (held) — must stay createdRemote:true ===');
{
  const created = await mcpCall('webhook_create', {}, REMOTE_HEADERS);
  const { webhookId: id } = created.result ?? {};
  if (!id) throw new Error(`webhook_create(remote) failed: ${JSON.stringify(created)}`);
  const wfName = uniq('val258-hook-b');

  const beforeClaim = (await mcpCall('webhook_list')).result.find((w) => w.id === id);
  console.log('immediately after remote create:', JSON.stringify({ createdRemote: beforeClaim.createdRemote }));

  const reg1 = await register(mcpCall, wfName, 'return 1;', [id]);
  const v1 = reg1.result?.version;
  if (!v1) throw new Error(`register v1 failed: ${JSON.stringify(reg1)}`);
  await publish(mcpCall, wfName, v1);
  const afterClaim = (await mcpCall('webhook_list')).result.find((w) => w.id === id);
  console.log('after LOCAL claim (must STAY true):', JSON.stringify({ createdRemote: afterClaim.createdRemote }));

  const reg2 = await register(mcpCall, wfName, 'return 2;', [id]);
  const v2 = reg2.result?.version;
  if (!v2) throw new Error(`register v2 failed: ${JSON.stringify(reg2)}`);
  await publish(mcpCall, wfName, v2);
  const afterHeld = (await mcpCall('webhook_list')).result.find((w) => w.id === id);
  console.log('after LOCAL re-register/held (must STAY true, no downgrade):', JSON.stringify({ createdRemote: afterHeld.createdRemote }));

  out.b_webhook = { id, wfName, createdRemote_at_creation: beforeClaim.createdRemote, createdRemote_after_local_claimed: afterClaim.createdRemote, createdRemote_after_local_held: afterHeld.createdRemote };
}

console.log('=== FULL RESULT ===');
console.log(JSON.stringify(out, null, 2));
