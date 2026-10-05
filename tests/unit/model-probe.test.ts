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
  probeEffectiveForHarness,
  harnessFilteredProbeLookup,
  type ProbeResult,
} from '../../src/models/model-probe.js';
import { enrichModelEntry, type ModelEntry } from '../../src/models/model-catalog.js';
import { parseModelRef } from '../../src/providers.js';

const NONCE = 'a1b2c3d4e5f60718';
const ok = (content: unknown, events: unknown[] = []): GatewayResult =>
  ({ ok: true, provider: 'p', model: 'm', tokens: { input: 1, output: 1 }, content, events: events as never });
const readCall = { ts: 't', kind: 'tool_call' as const, data: { type: 'tool_use', name: 'Read', input: { file_path: '/ws/probe-nonce.txt' } } };
const bashCall = { ts: 't', kind: 'tool_call' as const, data: { type: 'tool_use', name: 'Bash', input: { command: 'cat probe-nonce.txt' } } };

describe('classifyProbe (#73) — pass needs a real Read tool_use AND the unguessable value (issue #93 item 4)', () => {
  it('prose text + Read tool_use + nonce in the answer -> both verified', () => {
    const c = classifyProbe(ok('PONG'), ok(`the file says ${NONCE}`, [readCall]), NONCE);
    expect(c.proseVerified).toBe(true);
    expect(c.toolUseVerified).toBe(true);
  });

  it('empty / whitespace prose answer -> proseVerified false', () => {
    expect(classifyProbe(ok('   '), ok(NONCE, [readCall]), NONCE).proseVerified).toBe(false);
    expect(classifyProbe(ok(null), ok(NONCE, [readCall]), NONCE).proseVerified).toBe(false);
  });

  it('the nonce without any Read tool_use (a guess / leaked value) -> toolUseVerified false', () => {
    const c = classifyProbe(ok('PONG'), ok(NONCE, []), NONCE);
    expect(c.toolUseVerified).toBe(false);
    expect(c.detail).toMatch(/no Read tool_use/);
  });

  it('a failed tool leg quotes the start of what the model answered instead (diagnosable, not opaque)', () => {
    const c = classifyProbe(ok('PONG'), ok('{"name": "Read", "arguments": {"file_path": "/ws/probe-nonce.txt"}}', []), NONCE);
    expect(c.detail).toContain('{"name": "Read"');
  });

  it('a non-Read tool call (e.g. Bash) does not count', () => {
    expect(classifyProbe(ok('PONG'), ok(NONCE, [bashCall]), NONCE).toolUseVerified).toBe(false);
  });

  it('a Read tool_use whose answer lacks the nonce -> toolUseVerified false', () => {
    const c = classifyProbe(ok('PONG'), ok('I ran it', [readCall]), NONCE);
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

  // review M7: a pi deployment's catalog can still carry a legacy anthropic ref in
  // `workflow_versions.params` (a version registered back when the deployment ran gateway:"sdk",
  // before switching to gateway:"pi" — the same stale-pin scenario review L2 refuses at run_resume
  // admission). The periodic prober and the no-ref `models_probe` door must never spend a real call
  // probing it, matching models_list's own "anthropic never reaches enrichment under pi" filter
  // (call-tool.ts's owner decision 2).
  it('an explicit harnessProviders list drops every ref whose provider is not in it, even when well-formed', () => {
    const t = probeTargets(
      ['anthropic/claude-haiku-4-5-20251001', 'ollama/qwen2.5:7b', 'openrouter/openai/gpt-4.1'],
      ['openrouter', 'ollama'],
    );
    expect(t).toEqual([
      { provider: 'ollama', model: 'qwen2.5:7b' },
      { provider: 'openrouter', model: 'openai/gpt-4.1' },
    ]);
  });

  it('harnessProviders omitted (the sdk gateway) keeps every well-formed ref, unchanged', () => {
    const t = probeTargets(['anthropic/claude-haiku-4-5-20251001', 'ollama/qwen2.5:7b']);
    expect(t).toEqual([
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      { provider: 'ollama', model: 'qwen2.5:7b' },
    ]);
  });
});

/** A fake gateway that behaves like a tool-capable model: on the Read leg it reads the file the
 *  probe planted (the way the real `Read` tool would) and answers with it. Records every request. */
function recordingGateway(behave: 'good' | 'no-tools'): { gw: GatewayClient; reqs: Array<{ prompt: string; opts: AgentOpts; workspace?: string }> } {
  const reqs: Array<{ prompt: string; opts: AgentOpts; workspace?: string }> = [];
  const gw: GatewayClient = {
    async invoke(req) {
      reqs.push({ prompt: req.prompt, opts: req.opts, workspace: req.workspace });
      if (req.opts.allowedTools && req.opts.allowedTools.includes('Read')) {
        if (behave === 'no-tools') return ok('I cannot read files.');
        const value = readFileSync(join(req.workspace!, 'probe-nonce.txt'), 'utf8').trim();
        return ok(value, [{ ts: 't', kind: 'tool_call' as const, data: { type: 'tool_use', name: 'Read', input: { file_path: join(req.workspace!, 'probe-nonce.txt') } } }]);
      }
      return ok('PONG');
    },
  };
  return { gw, reqs };
}

describe('runProbe (#73) — the real GatewayClient.invoke path, a throwaway workspace under workRoot', () => {
  it('dispatches with model = the full ref; prose leg has no tools, tool leg has exactly [Read], per-call timeout, workspace inside workRoot and removed after (issue #93 item 4)', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-probe-'));
    try {
      const { gw, reqs } = recordingGateway('good');
      const r = await runProbe(gw, { provider: 'anthropic', model: 'claude-haiku' }, { workRoot, timeoutMs: 1234, clock: new FixedClock(new Date(0)) });
      expect(reqs).toHaveLength(2);
      expect(reqs[0]!.opts).toMatchObject({ model: 'anthropic/claude-haiku', allowedTools: [], timeoutMs: 1234 });
      expect(reqs[1]!.opts).toMatchObject({ model: 'anthropic/claude-haiku', allowedTools: ['Read'], timeoutMs: 1234 });
      // The tool prompt must NOT contain the value it asks for — otherwise echoing the prompt passes.
      const ws = reqs[1]!.workspace!;
      // Both legs run in the throwaway workspace, like every agent() call runs in its run workspace.
      expect(reqs[0]!.workspace).toBe(ws);
      const rel = relative(workRoot, ws);
      expect(rel.startsWith('..') || isAbsolute(rel)).toBe(false);
      // issue #93 item 4: the prompt names the ABSOLUTE nonce path, inside the probe workspace the
      // Read path-guard (claude-agent-sdk-client.ts's toolUsePreCheck) allows for THIS call.
      expect(reqs[1]!.prompt).toContain(join(ws, 'probe-nonce.txt'));
      expect(isAbsolute(join(ws, 'probe-nonce.txt'))).toBe(true);
      expect(existsSync(ws)).toBe(false);
      expect(r).toMatchObject({ provider: 'anthropic', model: 'claude-haiku', proseVerified: true, toolUseVerified: true });
      expect(typeof r.probedAt).toBe('string');
      // issue #138: the fake gateway's own `ok()` results (above) carry no `transport` at all — a
      // probe that genuinely cannot tell which harness ran it never guesses, so it records 'unknown'
      // rather than silently defaulting to some specific harness.
      expect(r.harness).toBe('unknown');
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });

  // issue #138: `runProbe` reads the harness straight off the SAME `GatewayResult` every agent()
  // call dispatches through (`GatewayResult.transport`) — never a separate guess from deployment
  // config — so a probe genuinely reflects which gateway answered it.
  it('records the harness from the GatewayResult.transport the probed gateway actually returned', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-probe-'));
    try {
      const gw: GatewayClient = {
        async invoke(req) {
          if (req.opts.allowedTools?.includes('Read')) {
            const value = readFileSync(join(req.workspace!, 'probe-nonce.txt'), 'utf8').trim();
            return { ok: true, provider: 'p', model: 'm', tokens: { input: 1, output: 1 }, content: value, transport: 'pi', events: [{ ts: 't', kind: 'tool_call', data: { type: 'tool_use', name: 'Read', input: {} } }] as never };
          }
          return { ok: true, provider: 'p', model: 'm', tokens: { input: 1, output: 1 }, content: 'PONG', transport: 'pi' };
        },
      };
      const r = await runProbe(gw, { provider: 'ollama', model: 'm' }, { workRoot, timeoutMs: 1000, clock: new FixedClock(new Date(0)) });
      expect(r.harness).toBe('pi');
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });

  it('the nonce is fresh per probe and never appears in the tool prompt', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-probe-'));
    try {
      const seen: string[] = [];
      const gw: GatewayClient = {
        async invoke(req) {
          if (req.opts.allowedTools?.includes('Read')) {
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
  probedAt: '2026-09-25T00:00:00.000Z', latencyMs: { prose: 812, tools: 4021 }, detail: 'tools: no Read tool_use in the reply',
  harness: 'pi',
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

  // issue #138: a db written before the `harness` column existed (e.g. a deployment still on the
  // #73-era schema, which itself already post-dates the alias-drop above) must not lose its rows —
  // unlike the alias migration (a genuinely incompatible shape), this one only ADDS a column, so
  // existing rows are preserved and backfilled with a documented default: 'sdk' (every one of these
  // rows necessarily predates the pi harness's existence, so "not pi" is a known fact — the finer
  // claude-agent-sdk-vs-direct-fetch split is NOT recoverable, which is exactly why 'sdk' is its own
  // value rather than a guess at one of those two).
  it('migrates a pre-existing db that predates the harness column by adding it with default "sdk", preserving existing rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-probe-db-migrate-harness-'));
    try {
      const path = join(dir, 'index.db');
      const legacy = new Database(path);
      legacy.exec(`CREATE TABLE model_probes (
        provider TEXT NOT NULL, model TEXT NOT NULL,
        prose_ok INTEGER NOT NULL, tools_ok INTEGER NOT NULL, probed_at TEXT NOT NULL,
        prose_ms INTEGER NOT NULL, tools_ms INTEGER NOT NULL, detail TEXT NOT NULL,
        PRIMARY KEY (provider, model))`);
      legacy.prepare('INSERT INTO model_probes VALUES (?,?,?,?,?,?,?,?)').run(
        'ollama', 'qwen2.5:7b', 1, 0, '2026-01-01T00:00:00.000Z', 100, 200, 'pre-harness-column row',
      );
      legacy.close();

      const store = new ModelProbeStore(path);
      // The pre-existing row survives (not dropped — this is an additive migration) and is
      // backfilled with the documented default.
      const row = store.get('ollama', 'qwen2.5:7b');
      expect(row).toMatchObject({ detail: 'pre-harness-column row', harness: 'sdk' });

      // A fresh write still records its own real harness, unaffected by the default.
      store.put(RESULT);
      expect(store.get('ollama', 'qwen2.5:7b')!.harness).toBe('pi');
      store.close();

      const reopened = new ModelProbeStore(path);
      expect(reopened.get('ollama', 'qwen2.5:7b')!.harness).toBe('pi');
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

  // issue #138 review M-138-2: a row recorded under a DIFFERENT harness than the one this deployment
  // is actively running must count as due IMMEDIATELY, regardless of `probedAt` age — otherwise, per
  // the review's own finding, a gateway switch leaves toolUseVerified null for up to `intervalMs`
  // (7 days default) before the periodic prober catches up, even though every reader already treats
  // the row as unprobed right now.
  it('dueTargets: a fresh row recorded under a MISMATCHED harness is due immediately (issue #138 M-138-2)', () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-prober-'));
    try {
      const store = new ModelProbeStore(join(workRoot, 'index.db'));
      const clock = new FixedClock(new Date('2026-09-25T00:00:00.000Z'));
      const prober = new ModelProber({
        gateway: recordingGateway('good').gw, store, workRoot, clock, config: MODEL_PROBE_DEFAULTS,
        modelRefs: () => ['ollama/freshSdk', 'ollama/freshPi'],
        activeHarness: 'pi',
      });
      // Both rows probed one second ago (nowhere near the 7-day interval) — the sdk one is due only
      // because it was recorded under a harness other than the active 'pi'.
      store.put({ ...RESULT, model: 'freshSdk', harness: 'claude-agent-sdk', probedAt: '2026-09-24T23:59:59.000Z' });
      store.put({ ...RESULT, model: 'freshPi', harness: 'pi', probedAt: '2026-09-24T23:59:59.000Z' });
      expect(prober.dueTargets().map((t) => `${t.provider}/${t.model}`)).toEqual(['ollama/freshSdk']);
      store.close();
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });

  it('dueTargets: activeHarness omitted (the sdk gateway, every pre-#138 call site) behaves exactly as before — only age gates due-ness', () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-prober-'));
    try {
      const store = new ModelProbeStore(join(workRoot, 'index.db'));
      const clock = new FixedClock(new Date('2026-09-25T00:00:00.000Z'));
      const prober = new ModelProber({
        gateway: recordingGateway('good').gw, store, workRoot, clock, config: MODEL_PROBE_DEFAULTS,
        modelRefs: () => ['ollama/fresh'],
      });
      store.put({ ...RESULT, model: 'fresh', harness: 'pi', probedAt: '2026-09-24T23:59:59.000Z' });
      expect(prober.dueTargets()).toEqual([]);
      store.close();
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });

  // review M7: a `harnessProviders`-scoped prober (the pi deployment's own) must not probe — or
  // return — an anthropic ref even when one still sits in the catalog (a version registered back
  // when this same deployment ran gateway:"sdk", before switching to "pi" — review L2's exact
  // stale-pin scenario, one layer over). `harnessProviders` undefined (every existing test above,
  // the sdk gateway) is untouched: zero behavior change there.
  it('a harnessProviders-scoped prober drops a legacy anthropic ref from both probeNow() and dueTargets(), never spending a call on it', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-prober-'));
    try {
      const store = new ModelProbeStore(join(workRoot, 'index.db'));
      const { gw, reqs } = recordingGateway('no-tools');
      const prober = new ModelProber({
        gateway: gw, store, workRoot, clock: new FixedClock(new Date(0)), config: { ...MODEL_PROBE_DEFAULTS, timeoutMs: 500 },
        modelRefs: () => ['ollama/q', 'anthropic/h'],
        harnessProviders: ['openrouter', 'ollama'],
      });
      // dueTargets checked BEFORE probing (both targets are never-probed -> both "due" absent the
      // harnessProviders filter) — probing ollama/q below would otherwise make it freshly-probed and
      // no longer due, confounding what this assertion is actually checking.
      expect(prober.dueTargets().map((t) => `${t.provider}/${t.model}`)).toEqual(['ollama/q']);
      const all = await prober.probeNow();
      expect(all!.map((r) => `${r.provider}/${r.model}`)).toEqual(['ollama/q']);
      expect(reqs).toHaveLength(2); // one target's two legs, never anthropic/h's
      expect(store.get('anthropic', 'h')).toBeUndefined();
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

// Issue #138: a probe recorded under one harness (e.g. the sdk gateway) must not keep driving
// MODEL_TOOL_USE_UNVERIFIED warnings, stability, or toolUseVerified after this deployment switches
// to a different harness (e.g. pi) — see #137's smoke report, which is where this was found: a
// 2026-09-28 sdk-era probe kept warning under gateway:"pi" even though the model worked fine there.
describe('probeEffectiveForHarness (#138) — a recorded probe counts only for a compatible active harness', () => {
  it('a precise claude-agent-sdk/direct-fetch recording is honoured under active "sdk" and ignored under active "pi"', () => {
    expect(probeEffectiveForHarness('claude-agent-sdk', 'sdk')).toBe(true);
    expect(probeEffectiveForHarness('direct-fetch', 'sdk')).toBe(true);
    expect(probeEffectiveForHarness('claude-agent-sdk', 'pi')).toBe(false);
    expect(probeEffectiveForHarness('direct-fetch', 'pi')).toBe(false);
  });

  it('a pi recording is honoured under active "pi" and ignored under active "sdk"', () => {
    expect(probeEffectiveForHarness('pi', 'pi')).toBe(true);
    expect(probeEffectiveForHarness('pi', 'sdk')).toBe(false);
  });

  it('the legacy migration default "sdk" behaves exactly like a precise sdk-family recording', () => {
    expect(probeEffectiveForHarness('sdk', 'sdk')).toBe(true);
    expect(probeEffectiveForHarness('sdk', 'pi')).toBe(false);
  });

  // 'unknown' carries NO negative knowledge (unlike the legacy 'sdk' default, which confidently
  // means "predates pi") — a gateway that never reports a transport at all (many real and test
  // GatewayClient implementations legitimately don't — see ProbeHarness's own doc) must not have its
  // probes invalidated by a gate it was never evidence for either way; this is "fail open", matching
  // the pre-#138 behavior that applied before harnesses were ever tracked.
  it('"unknown" (a probe whose own gateway result carried no transport at all) is honoured under every active harness', () => {
    expect(probeEffectiveForHarness('unknown', 'sdk')).toBe(true);
    expect(probeEffectiveForHarness('unknown', 'pi')).toBe(true);
  });

  it('an absent harness (a fixture/row that predates this field entirely) is treated the same as "unknown" — also fail-open', () => {
    expect(probeEffectiveForHarness(undefined, 'sdk')).toBe(true);
    expect(probeEffectiveForHarness(undefined, 'pi')).toBe(true);
  });
});

describe('harnessFilteredProbeLookup (#138) — the wrapper server.ts composes around the raw store lookup', () => {
  const sdkRow: ProbeResult = { ...RESULT, provider: 'ollama', model: 'a', harness: 'claude-agent-sdk' };
  const piRow: ProbeResult = { ...RESULT, provider: 'ollama', model: 'b', harness: 'pi' };
  const raw = (provider: string, model: string): ProbeResult | undefined =>
    provider === 'ollama' && model === 'a' ? sdkRow : provider === 'ollama' && model === 'b' ? piRow : undefined;

  it('an sdk-recorded probe passes through unfiltered when the active harness is sdk', () => {
    const lookup = harnessFilteredProbeLookup(raw, 'sdk');
    expect(lookup('ollama', 'a')).toEqual(sdkRow);
  });

  it('an sdk-recorded probe is hidden (undefined) when the active harness is pi', () => {
    const lookup = harnessFilteredProbeLookup(raw, 'pi');
    expect(lookup('ollama', 'a')).toBeUndefined();
  });

  it('a pi-recorded probe passes through unfiltered when the active harness is pi, and is hidden under sdk', () => {
    expect(harnessFilteredProbeLookup(raw, 'pi')('ollama', 'b')).toEqual(piRow);
    expect(harnessFilteredProbeLookup(raw, 'sdk')('ollama', 'b')).toBeUndefined();
  });

  it('no stored row at all stays undefined regardless of active harness', () => {
    expect(harnessFilteredProbeLookup(raw, 'pi')('ollama', 'absent')).toBeUndefined();
  });

  // issue #138 (run_start warning path): MODEL_TOOL_USE_UNVERIFIED must not fire for a run_start
  // whose probe evidence came from a harness this deployment is no longer running — exactly the
  // #137 scenario (sdk-era probe, now running pi).
  describe('run_start warning path (toolProbeWarnings fed a harness-filtered lookup)', () => {
    const resolveRef = (ref: string): { provider: string; model: string } | undefined => parseModelRef(ref);
    const calls = [{ line: 3, label: 'coder', index: 0, allowedTools: ['Bash'] }];

    it('an sdk-recorded, tool-unverified probe DOES warn when still running sdk', () => {
      const lookup = harnessFilteredProbeLookup(raw, 'sdk');
      const w = toolProbeWarnings({ calls, modelFor: () => 'ollama/a', resolve: resolveRef, lookup });
      expect(w).toHaveLength(1);
    });

    it('the SAME sdk-recorded, tool-unverified probe does NOT warn once this deployment is running pi', () => {
      const lookup = harnessFilteredProbeLookup(raw, 'pi');
      const w = toolProbeWarnings({ calls, modelFor: () => 'ollama/a', resolve: resolveRef, lookup });
      expect(w).toEqual([]);
    });
  });

  // issue #138 (models_list fields): toolUseVerified/proseVerified null and stabilitySource 'rule'
  // (the local classifyStability fallback), not the stale probe's verdict, once the harness no
  // longer matches — `enrichModelEntry` already treats an absent probe exactly this way (see the
  // "never probed" case above); feeding it a harness-filtered lookup result is all this needs.
  describe('models_list fields (enrichModelEntry fed a harness-filtered lookup)', () => {
    it('toolUseVerified/proseVerified are null and stabilitySource is "rule" when the recording harness mismatches', () => {
      const lookup = harnessFilteredProbeLookup(raw, 'pi');
      const e = enrichModelEntry(ROW, null, lookup('ollama', 'a'));
      expect(e.toolUseVerified).toBeNull();
      expect(e.proseVerified).toBeNull();
      expect(e.stabilitySource).toBe('rule');
    });

    it('the SAME row is honoured (probe-sourced fields, stabilitySource "probe") once the active harness matches', () => {
      const lookup = harnessFilteredProbeLookup(raw, 'sdk');
      const e = enrichModelEntry(ROW, null, lookup('ollama', 'a'));
      expect(e.toolUseVerified).toBe(sdkRow.toolUseVerified);
      expect(e.proseVerified).toBe(sdkRow.proseVerified);
      expect(e.stabilitySource).toBe('probe');
    });
  });
});

// issue #139(b): the probe used to dispatch with NO effort at all — under pi that collapses to
// OpenRouter `reasoning.effort:'none'`, which a mandatory-reasoning endpoint (glm-5.3-flash,
// gemini-3.8-flash) rejects with a terminal 400. `runProbe` must thread the run's own pinned `caps`
// through to BOTH legs, unchanged, so `PiGatewayClient`'s own `effectiveEffort` (the thing that
// actually picks the floor level) has the capability data it needs.
describe('runProbe (issue #139b) — threads opts.caps through to both legs', () => {
  it('a supplied caps object reaches gateway.invoke on both the prose and the tools leg, unchanged', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-probe-caps-'));
    try {
      const seenCaps: Array<unknown> = [];
      const gw: GatewayClient = {
        async invoke(req) {
          seenCaps.push(req.caps);
          return ok('PONG');
        },
      };
      const caps = { reasoning: true as const, tools: true as const, source: 'upstream' as const, reasoningMandatory: true, reasoningEfforts: ['low', 'medium'] };
      await runProbe(gw, { provider: 'openrouter', model: 'glm-5.3-flash' }, { workRoot, timeoutMs: 500, clock: new FixedClock(new Date(0)), caps });
      expect(seenCaps).toEqual([caps, caps]);
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });

  it('omitted caps -> req.caps is undefined on both legs (unchanged pre-#139(b) behavior)', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-probe-caps-'));
    try {
      const seenCaps: Array<unknown> = [];
      const gw: GatewayClient = {
        async invoke(req) {
          seenCaps.push(req.caps);
          return ok('PONG');
        },
      };
      await runProbe(gw, { provider: 'openrouter', model: 'gpt-4.1' }, { workRoot, timeoutMs: 500, clock: new FixedClock(new Date(0)) });
      expect(seenCaps).toEqual([undefined, undefined]);
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });
});

// issue #139(c): ollama/qwen2.5:7b (used by a registered workflow) stayed unprobed more than 1h
// after deploy. Root cause: ModelProber.start() only ever scheduled the periodic
// `setInterval(..., min(intervalMs, 1h))` — NEVER an immediate pass — so after a fresh
// deploy/restart, EVERY due target (not just ollama) waited out up to a full hour before the first
// probe ever ran. The two openrouter models in the original report were probed anyway because an
// admin manually ran `models_probe({model})`; ollama's was not, surfacing the gap.
describe('ModelProber.start() (issue #139c) — probes DUE targets promptly, not only on the first interval tick', () => {
  it('a never-probed target is probed shortly after start(), without waiting out intervalMs', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-prober-start-'));
    try {
      const store = new ModelProbeStore(join(workRoot, 'index.db'));
      const { gw } = recordingGateway('good');
      const prober = new ModelProber({
        gateway: gw, store, workRoot, clock: new FixedClock(new Date(0)),
        // The REAL default interval (7 days) — if start() only probed on the periodic tick, nothing
        // would be probed for min(7 days, 1h) = 1 hour, which this test's short real wait below
        // would never reach.
        config: { ...MODEL_PROBE_DEFAULTS },
        modelRefs: () => ['ollama/qwen2.5:7b'],
      });
      expect(store.get('ollama', 'qwen2.5:7b')).toBeUndefined();
      prober.start();
      await new Promise((r) => setTimeout(r, 30));
      expect(store.get('ollama', 'qwen2.5:7b')).toBeDefined();
      prober.stop();
      store.close();
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });

  it('start() called twice does not double-probe (the existing re-entrancy guard is unaffected)', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-prober-start-twice-'));
    try {
      const store = new ModelProbeStore(join(workRoot, 'index.db'));
      const { gw, reqs } = recordingGateway('good');
      const prober = new ModelProber({
        gateway: gw, store, workRoot, clock: new FixedClock(new Date(0)), config: { ...MODEL_PROBE_DEFAULTS },
        modelRefs: () => ['ollama/only'],
      });
      prober.start();
      prober.start();
      await new Promise((r) => setTimeout(r, 30));
      // One target, two legs (prose + tools) — not four.
      expect(reqs).toHaveLength(2);
      prober.stop();
      store.close();
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });

  it('config.enabled:false never probes at start() either', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-prober-start-disabled-'));
    try {
      const store = new ModelProbeStore(join(workRoot, 'index.db'));
      const { gw, reqs } = recordingGateway('good');
      const prober = new ModelProber({
        gateway: gw, store, workRoot, clock: new FixedClock(new Date(0)), config: { ...MODEL_PROBE_DEFAULTS, enabled: false },
        modelRefs: () => ['ollama/only'],
      });
      prober.start();
      await new Promise((r) => setTimeout(r, 30));
      expect(reqs).toHaveLength(0);
      prober.stop();
      store.close();
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });
});

// issue #139(c): `runProbe` itself never throws (a gateway exception is already caught into a
// failed leg, by its own doc) — but `_probe`'s surrounding per-target work (the injected `capsFor`
// lookup, the store write) is NOT inside that same guarantee. One target's OWN failure there must
// not abort every target QUEUED AFTER it in the same sweep.
describe('ModelProber — one target\'s own failure does not abort the rest of the sweep (issue #139c)', () => {
  it('a capsFor lookup that throws for one target does not prevent a LATER target from being probed', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-prober-isolate-'));
    try {
      const store = new ModelProbeStore(join(workRoot, 'index.db'));
      const { gw } = recordingGateway('good');
      const prober = new ModelProber({
        gateway: gw, store, workRoot, clock: new FixedClock(new Date(0)), config: { ...MODEL_PROBE_DEFAULTS, timeoutMs: 500 },
        modelRefs: () => ['ollama/bad', 'ollama/good'],
        capsFor: async (provider, model) => {
          if (model === 'bad') throw new Error('boom: capability lookup failed');
          return undefined;
        },
      });
      const results = await prober.probeNow();
      // 'bad' is skipped (its own lookup threw); 'good' — queued AFTER it — is still probed and
      // persisted, proving one target's failure does not abort the whole sweep.
      expect(results!.map((r) => `${r.provider}/${r.model}`)).toEqual(['ollama/good']);
      expect(store.get('ollama', 'good')).toBeDefined();
      expect(store.get('ollama', 'bad')).toBeUndefined();
      store.close();
    } finally { rmSync(workRoot, { recursive: true, force: true }); }
  });
});
