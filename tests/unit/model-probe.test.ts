// Issue #73: probe-backed model capability. models_list's `toolUseDeclared`/`effortDeclared` are
// DECLARED (never dispatched) and `stability` is a local rule; nothing observed a model actually
// answering or actually using a tool. These cases pin the probe's classification (fake gateway
// results — no network), persistence across a reopen, the models_list merge (+ stabilitySource),
// config validation, and the run_start tool-use warning.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { AgentOpts } from '../../src/types.js';
import { FixedClock } from '../../src/clock.js';
import {
  classifyProbe,
  probeTargets,
  runProbe,
  ModelProbeStore,
  ModelProber,
  validateModelProbeConfig,
  MODEL_PROBE_DEFAULTS,
  toolProbeWarnings,
  type ProbeResult,
} from '../../src/models/model-probe.js';
import { enrichModelEntry, type ModelEntry } from '../../src/models/model-catalog.js';

const NONCE = 'a1b2c3d4e5f60718';
const ok = (content: unknown, events: unknown[] = []): GatewayResult =>
  ({ ok: true, provider: 'p', model: 'm', tokens: { input: 1, output: 1 }, content, events: events as never });
const bashCall = { ts: 't', kind: 'tool_call' as const, data: { type: 'tool_use', name: 'Bash', input: { command: 'cat probe-nonce.txt' } } };
const readCall = { ts: 't', kind: 'tool_call' as const, data: { type: 'tool_use', name: 'Read', input: {} } };

describe('classifyProbe (#73) — pass needs a real Bash tool_use AND the unguessable value', () => {
  it('prose text + Bash tool_use + nonce in the answer -> both verified', () => {
    const c = classifyProbe(ok('PONG'), ok(`the file says ${NONCE}`, [bashCall]), NONCE);
    expect(c.proseVerified).toBe(true);
    expect(c.toolUseVerified).toBe(true);
  });

  it('empty / whitespace prose answer -> proseVerified false', () => {
    expect(classifyProbe(ok('   '), ok(NONCE, [bashCall]), NONCE).proseVerified).toBe(false);
    expect(classifyProbe(ok(null), ok(NONCE, [bashCall]), NONCE).proseVerified).toBe(false);
  });

  it('the nonce without any Bash tool_use (a guess / leaked value) -> toolUseVerified false', () => {
    const c = classifyProbe(ok('PONG'), ok(NONCE, []), NONCE);
    expect(c.toolUseVerified).toBe(false);
    expect(c.detail).toMatch(/no Bash tool_use/);
  });

  it('a failed tool leg quotes the start of what the model answered instead (diagnosable, not opaque)', () => {
    const c = classifyProbe(ok('PONG'), ok('{"name": "Bash", "arguments": {"command": "cat probe-nonce.txt"}}', []), NONCE);
    expect(c.detail).toContain('{"name": "Bash"');
  });

  it('a non-Bash tool call does not count', () => {
    expect(classifyProbe(ok('PONG'), ok(NONCE, [readCall]), NONCE).toolUseVerified).toBe(false);
  });

  it('a Bash tool_use whose answer lacks the nonce -> toolUseVerified false', () => {
    const c = classifyProbe(ok('PONG'), ok('I ran it', [bashCall]), NONCE);
    expect(c.toolUseVerified).toBe(false);
    expect(c.detail).toMatch(/nonce/);
  });

  it('a gateway failure on either leg is a fail with the reason in detail', () => {
    const fail: GatewayResult = { ok: false, provider: 'p', reason: 'timeout', detail: 'no answer in 1000ms' };
    const c = classifyProbe(fail, fail, NONCE);
    expect(c).toMatchObject({ proseVerified: false, toolUseVerified: false });
    expect(c.detail).toMatch(/timeout/);
  });
});

