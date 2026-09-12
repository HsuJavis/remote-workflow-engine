// v27 Gate 7.5 real-run setup for instance B (auth OFF): registers a 5-lane/9-agent workflow,
// runs it for real (local Ollama + one priced OpenRouter call), registers a second NEVER-RUN
// workflow (REQ-133 predicted layout), then prints everything the validator needs.
const BASE = process.env.RWE_BASE || 'http://127.0.0.1:8935';

async function mcp(name, args) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${name} -> ${JSON.stringify(body.error)}`);
  return JSON.parse(body.result.content[0].text);
}

const MERMAID = `graph LR
subgraph "REQUIREMENTS"
a1(["a1"])
a2(["a2"])
end
subgraph "ARCHITECTURE"
b1(["b1"])
end
subgraph "DESIGN"
c1(["c1"])
c2(["c2"])
c3(["c3"])
end
subgraph "IMPLEMENTATION"
d1(["d1"])
end
subgraph "VERIFICATION"
e1(["e1"])
e2(["e2"])
end
a1-->a2
a2-->b1
b1-->c1
c1-->c2
c2-->c3
c3-->d1
d1-->e1
e1-->e2`;

const SCRIPT = `
export const meta = {
  description: 'v27 Gate 7.5 real-run probe: 5 lanes, 9 agents, one priced call, one agentType call',
  phases: [
    { title: 'REQUIREMENTS' }, { title: 'ARCHITECTURE' }, { title: 'DESIGN' },
    { title: 'IMPLEMENTATION' }, { title: 'VERIFICATION' },
  ],
  params: {
    agents: {
      a1: { model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
      a2: { model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
      b1: { model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
      c1: { model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
      c2: { model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
      c3: { model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
      d1: { model: { type: 'string', default: 'gpt41nano' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
      e1: { model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
      e2: { model: { type: 'string', default: 'local' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
    },
  },
};
phase('REQUIREMENTS');
await agent('a1', { prompt: 'Say hello in one word.' });
await agent('a2', { prompt: 'Say hello in one word.' });
phase('ARCHITECTURE');
await agent('b1', { prompt: 'Say hello in one word.' });
phase('DESIGN');
await agent('c1', { prompt: 'Say hello in one word.' });
await agent('c2', { prompt: 'Say hello in one word.' });
await agent('c3', { prompt: 'Say hello in one word.' });
phase('IMPLEMENTATION');
await agent('d1', { prompt: 'Say hello in one word.' });
phase('VERIFICATION');
await agent('e1', { prompt: 'Say hello in one word.' });
const r2 = await agent('e2', { prompt: 'RWE-V27-USERPROMPT-MARKER: what is 2+2? Answer with just the number.', agentType: 'echoer' });
return { ok: true, e2: r2 };
`;

async function registerAndPublish(name) {
  const reg = await mcp('workflow_register', { name, script: SCRIPT, mermaid: MERMAID });
  console.log(`register ${name} ->`, JSON.stringify(reg));
  if (reg.status === 'failed') throw new Error(`register failed: ${JSON.stringify(reg.error)}`);
  const version = reg.result.version;
  const pub = await mcp('workflow_publish', { name, version, channel: 'release' });
  console.log(`publish ${name}@${version} ->`, JSON.stringify(pub));
  return version;
}

const RUN_NAME = 'val27-swimlane';
const NEVERRUN_NAME = 'val27-neverrun';

await registerAndPublish(RUN_NAME);
await registerAndPublish(NEVERRUN_NAME);

const started = await mcp('run_start', { name: RUN_NAME });
console.log('run_start ->', JSON.stringify(started));
const deadline = Date.now() + 120000;
let status;
while (Date.now() < deadline) {
  status = await mcp('run_status', { runId: started.runId });
  if (['completed', 'failed'].includes(status.status)) break;
  await new Promise((r) => setTimeout(r, 500));
}
console.log('final status', JSON.stringify(status));
console.log('RUN_ID=' + started.runId);
