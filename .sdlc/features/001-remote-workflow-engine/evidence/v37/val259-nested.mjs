// VAL-259 ITEM 5: the nested-workflow() door (run-manager.ts _handleWorkflowRequest, DES-263
// 第三次修訂 三道判定點 (c)). A LOCALLY registered parent whose own script calls workflow() on a
// REMOTELY registered child, started LOCALLY — expect the parent run to fail with
// CONFINEMENT_UNAVAILABLE surfacing from the nested call (never passes through start()).
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
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const out = {};

const childName = uniq('val259-item5-child');
console.log('--- child: workflow_register (REMOTE headers) ---');
const childReg = await mcpCall('workflow_register', { name: childName, script: 'return "child-ran";', mermaid: 'graph LR', triggers: [] }, REMOTE_HEADERS);
console.log(JSON.stringify(childReg, null, 2));
const childVersion = childReg.result?.version;
if (!childVersion) throw new Error(`child register failed: ${JSON.stringify(childReg)}`);

console.log('--- child: workflow_publish (local caller, publish not origin-gated) ---');
const childPub = await mcpCall('workflow_publish', { name: childName, version: childVersion, channel: 'release' });
console.log(JSON.stringify(childPub, null, 2));
if (childPub.error) throw new Error(`child publish failed: ${JSON.stringify(childPub)}`);

console.log('--- child: workflow_describe, confirm registeredRemote:true ---');
const childDesc = await mcpCall('workflow_describe', { name: childName });
console.log(JSON.stringify(childDesc, null, 2));
out.childDescribe = childDesc;

const parentName = uniq('val259-item5-parent');
const parentScript = `const child = await workflow(${JSON.stringify(childName)}, {}); return { child };`;
console.log('--- parent: workflow_register (LOCAL, no headers), script calls workflow() on the remote child ---');
console.log('parent script:', parentScript);
const parentReg = await mcpCall('workflow_register', { name: parentName, script: parentScript, mermaid: 'graph LR', triggers: [] });
console.log(JSON.stringify(parentReg, null, 2));
const parentVersion = parentReg.result?.version;
if (!parentVersion) throw new Error(`parent register failed: ${JSON.stringify(parentReg)}`);

console.log('--- parent: workflow_publish ---');
const parentPub = await mcpCall('workflow_publish', { name: parentName, version: parentVersion, channel: 'release' });
console.log(JSON.stringify(parentPub, null, 2));
if (parentPub.error) throw new Error(`parent publish failed: ${JSON.stringify(parentPub)}`);

console.log('--- parent: workflow_describe, confirm registeredRemote:false (parent itself is local) ---');
const parentDesc = await mcpCall('workflow_describe', { name: parentName });
console.log(JSON.stringify(parentDesc, null, 2));
out.parentDescribe = parentDesc;

console.log('--- parent: run_start LOCAL (no header) — start() admits it (parent version is local); expect the NESTED workflow() call to fail the run ---');
const run = await mcpCall('run_start', { name: parentName });
console.log(JSON.stringify(run, null, 2));
out.parentRunStart = run;

const runId = run.result?.runId;
if (runId) {
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
  out.finalStatus = status;

  const result = await mcpCall('run_result', { runId });
  console.log('--- run_result (expect the nested CONFINEMENT_UNAVAILABLE surfaced as this run\'s failure) ---');
  console.log(JSON.stringify(result, null, 2));
  out.runResult = result;
} else {
  console.log('run_start never admitted (no runId) — parent itself was refused at start(), NOT what item 5 is testing (that would prove the wrong checkpoint). Recording as-is.');
  out.parentRunStartNeverAdmitted = true;
}

console.log('=== FULL RESULT ===');
console.log(JSON.stringify(out, null, 2));
