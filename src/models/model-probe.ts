// Issue #73: probe-backed model capability. `models_list`'s `toolUseDeclared`/`effortDeclared` are
// what a catalog DECLARES and `stability` is a local rule (model-catalog.ts `classifyStability`) —
// nothing ever observed a configured model answer, or actually use a tool. This module does, cheaply:
// per configured (provider, model) pair — never the ~100 catalog rows — ONE prose call and ONE call
// holding only Bash that must run a command whose output the model cannot guess. Both go through the
// deployment's own `GatewayClient.invoke()` (the same object `AgentExecutor` dispatches every agent()
// call through), so the probe measures what a run would get, not a parallel client's opinion.
//
// Cost bound: `AgentOpts` has no output-token knob, so "capped" is a one-line prompt asking for a
// one-line answer plus the per-call `timeoutMs`; the gateway's configured `retries` still apply to a
// failing call (`attemptsFor`), exactly as they would to an agent's.
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AliasMap, GatewayClient, GatewayResult } from '../gateway/client.js';
import type { Clock } from '../clock.js';
import type { AgentCallScan } from '../workflow-meta.js';

export interface ModelProbeConfig {
  /** Run the periodic probe. The admin `models_probe` tool works either way. */
  enabled: boolean;
  /** How old the last probe of a model may get before the periodic check re-probes it. */
  intervalMs: number;
  /** Per-call bound for each of the two probe calls. */
  timeoutMs: number;
}

/** Default ON: the owner ruled (v26) that weekly probing should happen, and the spend is ~2 one-line
 *  calls per configured model per week. 60 s per call leaves room for a cold SDK CLI start and a
 *  local model's first load without calling a slow-but-working model dead. */
export const MODEL_PROBE_DEFAULTS: ModelProbeConfig = { enabled: true, intervalMs: 7 * 24 * 60 * 60 * 1000, timeoutMs: 60_000 };

const MIN_INTERVAL_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;
const PROBE_KEYS = new Set(['enabled', 'intervalMs', 'timeoutMs']);

/** Fail-closed validation of the `modelProbe` config block (absent -> the defaults; a partial block
 *  fills the rest from them). Never throws — the caller (composeConfig) refuses the boot. */
export function validateModelProbeConfig(raw: unknown): { ok: true; value: ModelProbeConfig } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: { ...MODEL_PROBE_DEFAULTS } };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'modelProbe must be an object' };
  const r = raw as Record<string, unknown>;
  const unknown = Object.keys(r).filter((k) => !PROBE_KEYS.has(k));
  if (unknown.length > 0) return { ok: false, message: `modelProbe has unknown key(s): ${unknown.join(', ')} (allowed: enabled, intervalMs, timeoutMs)` };
  const value = { ...MODEL_PROBE_DEFAULTS, ...r } as ModelProbeConfig;
  if (typeof value.enabled !== 'boolean') return { ok: false, message: 'modelProbe.enabled must be a boolean' };
  if (!Number.isInteger(value.intervalMs) || value.intervalMs < MIN_INTERVAL_MS) {
    return { ok: false, message: `modelProbe.intervalMs must be an integer >= ${MIN_INTERVAL_MS}` };
  }
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs <= 0 || value.timeoutMs > MAX_TIMEOUT_MS) {
    return { ok: false, message: `modelProbe.timeoutMs must be an integer in 1..${MAX_TIMEOUT_MS}` };
  }
  return { ok: true, value };
}

export interface ProbeTarget { alias: string; provider: string; model: string }

export interface ProbeResult extends ProbeTarget {
  proseVerified: boolean;
  toolUseVerified: boolean;
  probedAt: string;
  latencyMs: { prose: number; tools: number };
  /** Short, human-readable outcome of both legs (capped at `DETAIL_CAP`). */
  detail: string;
}

export const DETAIL_CAP = 200;
const cap = (s: string): string => (s.length > DETAIL_CAP ? s.slice(0, DETAIL_CAP - 1) + '…' : s);

/** One target per DISTINCT configured (provider, model) — the first alias naming it is the one
 *  dispatched (the gateway resolves it exactly as it would an agent's `model`). */
