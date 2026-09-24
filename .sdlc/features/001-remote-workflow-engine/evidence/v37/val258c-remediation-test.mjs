// Advisor-directed follow-up: does an explicit remote workflow_register({triggers:[legacyId]})
// successfully claim+stamp a pre-v24 legacy-bound trigger, or does it refuse (ownership/NOT_FOUND)?
const BASE = 'http://127.0.0.1:8793';
const REMOTE_HEADERS = { 'X-Forwarded-For': '203.0.113.13' };

async function mcpCall(name, args = {}, extraHeaders = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

const legacyScheduleId = 'c473d2f2-884c-4765-b98b-0901928e3fc4';
const legacyScheduleWf = 'val258-legacy-sched-wf';
const legacyWebhookId = '76fef1b5-38ac-4366-88e0-43cdf8b3586a';
const legacyWebhookWf = 'val258-legacy-hook-wf';

console.log('=== SCHEDULE: REMOTE workflow_register EXPLICITLY listing the legacy id in triggers[] ===');
{
  const reg = await mcpCall('workflow_register', { name: legacyScheduleWf, script: 'return "explicit-claim-attempt";', mermaid: 'graph LR', triggers: [legacyScheduleId] }, REMOTE_HEADERS);
  console.log('register result:', JSON.stringify(reg));
  if (reg.result?.version) {
    const pub = await mcpCall('workflow_publish', { name: legacyScheduleWf, version: reg.result.version, channel: 'release' });
    console.log('publish result:', JSON.stringify(pub));
  }
  const after = (await mcpCall('schedule_list')).result.find((s) => s.id === legacyScheduleId);
  console.log('legacy schedule row AFTER explicit remote claim attempt:', JSON.stringify(after));
}

console.log('=== WEBHOOK: REMOTE workflow_register EXPLICITLY listing the legacy id in triggers[] ===');
{
  const reg = await mcpCall('workflow_register', { name: legacyWebhookWf, script: 'return "explicit-claim-attempt";', mermaid: 'graph LR', triggers: [legacyWebhookId] }, REMOTE_HEADERS);
  console.log('register result:', JSON.stringify(reg));
  if (reg.result?.version) {
    const pub = await mcpCall('workflow_publish', { name: legacyWebhookWf, version: reg.result.version, channel: 'release' });
    console.log('publish result:', JSON.stringify(pub));
  }
  const after = (await mcpCall('webhook_list')).result.find((w) => w.id === legacyWebhookId);
  console.log('legacy webhook row AFTER explicit remote claim attempt:', JSON.stringify(after));
}
