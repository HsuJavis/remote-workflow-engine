// #169: `RunManager._handleAudioRequest` end to end — a real script calling generateAudio() over the
// real sandbox fork, the OpenRouter streaming wire stood in by a fake SSE fetch at
// `RunManagerDeps.directDeps` (no real network). Pins: the file lands in the workspace with the
// documented return shape; the wire's `usage.cost` reaches the record and the run's usage (and
// the live USD budget); an attempt with no readable cost is unpriced, never a known $0; a zero
// catalog price never refuses PRICE_UNKNOWN; unknown bytes / a bad outDir / retries / resume.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { ModelBook } from '../../src/models/model-book.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { startScript, DEFAULT_FIXTURE_MODEL, AUTH_DISABLED } from '../helpers/workflow-fixtures.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { makeStubFetch, type StubFetchStep } from '../helpers/stub-fetch.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 20, maxIter = 300): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped', 'suspended'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function workRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-audio-it-'));
  dirs.push(d);
  return d;
}

const LYRIA = 'openrouter/google/lyria-3-clip-preview';
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([0x04, 0, 0, 0, 0, 0, 0]), Buffer.alloc(64, 0x22)]);
const SPEC = (retries = 0) => `{ model: { type: 'string', default: '${LYRIA}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: ${retries} } }`;
const META = (retries = 0) => `export const meta = { phases: [], params: { audio: { song: ${SPEC(retries)} } } };`;

function sse(chunks: unknown[]): Uint8Array {
  return new TextEncoder().encode(`: OPENROUTER PROCESSING\n\n${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`);
}
function audioStream(opts: { audio?: Buffer; text?: string; cost?: number | null } = {}): StubFetchStep {
  const audio = opts.audio ?? MP3;
  const usage: Record<string, unknown> = { prompt_tokens: 14, completion_tokens: 4 };
  if (opts.cost !== null) usage['cost'] = opts.cost ?? 0.04;
  return {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    bodyBytes: sse([
      { id: 'g', choices: [{ index: 0, delta: { role: 'assistant', content: opts.text ?? '<instrumental>' } }] },
      { id: 'g', choices: [{ index: 0, delta: { audio: { data: audio.toString('base64') } } }] },
      { id: 'g', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage },
    ]),
  };
}

/** Lyria's real catalog row: prompt 0 / completion 0 — a finite zero the catalog "knows". */
function zeroPricedBook(): ModelBook {
  return new ModelBook(
    async () => [{ provider: 'openrouter', model: 'google/lyria-3-clip-preview', modelType: 'chat', modelTypeSource: 'static', ratesPerM: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 } }],
    { clock: new FixedClock(new Date('2026-11-24T00:00:00Z')) },
  );
}

