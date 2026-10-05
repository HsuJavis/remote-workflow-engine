// Issue #73: probe-backed model capability. `models_list`'s `toolUseDeclared`/`effortDeclared` are
// what a catalog DECLARES and `stability` is a local rule (model-catalog.ts `classifyStability`) —
// nothing ever observed a configured model answer, or actually use a tool. This module does, cheaply:
// per configured (provider, model) pair — never the ~100 catalog rows — ONE prose call and ONE call
// holding only Read that must read a file whose content the model cannot guess. Both go through the
// deployment's own `GatewayClient.invoke()` (the same object `AgentExecutor` dispatches every agent()
// call through), so the probe measures what a run would get, not a parallel client's opinion.
// issue #93 item 4: the tool leg used to hold `allowedTools:['Bash']` and ask the model to
// `cat <nonce file>` — a real Bash tool_use plus the OS-level confinement question this file has
// nothing to do with. `Read` measures the SAME thing (a real tool_use whose result the model could
// not have guessed) without needing a shell at all, so this leg now asks the model to use the
// `Read` tool on the nonce file's ABSOLUTE path (inside the probe's own throwaway workspace, which
// the SDK's own file-tool path-guard — `claude-agent-sdk-client.ts`'s `toolUsePreCheck` — already
// allows: any path, relative or absolute, that resolves inside the call's `workspace` root).
//
// Cost bound: `AgentOpts` has no output-token knob, so "capped" is a one-line prompt asking for a
// one-line answer plus the per-call `timeoutMs`; the gateway's configured `retries` still apply to a
// failing call (`attemptsFor`), exactly as they would to an agent's.
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GatewayClient, GatewayResult } from '../gateway/client.js';
import { parseModelRef } from '../providers.js';
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

export interface ProbeTarget { provider: string; model: string }

/** issue #138: which wire actually ran a probe. `'claude-agent-sdk'`/`'direct-fetch'`/`'pi'` are the
 *  precise values `runProbe` reads straight off the probed `GatewayResult.transport` (the SAME three
 *  literals `GatewayClient`/`AgentRecord`/`HarnessDescriptor` already use elsewhere) — never a guess
 *  from deployment config. `'sdk'` is reserved for a row migrated from before this column existed:
 *  every such row necessarily predates the pi harness's existence, so "not pi" is a known fact, but
 *  the finer claude-agent-sdk-vs-direct-fetch split is unrecoverable (documented default, see
 *  `ModelProbeStore`'s own migration) — it is FILTERED exactly like a precise sdk-family recording.
 *  `'unknown'` is different in kind, not just in precision: it is what a FRESH probe gets when the
 *  gateway it actually ran through reported no `transport` at all on its `GatewayResult` — a real,
 *  common case (`GatewayResult.transport` is optional precisely because ~30 existing call sites,
 *  including hand-rolled `config.gateway` overrides and test fakes, never set it — see that field's
 *  own doc in gateway/client.ts). Unlike `'sdk'`, this carries NO negative knowledge ("definitely not
 *  pi") — picking EITHER family to filter it against would invalidate probes that were always valid
 *  for whatever harness actually ran them, which is a regression `'unknown'` existing at all must not
 *  cause. So `probeEffectiveForHarness` treats `'unknown'` (and an entirely absent `harness`) as
 *  compatible with EVERY active harness — the same "no tracking, always honoured" behavior probes had
 *  before this issue — while `'sdk'`/`'pi'`/a precise sdk-family value carry real, filterable
 *  evidence. */
export type ProbeHarness = 'claude-agent-sdk' | 'direct-fetch' | 'pi' | 'sdk' | 'unknown';

export interface ProbeResult extends ProbeTarget {
  proseVerified: boolean;
  toolUseVerified: boolean;
  probedAt: string;
  latencyMs: { prose: number; tools: number };
  /** Short, human-readable outcome of both legs (capped at `DETAIL_CAP`). */
  detail: string;
  /** issue #138: optional so every pre-existing `ProbeResult` literal across the codebase (tests,
   *  fixtures) keeps type-checking unchanged — a REAL probe (`runProbe`) and a REAL stored row
   *  (`ModelProbeStore.get`/`all`) always set it, going forward. Absent is treated identically to
   *  `'unknown'` by `probeEffectiveForHarness` (honoured regardless of the active harness). */
  harness?: ProbeHarness;
}