describe('probeTargets (#73) — configured aliases only, one per distinct (provider, model)', () => {
  it('dedupes two aliases naming one model; keeps the first alias as the dispatch name', () => {
    const t = probeTargets({
      haiku: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      'claude-haiku-4-5': { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      default: { provider: 'ollama', model: 'qwen2.5:7b' },
    });
    expect(t).toEqual([
      { alias: 'haiku', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      { alias: 'default', provider: 'ollama', model: 'qwen2.5:7b' },
    ]);
  });
});

/** A fake gateway that behaves like a tool-capable model: on the Bash leg it reads the file the
 *  probe planted (the way `cat` would) and answers with it. Records every request. */
function recordingGateway(behave: 'good' | 'no-tools'): { gw: GatewayClient; reqs: Array<{ prompt: string; opts: AgentOpts; workspace?: string }> } {
  const reqs: Array<{ prompt: string; opts: AgentOpts; workspace?: string }> = [];
  const gw: GatewayClient = {
    async invoke(req) {
      reqs.push({ prompt: req.prompt, opts: req.opts, workspace: req.workspace });
      if (req.opts.allowedTools && req.opts.allowedTools.includes('Bash')) {
        if (behave === 'no-tools') return ok('I cannot run commands.');
        const value = readFileSync(join(req.workspace!, 'probe-nonce.txt'), 'utf8').trim();
        return ok(value, [bashCall]);
      }
      return ok('PONG');
    },
  };
  return { gw, reqs };
}

describe('runProbe (#73) — the real GatewayClient.invoke path, a throwaway workspace under workRoot', () => {
  it('prose leg has no tools, tool leg has exactly [Bash], per-call timeout, workspace inside workRoot and removed after', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-probe-'));
    try {
      const { gw, reqs } = recordingGateway('good');
      const r = await runProbe(gw, { alias: 'haiku', provider: 'anthropic', model: 'claude-haiku' }, { workRoot, timeoutMs: 1234, clock: new FixedClock(new Date(0)) });
      expect(reqs).toHaveLength(2);
      expect(reqs[0]!.opts).toMatchObject({ model: 'haiku', allowedTools: [], timeoutMs: 1234 });
      expect(reqs[1]!.opts).toMatchObject({ model: 'haiku', allowedTools: ['Bash'], timeoutMs: 1234 });
      // The tool prompt must NOT contain the value it asks for — otherwise echoing the prompt passes.
      const ws = reqs[1]!.workspace!;
      const rel = relative(workRoot, ws);
      expect(rel.startsWith('..') || isAbsolute(rel)).toBe(false);
      expect(existsSync(ws)).toBe(false);
      expect(r).toMatchObject({ alias: 'haiku', provider: 'anthropic', model: 'claude-haiku', proseVerified: true, toolUseVerified: true });
      expect(typeof r.probedAt).toBe('string');
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });

  it('the nonce is fresh per probe and never appears in the tool prompt', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-probe-'));
    try {
      const seen: string[] = [];
      const gw: GatewayClient = {
        async invoke(req) {
          if (req.opts.allowedTools?.includes('Bash')) {
            const v = readFileSync(join(req.workspace!, 'probe-nonce.txt'), 'utf8').trim();
            seen.push(v);
            expect(req.prompt).not.toContain(v);
          }
          return ok('x');
        },
      };
      const t = { alias: 'a', provider: 'ollama', model: 'm' };
      await runProbe(gw, t, { workRoot, timeoutMs: 1000, clock: new FixedClock(new Date(0)) });
      await runProbe(gw, t, { workRoot, timeoutMs: 1000, clock: new FixedClock(new Date(0)) });
      expect(seen).toHaveLength(2);
      expect(seen[0]).not.toBe(seen[1]);
      expect(seen[0]!.length).toBeGreaterThanOrEqual(16);
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });

  it('a gateway that throws is recorded as a failed probe, never an exception', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-probe-'));
    try {
      const gw: GatewayClient = { async invoke() { throw new Error('boom'); } };
      const r = await runProbe(gw, { alias: 'a', provider: 'ollama', model: 'm' }, { workRoot, timeoutMs: 1000, clock: new FixedClock(new Date(0)) });
      expect(r).toMatchObject({ proseVerified: false, toolUseVerified: false });
      expect(r.detail).toMatch(/boom/);
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });
});

const RESULT: ProbeResult = {
  alias: 'default', provider: 'ollama', model: 'qwen2.5:7b', proseVerified: true, toolUseVerified: false,
  probedAt: '2026-09-25T00:00:00.000Z', latencyMs: { prose: 812, tools: 4021 }, detail: 'tools: no Bash tool_use in the reply',
};

describe('ModelProbeStore (#73) — persisted so a restart keeps the last result', () => {
  it('round-trips through a close + reopen of the same sqlite file, latest result wins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-probe-db-'));
    try {
      const path = join(dir, 'index.db');
      const a = new ModelProbeStore(path);
      a.put({ ...RESULT, toolUseVerified: true, probedAt: '2026-09-18T00:00:00.000Z' });
      a.put(RESULT);
      a.close();
      const b = new ModelProbeStore(path);
      expect(b.get('ollama', 'qwen2.5:7b')).toEqual(RESULT);
      expect(b.get('ollama', 'absent')).toBeUndefined();
      expect(b.all()).toHaveLength(1);
      b.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

const ROW: ModelEntry = {
  provider: 'ollama', model: 'qwen2.5:7b', aliases: ['default'], description: 'qwen', modalities: { in: ['text'], out: ['text'] },
  contextWindow: null, price: 'free', toolUse: 'unknown', location: 'local', ratesPerM: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
};

describe('enrichModelEntry + probe (#73) — verified fields and stabilitySource', () => {
  it('never probed: verified fields null, stability from the rule', () => {
    const e = enrichModelEntry(ROW, null);
    expect(e).toMatchObject({ toolUseVerified: null, proseVerified: null, lastProbedAt: null, probeDetail: null, stability: 'variable', stabilitySource: 'rule' });
  });

  it('prose ok, tools failed -> degraded, from the probe', () => {
    const e = enrichModelEntry(ROW, null, RESULT);
    expect(e).toMatchObject({ toolUseVerified: false, proseVerified: true, lastProbedAt: RESULT.probedAt, probeDetail: RESULT.detail, stability: 'degraded', stabilitySource: 'probe' });
  });

  it('prose failed -> unavailable, from the probe', () => {
    const e = enrichModelEntry(ROW, null, { ...RESULT, proseVerified: false, toolUseVerified: false });
    expect(e).toMatchObject({ stability: 'unavailable', stabilitySource: 'probe' });
  });

  it('both passed -> the rule tier is kept (a probe does not promote a local model to stable), source probe', () => {
    const e = enrichModelEntry(ROW, null, { ...RESULT, toolUseVerified: true, detail: 'ok' });
    expect(e).toMatchObject({ stability: 'variable', stabilitySource: 'probe', toolUseVerified: true });
  });

  it('probeDetail is short (capped)', () => {
    const e = enrichModelEntry(ROW, null, { ...RESULT, detail: 'x'.repeat(5000) });
    expect(e.probeDetail!.length).toBeLessThanOrEqual(200);
  });
});

describe('validateModelProbeConfig (#73) — fail closed on bad values', () => {
  it('absent -> the defaults (enabled, weekly)', () => {
    expect(validateModelProbeConfig(undefined)).toEqual({ ok: true, value: MODEL_PROBE_DEFAULTS });
    expect(MODEL_PROBE_DEFAULTS.intervalMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(MODEL_PROBE_DEFAULTS.enabled).toBe(true);
  });

  it('a partial block fills the rest from the defaults', () => {
    const r = validateModelProbeConfig({ enabled: false });
    expect(r).toEqual({ ok: true, value: { ...MODEL_PROBE_DEFAULTS, enabled: false } });
  });

  it.each([
    ['not an object', 'weekly'],
    ['enabled not boolean', { enabled: 'yes' }],
    ['intervalMs below a minute', { intervalMs: 1000 }],
    ['intervalMs not an integer', { intervalMs: 1.5e6 + 0.5 }],
    ['timeoutMs zero', { timeoutMs: 0 }],
    ['timeoutMs above 10 minutes', { timeoutMs: 600_001 }],
    ['unknown key (typo)', { interval: 60000 }],
  ])('refuses %s', (_why, raw) => {
    const r = validateModelProbeConfig(raw);
    expect(r.ok).toBe(false);
  });
});

describe('ModelProber (#73) — probeNow over all or one alias; persists', () => {
  it('probes every distinct configured model, or only the named alias; unknown alias -> null', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-prober-'));
    try {
      const store = new ModelProbeStore(join(workRoot, 'index.db'));
      const { gw, reqs } = recordingGateway('no-tools');
      const prober = new ModelProber({
        gateway: gw, store, workRoot, clock: new FixedClock(new Date(0)), config: { ...MODEL_PROBE_DEFAULTS, timeoutMs: 500 },
        aliases: { default: { provider: 'ollama', model: 'q' }, other: { provider: 'ollama', model: 'q' }, haiku: { provider: 'anthropic', model: 'h' } },
      });
      const all = await prober.probeNow();
      expect(all!.map((r) => r.alias)).toEqual(['default', 'haiku']);
      expect(reqs).toHaveLength(4);
      expect(store.get('ollama', 'q')).toMatchObject({ proseVerified: true, toolUseVerified: false });
      const one = await prober.probeNow('other');
      expect(one!.map((r) => r.alias)).toEqual(['other']);
      expect(await prober.probeNow('nope')).toBeNull();
      // A per-call override of the configured per-call bound (the admin tool's `timeoutMs`).
      await prober.probeNow('other', 777);
      expect(reqs.slice(-2).map((r) => r.opts.timeoutMs)).toEqual([777, 777]);
      store.close();
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });

  it('dueTargets: never-probed and stale targets are due; a fresh one is not', () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-prober-'));
    try {
      const store = new ModelProbeStore(join(workRoot, 'index.db'));
      const clock = new FixedClock(new Date('2026-09-25T00:00:00.000Z'));
      const prober = new ModelProber({
        gateway: recordingGateway('good').gw, store, workRoot, clock, config: MODEL_PROBE_DEFAULTS,
        aliases: { a: { provider: 'ollama', model: 'fresh' }, b: { provider: 'ollama', model: 'stale' }, c: { provider: 'ollama', model: 'never' } },
      });
      store.put({ ...RESULT, alias: 'a', model: 'fresh', probedAt: '2026-09-24T00:00:00.000Z' });
      store.put({ ...RESULT, alias: 'b', model: 'stale', probedAt: '2026-09-01T00:00:00.000Z' });
      expect(prober.dueTargets().map((t) => t.alias)).toEqual(['b', 'c']);
      store.close();
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });
});

describe('toolProbeWarnings (#73 (d)) — run_start warns, never refuses', () => {
  const resolve = (alias: string) => ({ default: { provider: 'ollama', model: 'qwen2.5:7b' }, haiku: { provider: 'anthropic', model: 'h' } } as Record<string, { provider: string; model: string }>)[alias];
  const lookup = (provider: string, model: string): ProbeResult | undefined =>
    provider === 'ollama' && model === 'qwen2.5:7b' ? RESULT : provider === 'anthropic' ? { ...RESULT, provider, model, toolUseVerified: true } : undefined;

  it('an agent with tools on a model whose probe shows no tool use gets a warning naming label, alias and probe time', () => {
    const w = toolProbeWarnings({
      calls: [{ line: 3, label: 'coder', index: 0, allowedTools: ['Bash'] }],
      modelFor: () => 'default', resolve, lookup,
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ code: 'MODEL_TOOL_USE_UNVERIFIED', label: 'coder', model: 'default' });
    expect(w[0]!.message).toContain(RESULT.probedAt);
  });

  it("allowedTools absent means the deployment's default tool set (non-empty) -> also warns", () => {
    expect(toolProbeWarnings({ calls: [{ line: 3, label: 'x', index: 0, allowedTools: 'absent' }], modelFor: () => 'default', resolve, lookup })).toHaveLength(1);
  });

  it('allowedTools: [] (prose-only), a tool-verified model, or an unprobed model -> no warning', () => {
    expect(toolProbeWarnings({ calls: [{ line: 3, label: 'x', index: 0, allowedTools: [] }], modelFor: () => 'default', resolve, lookup })).toEqual([]);
    expect(toolProbeWarnings({ calls: [{ line: 3, label: 'x', index: 0, allowedTools: ['Bash'] }], modelFor: () => 'haiku', resolve, lookup })).toEqual([]);
    expect(toolProbeWarnings({ calls: [{ line: 3, label: 'x', index: 0, allowedTools: ['Bash'] }], modelFor: () => 'nope', resolve, lookup })).toEqual([]);
  });

  it('one warning per label even when the label is called twice', () => {
    const calls = [{ line: 3, label: 'x', index: 0, allowedTools: ['Bash'] }, { line: 5, label: 'x', index: 9, allowedTools: ['Bash'] }];
    expect(toolProbeWarnings({ calls, modelFor: () => 'default', resolve, lookup })).toHaveLength(1);
  });
});
