// Cold-model probe harness (v26 Gate 7.5 round 2, REQ-128 re-verification).
// The subject is a FRESH model instance over the OpenRouter API whose entire context is the
// operator task + this engine's own tools/list. No source tree, no transcript, no plugin.
// Usage: node coldprobe.mjs <enginePort> <model> <workflowName> <outfile>
const [, , PORT, MODEL, NAME, OUT] = process.argv;
const KEY = process.env.OPENROUTER_API_KEY;
const ENGINE = `http://127.0.0.1:${PORT}/mcp`;

const OPERATOR_TASK = `You are talking to a running "remote-workflow-engine" MCP server through the tools below.
You have never seen this server before. Everything you need to know is discoverable through its own tools.

Do this, in one go, without asking me anything:
1. Author and REGISTER a workflow named "${NAME}" that dispatches TWO agents in TWO separate stages,
   using this deployment's default model alias.
2. Give the run a starting file: the workspace must contain a file "notes.txt" whose content is the
   text "cold-probe-input". Use whichever of the engine's documented ways of doing that you judge right.
3. Publish it to the release channel and start a run with that starting file.
4. Poll until the run reaches a terminal state and report the result.

Report at the end: what you registered, whether anything was refused and why, and the final run result.`;

async function rpc(method, params) {
  const res = await fetch(ENGINE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.trim().startsWith('{') || l.startsWith('data: '));
  const json = JSON.parse((line ?? text).replace(/^data: /, ''));
  return json;
}

const listed = await rpc('tools/list', {});
const specs = listed.result.tools;
const tools = specs.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema },
}));
console.log(`tools/list: ${tools.length} tools`);

const record = { model: MODEL, name: NAME, toolCount: tools.length, calls: 0, refusals: [], registerAttempts: [], transcript: [] };
record.transcript.push({ role: 'operator-task', content: OPERATOR_TASK });

const messages = [{ role: 'user', content: OPERATOR_TASK }];

for (let turn = 0; turn < 40; turn++) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: 'auto', ...(process.env.NO_REASONING ? { reasoning: { exclude: true } } : {}) }),
  });
  const body = await res.json();
  if (!res.ok || body.error) {
    console.error('SUBJECT API ERROR', res.status, JSON.stringify(body).slice(0, 1200));
    record.fatal = { status: res.status, body };
    break;
  }
  const msg = body.choices?.[0]?.message;
  if (!msg) { record.fatal = { body }; break; }
  messages.push(msg);
  const calls = msg.tool_calls ?? [];
  record.transcript.push({
    role: 'subject',
    content: msg.content ?? '',
    tool_calls: calls.map((c) => ({ name: c.function.name, args: c.function.arguments })),
  });
  if (calls.length === 0) {
    console.log('SUBJECT FINAL:', (msg.content ?? '').slice(0, 2000));
    record.final = msg.content ?? '';
    break;
  }
  for (const c of calls) {
    let args = {};
    try { args = JSON.parse(c.function.arguments || '{}'); } catch { args = {}; }
    record.calls++;
    if (c.function.name === 'workflow_register') {
      record.registerAttempts.push({ name: args.name, script: args.script, mermaid: args.mermaid });
    }
    const out = await rpc('tools/call', { name: c.function.name, arguments: args });
    const text = out.result?.content?.[0]?.text ?? JSON.stringify(out);
    console.log(`  -> ${c.function.name}: ${text.slice(0, 220)}`);
    if (/"status"\s*:\s*"failed"|"error"\s*:/.test(text)) {
      record.refusals.push({ tool: c.function.name, text: text.slice(0, 1500) });
    }
    record.transcript.push({ role: 'tool-result', tool: c.function.name, text: text.slice(0, 4000) });
    // HARNESS DEFECT found at Gate 7.5 round 2 and fixed here: this used to be `slice(0, 12000)`,
    // which cut the 38 041-char authoring guide off at char 12 000 — past the script-body
    // paragraph (char 3 736) but BEFORE the node-shape table (14 672) and the whole diagram
    // grammar (LANE_MISMATCH at 17 144). Three subjects were therefore asked to draw a diagram to
    // a contract they had never been shown. The model must see what the engine actually served.
    messages.push({ role: 'tool', tool_call_id: c.id, content: text.slice(0, 200000) });
  }
}

const { writeFileSync } = await import('node:fs');
writeFileSync(OUT, JSON.stringify(record, null, 1));
console.log(`\nwrote ${OUT}; calls=${record.calls} registerAttempts=${record.registerAttempts.length} refusals=${record.refusals.length}`);