const SDK_FAMILY: ReadonlySet<ProbeHarness> = new Set(['claude-agent-sdk', 'direct-fetch', 'sdk']);

/** issue #138: is a RECORDED probe's harness still good evidence for the harness this deployment is
 *  ACTIVELY running (`'sdk'`/`'pi'` — the same two-way distinction `harness-info.ts`'s
 *  `HarnessAnnounce.name` already discloses; the deployment runs exactly one `GatewayClient`
 *  implementation at a time, so this is a FIXED fact for the deployment's lifetime, never re-derived
 *  per call)? `'unknown'` (or an entirely absent `harness`) carries NO negative knowledge — it is
 *  honoured for EVERY active harness, preserving the pre-#138 "no tracking at all" behavior for a
 *  probe whose own gateway never reported a transport (see `ProbeHarness`'s own doc for why this
 *  must stay fail-open rather than fail-closed). A precise sdk-family recording
 *  (`'claude-agent-sdk'`/`'direct-fetch'`) OR the legacy `'sdk'` migration default both count as real
 *  "this is sdk, not pi" evidence and are filtered out once the active harness is `'pi'`; `'pi'`
 *  itself counts only for `'pi'`. Callers that need this (`harnessFilteredProbeLookup`, below) are
 *  the ONLY place that cares about harnesses at all; everything downstream (`enrichModelEntry`,
 *  `toolProbeWarnings`) already treats an absent probe as "never probed", so hiding a mismatched row
 *  before it reaches them is the entire fix — no downstream code needs to change. */
export function probeEffectiveForHarness(recorded: ProbeHarness | undefined, active: 'sdk' | 'pi'): boolean {
  if (recorded === undefined || recorded === 'unknown') return true;
  return active === 'pi' ? recorded === 'pi' : SDK_FAMILY.has(recorded);
}

/** issue #138: wraps a raw per-(provider,model) probe lookup (e.g. `ModelProbeStore.get`) so every
 *  consumer `server.ts` shares it with (`run-manager.ts`'s `toolProbeWarnings` for the run_start
 *  warning, `call-tool.ts`'s `models_list` enrichment, the dashboard) automatically stops honouring a
 *  probe recorded under a DIFFERENT harness than the one this deployment is actively running — the
 *  #137 scenario (an sdk-era probe still driving MODEL_TOOL_USE_UNVERIFIED after the deployment
 *  switched to pi). One wrapper, composed once at the point `server.ts` already builds its probe
 *  lookup closure, rather than re-checking harnesses at every call site. */
export function harnessFilteredProbeLookup(
  raw: (provider: string, model: string) => ProbeResult | undefined,
  active: 'sdk' | 'pi',
): (provider: string, model: string) => ProbeResult | undefined {
  return (provider, model) => {
    const row = raw(provider, model);
    if (!row) return undefined;
    return probeEffectiveForHarness(row.harness, active) ? row : undefined;
  };
}

export const DETAIL_CAP = 200;
const cap = (s: string): string => (s.length > DETAIL_CAP ? s.slice(0, DETAIL_CAP - 1) + '…' : s);

/** 2026-09-26 (alias mechanism removed, owner decision 10): one target per DISTINCT (provider,
 *  model) named by `refs` — the distinct full `<provider>/<model-id>` refs declared by registered
 *  workflow versions (release/beta and every other live version — `WorkflowCatalog`'s own
 *  `distinctModelRefs()`), no alias table to iterate. A malformed ref is silently skipped (it could
 *  only come from a pre-2026-09-26 legacy row that predates this ref-only rule; nothing to probe).
 *  review M7: `harnessProviders`, when supplied (only a `gateway:"pi"` deployment supplies it — see
 *  `ModelProber`'s own field), drops any ref whose provider it does not list — the SAME gate
 *  `checkModelRef`'s own harnessProviders check and `models_list`'s own filter apply (call-tool.ts's
 *  "owner decision 2"). This is what keeps a legacy anthropic ref (one `workflow_versions.params` row
 *  registered back when this deployment ran gateway:"sdk", before switching to "pi" — review L2's
 *  exact stale-pin scenario, one layer over) from ever being probed or returned once the deployment
 *  is pi. Omitted (the sdk gateway, every call site before this review): unchanged, every well-formed
 *  ref is kept. */
