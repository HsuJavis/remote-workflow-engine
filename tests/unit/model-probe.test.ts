// Issue #73: probe-backed model capability. models_list's `toolUseDeclared`/`effortDeclared` are
// DECLARED (never dispatched) and `stability` is a local rule; nothing observed a model actually
// answering or actually using a tool. These cases pin the probe's classification (fake gateway
// results — no network), persistence across a reopen, the models_list merge (+ stabilitySource),
// config validation, and the run_start tool-use warning.
//
// 2026-09-26 (alias mechanism removed, owner decision 10): probe targets are now the distinct full
// `<provider>/<model-id>` refs declared by registered workflow versions — no alias table, no
// `alias` field on `ProbeTarget`/`ProbeResult`, no `alias` column in the sqlite store.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import Database from 'better-sqlite3';
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
import { parseModelRef } from '../../src/providers.js';

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

describe('probeTargets (#73) — distinct full refs only, one per distinct (provider, model)', () => {
  it('dedupes two refs naming one model; a malformed ref is silently skipped', () => {
    const t = probeTargets([
      'anthropic/claude-haiku-4-5-20251001',
      'anthropic/claude-haiku-4-5-20251001',
      'ollama/qwen2.5:7b',
      'not-a-valid-ref',
    ]);
    expect(t).toEqual([
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      { provider: 'ollama', model: 'qwen2.5:7b' },
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
  it('dispatches with model = the full ref; prose leg has no tools, tool leg has exactly [Bash], per-call timeout, workspace inside workRoot and removed after', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-probe-'));
    try {
      const { gw, reqs } = recordingGateway('good');
      const r = await runProbe(gw, { provider: 'anthropic', model: 'claude-haiku' }, { workRoot, timeoutMs: 1234, clock: new FixedClock(new Date(0)) });
      expect(reqs).toHaveLength(2);
      expect(reqs[0]!.opts).toMatchObject({ model: 'anthropic/claude-haiku', allowedTools: [], timeoutMs: 1234 });
      expect(reqs[1]!.opts).toMatchObject({ model: 'anthropic/claude-haiku', allowedTools: ['Bash'], timeoutMs: 1234 });
      // The tool prompt must NOT contain the value it asks for — otherwise echoing the prompt passes.
      const ws = reqs[1]!.workspace!;
      // Both legs run in the throwaway workspace, like every agent() call runs in its run workspace.
      expect(reqs[0]!.workspace).toBe(ws);
      const rel = relative(workRoot, ws);
      expect(rel.startsWith('..') || isAbsolute(rel)).toBe(false);
      expect(existsSync(ws)).toBe(false);
      expect(r).toMatchObject({ provider: 'anthropic', model: 'claude-haiku', proseVerified: true, toolUseVerified: true });
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
      const t = { provider: 'ollama', model: 'm' };
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
      const r = await runProbe(gw, { provider: 'ollama', model: 'm' }, { workRoot, timeoutMs: 1000, clock: new FixedClock(new Date(0)) });
      expect(r).toMatchObject({ proseVerified: false, toolUseVerified: false });
      expect(r.detail).toMatch(/boom/);
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });
});

const RESULT: ProbeResult = {
  provider: 'ollama', model: 'qwen2.5:7b', proseVerified: true, toolUseVerified: false,
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

  // 2026-09-26 (alias mechanism removed): a pre-existing db from before this change has an `alias
  // TEXT NOT NULL` column. The migration is a hard reset (spec's own call: "old rows may be
  // dropped" — a probe result is a cache the periodic prober repopulates on its own schedule).
  it('migrates a pre-existing db with the old alias-shaped schema by dropping and recreating the table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-probe-db-migrate-'));
    try {
      const path = join(dir, 'index.db');
      const legacy = new Database(path);
      legacy.exec(`CREATE TABLE model_probes (
        provider TEXT NOT NULL, model TEXT NOT NULL, alias TEXT NOT NULL,
        prose_ok INTEGER NOT NULL, tools_ok INTEGER NOT NULL, probed_at TEXT NOT NULL,
        prose_ms INTEGER NOT NULL, tools_ms INTEGER NOT NULL, detail TEXT NOT NULL,
        PRIMARY KEY (provider, model))`);
      legacy.prepare('INSERT INTO model_probes VALUES (?,?,?,?,?,?,?,?,?)').run(
        'ollama', 'qwen2.5:7b', 'default', 1, 0, '2026-01-01T00:00:00.000Z', 100, 200, 'legacy row',
      );
      legacy.close();

      const store = new ModelProbeStore(path);
      // The old row is gone (dropped, not migrated) — a fresh, alias-free schema.
      expect(store.all()).toEqual([]);
      // The new schema genuinely works (no `alias` column requirement left over).
      store.put(RESULT);
      expect(store.get('ollama', 'qwen2.5:7b')).toEqual(RESULT);
      store.close();

      // Reopening again (schema already migrated) is a no-op / stable.
      const reopened = new ModelProbeStore(path);
      expect(reopened.get('ollama', 'qwen2.5:7b')).toEqual(RESULT);
      reopened.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

const ROW: ModelEntry = {
  provider: 'ollama', model: 'qwen2.5:7b', description: 'qwen', modalities: { in: ['text'], out: ['text'] },
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

describe('ModelProber (#73) — probeNow over all distinct refs, or one; malformed ref -> null', () => {
  it('probes every distinct model registered workflow versions declare, or only the named ref; a malformed ref -> null', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-prober-'));
    try {
      const store = new ModelProbeStore(join(workRoot, 'index.db'));
      const { gw, reqs } = recordingGateway('no-tools');
      const prober = new ModelProber({
        gateway: gw, store, workRoot, clock: new FixedClock(new Date(0)), config: { ...MODEL_PROBE_DEFAULTS, timeoutMs: 500 },
        // 2026-09-26: a LIVE accessor over distinct refs — 'ollama/q' declared twice (two labels/
        // versions naming the same model) dedupes to one target, same as before.
        modelRefs: () => ['ollama/q', 'ollama/q', 'anthropic/h'],
      });
      const all = await prober.probeNow();
      expect(all!.map((r) => `${r.provider}/${r.model}`)).toEqual(['ollama/q', 'anthropic/h']);
      expect(reqs).toHaveLength(4);
      expect(store.get('ollama', 'q')).toMatchObject({ proseVerified: true, toolUseVerified: false });
      const one = await prober.probeNow('anthropic/h');
      expect(one!.map((r) => `${r.provider}/${r.model}`)).toEqual(['anthropic/h']);
      // A well-formed ref not (yet) declared by any registered version is still probed on demand —
      // an ad-hoc `models_probe({model})` check is a legitimate use.
      const adhoc = await prober.probeNow('ollama/not-yet-registered');
      expect(adhoc!.map((r) => `${r.provider}/${r.model}`)).toEqual(['ollama/not-yet-registered']);
      expect(await prober.probeNow('not-a-valid-ref')).toBeNull();
      // A per-call override of the configured per-call bound (the admin tool's `timeoutMs`).
      await prober.probeNow('anthropic/h', 777);
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
        modelRefs: () => ['ollama/fresh', 'ollama/stale', 'ollama/never'],
      });
      store.put({ ...RESULT, model: 'fresh', probedAt: '2026-09-24T00:00:00.000Z' });
      store.put({ ...RESULT, model: 'stale', probedAt: '2026-09-01T00:00:00.000Z' });
      expect(prober.dueTargets().map((t) => `${t.provider}/${t.model}`)).toEqual(['ollama/stale', 'ollama/never']);
      store.close();
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });
});

describe('toolProbeWarnings (#73 (d)) — run_start warns, never refuses', () => {
  const resolve = (ref: string): { provider: string; model: string } | undefined => parseModelRef(ref);
  const lookup = (provider: string, model: string): ProbeResult | undefined =>
    provider === 'ollama' && model === 'qwen2.5:7b' ? RESULT : provider === 'anthropic' ? { ...RESULT, provider, model, toolUseVerified: true } : undefined;

  it('an agent with tools on a model whose probe shows no tool use gets a warning naming label, the full ref and probe time', () => {
    const w = toolProbeWarnings({
      calls: [{ line: 3, label: 'coder', index: 0, allowedTools: ['Bash'] }],
      modelFor: () => 'ollama/qwen2.5:7b', resolve, lookup,
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ code: 'MODEL_TOOL_USE_UNVERIFIED', label: 'coder', model: 'ollama/qwen2.5:7b' });
    expect(w[0]!.message).toContain(RESULT.probedAt);
  });

  it("allowedTools absent means the deployment's default tool set (non-empty) -> also warns", () => {
    expect(toolProbeWarnings({ calls: [{ line: 3, label: 'x', index: 0, allowedTools: 'absent' }], modelFor: () => 'ollama/qwen2.5:7b', resolve, lookup })).toHaveLength(1);
  });

  it('allowedTools: [] (prose-only), a tool-verified model, or an unresolvable ref -> no warning', () => {
    expect(toolProbeWarnings({ calls: [{ line: 3, label: 'x', index: 0, allowedTools: [] }], modelFor: () => 'ollama/qwen2.5:7b', resolve, lookup })).toEqual([]);
    expect(toolProbeWarnings({ calls: [{ line: 3, label: 'x', index: 0, allowedTools: ['Bash'] }], modelFor: () => 'anthropic/h', resolve, lookup })).toEqual([]);
    expect(toolProbeWarnings({ calls: [{ line: 3, label: 'x', index: 0, allowedTools: ['Bash'] }], modelFor: () => 'not-a-valid-ref', resolve, lookup })).toEqual([]);
  });

  it('one warning per label even when the label is called twice', () => {
    const calls = [{ line: 3, label: 'x', index: 0, allowedTools: ['Bash'] }, { line: 5, label: 'x', index: 9, allowedTools: ['Bash'] }];
    expect(toolProbeWarnings({ calls, modelFor: () => 'ollama/qwen2.5:7b', resolve, lookup })).toHaveLength(1);
  });
});
