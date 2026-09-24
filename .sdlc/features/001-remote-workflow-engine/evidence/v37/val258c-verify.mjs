// VAL-258 part (c) verification: against the legacy-shaped rows seeded by val258c-seed-legacy.mjs.
import { createHmac } from 'node:crypto';

const BASE = 'http://127.0.0.1:8793';
const REMOTE_HEADERS = { 'X-Forwarded-For': '203.0.113.11' };

const SEED = JSON.parse(process.argv[2]);

async function mcpCall(name, args = {}, extraHeaders = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const out = {};

console.log('=== (c) SCHEDULE: legacy row before any registration ===');
{
  const before = (await mcpCall('schedule_list')).result.find((s) => s.id === SEED.legacyScheduleId);
  console.log(JSON.stringify(before));
  out.before = before;
}

console.log('=== (c) SCHEDULE: REMOTE workflow_register+publish onto the legacy workflow name, triggers:[] (NOT declaring the legacy id) ===');
{
  const reg = await mcpCall('workflow_register', { name: SEED.legacyScheduleWf, script: 'return "remote-script-ran";', mermaid: 'graph LR', triggers: [] }, REMOTE_HEADERS);
  const v = reg.result?.version;
  if (!v) throw new Error(`register failed: ${JSON.stringify(reg)}`);
  const pub = await mcpCall('workflow_publish', { name: SEED.legacyScheduleWf, version: v, channel: 'release' });
  if (pub.error) throw new Error(`publish failed: ${JSON.stringify(pub)}`);
  out.registeredVersion = v;

  const after = (await mcpCall('schedule_list')).result.find((s) => s.id === SEED.legacyScheduleId);
  console.log('legacy row after REMOTE register of its own workflow name (claim() never called on it — must be UNCHANGED):', JSON.stringify(after));
  out.afterRemoteRegisterNoDeclare = after;
}

console.log('=== (c) SCHEDULE: enable + fire — does it run the REMOTELY-registered script, unconfined, because ITS OWN createdRemote is still false? ===');
{
  await mcpCall('schedule_setEnabled', { id: SEED.legacyScheduleId, enabled: true });
  const deadline = Date.now() + 15000;
  let row;
  for (;;) {
    row = (await mcpCall('schedule_list')).result.find((s) => s.id === SEED.legacyScheduleId);
    if (row.lastError || row.lastRunId) break;
    if (Date.now() > deadline) break;
    await sleep(300);
  }
  console.log('final legacy schedule row:', JSON.stringify(row));
  out.finalScheduleRow = row;
  if (row.lastRunId) {
    const result = await mcpCall('run_result', { runId: row.lastRunId });
    console.log('run result (should show the REMOTELY-registered script executed, unconfined, via legacy binding):', JSON.stringify(result));
    out.runResult = result;
  }
}

console.log('=== (c) WEBHOOK: legacy row before any registration ===');
{
  const before = (await mcpCall('webhook_list')).result.find((w) => w.id === SEED.legacyWebhookId);
  console.log(JSON.stringify(before));
  out.webhookBefore = before;
}

console.log('=== (c) WEBHOOK: REMOTE workflow_register+publish onto the legacy webhook workflow name, triggers:[] ===');
{
  const reg = await mcpCall('workflow_register', { name: SEED.legacyWebhookWf, script: 'return { hooked: args.event ?? null };', mermaid: 'graph LR', triggers: [] }, REMOTE_HEADERS);
  const v = reg.result?.version;
  if (!v) throw new Error(`register failed: ${JSON.stringify(reg)}`);
  const pub = await mcpCall('workflow_publish', { name: SEED.legacyWebhookWf, version: v, channel: 'release' });
  if (pub.error) throw new Error(`publish failed: ${JSON.stringify(pub)}`);

  const after = (await mcpCall('webhook_list')).result.find((w) => w.id === SEED.legacyWebhookId);
  console.log('legacy webhook row after REMOTE register of its own workflow name (must be UNCHANGED, createdRemote stays false):', JSON.stringify(after));
  out.webhookAfterRemoteRegisterNoDeclare = after;
}

console.log('=== (c) WEBHOOK: deliver over plain loopback — should be ADMITTED (origin:local, since the TRIGGER itself still reads createdRemote:false) ===');
{
  const body = JSON.stringify({ event: 'legacy' });
  const sig = 'sha256=' + createHmac('sha256', SEED.legacySecret).update(body).digest('hex');
  const res = await fetch(`${BASE}/hooks/${SEED.legacyWebhookId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RWE-Signature': sig, 'X-RWE-Timestamp': new Date().toISOString(), 'X-RWE-Delivery': 'd-' + Math.random().toString(36).slice(2, 8) },
    body,
  });
  const status = res.status;
  const respBody = await res.json().catch(() => ({}));
  console.log('delivery result:', status, JSON.stringify(respBody));
  out.webhookDelivery = { status, respBody };
}

console.log('=== (c) IDENTIFYING QUERIES ===');
{
  // MCP form (works for both stores): for a row with a non-null workflow binding, compare its id
  // against workflow_describe({name}).triggers[] of that workflow — absent => in the pre-v24 cohort.
  async function mcpFormFlags(id, workflowName) {
    const desc = await mcpCall('workflow_describe', { name: workflowName });
    const declared = desc.result?.triggers ?? [];
    return !declared.includes(id);
  }
  const mcpFlagsSchedule = await mcpFormFlags(SEED.legacyScheduleId, SEED.legacyScheduleWf);
  const mcpFlagsWebhook = await mcpFormFlags(SEED.legacyWebhookId, SEED.legacyWebhookWf);
  console.log('MCP-form cohort membership — schedule:', mcpFlagsSchedule, 'webhook:', mcpFlagsWebhook, '(true = correctly identified as pre-v24 cohort)');
  out.mcpForm = { schedule: mcpFlagsSchedule, webhook: mcpFlagsWebhook };
}

console.log('=== FULL RESULT ===');
console.log(JSON.stringify(out, null, 2));
