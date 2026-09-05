// VAL-104 (REQ-094): a user-supplied appendPrompt attaches at a fixed position after everything
// the author controls.
//
// Mock policy (acceptance, DES-108): real server; the transcript-composition assertion needs no
// live backend (the prompt is composed and captured before dispatch reaches the network) — no
// HAS_PROVIDER gate required. The over-cap-refusal assertion needs no backend either.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val104-'));
  // useLiteLLMProxy:false + 'ollama': onHarness fires (with the fully-composed prompt) at
  // session-build time without spawning the litellm subprocess or needing a live backend.
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    aliases: { default: { provider: 'ollama', model: 'qwen2.5:7b' } },
    useLiteLLMProxy: false,
  });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}


// v24 (integrator): `UserOverrides` is per-agent (DES-145) and `run_agent_log` is addressed by the
// script's own LABEL (DES-161 — an engine-minted agentId is not something a caller can learn from
// tools/list, and the tool's schema requires `label`). Both cases below move onto those spellings;
// neither oracle changes — an over-cap appendPrompt is still refused without echoing the text, and
// the framed user text still lands AFTER the author's own prompt.
const LABEL = 'writer';
function declaredScript(prompt: string): string {
  return [
    'export const meta = { params: { agents: { ' + LABEL + ': {',
    "  model: { type: 'string', default: 'default' },",
    "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
    "  timeoutMs: { type: 'number', default: 60000 },",
    // Declared explicitly: a per-agent override may only name a key the LABEL declares (v24 answers
    // PARAM_UNKNOWN otherwise), and `appendPrompt` is the key this whole file is about.
    "  appendPrompt: { type: 'string' } } } } };",
    "return await agent('" + LABEL + "', { prompt: '" + prompt + "' });",
  ].join('\n');
}

describe('REQ-094: appendPrompt attaches last, after everything the author controls (VAL-104)', () => {
  it('an over-cap appendPrompt is refused at submission with byte counts, and the text is NEVER echoed in the error', async () => {
    await registerPublishedVia(callTool, 'val104-overcap', declaredScript('go'));
    const big = 'A'.repeat(2000);
    const r = await callTool('run_start', { name: 'val104-overcap', overrides: { agents: { [LABEL]: { appendPrompt: big } } } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');
    expect(JSON.stringify(r)).not.toContain(big);
  });

  it('the captured transcript prompt shows the framed appendPrompt AFTER the author\'s own prompt segments', async () => {
    await registerPublishedVia(callTool, 'val104-order', declaredScript('SCRIPT-PROMPT-MARKER'));
    const run = await callTool('run_start', { name: 'val104-order', overrides: { agents: { [LABEL]: { appendPrompt: 'USER-TEXT-MARKER' } } } });
    const runId = run.runId as string;

    let harness: { prompt?: string } | undefined;
    for (let i = 0; i < 100 && !harness; i++) {
      const log = await callTool('run_agent_log', { runId, label: LABEL }) as { harness?: { prompt?: string } };
      harness = log.harness ?? undefined;
      if (!harness) await new Promise((r) => setTimeout(r, 100));
    }
    expect(harness?.prompt).toBeDefined();
    const scriptIdx = harness!.prompt!.indexOf('SCRIPT-PROMPT-MARKER');
    const userIdx = harness!.prompt!.indexOf('USER-TEXT-MARKER');
    expect(scriptIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeGreaterThan(scriptIdx);
  });
});