export function probeTargets(refs: readonly string[], harnessProviders?: readonly string[]): ProbeTarget[] {
  const seen = new Set<string>();
  const out: ProbeTarget[] = [];
  for (const ref of refs) {
    const parsed = parseModelRef(ref);
    if (!parsed) continue;
    if (harnessProviders !== undefined && !harnessProviders.includes(parsed.provider)) continue;
    const key = `${parsed.provider}/${parsed.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider: parsed.provider, model: parsed.model });
  }
  return out;
}

const text = (r: GatewayResult): string => (r.ok ? (typeof r.content === 'string' ? r.content : r.content == null ? '' : JSON.stringify(r.content)) : '');
const failure = (r: GatewayResult): string => (r.ok ? '' : `${r.reason}${r.detail ? ` (${r.detail})` : ''}`);

/** Pure classification of the two legs. Tools pass = a real `Read` tool_use event in the reply AND
 *  the unguessable nonce in the answer — either alone is not proof (a nonce without a tool call is a
 *  leak or a guess; a tool call without the value is a model that did not read its own output).
 *  issue #93 item 4: `Bash` → `Read` (see this module's header comment for why). */
export function classifyProbe(prose: GatewayResult, tools: GatewayResult, nonce: string): { proseVerified: boolean; toolUseVerified: boolean; detail: string } {
  const proseVerified = prose.ok && text(prose).trim().length > 0;
  const proseDetail = prose.ok ? (proseVerified ? 'ok' : 'empty reply') : failure(prose);
  let toolUseVerified = false;
  let toolsDetail: string;
  if (!tools.ok) {
    toolsDetail = failure(tools);
  } else {
    const usedRead = (tools.events ?? []).some((e) => e.kind === 'tool_call' && (e.data as { name?: unknown } | undefined)?.name === 'Read');
    const hasNonce = text(tools).includes(nonce);
    toolUseVerified = usedRead && hasNonce;
    toolsDetail = toolUseVerified ? 'ok' : !usedRead ? 'no Read tool_use in the reply' : 'Read ran but the answer lacks the nonce';
    // What it said instead is the diagnosis (e.g. a tool call written out as prose JSON).
    if (!toolUseVerified) toolsDetail += ` — replied: ${text(tools).replace(/\s+/g, ' ').trim().slice(0, 80) || '(empty)'}`;
  }
  return { proseVerified, toolUseVerified, detail: cap(`prose: ${proseDetail}; tools: ${toolsDetail}`) };
}

const NONCE_FILE = 'probe-nonce.txt';
const PROSE_PROMPT = 'Reply with the single word PONG and nothing else.';
// issue #93 item 4: takes the nonce file's ABSOLUTE path (built per-call in `runProbe`, once the
// throwaway workspace exists) — never the bare relative `NONCE_FILE` name — so the prompt itself
// names exactly the path the Read path-guard will actually allow, with nothing left for the model
// to resolve against an assumed cwd.
function toolsPrompt(absoluteNoncePath: string): string {
  return (
    `Use the Read tool to read this exact absolute file path: ${absoluteNoncePath}\n` +
    'Then reply with only the text that file contains, nothing else. Do not guess — the value is random.'
  );
}

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
  const ref = `${target.provider}/${target.model}`;
  let prose: { r: GatewayResult; ms: number };
  let tools: { r: GatewayResult; ms: number };
  try {
    prose = await timed(clock, () => gateway.invoke({
      prompt: PROSE_PROMPT, opts: { model: ref, allowedTools: [], timeoutMs }, runId, agentId: `probe-prose-${ref}`, workspace,
    }));
    const noncePath = join(workspace, NONCE_FILE);
    writeFileSync(noncePath, `${nonce}\n`);
    tools = await timed(clock, () => gateway.invoke({
      prompt: toolsPrompt(noncePath), opts: { model: ref, allowedTools: ['Read'], timeoutMs }, runId, agentId: `probe-tools-${ref}`, workspace,
    }));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
  const c = classifyProbe(prose.r, tools.r, nonce);
  // issue #138: read straight off whichever leg's own GatewayResult carried a transport (both legs
  // go through the SAME gateway/call, so they always agree when either reports one) — never guessed
  // from deployment config. Neither leg reporting one (a pre-v26 gateway, or a test fake) is recorded
  // honestly as 'unknown', not silently assigned to a specific harness.
  const harness: ProbeHarness = prose.r.transport ?? tools.r.transport ?? 'unknown';
  return { ...target, ...c, harness, probedAt: clock.isoNow(), latencyMs: { prose: prose.ms, tools: tools.ms } };
}

/** Latest probe result per (provider, model), in a sqlite table. Production puts it in the run
 *  store's own `store/index.db`, which the Bash sandbox already denies (the whole workRoot is denyRead, issue #101).
 *  2026-09-26 (alias mechanism removed): the `alias` column is gone — keyed by (provider, model)
 *  alone, which was always the real primary key. A pre-existing db from before this change is
 *  migrated by DROPPING the old table (the spec's own call: "old rows may be dropped") — probe
 *  results are a cache the periodic prober repopulates on its own schedule, never load-bearing. */
// issue #138: the documented migration default for a row written before the `harness` column
// existed — see `ProbeHarness`'s own doc for why 'sdk' (not 'unknown') is the right default: these
// rows provably predate the pi harness's existence.
const LEGACY_HARNESS_DEFAULT: ProbeHarness = 'sdk';
const KNOWN_HARNESSES: ReadonlySet<string> = new Set(['claude-agent-sdk', 'direct-fetch', 'pi', 'sdk', 'unknown']);

export class ModelProbeStore {
  private readonly _db: Database.Database;
  constructor(dbPath: string) {
    this._db = new Database(dbPath);
    const cols = (this._db.prepare("PRAGMA table_info(model_probes)").all() as Array<{ name: string }>).map((c) => c.name);
    if (cols.includes('alias')) this._db.exec('DROP TABLE model_probes');
    this._db.exec(`CREATE TABLE IF NOT EXISTS model_probes (
      provider TEXT NOT NULL, model TEXT NOT NULL,
      prose_ok INTEGER NOT NULL, tools_ok INTEGER NOT NULL, probed_at TEXT NOT NULL,
      prose_ms INTEGER NOT NULL, tools_ms INTEGER NOT NULL, detail TEXT NOT NULL,
      harness TEXT NOT NULL DEFAULT '${LEGACY_HARNESS_DEFAULT}',
      PRIMARY KEY (provider, model))`);
    // issue #138: a db that already existed before this column — an ADDITIVE migration (unlike the
    // `alias` hard-reset above): existing rows are PRESERVED, backfilled with the same documented
    // default `CREATE TABLE`'s own `DEFAULT` would have given a fresh table.
    const cols2 = (this._db.prepare("PRAGMA table_info(model_probes)").all() as Array<{ name: string }>).map((c) => c.name);
    if (!cols2.includes('harness')) {
      this._db.exec(`ALTER TABLE model_probes ADD COLUMN harness TEXT NOT NULL DEFAULT '${LEGACY_HARNESS_DEFAULT}'`);
    }
  }
  put(r: ProbeResult): void {
    this._db.prepare(`INSERT OR REPLACE INTO model_probes VALUES (?,?,?,?,?,?,?,?,?)`).run(
      r.provider, r.model, r.proseVerified ? 1 : 0, r.toolUseVerified ? 1 : 0, r.probedAt, r.latencyMs.prose, r.latencyMs.tools, r.detail,
      r.harness ?? 'unknown',
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

interface Row { provider: string; model: string; prose_ok: number; tools_ok: number; probed_at: string; prose_ms: number; tools_ms: number; detail: string; harness: string }
function fromRow(r: Row): ProbeResult {
  return {
    provider: r.provider, model: r.model, proseVerified: r.prose_ok === 1, toolUseVerified: r.tools_ok === 1,
    probedAt: r.probed_at, latencyMs: { prose: r.prose_ms, tools: r.tools_ms }, detail: r.detail,
    harness: KNOWN_HARNESSES.has(r.harness) ? (r.harness as ProbeHarness) : 'unknown',
  };
}

const HOUR_MS = 60 * 60 * 1000;

/** Owns the admin "probe now" entry point and the periodic re-probe. The periodic check ticks every
 *  min(intervalMs, 1h) — never at boot — and probes only targets whose last result is older than
 *  intervalMs (or absent), so a restart does not re-spend on models probed yesterday.
 *  2026-09-26 (alias mechanism removed, owner decision 10): `modelRefs` replaces the old static
 *  `aliases` table — a LIVE accessor (called fresh on every `probeNow()`/`dueTargets()`, never
 *  cached at construction) over the distinct full refs registered workflow versions declare, so a
 *  newly registered/re-registered workflow's models are probed without a restart. */
export class ModelProber {
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _running: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly _deps: {
      gateway: GatewayClient;
      modelRefs: () => string[];
      store: ModelProbeStore;
      workRoot: string;
      clock: Clock;
      config: ModelProbeConfig;
      /** review M7: present only for a `gateway:"pi"` deployment (the SAME `ServerConfig.harnessProviders`
       *  `checkModelRef`'s provider gate and `models_list`'s filter read) — see `probeTargets`' own
       *  doc for why this is needed even though registration already refuses a NEW anthropic ref
       *  under pi: a LEGACY row from before the deployment switched gateways can still be sitting in
       *  the catalog. Omitted (the sdk gateway): unchanged. */
      harnessProviders?: readonly string[];
    },
  ) {}

  /** All configured targets, or only the one `ref` names. `null` when `ref` does not parse as a
   *  valid full model ref, OR (review M7) when `harnessProviders` is set and `ref`'s provider is not
   *  in it — `call-tool.ts`'s `models_probe` handler is the primary door for that case (it refuses
   *  with the specific `PROVIDER_UNSUPPORTED_BY_HARNESS` code before ever reaching here); this is
   *  only the defense-in-depth backstop for a direct caller that skips that door, so folding it into
   *  the existing "malformed" `null` is enough — it is never the path a real admin tool reply reads.
   *  Probes run one at a time, and never overlap a periodic pass. `timeoutMs` overrides the
   *  configured per-call bound for this probe only. An explicit `ref` is probed even when it is not
   *  (yet) declared by any registered workflow version — a well-formed ad-hoc check is a legitimate
   *  use of `models_probe({model})`. */
  async probeNow(ref?: string, timeoutMs?: number): Promise<ProbeResult[] | null> {
    let targets: ProbeTarget[];
    if (ref !== undefined) {
      const parsed = parseModelRef(ref);
      if (!parsed) return null;
      if (this._deps.harnessProviders !== undefined && !this._deps.harnessProviders.includes(parsed.provider)) return null;
      targets = [{ provider: parsed.provider, model: parsed.model }];
    } else {
      targets = probeTargets(this._deps.modelRefs(), this._deps.harnessProviders);
    }
    return this._serial(() => this._probe(targets, timeoutMs));
  }

  dueTargets(): ProbeTarget[] {
    const now = this._deps.clock.now();
    return probeTargets(this._deps.modelRefs(), this._deps.harnessProviders).filter((t) => {
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
 *  an unparseable ref warns nothing (no evidence either way). */
export function toolProbeWarnings(input: {
  calls: AgentCallScan['calls'];
  modelFor: (label: string) => string;
  resolve: (ref: string) => { provider: string; model: string } | undefined;
  lookup: (provider: string, model: string) => ProbeResult | undefined;
}): ModelToolWarning[] {
  const out: ModelToolWarning[] = [];
  const done = new Set<string>();
  for (const call of input.calls) {
    if (Array.isArray(call.allowedTools) && call.allowedTools.length === 0) continue;
    if (done.has(call.label)) continue;
    const ref = input.modelFor(call.label);
    const target = input.resolve(ref);
    const probe = target ? input.lookup(target.provider, target.model) : undefined;
    if (!probe || probe.toolUseVerified) continue;
    done.add(call.label);
    out.push({
      code: 'MODEL_TOOL_USE_UNVERIFIED',
      label: call.label,
      line: call.line,
      model: ref,
      message:
        `agent('${call.label}') (line ${call.line}) has tools, but model '${ref}' (${probe.provider}/${probe.model}) did not use a tool ` +
        `in its last probe (${probe.probedAt}: ${probe.detail}). The run was started anyway; expect a prose answer where a tool call was needed, ` +
        'or pick a model whose models_list row shows toolUseVerified: true.',
    });
  }
  return out;
}
