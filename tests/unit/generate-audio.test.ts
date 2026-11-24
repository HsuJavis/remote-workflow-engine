// #169: generateAudio() — the pure layers (input validation, call key, magic-byte sniff, atomic
// write + verify, SSE parse, wire-cost read, the retry loop over the OpenRouter streaming chat
// endpoint, pricing). Real tmp dir for the fs layer; only `DirectDeps.fetch`/`sleep`/
// `attemptSignal`/`random`/`now` are faked for the network layer (no real network).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAudioInput, primitiveCallKey, MAX_AUDIO_PROMPT_BYTES } from '../../src/direct-models/inputs.js';
import { sniffAudioMime, writeAudio, verifyFiles, resolveOutDir } from '../../src/direct-models/image-files.js';
import {
  parseAudioSse, runAudio, makeObservedFetch, OPENROUTER_BASE_URL, MAX_AUDIO_RESPONSE_BYTES,
  type DirectDeps,
} from '../../src/direct-models/call.js';
import { pricePrimitiveCall, foldPrimitiveSpend, primitivePriceKnowable } from '../../src/run-guard.js';
import { makeStubFetch, type StubFetchStep } from '../helpers/stub-fetch.js';

const SENTINEL = 'sentinel-a0d1o';

// A minimal ID3v2-headed "MP3": what Lyria's stream decoded to (MPEG layer III with an ID3 tag).
const MP3_ID3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([0x04, 0x00, 0x00, 0, 0, 0, 0]), Buffer.alloc(32, 0x11)]);
const MP3_SYNC = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(8)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(8)]);
const FLAC = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(8)]);

/** One OpenRouter streaming chat-completions body, exactly the wire shape observed live: `data:`
 *  lines, the audio base64 under `choices[0].delta.audio.data`, text under `delta.content`, the
 *  final chunk carrying `usage` (with `cost`), then `data: [DONE]`. */