function manager(steps: StubFetchStep[] | ReturnType<typeof makeStubFetch>, extra: Record<string, unknown> = {}) {
  const stub = Array.isArray(steps) ? makeStubFetch(steps) : steps;
  const events: any[] = [];
  const store = new InMemoryRunStore(new FixedClock(new Date('2026-11-24T00:00:00Z')));
  const root = workRoot();
  const mgr = new RunManager({ store, workRoot: root, eventSink: (e: unknown) => events.push(e), directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test', sleep: async () => {} }, ...extra } as any);
  return { mgr, stub, events, store };
}

describe('#169: generateAudio() happy path', () => {
  it('writes the clip, returns {files:[{path,mimeType,bytes,sha256}], text}, and charges the wire cost to the record and the run', async () => {
    const { mgr, stub, events } = manager([audioStream()]);
    const runId = await startScript(mgr, `${META()}
      return await generateAudio('song', { prompt: 'a calm piano loop' });`);
    const view = await pollStatus(mgr, runId);
    expect(view.status, JSON.stringify(view.error ?? null)).toBe('completed');
    expect(stub.calls).toHaveLength(1);
    expect(JSON.parse(String(stub.calls[0]!.init!.body))).toMatchObject({ model: 'google/lyria-3-clip-preview', modalities: ['audio', 'text'], stream: true });

    const r = await mgr.result(runId);
    expect(r.ok).toBe(true);
    const value = (r as { value: { files: any[]; text: string } }).value;
    expect(value.text).toBe('<instrumental>');
    expect(value.files).toHaveLength(1);
    expect(value.files[0]).toMatchObject({ mimeType: 'audio/mpeg', bytes: MP3.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(value.files[0].path).toMatch(/^generated\/song-\d+-0\.mp3$/);
    const ws = (await mgr.workspacePath(runId))!;
    expect(readFileSync(join(ws, value.files[0].path)).equals(MP3)).toBe(true);

    expect(view.usage?.costUSD).toBeCloseTo(0.04, 9);
    expect(view.usage?.unpricedCalls).toBe(0);
    const rec = (view.agents ?? []).find((a: any) => a.kind === 'audio');
    expect(rec).toMatchObject({ state: 'done', label: 'song', provider: 'openrouter', model: 'google/lyria-3-clip-preview', unpriced: false });
    expect(rec.costUSD).toBeCloseTo(0.04, 9);

    const ok = events.find((e) => e.kind === 'primitive.call' && e.outcome === 'ok');
    expect(ok).toMatchObject({ primitive: 'audio', label: 'song', model: LYRIA, attempt: 1, costUSD: 0.04, costSource: 'reported', files: value.files });
    expect(JSON.stringify(ok)).not.toContain('instrumental'); // the model's text never rides the event log
  });

  it('honours outDir', async () => {
    const { mgr } = manager([audioStream()]);
    const runId = await startScript(mgr, `${META()}
      const a = await generateAudio('song', { prompt: 'p', outDir: 'music/out' });
      return a.files[0].path;`);
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('completed');
    expect(((await mgr.result(runId)) as { value: string }).value).toMatch(/^music\/out\/song-\d+-0\.mp3$/);
  });
});

describe('#169: generateAudio() cost — wire-priced, unpriced when absent, budgets still bind', () => {
  it('no wire cost -> the call is recorded unpriced and counted in unpricedCalls (never a known $0), even over a zero catalog price', async () => {
    const { mgr } = manager([audioStream({ cost: null })], { modelBook: zeroPricedBook() });
    const runId = await startScript(mgr, `${META()}
      return (await generateAudio('song', { prompt: 'p' })).files.length;`);
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('completed');
    const rec = (view.agents ?? []).find((a: any) => a.kind === 'audio');
    expect(rec.unpriced).toBe(true);
    expect(view.usage?.unpricedCalls).toBe(1);
  });

  it('a 500 (no readable cost) retried to a priced stream -> unpriced:true, costUSD = the priced attempt', async () => {
    const { mgr, stub } = manager([{ status: 500 }, audioStream({ cost: 0.04 })]);
    const runId = await startScript(mgr, `${META(1)}
      return (await generateAudio('song', { prompt: 'p' })).files.length;`);
    const view = await pollStatus(mgr, runId);
    expect(view.status, JSON.stringify(view.error ?? null)).toBe('completed');
    expect(stub.calls).toHaveLength(2);
    const rec = (view.agents ?? []).find((a: any) => a.kind === 'audio');
    expect(rec.unpriced).toBe(true);
    expect(rec.costUSD).toBeCloseTo(0.04, 9);
  });

  it('a USD budget over a zero/absent catalog price is NOT refused PRICE_UNKNOWN; once spend reaches the budget the next call is refused BUDGET_EXCEEDED before dispatch', async () => {
    const { mgr, stub } = manager([audioStream({ cost: 0.04 })], { modelBook: zeroPricedBook() });
    const runId = await startScript(mgr, `${META()}
      const a = await generateAudio('song', { prompt: 'p' });
      await generateAudio('song', { prompt: 'again' });
      return 'second-call-was-not-refused';`, { budget: { usd: 0.03 } });
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    expect(view.error?.code ?? view.code).toBe('BUDGET_EXCEEDED');
    expect(stub.calls).toHaveLength(1);
    expect(view.usage?.costUSD).toBeCloseTo(0.04, 9);
  });

  it('no price book pin at all + a USD budget -> still dispatches (wire-priced)', async () => {
    const { mgr, stub } = manager([audioStream({ cost: 0.01 })]);
    const runId = await startScript(mgr, `${META()}
      return (await generateAudio('song', { prompt: 'p' })).files.length;`, { budget: { usd: 1 } });
    const view = await pollStatus(mgr, runId);
    expect(view.status, JSON.stringify(view.error ?? null)).toBe('completed');
    expect(stub.calls).toHaveLength(1);
  });
});

describe('#169: generateAudio() failures', () => {
  it('a stream whose audio bytes are of no known type -> PRIMITIVE_FAILED{no_output}, spend kept, nothing written', async () => {
    const { mgr } = manager([audioStream({ audio: Buffer.from('definitely not audio'), cost: 0.04 })]);
    const runId = await startScript(mgr, `${META()}
      try { await generateAudio('song', { prompt: 'p' }); return 'no-throw'; }
      catch (e) { return e.code + ':' + e.message; }`);
    const view = await pollStatus(mgr, runId);
    expect(((await mgr.result(runId)) as { value: string }).value).toBe("PRIMITIVE_FAILED:generateAudio 'song' failed: no_output after 1 attempt");
    const rec = (view.agents ?? []).find((a: any) => a.kind === 'audio');
    expect(rec).toMatchObject({ state: 'failed', failReason: 'no_output' });
    expect(rec.costUSD).toBeCloseTo(0.04, 9);
    expect(view.agentFailures).toContainEqual(expect.objectContaining({ label: 'song', reason: 'no_output', message: "generateAudio 'song' failed: no_output after 1 attempt" }));
    const ws = (await mgr.workspacePath(runId))!;
    expect(readdirSync(join(ws, 'generated'))).toEqual([]);
  });

  it('a text-only stream -> no_output too (the run never "succeeds" with just <instrumental>)', async () => {
    const { mgr } = manager([audioStream({ audio: Buffer.alloc(0) })]);
    const runId = await startScript(mgr, `${META()}
      try { await generateAudio('song', { prompt: 'p' }); return 'no-throw'; }
      catch (e) { return e.code + ':' + e.detail; }`);
    await pollStatus(mgr, runId);
    expect(((await mgr.result(runId)) as { value: string }).value).toMatch(/^PRIMITIVE_FAILED:/);
  });

  it('uncaught failure surfaces PRIMITIVE_FAILED as the run error code', async () => {
    const { mgr } = manager([{ status: 400, body: { error: { message: 'Audio output requires stream: true' } } }]);
    const runId = await startScript(mgr, `${META()}
      return await generateAudio('song', { prompt: 'p' });`);
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    expect(view.error?.code ?? view.code).toBe('PRIMITIVE_FAILED');
  });

  it('an escaping outDir is refused IMAGE_PATH_REFUSED before any provider call', async () => {
    const { mgr, stub } = manager([audioStream()]);
    const runId = await startScript(mgr, `${META()}
      return await generateAudio('song', { prompt: 'p', outDir: '../up' });`);
    const view = await pollStatus(mgr, runId);
    expect(view.error?.code ?? view.code).toBe('IMAGE_PATH_REFUSED');
    expect(stub.calls).toHaveLength(0);
  });

  it('a bad prompt is refused PRIMITIVE_INPUT_INVALID before any provider call', async () => {
    const { mgr, stub } = manager([audioStream()]);
    const runId = await startScript(mgr, `${META()}
      return await generateAudio('song', { prompt: '' });`);
    const view = await pollStatus(mgr, runId);
    expect(view.error?.code ?? view.code).toBe('PRIMITIVE_INPUT_INVALID');
    expect(stub.calls).toHaveLength(0);
  });
});

describe('#169: generateAudio() resume replay', () => {
  const AGENT = `slow: { model: { type: 'string', default: '${DEFAULT_FIXTURE_MODEL}' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }`;
  const SCRIPT = `export const meta = { params: { agents: { ${AGENT} }, audio: { song: ${SPEC()} } } };
    const a = await generateAudio('song', { prompt: 'p' });
    const t = await agent('slow', { prompt: 'x' });
    return { path: a.files[0].path, text: a.text, t };`;

  function hangingFirstGateway(): { gateway: GatewayClient; firstStarted: Promise<void> } {
    let n = 0;
    let started!: () => void;
    const firstStarted = new Promise<void>((r) => { started = r; });
    return {
      firstStarted,
      gateway: {
        invoke: async () => {
          n += 1;
          if (n === 1) { started(); return await new Promise<never>(() => {}); }
          return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'DONE' };
        },
      } as GatewayClient,
    };
  }

  it('a journaled call replays on resume without re-calling the provider', async () => {
    const { gateway, firstStarted } = hangingFirstGateway();
    const { mgr, stub } = manager([audioStream()], { gateway });
    const runId = await startScript(mgr, SCRIPT);
    await firstStarted;
    await mgr.suspend(runId);
    await new Promise((r) => setTimeout(r, 300));
    await mgr.resume(runId);
    const view = await pollStatus(mgr, runId);
    expect(view.status, JSON.stringify(view.error ?? null)).toBe('completed');
    expect(stub.calls).toHaveLength(1);
    expect(((await mgr.result(runId)) as { value: any }).value).toMatchObject({ text: '<instrumental>', t: 'DONE' });
  });

  it('a journaled file that no longer verifies re-runs the call live on resume', async () => {
    const { gateway, firstStarted } = hangingFirstGateway();
    const { mgr, stub } = manager([audioStream()], { gateway });
    const runId = await startScript(mgr, SCRIPT);
    await firstStarted;
    await mgr.suspend(runId);
    await new Promise((r) => setTimeout(r, 300));
    const ws = (await mgr.workspacePath(runId))!;
    const journal = await (mgr as any)._store.getJournal?.(runId);
    const path = journal?.find((j: any) => j.value?.files)?.value.files[0].path ?? 'generated/song-0-0.mp3';
    writeFileSync(join(ws, path), 'tampered');
    await mgr.resume(runId);
    const view = await pollStatus(mgr, runId);
    expect(view.status, JSON.stringify(view.error ?? null)).toBe('completed');
    expect(stub.calls).toHaveLength(2);
    expect(readFileSync(join(ws, path)).equals(MP3)).toBe(true);
  });
});

describe('#169: run_result meta.budgetEnforceable for generateAudio()', () => {
  it('wire-priced over a zero catalog pin -> usd enforceable, costUSD is the wire cost', async () => {
    const { mgr, store } = manager([audioStream({ cost: 0.04 })], { modelBook: zeroPricedBook() });
    const runId = await startScript(mgr, `${META()}
      return (await generateAudio('song', { prompt: 'p' })).files.length;`, { budget: { usd: 1 } });
    expect((await pollStatus(mgr, runId)).status).toBe('completed');
    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    const r = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    expect(r.meta?.usage?.costUSD).toBeCloseTo(0.04, 9);
    expect(r.meta?.budgetEnforceable).toMatchObject({ usd: true });
  });

  it('no wire cost -> unpricedCalls 1 and usd NOT enforceable', async () => {
    const { mgr, store } = manager([audioStream({ cost: null })], { modelBook: zeroPricedBook() });
    const runId = await startScript(mgr, `${META()}
      return (await generateAudio('song', { prompt: 'p' })).files.length;`, { budget: { usd: 1 } });
    expect((await pollStatus(mgr, runId)).status).toBe('completed');
    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    const r = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    expect(r.meta?.usage?.unpricedCalls).toBe(1);
    expect(r.meta?.budgetEnforceable).toMatchObject({ usd: false });
  });
});

