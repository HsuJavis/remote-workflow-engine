const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const proto = await send('Runtime.evaluate', { expression: 'ReadableStream.prototype' });
const q = await send('Runtime.queryObjects', { prototypeObjectId: proto.result.result.objectId });
// array of pullAlgorithm functions of locked streams
const fns = await send('Runtime.callFunctionOn', { objectId: q.result.objects.objectId, functionDeclaration: `function(){ const K=o=>o[Object.getOwnPropertySymbols(o).find(x=>String(x)==='Symbol(kState)')]; const out=[]; for (const s of this){ let l; try{ l=s.locked }catch{continue} if(!l) continue; out.push(K(K(s).controller).pullAlgorithm); } return out }` });
const arr = await send('Runtime.getProperties', { objectId: fns.result.result.objectId, ownProperties: true });
const results = [];
for (const p of arr.result.result.filter((p) => /^\d+$/.test(p.name))) {
  // pullAlgorithm in the stream controller is a wrapper; walk [[Scopes]] up to 3 levels of function refs to find fetchParams
  const seen = new Set(); const queue = [p.value.objectId]; let found = null;
  for (let depth = 0; queue.length && depth < 40 && !found; depth++) {
    const oid = queue.shift(); if (seen.has(oid)) continue; seen.add(oid);
    const props = await send('Runtime.getProperties', { objectId: oid, ownProperties: true, accessorPropertiesOnly: false, generatePreview: false });
    const internal = props.result.internalProperties ?? [];
    const scopes = internal.find((x) => x.name === '[[Scopes]]');
    if (!scopes) continue;
    const scopeList = await send('Runtime.getProperties', { objectId: scopes.value.objectId, ownProperties: true });
    for (const sc of scopeList.result.result) {
      if (!sc.value?.objectId) continue;
      const vars = await send('Runtime.getProperties', { objectId: sc.value.objectId, ownProperties: true });
      for (const v of vars.result.result) {
        if (v.name === 'fetchParams' && v.value?.objectId) { found = v.value.objectId; break; }
        if (v.value?.type === 'function' && v.value.objectId) queue.push(v.value.objectId);
      }
      if (found) break;
    }
  }
  if (!found) { results.push('fetchParams not found'); continue; }
  const st = await send('Runtime.callFunctionOn', { objectId: found, functionDeclaration: `function(){ const c=this.controller; return { state: c.state, ended: c.ended, aborted: c.serializedAbortReason ? String(c.serializedAbortReason.name||c.serializedAbortReason) : null, terminatedListeners: c.listenerCount('terminated'), hasOnAborted: !!c.onAborted } }`, returnByValue: true });
  results.push(st.result.result.value);
}
console.log(JSON.stringify(results));
ws.close();
