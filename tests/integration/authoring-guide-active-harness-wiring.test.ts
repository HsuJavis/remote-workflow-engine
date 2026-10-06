// Issue #147: `buildAuthoringGuide` is pure over its `ceilings` argument — adding an
// `activeHarness` field to it is worthless unless the composition root actually forwards THIS
// deployment's measured harness into it. `src/server.ts` already computes `activeHarness` (issue
// #138's direct-transport-signal const) for the model-probe/observed-stats wiring; this is a
// SECOND reader of that same value, not a new fact. The "composeConfig wiring bug class" memory
// note is exactly this shape — a field threaded through a builder's signature but forgotten in the
// ONE object literal (`new McpFacade({...})`, server.ts) that actually constructs it for a real
// deployment, silently leaving the feature dead. This test exercises the REAL `createServer()` →
// real `/mcp` `tools/call` path (no unit-level `buildAuthoringGuide` shortcut) for both harnesses.
//
// Mock policy (integration): real createServer(); `harnessProviders` alone (no real PiGatewayClient
// construction) is enough to drive server.ts's `activeHarness` to 'pi' (the gateway-transport
// signal is undefined with no `gateway` configured, so it falls back to the harnessProviders
// proxy) — see server.ts's own comment on that fallback order.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

async function guideTextOf(server: Server): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow_authoring_guide', arguments: {} } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  const payload = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as { result?: unknown };
  return typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result ?? '');
}

function skillsSection(text: string): string {
  const start = text.indexOf('**Skills.**');
  expect(start, 'Skills paragraph not found in the live guide').toBeGreaterThanOrEqual(0);
  return text.slice(start, start + 2000);
}

describe('issue #147: the LIVE workflow_authoring_guide Skills section reflects server.ts\'s real activeHarness', () => {
  let sdkServer: Server;
  let piServer: Server;
  let sdkRoot: string;
  let piRoot: string;

  beforeAll(async () => {
    sdkRoot = mkdtempSync(join(tmpdir(), 'rwe-147-sdk-'));
    piRoot = mkdtempSync(join(tmpdir(), 'rwe-147-pi-'));
    sdkServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: sdkRoot });
    piServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: piRoot, harnessProviders: ['openrouter', 'ollama'] } as never);
  });
  afterAll(async () => {
    await sdkServer?.close();
    await piServer?.close();
    rmSync(sdkRoot, { recursive: true, force: true });
    rmSync(piRoot, { recursive: true, force: true });
  });

  it('a plain deployment (no gateway override) leads the Skills section with the sdk Skill-tool rule', async () => {
    const s = skillsSection(await guideTextOf(sdkServer));
    const sdkIdx = s.search(/through the Skill tool|active harness: sdk/i);
    const piIdx = s.search(/SKILL_REQUIRES_READ_TOOL/);
    expect(sdkIdx, s).toBeGreaterThanOrEqual(0);
    if (piIdx >= 0) expect(sdkIdx).toBeLessThan(piIdx);
  });

  it('a gateway:"pi"-shaped deployment leads the Skills section with the pi rule and SKILL_REQUIRES_READ_TOOL', async () => {
    const s = skillsSection(await guideTextOf(piServer));
    expect(s).toMatch(/SKILL_REQUIRES_READ_TOOL/);
    const piIdx = s.search(/gateway:"pi"|pi harness|active harness: pi/i);
    const sdkIdx = s.search(/gateway:"sdk"|active harness: sdk/i);
    expect(piIdx, s).toBeGreaterThanOrEqual(0);
    if (sdkIdx >= 0) expect(piIdx).toBeLessThan(sdkIdx);
  });
});
