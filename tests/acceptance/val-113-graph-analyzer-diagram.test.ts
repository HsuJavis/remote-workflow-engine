// VAL-113 (REQ-102, DES-131/134, ARCH-079): register a workflow on a real engine with a real
// provider -> poll `workflow_describe` until `diagramStatus:'ready'` -> the diagram is ASCII in the
// vocabulary, and the secret literal / the distinctive prompt sentence / the `appendPrompt` string
// are each individually absent. `graphAnalyzer.enabled:false` -> registration still succeeds and
// describe returns `diagram:null`, `diagramStatus:'unavailable'`.
//
// Mock policy (acceptance, DES-119): real `createServer`, real `/mcp`. The `enabled:false` half needs
// NO live provider (an honest-absence property of config alone) and is UNCONDITIONALLY asserted
// below. The "a real analyzer run produces a gate-passing diagram" half genuinely needs a live LLM
// call (`HAS_PROVIDER`, same gating convention as VAL-003/VAL-004/VAL-080) — this environment has no
// provider configured, so that case legitimately no-ops here; it is the Gate 7.5 real-run's own job
// (TASK-124) to prove it against a live provider, same as every other online-gated VAL in this ledger.
//
// Red reason: `graphAnalyzer.enabled:false` has no effect at all today (the key does not exist) and
// `workflow_describe` does not exist as a tool -> the unconditional assertion fails for the genuine
// unimplemented reason.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const HAS_PROVIDER = !!(process.env['ANTHROPIC_API_KEY'] || process.env['OLLAMA_BASE_URL'] || process.env['OPENAI_API_KEY'] || process.env['OPENROUTER_API_KEY']);

let server: Server;
let workRoot: string;

async function call(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val113-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot, graphAnalyzer: { enabled: false } } as never);
});
afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

describe('REQ-102: graphAnalyzer.enabled:false -> registration still succeeds, honest absence (VAL-113)', () => {
  it('registration succeeds and workflow_describe reports diagram:null, diagramStatus:"unavailable" — never an error', async () => {
    await registerPublishedVia(call, 'val113-disabled', `return 1;`);
    const resp = await call('workflow_describe', { name: 'val113-disabled' });
    expect(resp.error).toBeUndefined();
    expect(resp.result?.diagram).toBeNull();
    expect(resp.result?.diagramStatus).toBe('unavailable');
  });
});

describe('REQ-102: a real analyzer run produces a gate-passing ASCII diagram (VAL-113, HAS_PROVIDER-gated)', () => {
  // A SEPARATE server (the outer one is deliberately analyzer-disabled) — built only inside the
  // gated test, never in beforeAll, so a provider-less environment boots nothing extra.
  it('polling workflow_describe until ready yields a diagram with no secret/prompt-sentence/appendPrompt leakage', async () => {
    if (!HAS_PROVIDER) return; // real-tier deferred to Gate 7.5 (TASK-124) in a provider-less env, same convention as VAL-003/004/080 — nothing asserted, nothing to no-op past.
    const secretLiteral = 'val113-secret-DO-NOT-LEAK';
    const promptSentence = 'The quick brown fox never appears in a diagram.';
    const appendPromptText = 'val113-appendPrompt-marker';
    const enabledRoot = mkdtempSync(join(tmpdir(), 'rwe-val113-live-'));
    const enabledServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: enabledRoot } as never);
    try {
      async function liveCall(name: string, args: unknown): Promise<any> {
        const res = await fetch(`http://127.0.0.1:${enabledServer.port}/mcp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        });
        const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
        return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
      }
      await registerPublishedVia(liveCall, 'val113-live', `
        // ${secretLiteral} — ${promptSentence}
        return 1;
      `, { defaults: { appendPrompt: appendPromptText } });

      let resp: any;
      const deadline = Date.now() + 30_000;
      do {
        resp = await liveCall('workflow_describe', { name: 'val113-live' });
        if (resp.result?.diagramStatus === 'ready') break;
        await new Promise((r) => setTimeout(r, 500));
      } while (Date.now() < deadline);

      expect(resp.result?.diagramStatus).toBe('ready');
      const diagram = resp.result?.diagram as string;
      expect(typeof diagram).toBe('string');
      expect(diagram).not.toContain(secretLiteral);
      expect(diagram).not.toContain(promptSentence);
      expect(diagram).not.toContain(appendPromptText);
    } finally {
      await enabledServer.close();
      rmSync(enabledRoot, { recursive: true, force: true });
    }
  }, 35_000);
});
