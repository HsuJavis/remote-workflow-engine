// VAL-259 real-tier HTTP exercise of DES-263 第三次修訂 (ADR-086 P1): two-source OR admission
// (trigger.createdRemote OR resolvedVersion.registeredRemote), no UPDATE path on either column.
// Scratch instance: http://127.0.0.1:8901/mcp, workRoot=/home/user/rwe-scratch-v37/workroot
// (outside the Claude project directory), booted via RWE_CONFIG_PATH=/home/user/rwe-scratch-v37/scratch.config.json.
// Covers items 1, 2, 3 of the v37 validation dispatch. Items 4 (webhook delivery) and 5 (nested
// workflow()) are in separate scripts (val259-webhook.mjs, val259-nested.mjs) so each can be
// re-run independently without re-registering the earlier fixtures.
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
  try {
    parsed = JSON.parse(body.result?.content?.[0]?.text ?? '{}');
  } catch {
    parsed = { rawResultBody: body };
  }
  return { httpStatus: res.status, ...parsed };
}
function uniq(prefix) { return `${prefix}-${Math.random().toString(36).slice(2, 8)}`; }
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const out = {};

// ================= ITEM 1: run_start route, remote-registered script / local caller =================
console.log('=========================================================');
console.log('ITEM 1: REMOTE workflow_register+publish, then LOCAL (no header) run_start — must be refused CONFINEMENT_UNAVAILABLE');
console.log('=========================================================');
{
  const wfName = uniq('val259-item1-remote-wf');
  console.log('--- workflow_register (REMOTE headers) ---');
  const reg = await mcpCall('workflow_register', { name: wfName, script: 'return "should-not-run";', mermaid: 'graph LR', triggers: [] }, REMOTE_HEADERS);
  console.log(JSON.stringify(reg, null, 2));
  const version = reg.result?.version;
  if (!version) throw new Error(`ITEM1 register failed: ${JSON.stringify(reg)}`);

  console.log('--- workflow_publish (local caller, publish is not gated by origin) ---');
  const pub = await mcpCall('workflow_publish', { name: wfName, version, channel: 'release' });
  console.log(JSON.stringify(pub, null, 2));
  if (pub.error) throw new Error(`ITEM1 publish failed: ${JSON.stringify(pub)}`);

  console.log('--- workflow_describe: confirm registeredRemote:true on this version, BEFORE run_start ---');
  const desc = await mcpCall('workflow_describe', { name: wfName });
  console.log(JSON.stringify(desc, null, 2));
  out.item1_describeBeforeRun = desc;

  console.log('--- run_start WITHOUT remote header (genuine loopback call) ---');
  const run = await mcpCall('run_start', { name: wfName });
  console.log(JSON.stringify(run, null, 2));
  out.item1_runStart = run;
}

// ================= ITEM 2: mirror — local register+publish, local run_start — must be admitted, reaches terminal =================
console.log('=========================================================');
console.log('ITEM 2 (mirror): LOCAL workflow_register+publish, LOCAL run_start — must be ADMITTED and reach terminal');
console.log('=========================================================');
{
  const wfName = uniq('val259-item2-local-wf');
  console.log('--- workflow_register (no headers, local) ---');
  const reg = await mcpCall('workflow_register', { name: wfName, script: 'return 42;', mermaid: 'graph LR', triggers: [] });
  console.log(JSON.stringify(reg, null, 2));
  const version = reg.result?.version;
  if (!version) throw new Error(`ITEM2 register failed: ${JSON.stringify(reg)}`);

  console.log('--- workflow_publish ---');
  const pub = await mcpCall('workflow_publish', { name: wfName, version, channel: 'release' });
  console.log(JSON.stringify(pub, null, 2));
  if (pub.error) throw new Error(`ITEM2 publish failed: ${JSON.stringify(pub)}`);

  console.log('--- workflow_describe: confirm registeredRemote:false on this version ---');
  const desc = await mcpCall('workflow_describe', { name: wfName });
  console.log(JSON.stringify(desc, null, 2));
  out.item2_describeBeforeRun = desc;

  console.log('--- run_start (no header, local) ---');
  const run = await mcpCall('run_start', { name: wfName });
  console.log(JSON.stringify(run, null, 2));
  const runId = run.result?.runId;
  if (!runId) throw new Error(`ITEM2 run_start failed to admit: ${JSON.stringify(run)}`);

  console.log('--- polling run_status until terminal ---');
  const deadline = Date.now() + 20000;
  let status;
  for (;;) {
    status = await mcpCall('run_status', { runId });
    const s = status.result?.status;
    if (s && s !== 'running' && s !== 'queued' && s !== 'pending') break;
    if (Date.now() > deadline) break;
    await sleep(300);
  }
  console.log(JSON.stringify(status, null, 2));
  out.item2_finalStatus = status;

  const result = await mcpCall('run_result', { runId });
  console.log('--- run_result ---');
  console.log(JSON.stringify(result, null, 2));
  out.item2_runResult = result;
}

// ================= ITEM 3: trigger immutability + version taint =================
console.log('=========================================================');
console.log('ITEM 3: webhook_create LOCAL -> createdRemote:false; REMOTE workflow_register listing that id in triggers[] -> webhook row UNCHANGED, but the NEW VERSION registeredRemote:true');
console.log('=========================================================');
{
  console.log('--- webhook_create (no headers, local) ---');
  const created = await mcpCall('webhook_create', {});
  console.log(JSON.stringify(created, null, 2));
  const webhookId = created.result?.webhookId;
  const secret = created.result?.secret;
  const url = created.result?.url;
  if (!webhookId) throw new Error(`ITEM3 webhook_create failed: ${JSON.stringify(created)}`);
  out.item3_webhookCreate = created;

  console.log('--- webhook_list: BEFORE remote register, confirm createdRemote:false ---');
  const listBefore = await mcpCall('webhook_list');
  const rowBefore = (listBefore.result ?? []).find((w) => w.id === webhookId);
  console.log(JSON.stringify(rowBefore, null, 2));
  out.item3_webhookRowBefore = rowBefore;

  const wfName = uniq('val259-item3-wf');
  console.log('--- workflow_register (REMOTE headers), triggers:[webhookId] ---');
  const reg = await mcpCall('workflow_register', { name: wfName, script: 'return { hooked: args.event ?? null };', mermaid: 'graph LR', triggers: [webhookId] }, REMOTE_HEADERS);
  console.log(JSON.stringify(reg, null, 2));
  const version = reg.result?.version;
  if (!version) throw new Error(`ITEM3 register failed: ${JSON.stringify(reg)}`);
  out.item3_register = reg;

  console.log('--- webhook_list: AFTER remote register, createdRemote must STILL be false (no UPDATE path) ---');
  const listAfter = await mcpCall('webhook_list');
  const rowAfter = (listAfter.result ?? []).find((w) => w.id === webhookId);
  console.log(JSON.stringify(rowAfter, null, 2));
  out.item3_webhookRowAfter = rowAfter;

  console.log('--- workflow_describe (version:v1, unpublished — proves the taint exists on the version itself, not on the release pointer): the NEW version must report registeredRemote:true ---');
  const desc = await mcpCall('workflow_describe', { name: wfName, version });
  console.log(JSON.stringify(desc, null, 2));
  out.item3_describe = desc;

  // stash for item 4 script
  out.item3_fixture = { webhookId, secret, url, wfName, version };
}

console.log('=========================================================');
console.log('FULL RESULT (JSON)');
console.log('=========================================================');
console.log(JSON.stringify(out, null, 2));
