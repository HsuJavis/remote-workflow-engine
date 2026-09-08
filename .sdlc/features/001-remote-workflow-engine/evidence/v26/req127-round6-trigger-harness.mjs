// REQ-127 — the trigger clause, re-measured in round 6 on the PRODUCTION alias table:
//   「Given trigger 啟動的 run Then 不帶花費上限 ... 花費照上一條紀錄」 — a schedule-started run
//   carries NO ceiling (budget.limits both null) and STILL records the four columns + costUSD.
// Round 1 measured this with a free local model; on the production alias table a PRICED model also
// shows that "no cap" does not mean "no accounting".
// Usage: node req127-round6-trigger-harness.mjs <port> <outJson>
import { writeFileSync } from 'node:fs';
const [, , PORT, OUT] = process.argv;
const ENGINE = `http://127.0.0.1:${PORT}/mcp`;
const R = { port: PORT, at: new Date().toISOString() };
async function call(name, args) {
  const res = await fetch(ENGINE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await res.json();
  const t = j.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return j; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAME = `val127r6trig-${Date.now()}`;
const SCRIPT = `export const meta = {
  description: 'Gate 7.5 round 6: a schedule-started run records usage and carries no ceiling.',
  params: { agents: {
    cloudone: { model: { type: 'string', default: 'haiku' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 300000 } },
  } },
};
phase('cloud');
const limits = JSON.stringify(budget.limits);
const a = await agent('cloudone', { prompt: 'Reply with exactly: TRIG_OK', allowedTools: [] });
return 'limits=' + limits + '|' + a;`;
const MERMAID = `graph LR
subgraph "cloud"
cloudone(["cloudone<br/>haiku · low · 300000<br/>tools: none"])
end`;

const sched = await call('schedule_create', { kind: 'once', at: new Date(Date.now() + 20000).toISOString(), enabled: true });
R.schedule = sched.result ?? sched;
const scheduleId = R.schedule.id ?? R.schedule.scheduleId;
const reg = await call('workflow_register', { name: NAME, script: SCRIPT, mermaid: MERMAID, triggers: [scheduleId] });
R.register = reg.error ?? { version: reg.result?.version ?? reg.version };
await call('workflow_publish', { name: NAME, channel: 'release', version: reg.result?.version ?? 'v1' });

// wait for the scheduler's own tick to start a run for this workflow
let run = null;
for (let i = 0; i < 60; i++) {
  await sleep(3000);
  const runs = await fetch(`http://127.0.0.1:${PORT}/api/runs`).then((r) => r.json());
  const rows = Array.isArray(runs) ? runs : runs.runs;
  const mine = rows.find((x) => x.workflow === NAME || x.name === NAME);
  if (mine) {
    const st = await call('run_status', { runId: mine.runId });
    const v = st.result ?? st;
    if (['completed', 'failed', 'stopped'].includes(v.status)) { run = v; break; }
  }
}
R.run = run && {
  runId: run.runId, status: run.status, startedBy: run.startedBy,
  agents: (run.agents ?? []).map((a) => ({ label: a.label, provider: a.provider, model: a.model, state: a.state, tokens: a.tokens, costUSD: a.costUSD, unpriced: a.unpriced })),
};
if (run) {
  const rr = await call('run_result', { runId: run.runId });
  R.result = rr.result;      // carries the script-visible budget.limits it read at run time
  R.meta = rr.meta;
}
if (scheduleId) await call('schedule_delete', { id: scheduleId });
if (OUT) writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
