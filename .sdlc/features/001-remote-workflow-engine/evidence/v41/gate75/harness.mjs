import { readFileSync, appendFileSync } from 'node:fs';
const PORT = process.env.PORT ?? '8821';
const OUT = process.env.OUT;

async function call(name, args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const t = await res.text();
  const body = JSON.parse(t.startsWith('event:') || t.startsWith('data:') ? t.split('\n').find((l) => l.startsWith('data:')).slice(5) : t);
  if (body.error) return { __rpcError: body.error };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}
const log = (o) => { const l = JSON.stringify({ t: new Date().toISOString(), ...o }); console.log(l); if (OUT) appendFileSync(OUT, l + '\n'); };

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'call') {
  console.log(JSON.stringify(await call(rest[0], JSON.parse(rest[1] ?? '{}')), null, 1));
  process.exit(0);
}

if (cmd === 'register') {
  const script = readFileSync(rest[0], 'utf8');
  const mermaid = readFileSync(rest[0].replace(/\.js$/, '.mmd'), 'utf8');
  const name = rest[1];
  const r = await call('workflow_register', { name, script, mermaid });
  log({ register: r });
  const vRaw = r.version ?? r.result?.version;
  const v = typeof vRaw === 'string' ? vRaw : 'v' + vRaw;
  const p = await call('workflow_publish', { name, version: v, channel: 'release' });
  log({ publish: p });
  process.exit(0);
}

if (cmd === 'round') {
  // round <name> <version> <n> <k> <overridesJson> <maxS>
  const [name, version, nStr, kStr, overridesJson, maxSStr] = rest;
  const n = Number(nStr), k = Number(kStr), maxS = Number(maxSStr ?? 300);
  const overrides = overridesJson ? JSON.parse(overridesJson) : undefined;
  const starts = await Promise.all(Array.from({ length: k }, () =>
    call('run_start', { name, version, args: { n }, ...(overrides ? { overrides } : {}) })));
  const ids = starts.map((s) => s.runId);
  log({ started: ids, raw: starts.map((s) => (s.runId ? undefined : s)) });
  const t0 = Date.now();
  const done = new Map();
  while (Date.now() - t0 < maxS * 1000 && done.size < ids.length) {
    for (const id of ids) {
      if (!id || done.has(id)) continue;
      const st = await call('run_status', { runId: id });
      if (['completed', 'failed', 'stopped', 'suspended', 'interrupted'].includes(st.status ?? st.result?.status)) done.set(id, st);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  for (const id of ids) {
    const st0 = done.get(id) ?? (await call('run_status', { runId: id }));
    const st = { status: st0.status, ...(st0.result ?? {}) };
    const agents = st.agents ?? [];
    const nonDone = agents.filter((a) => a.state !== 'done');
    const rr = done.has(id) ? await call('run_result', { runId: id }) : null;
    log({
      runId: id, status: st.status, totalAgents: agents.length, costUSD: st.usage?.costUSD,
      nonDone: nonDone.map((a) => ({ agentId: a.agentId, label: a.label, kind: a.kind, state: a.state, failReason: a.failReason })),
      agentFailures: st.agentFailures, result: rr?.result ?? rr,
    });
  }
  process.exit(0);
}

if (cmd === 'status') {
  console.log(JSON.stringify(await call('run_status', { runId: rest[0] }), null, 1));
  process.exit(0);
}

if (cmd === 'result') {
  console.log(JSON.stringify(await call('run_result', { runId: rest[0] }), null, 1));
  process.exit(0);
}