export function probeTargets(aliases: AliasMap): ProbeTarget[] {
  const seen = new Set<string>();
  const out: ProbeTarget[] = [];
  for (const [alias, t] of Object.entries(aliases)) {
    const key = `${t.provider}/${t.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ alias, provider: t.provider, model: t.model });
  }
  return out;
}

const text = (r: GatewayResult): string => (r.ok ? (typeof r.content === 'string' ? r.content : r.content == null ? '' : JSON.stringify(r.content)) : '');
const failure = (r: GatewayResult): string => (r.ok ? '' : `${r.reason}${r.detail ? ` (${r.detail})` : ''}`);

/** Pure classification of the two legs. Tools pass = a real `Bash` tool_use event in the reply AND
 *  the unguessable nonce in the answer — either alone is not proof (a nonce without a tool call is a
 *  leak or a guess; a tool call without the value is a model that did not read its own output). */
export function classifyProbe(prose: GatewayResult, tools: GatewayResult, nonce: string): { proseVerified: boolean; toolUseVerified: boolean; detail: string } {
  const proseVerified = prose.ok && text(prose).trim().length > 0;
  const proseDetail = prose.ok ? (proseVerified ? 'ok' : 'empty reply') : failure(prose);
  let toolUseVerified = false;
  let toolsDetail: string;
  if (!tools.ok) {
    toolsDetail = failure(tools);
  } else {
    const usedBash = (tools.events ?? []).some((e) => e.kind === 'tool_call' && (e.data as { name?: unknown } | undefined)?.name === 'Bash');
    const hasNonce = text(tools).includes(nonce);
    toolUseVerified = usedBash && hasNonce;
    toolsDetail = toolUseVerified ? 'ok' : !usedBash ? 'no Bash tool_use in the reply' : 'Bash ran but the answer lacks the nonce';
    // What it said instead is the diagnosis (e.g. a tool call written out as prose JSON).
    if (!toolUseVerified) toolsDetail += ` — replied: ${text(tools).replace(/\s+/g, ' ').trim().slice(0, 80) || '(empty)'}`;
  }
  return { proseVerified, toolUseVerified, detail: cap(`prose: ${proseDetail}; tools: ${toolsDetail}`) };
}

const NONCE_FILE = 'probe-nonce.txt';
const PROSE_PROMPT = 'Reply with the single word PONG and nothing else.';
const TOOLS_PROMPT =
  `Use the Bash tool to run exactly this command: cat ${NONCE_FILE}\n` +
  'Then reply with only the text that command printed, nothing else. Do not guess — the value is random.';

async function timed(clock: Clock, fn: () => Promise<GatewayResult>): Promise<{ r: GatewayResult; ms: number }> {
  const t0 = clock.now();
  let r: GatewayResult;
  try { r = await fn(); } catch (err) { r = { ok: false, provider: 'probe', reason: 'terminal', detail: String((err as Error)?.message ?? err) }; }
  return { r, ms: Math.max(0, clock.now() - t0) };
}

/** Probe one target through `gateway.invoke()`. Both legs run in a throwaway workspace UNDER
 *  workRoot — as every agent() call runs in its run workspace (the SDK gateway refuses one outside
 *  workRoot — WORKROOT_INSIDE_PROJECT) — removed afterwards. Never throws: a gateway exception is a
 *  failed leg. */
export async function runProbe(
  gateway: GatewayClient,
  target: ProbeTarget,
  opts: { workRoot: string; timeoutMs: number; clock: Clock },
): Promise<ProbeResult> {
  const { clock, timeoutMs } = opts;
  const runId = `model-probe-${clock.now()}`;
  const parent = join(opts.workRoot, 'model-probe');
  mkdirSync(parent, { recursive: true });
  const workspace = mkdtempSync(join(parent, 'ws-'));
  const nonce = randomBytes(12).toString('hex');
  let prose: { r: GatewayResult; ms: number };
  let tools: { r: GatewayResult; ms: number };
  try {
    prose = await timed(clock, () => gateway.invoke({
      prompt: PROSE_PROMPT, opts: { model: target.alias, allowedTools: [], timeoutMs }, runId, agentId: `probe-prose-${target.alias}`, workspace,
    }));
    writeFileSync(join(workspace, NONCE_FILE), `${nonce}\n`);
    tools = await timed(clock, () => gateway.invoke({
      prompt: TOOLS_PROMPT, opts: { model: target.alias, allowedTools: ['Bash'], timeoutMs }, runId, agentId: `probe-tools-${target.alias}`, workspace,
    }));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
  const c = classifyProbe(prose.r, tools.r, nonce);
  return { ...target, ...c, probedAt: clock.isoNow(), latencyMs: { prose: prose.ms, tools: tools.ms } };
}

/** Latest probe result per (provider, model), in a sqlite table. Production puts it in the run
 *  store's own `store/index.db`, which the Bash sandbox already denies (ENGINE_STATE_DENY). */
export class ModelProbeStore {
  private readonly _db: Database.Database;
  constructor(dbPath: string) {
    this._db = new Database(dbPath);
    this._db.exec(`CREATE TABLE IF NOT EXISTS model_probes (
      provider TEXT NOT NULL, model TEXT NOT NULL, alias TEXT NOT NULL,
      prose_ok INTEGER NOT NULL, tools_ok INTEGER NOT NULL, probed_at TEXT NOT NULL,
      prose_ms INTEGER NOT NULL, tools_ms INTEGER NOT NULL, detail TEXT NOT NULL,
      PRIMARY KEY (provider, model))`);
  }
  put(r: ProbeResult): void {
    this._db.prepare(`INSERT OR REPLACE INTO model_probes VALUES (?,?,?,?,?,?,?,?,?)`).run(
      r.provider, r.model, r.alias, r.proseVerified ? 1 : 0, r.toolUseVerified ? 1 : 0, r.probedAt, r.latencyMs.prose, r.latencyMs.tools, r.detail,
    );
  }
  get(provider: string, model: string): ProbeResult | undefined {
    const row = this._db.prepare('SELECT * FROM model_probes WHERE provider = ? AND model = ?').get(provider, model) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }
  all(): ProbeResult[] {
    return (this._db.prepare('SELECT * FROM model_probes ORDER BY provider, model').all() as Row[]).map(fromRow);
  }
  close(): void { this._db.close(); }
}

interface Row { provider: string; model: string; alias: string; prose_ok: number; tools_ok: number; probed_at: string; prose_ms: number; tools_ms: number; detail: string }
function fromRow(r: Row): ProbeResult {
  return {
    alias: r.alias, provider: r.provider, model: r.model, proseVerified: r.prose_ok === 1, toolUseVerified: r.tools_ok === 1,
    probedAt: r.probed_at, latencyMs: { prose: r.prose_ms, tools: r.tools_ms }, detail: r.detail,
  };
}

const HOUR_MS = 60 * 60 * 1000;

/** Owns the admin "probe now" entry point and the periodic re-probe. The periodic check ticks every
 *  min(intervalMs, 1h) — never at boot — and probes only targets whose last result is older than
 *  intervalMs (or absent), so a restart does not re-spend on models probed yesterday. */
export class ModelProber {
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _running: Promise<unknown> = Promise.resolve();
  constructor(private readonly _deps: { gateway: GatewayClient; aliases: AliasMap; store: ModelProbeStore; workRoot: string; clock: Clock; config: ModelProbeConfig }) {}

  /** All configured targets, or only the one `alias` names (dispatched under THAT alias). `null`
   *  when `alias` is not configured. Probes run one at a time, and never overlap a periodic pass.
   *  `timeoutMs` overrides the configured per-call bound for this probe only. */
  async probeNow(alias?: string, timeoutMs?: number): Promise<ProbeResult[] | null> {
    let targets: ProbeTarget[];
    if (alias !== undefined) {
      const t = this._deps.aliases[alias];
      if (!t) return null;
      targets = [{ alias, provider: t.provider, model: t.model }];
    } else {
      targets = probeTargets(this._deps.aliases);
    }
    return this._serial(() => this._probe(targets, timeoutMs));
  }

  dueTargets(): ProbeTarget[] {
    const now = this._deps.clock.now();
    return probeTargets(this._deps.aliases).filter((t) => {
      const last = this._deps.store.get(t.provider, t.model);
      return last === undefined || now - Date.parse(last.probedAt) >= this._deps.config.intervalMs;
    });
  }

  start(): void {
    if (!this._deps.config.enabled || this._timer) return;
    this._timer = setInterval(() => {
      void this._serial(() => this._probe(this.dueTargets())).catch((err) => console.error('[model-probe] periodic probe failed:', err));
    }, Math.min(this._deps.config.intervalMs, HOUR_MS));
    this._timer.unref?.();
  }

  stop(): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = undefined;
  }

  private _serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this._running.catch(() => undefined).then(fn);
    this._running = next;
    return next;
  }

  private async _probe(targets: ProbeTarget[], timeoutMs = this._deps.config.timeoutMs): Promise<ProbeResult[]> {
    const out: ProbeResult[] = [];
    for (const t of targets) {
      const r = await runProbe(this._deps.gateway, t, { workRoot: this._deps.workRoot, timeoutMs, clock: this._deps.clock });
      this._deps.store.put(r);
      out.push(r);
    }
    return out;
  }
}

export interface ModelToolWarning {
  code: 'MODEL_TOOL_USE_UNVERIFIED';
  label: string;
  line: number;
  model: string;
  message: string;
}

/** Issue #73 (d): one non-fatal warning per agent label that holds tools but resolves to a model
 *  whose latest probe saw no tool use. `allowedTools: []` is the only "no tools" spelling — an
 *  absent list gets the deployment's default tool set, which is never empty. An unprobed model or
 *  an unresolvable alias warns nothing (no evidence either way). */
export function toolProbeWarnings(input: {
  calls: AgentCallScan['calls'];
  modelFor: (label: string) => string;
  resolve: (alias: string) => { provider: string; model: string } | undefined;
  lookup: (provider: string, model: string) => ProbeResult | undefined;
}): ModelToolWarning[] {
  const out: ModelToolWarning[] = [];
  const done = new Set<string>();
  for (const call of input.calls) {
    if (Array.isArray(call.allowedTools) && call.allowedTools.length === 0) continue;
    if (done.has(call.label)) continue;
    const alias = input.modelFor(call.label);
    const target = input.resolve(alias);
    const probe = target ? input.lookup(target.provider, target.model) : undefined;
    if (!probe || probe.toolUseVerified) continue;
    done.add(call.label);
    out.push({
      code: 'MODEL_TOOL_USE_UNVERIFIED',
      label: call.label,
      line: call.line,
      model: alias,
      message:
        `agent('${call.label}') (line ${call.line}) has tools, but model '${alias}' (${probe.provider}/${probe.model}) did not use a tool ` +
        `in its last probe (${probe.probedAt}: ${probe.detail}). The run was started anyway; expect a prose answer where a tool call was needed, ` +
        'or pick a model whose models_list row shows toolUseVerified: true.',
    });
  }
  return out;
}
