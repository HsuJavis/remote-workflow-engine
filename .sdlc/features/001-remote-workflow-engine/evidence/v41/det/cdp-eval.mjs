const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const r = await send('Runtime.evaluate', { expression: process.argv[2], includeCommandLineAPI: true, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(r.result.result?.value ?? r.result, null, 1));
ws.close();