function sse(chunks: unknown[], opts: { crlf?: boolean; done?: boolean } = {}): Uint8Array {
  const nl = opts.crlf ? '\r\n' : '\n';
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}${nl}${nl}`);
  if (opts.done !== false) lines.push(`data: [DONE]${nl}${nl}`);
  return new TextEncoder().encode(`: OPENROUTER PROCESSING${nl}${nl}${lines.join('')}`);
}
const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'gen-1', choices: [{ index: 0, delta, finish_reason: null }], ...extra });
const usageChunk = (usage: Record<string, unknown>) => ({ id: 'gen-1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage });

function sseStep(chunks: unknown[], opts: { crlf?: boolean; done?: boolean } = {}): StubFetchStep {
  return { status: 200, bodyBytes: sse(chunks, opts), headers: { 'content-type': 'text/event-stream' } };
}

function fakeDeps(opts: { fetchSteps: StubFetchStep[]; timeoutOnAttempts?: Set<number> }): DirectDeps & { onAttempt: ReturnType<typeof vi.fn>; calls: { url: string; init: RequestInit | undefined }[] } {
  const stub = makeStubFetch(opts.fetchSteps);
  let attempt = 0;
  const onAttempt = vi.fn();
  return {
    fetch: stub.fetch,
    calls: stub.calls,
    now: () => 0,
    sleep: async () => {},
    attemptSignal: (_ms: number) => {
      attempt++;
      const ctrl = new AbortController();
      if (opts.timeoutOnAttempts?.has(attempt)) ctrl.abort();
      return { signal: ctrl.signal, fired: () => ctrl.signal.aborted, clear: () => {} };
    },
    random: () => 0.5,
    resolveKey: () => 'test-openrouter-key',
    onAttempt,
  };
}

const LYRIA = 'google/lyria-3-clip-preview';
const req = (over: Partial<Parameters<typeof runAudio>[0]> = {}) => ({
  model: LYRIA, prompt: 'a calm piano loop', timeoutMs: 1000, retries: 0, runSignal: new AbortController().signal, label: 'song', ...over,
});

describe('#169: validateAudioInput', () => {
  it('accepts {prompt} and {prompt, outDir}', () => {
    expect(validateAudioInput('song', { prompt: 'p' })).toEqual({ prompt: 'p', outDir: undefined });
    expect(validateAudioInput('song', { prompt: 'p', outDir: 'out/a' })).toEqual({ prompt: 'p', outDir: 'out/a' });
  });

  it.each([
    [undefined, /opts must be an object/],
    [{}, /prompt must be a non-empty string/],
    [{ prompt: '' }, /prompt must be a non-empty string/],
    [{ prompt: 3 }, /prompt must be a non-empty string/],
    [{ prompt: 'p', inputImages: [] }, /inputImages is not a recognized argument/],
    [{ prompt: 'p', model: 'x' }, /model is not a recognized argument/],
    [{ prompt: 'p', outDir: '' }, /outDir must be a non-empty string/],
  ])('refuses %j with PRIMITIVE_INPUT_INVALID', (opts, re) => {
    expect(() => validateAudioInput('song', opts)).toThrow(re);
    try { validateAudioInput('song', opts); } catch (e) {
      expect((e as { code?: string }).code).toBe('PRIMITIVE_INPUT_INVALID');
      expect((e as Error).message).toMatch(/^PRIMITIVE_INPUT_INVALID: generateAudio 'song': /);
    }
  });

  it('caps the prompt at MAX_AUDIO_PROMPT_BYTES (bytes, not chars) and never echoes it', () => {
    expect(MAX_AUDIO_PROMPT_BYTES).toBe(16_384);
    expect(() => validateAudioInput('song', { prompt: 'x'.repeat(MAX_AUDIO_PROMPT_BYTES) })).not.toThrow();
    const big = SENTINEL + 'é'.repeat(MAX_AUDIO_PROMPT_BYTES / 2);
    expect(() => validateAudioInput('song', { prompt: big })).toThrow(/exceeds 16384 bytes/);
    try { validateAudioInput('song', { prompt: big }); } catch (e) { expect((e as Error).message).not.toContain(SENTINEL); }
  });

  it.each(['/abs', '../up', 'a/../../b', '.hidden'])('outDir %s is refused as an escape, naming generateAudio', (outDir) => {
    try {
      validateAudioInput('song', { prompt: 'p', outDir });
      expect.unreachable();
    } catch (e) {
      expect((e as { code?: string }).code).toBe('IMAGE_PATH_REFUSED');
      expect((e as Error).message).toMatch(/generateAudio: outDir escape/);
    }
  });
});

describe('#169: primitiveCallKey for audio', () => {
  it("is kind-prefixed 'audio:' and normalizes outDir like image does", () => {
    const k1 = primitiveCallKey('audio', 'song', 'm', { prompt: 'p', outDir: 'out/a' });
    const k2 = primitiveCallKey('audio', 'song', 'm', { prompt: 'p', outDir: './out/a/' });
    expect(k1.prompt).toMatch(/^audio:[0-9a-f]{64}$/);
    expect(k1).toEqual(k2);
    // same inputs under the image kind never collide with the audio key
    expect(primitiveCallKey('image', 'song', 'm', { prompt: 'p', outDir: 'out/a' }).prompt).not.toBe(k1.prompt);
  });
});

describe('#169: sniffAudioMime', () => {
  it.each([
    [MP3_ID3, 'audio/mpeg'],
    [MP3_SYNC, 'audio/mpeg'],
    [WAV, 'audio/wav'],
    [OGG, 'audio/ogg'],
    [FLAC, 'audio/flac'],
  ])('sniffs magic bytes', (bytes, mime) => {
    expect(sniffAudioMime(bytes as Buffer)).toBe(mime);
  });

  it.each([
    ['text', Buffer.from('<instrumental>')],
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['jpeg (0xFFD8 is not an MPEG frame sync)', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['AAC ADTS (layer bits 00)', Buffer.from([0xff, 0xf1, 0x50, 0x80])],
    ['RIFF but WEBP', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])],
    ['empty', Buffer.alloc(0)],
  ])('returns null for %s', (_name, bytes) => {
    expect(sniffAudioMime(bytes)).toBeNull();
  });
});

describe('#169: writeAudio / verifyFiles (real fs)', () => {
  let root: string;
  beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'rwe-audio-files-'))); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('writes <label>-<callSeq>-0.mp3 atomically and returns {path, mimeType, bytes, sha256}', async () => {
    const absDir = await resolveOutDir(root, undefined, 'generateAudio');
    const f = await writeAudio(root, absDir, 'song', 3, MP3_ID3);
    expect(f).toMatchObject({ path: 'generated/song-3-0.mp3', mimeType: 'audio/mpeg', bytes: MP3_ID3.length });
    expect(f!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(root, f!.path)).equals(MP3_ID3)).toBe(true);
    expect(readdirSync(absDir)).toEqual(['song-3-0.mp3']); // no tmp file left behind
    expect(await verifyFiles(root, [f!])).toBe(true);
  });

  it.each([[WAV, 'wav'], [OGG, 'ogg'], [FLAC, 'flac']])('picks the extension from the sniffed bytes', async (bytes, ext) => {
    const absDir = await resolveOutDir(root, 'out', 'generateAudio');
    const f = await writeAudio(root, absDir, 'a', 0, bytes as Buffer);
    expect(f!.path).toBe(`out/a-0-0.${ext}`);
  });

  it('unknown bytes -> null, nothing written', async () => {
    const absDir = await resolveOutDir(root, undefined, 'generateAudio');
    expect(await writeAudio(root, absDir, 'song', 0, Buffer.from('<instrumental>'))).toBeNull();
    expect(readdirSync(absDir)).toEqual([]);
  });

  it('a planted symlink at the final name is replaced, never followed', async () => {
    const absDir = await resolveOutDir(root, undefined, 'generateAudio');
    const outside = join(tmpdir(), `rwe-audio-outside-${process.pid}.txt`);
    writeFileSync(outside, 'keep');
    symlinkSync(outside, join(absDir, 'song-0-0.mp3'));
    const f = await writeAudio(root, absDir, 'song', 0, MP3_ID3);
    expect(readFileSync(outside, 'utf8')).toBe('keep');
    expect(await verifyFiles(root, [f!])).toBe(true);
    rmSync(outside, { force: true });
  });

  it('resolveOutDir refuses a symlinked outDir escaping root, naming generateAudio', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'rwe-audio-out-')));
    symlinkSync(outside, join(root, 'esc'));
    await expect(resolveOutDir(root, 'esc/x', 'generateAudio')).rejects.toThrow(/IMAGE_PATH_REFUSED: generateAudio: outDir escape/);
    rmSync(outside, { recursive: true, force: true });
  });

  it('verifyFiles fails on a changed or missing file', async () => {
    mkdirSync(join(root, 'generated'));
    const absDir = await resolveOutDir(root, undefined, 'generateAudio');
    const f = (await writeAudio(root, absDir, 'song', 0, MP3_ID3))!;
    writeFileSync(join(root, f.path), Buffer.concat([MP3_ID3, Buffer.from([1])]));
    expect(await verifyFiles(root, [f])).toBe(false);
    rmSync(join(root, f.path));
    expect(await verifyFiles(root, [f])).toBe(false);
  });
});

describe('#169: parseAudioSse', () => {
  it('concatenates every audio.data piece in order (split at a non-multiple-of-4 boundary), collects text, reads final usage', () => {
    const b64 = MP3_ID3.toString('base64');
    const cut = 7; // not a multiple of 4 — decoding each piece separately would corrupt the bytes
    const body = sse([
      chunk({ role: 'assistant', content: '<instru' }),
      chunk({ audio: { data: b64.slice(0, cut) } }),
      chunk({ content: 'mental>', audio: { data: b64.slice(cut) } }),
      usageChunk({ prompt_tokens: 14, completion_tokens: 4, cost: 0.04, cost_details: { upstream_inference_cost: null } }),
    ]);
    const r = parseAudioSse(Buffer.from(body).toString('utf8'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.audio.equals(MP3_ID3)).toBe(true);
    expect(r.text).toBe('<instrumental>');
    expect(r.usage).toEqual({ prompt_tokens: 14, completion_tokens: 4, cost: 0.04, cost_details: { upstream_inference_cost: null } });
  });

  it('handles CRLF line endings, comment lines, and a missing [DONE]', () => {
    const r = parseAudioSse(Buffer.from(sse([chunk({ audio: { data: MP3_SYNC.toString('base64') } })], { crlf: true, done: false })).toString('utf8'));
    expect(r.ok && r.audio.equals(MP3_SYNC)).toBe(true);
  });

  it('text only, no audio -> ok with an empty audio buffer', () => {
    const r = parseAudioSse(Buffer.from(sse([chunk({ content: 'hi' })])).toString('utf8'));
    expect(r).toMatchObject({ ok: true, text: 'hi' });
    expect(r.ok && r.audio.length).toBe(0);
  });

  it('an in-stream error chunk or an unparseable data line -> not ok', () => {
    expect(parseAudioSse(Buffer.from(sse([{ error: { code: 502, message: 'upstream' } }])).toString('utf8')).ok).toBe(false);
    expect(parseAudioSse('data: {not json\n\n').ok).toBe(false);
  });
});

describe('#169: makeObservedFetch reads wire cost from an SSE body (last usage.cost)', () => {
  it('SSE 2xx body -> wireCostUSD from the last chunk carrying usage.cost', async () => {
    const stub = makeStubFetch([sseStep([chunk({ content: 'x' }), usageChunk({ cost: 0.01 }), usageChunk({ cost: 0.04 })])]);
    const observed = makeObservedFetch({ fetch: stub.fetch, now: () => 0 }, MAX_AUDIO_RESPONSE_BYTES, new AbortController().signal);
    await observed.fetch('https://x');
    expect(observed.last()?.wireCostUSD).toBe(0.04);
  });

  it('SSE body with no usage.cost -> null (never guessed as 0)', async () => {
    const stub = makeStubFetch([sseStep([chunk({ content: 'x' }), usageChunk({ prompt_tokens: 1, completion_tokens: 1 })])]);
    const observed = makeObservedFetch({ fetch: stub.fetch, now: () => 0 }, MAX_AUDIO_RESPONSE_BYTES, new AbortController().signal);
    await observed.fetch('https://x');
    expect(observed.last()?.wireCostUSD).toBeNull();
  });

  it('a JSON body still reads usage.cost as before', async () => {
    const stub = makeStubFetch([{ status: 200, body: { usage: { cost: 0.2 } } }]);
    const observed = makeObservedFetch({ fetch: stub.fetch, now: () => 0 }, MAX_AUDIO_RESPONSE_BYTES, new AbortController().signal);
    await observed.fetch('https://x');
    expect(observed.last()?.wireCostUSD).toBe(0.2);
  });
});

describe('#169: runAudio (OpenRouter streaming chat completions)', () => {
  const OK = [
    chunk({ role: 'assistant', content: '<instrumental>' }),
    chunk({ audio: { data: MP3_ID3.toString('base64') } }),
    usageChunk({ prompt_tokens: 14, completion_tokens: 4, cost: 0.04 }),
  ];

  it('POSTs the verified request shape to /chat/completions with the key, and returns audio/text/spend', async () => {
    const deps = fakeDeps({ fetchSteps: [sseStep(OK)] });
    const r = await runAudio(req(), deps);
    expect(r.audio.equals(MP3_ID3)).toBe(true);
    expect(r.text).toBe('<instrumental>');
    expect(r.attempts).toBe(1);
    expect(r.spends).toEqual([{ wireCostUSD: 0.04, tokens: { input: 14, output: 4, cacheRead: 0, cacheWrite: 0 } }]);
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0]!.url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    const init = deps.calls[0]!.init!;
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-openrouter-key');
    expect(JSON.parse(String(init.body))).toEqual({
      model: LYRIA, modalities: ['audio', 'text'], messages: [{ role: 'user', content: 'a calm piano loop' }], stream: true, usage: { include: true },
    });
  });

  it('missing wire cost -> that attempt spends wireCostUSD:null (the caller prices it unpriced)', async () => {
    const deps = fakeDeps({ fetchSteps: [sseStep([chunk({ audio: { data: MP3_ID3.toString('base64') } }), usageChunk({ prompt_tokens: 1, completion_tokens: 2 })])] });
    const r = await runAudio(req(), deps);
    expect(r.spends).toEqual([{ wireCostUSD: null, tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }]);
  });

  it.each([429, 500, 503])('HTTP %s then a stream -> retried, succeeds on attempt 2', async (status) => {
    const deps = fakeDeps({ fetchSteps: [{ status }, sseStep(OK)] });
    const r = await runAudio(req({ retries: 1 }), deps);
    expect(r.attempts).toBe(2);
    expect(r.spends).toHaveLength(2);
    expect(r.spends[0]).toEqual({ wireCostUSD: null });
    expect(deps.onAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, outcome: 'retry', reason: 'http', status }));
  });

  it('timeout then a stream -> retried', async () => {
    // attempt 1's deadline has already fired, so the seam never reaches fetch; attempt 2 streams.
    const deps = fakeDeps({ fetchSteps: [sseStep(OK)], timeoutOnAttempts: new Set([1]) });
    const r = await runAudio(req({ retries: 1 }), deps);
    expect(r.attempts).toBe(2);
    expect(deps.onAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, outcome: 'retry', reason: 'timeout' }));
  });

  it('network error then a stream -> retried', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 0, networkError: true }, sseStep(OK)] });
    const r = await runAudio(req({ retries: 1 }), deps);
    expect(r.attempts).toBe(2);
  });

  it('HTTP 400 (e.g. non-streaming refused) -> PRIMITIVE_FAILED{http, 400}, not retried', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 400, body: { error: { message: 'Audio output requires stream: true' } } }] });
    await expect(runAudio(req({ retries: 3 }), deps)).rejects.toMatchObject({
      code: 'PRIMITIVE_FAILED', message: "generateAudio 'song' failed: HTTP 400 after 1 attempt", detail: expect.objectContaining({ reason: 'http', status: 400, attempts: 1 }),
    });
  });

  it('retries exhausted on 429 -> PRIMITIVE_FAILED carrying every attempt spend', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 429 }] });
    await expect(runAudio(req({ retries: 2 }), deps)).rejects.toMatchObject({
      code: 'PRIMITIVE_FAILED', detail: expect.objectContaining({ reason: 'http', attempts: 3, spends: [{ wireCostUSD: null }, { wireCostUSD: null }, { wireCostUSD: null }] }),
    });
  });

  it('a text-only stream (no audio bytes) -> PRIMITIVE_FAILED{no_output}, spend kept', async () => {
    const deps = fakeDeps({ fetchSteps: [sseStep([chunk({ content: '<instrumental>' }), usageChunk({ cost: 0.04 })])] });
    await expect(runAudio(req({ retries: 2 }), deps)).rejects.toMatchObject({
      code: 'PRIMITIVE_FAILED', detail: expect.objectContaining({ reason: 'no_output', attempts: 1, spends: [{ wireCostUSD: 0.04 }] }),
    });
  });

  it('an in-stream error chunk on a 200 -> PRIMITIVE_FAILED{malformed}', async () => {
    const deps = fakeDeps({ fetchSteps: [sseStep([{ error: { message: 'boom' } }])] });
    await expect(runAudio(req({ retries: 2 }), deps)).rejects.toMatchObject({ code: 'PRIMITIVE_FAILED', detail: expect.objectContaining({ reason: 'malformed' }) });
  });

  it('a body over the byte cap -> response_too_large', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 200, bodyBytes: new Uint8Array(MAX_AUDIO_RESPONSE_BYTES + 1) }] });
    await expect(runAudio(req(), deps)).rejects.toMatchObject({ code: 'PRIMITIVE_FAILED', detail: expect.objectContaining({ reason: 'response_too_large' }) });
  });

  it('run abort -> aborted, never retried', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const deps = fakeDeps({ fetchSteps: [sseStep(OK)] });
    await expect(runAudio(req({ runSignal: ctrl.signal, retries: 3 }), deps)).rejects.toMatchObject({ code: 'PRIMITIVE_FAILED', detail: expect.objectContaining({ reason: 'aborted' }) });
  });
});

describe('#169: audio pricing — the wire cost is authoritative; absent is unpriced, never a known $0', () => {
  // Lyria's catalog row: prompt 0 / completion 0 — a finite, all-zero price the catalog cannot
  // actually back (it bills per clip on the wire).
  const ZERO_PIN = { price: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 } } as never;
  const T = { input: 14, output: 4, cacheRead: 0, cacheWrite: 0 };

  it('wire cost -> reported', () => {
    expect(pricePrimitiveCall({ wireCostUSD: 0.04, tokens: T, entry: ZERO_PIN, kind: 'audio' })).toEqual({ costUSD: 0.04, source: 'reported' });
  });

  it('no wire cost + tokens + a zero catalog price -> absent (NOT estimated $0)', () => {
    expect(pricePrimitiveCall({ wireCostUSD: null, tokens: T, entry: ZERO_PIN, kind: 'audio' })).toEqual({ absent: true });
  });

  it('fold: one priced + one unpriced attempt -> costUSD sums the priced, unpriced:true', () => {
    expect(foldPrimitiveSpend([{ wireCostUSD: null }, { wireCostUSD: 0.04, tokens: T }], ZERO_PIN, 'audio'))
      .toEqual({ costUSD: 0.04, unpriced: true, tokens: T, costSource: 'reported' });
  });

  it('the catalog never "knows" an audio price (it is wire-priced only)', () => {
    expect(primitivePriceKnowable(ZERO_PIN, 'audio')).toBe(false);
  });
});
