// AgentExecutor (DES-007 / ARCH-004) + AgentTranscriptSink (DES-008 / TASK-010).
import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import type { AgentOpts, AgentRecord, HarnessDescriptor, HarnessWarning, TranscriptEvent, PriceBook, Caps, Tokens } from './types.js';
import { parseModelRef } from './providers.js';
import type { GatewayClient, GatewayResult } from './gateway/client.js';
import type { RunGuard } from './run-guard.js';
import { ZERO_TOKENS, priceCall } from './run-guard.js';
import type { RunStore } from './run-store.js';
import { redact } from './secret-resolver.js';
import type { SecretValueProvider } from './secret-resolver.js';
import { composePrompt, type RunParams, type EffectiveCallParams } from './params/resolve.js';
import { isEffort } from './params/contract.js';
import { codedError } from './errors.js';
import type { ErrorCode } from './errors.js';

const PROMPT_CAP = 4096;
const PROMPT_CAP_HALF = 2048;

/** DES-066 (TASK-069): the descriptor's 4KB prompt bound — first 2048 + "…[truncated]…" + last 2048
 *  (tail survives, task instructions land there).
 *
 *  v21 Gate 8 re-review (review §R2, R-G9): this used to run inside `redactHarness`, i.e. BEFORE the
 *  persist-site `redact()`. That ordering is unsafe — a secret value straddling either seam is cut in
 *  half, and `redact()` is a value-EXACT substring match, so neither fragment matches and partial
 *  credential bytes land in the persisted descriptor. The cap is a SIZE bound, not a security
 *  control, so it is now applied last, at the one persist site, after redaction (`_invokeOnce`
 *  below). Cutting a `‹secret:NAME›` marker in half is harmless; cutting a live secret is not. */
export function capPrompt(prompt: string): string {
  return prompt.length > PROMPT_CAP
    ? prompt.slice(0, PROMPT_CAP_HALF) + '…[truncated]…' + prompt.slice(prompt.length - PROMPT_CAP_HALF)
    : prompt;
}

const DETAIL_CAP_BYTES = 1024;

/** issue #141: pure per-column `Tokens` addition — the one place a schema re-ask's per-attempt
 *  usage is summed onto the running total `AgentTranscriptSink.capture` keeps on the live record
 *  (never a bare `sumTokens` scalar add, which would lose the four-column split). */
function addTokenVectors(a: Tokens, b: Tokens): Tokens {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

/** v26 (H-3 send-back repair, ARCH-111, DES-171, INV-V26-5): the SAME redact-then-cap rule as
 *  `capPrompt` above, for a provider-authored error `detail` string. Used to run inside
 *  `claude-agent-sdk-client.ts`'s `_drain`, at BUILD time — before `redact()` ever saw the string —
 *  so a secret straddling the 1024-byte seam was cut in half and `redact()`'s value-exact match
 *  then failed on both fragments. Applied here instead, AFTER each persist site's own `redact()`
 *  call (`_emit` below, the streaming `onEvent` closure in `_invokeOnce`, and `capture()`'s failed
 *  branch for `AgentRecord.detail`). */
export function capDetail(detail: string): string {
  return Buffer.byteLength(detail, 'utf8') <= DETAIL_CAP_BYTES
    ? detail
    : `${Buffer.from(detail, 'utf8').subarray(0, DETAIL_CAP_BYTES).toString('utf8')}…[truncated]`;
}

/** DES-066 (TASK-069): pure STRUCTURAL transform — strips all resolved values, keeps names only.
 *  Redacts no secret VALUES and emits no `‹secret:NAME›` markers; that is the persist site's job.
 *  - surfaceType:'none' (direct-fetch) → all arrays empty (no curated surface available).
 *  - MCP configs: name only, never URL/key/token.
 *  - prompt passes through UNCUT — see `capPrompt` (R-G9: cap after redact, never before).
 *  - `unresolvedMcp` (v22, REQ-099 / adjudication #4 N-1): referenced MCP names the dispatch site
 *    could not resolve. Carried onto `mcpUnresolved` only when non-empty, so an unaffected run's
 *    descriptor keeps exactly the keys it had before.
 *  - `modelName` (v26 integration, REQ-125, clarification 26) is the RESOLVED provider model id,
 *    and the `rwe-proxy-*` cloak — when the dispatch used one — travels separately as `proxyModel`.
 *    The caller used to pass the cloak as `modelName`, and since `markHarness` stamps this
 *    descriptor onto the live AgentRecord and `capture()`'s harness-wins merge keeps it, every
 *    LiteLLM-route record ended up with `model === proxyModel`: the terminal record named the proxy
 *    instead of the backend that served the call, which is precisely what REQ-125 forbids. */
export function redactHarness(resolved: {
  surfaceType: 'curated' | 'none';
  modelName: string;
  proxyModel?: string;
  provider?: string;
  prompt: string;
  curatedTools: string[];
  mergedMcp: Array<{ name: string; [key: string]: unknown }>;
  skills: string[];
  unresolvedMcp?: string[];
}): HarnessDescriptor {
  const provider = resolved.provider ?? '';
  const prompt = resolved.prompt;
  // Absent (never `undefined`-valued) when the dispatch put no cloak on the wire, so an
  // anthropic-direct descriptor keeps exactly the keys it had before v26.
  const proxy = resolved.proxyModel !== undefined ? { proxyModel: resolved.proxyModel } : {};
  if (resolved.surfaceType === 'none') {
    return { model: resolved.modelName, ...proxy, provider, prompt, tools: [], skills: [], mcpServers: [], surfaceType: 'none' };
  }
  return {
    model: resolved.modelName,
    ...proxy,
    provider,
    prompt,
    tools: resolved.curatedTools,
    skills: resolved.skills,
    mcpServers: resolved.mergedMcp.map((m) => m.name),
    ...(resolved.unresolvedMcp !== undefined && resolved.unresolvedMcp.length > 0 ? { mcpUnresolved: resolved.unresolvedMcp } : {}),
    surfaceType: 'curated',
  };
}

// D-V4: real JSON-schema validation (never a type-cast passthrough). One shared Ajv instance —
// schemas are per-call plain objects (JSON Schema draft-07-ish subset), not compiled/cached ahead
// of time since agent() schemas are arbitrary and one-shot.
const ajv = new Ajv({ allErrors: false, strict: false });

/** Parses a gateway result's `content` into a schema-validatable value. Tolerant of how real LLMs
 *  (esp. OpenAI models after a tool loop) actually emit JSON: a raw object string, JSON wrapped in a
 *  ```json code fence, or a JSON object embedded in surrounding prose — all yield the object. An
 *  already-object content passes through. Returns undefined only when no JSON value can be recovered
 *  (treated as a schema mismatch, not a crash). */
function parseJsonContent(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  let s = content.trim();
  const fence = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(s);
  if (fence) s = fence[1]!.trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through — try to extract the first balanced JSON object/array embedded in prose */
  }
  const start = s.search(/[{[]/);
  if (start < 0) return undefined;
  const open = s[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

export interface AgentReq {
  runId: string;
  agentId: string;
  prompt: string;
  opts: AgentOpts;
  workspace: string;
  signal: AbortSignal;
  /** v21 (ARCH-068, DES-105, TASK-101): the run-immutable admission-time parameter snapshot —
   *  REQUIRED, no default, no `?`. The tsc lever lives here (built at exactly one production site,
   *  run-manager.ts:_handleAgentRequest) rather than on the constructor, which is a loose bag
   *  constructed at ~30 test call sites that have nothing to do with where params semantically live. */
  runParams: RunParams;
  /** v24 (ARCH-103/ARCH-104, DES-154, TASK-145): this label's declared skill/mcp asset names + the
   *  asset store's two scope roots, threaded to the gateway for selective per-agent materialization
   *  (DES-154) — filled from that label's registered `AgentParamSpec.skills/mcp` and the run's
   *  workflow name. Optional: a caller with no per-label declared-asset wiring yet (or a label with
   *  nothing declared) omits it, which materializes nothing — the same outcome as an empty
   *  `declared` set (DES-154's boundary), never a crash. */
  assets?: { roots: { workflow: string; global: string }; declared: { skills: string[]; mcp: string[] }; workflow: string };
}

export type AgentOutcome =
  | { kind: 'text';   value: string }
  | { kind: 'object'; value: object }
  // D-F13: `aborted` distinguishes a null caused by workflow_suspend/workflow_stop cutting the call
  // short (must re-run live on resume — see JournalEntry.aborted) from a genuine terminal gateway
  // failure or exhausted schema-retry budget (a legitimate, replayable null). Absent/false for both
  // of the latter — unchanged default behavior.
  | { kind: 'null'; aborted?: boolean };

export interface AgentSpawner {
  run(req: AgentReq): Promise<AgentOutcome>;
}

/** A gateway that never reaches a provider — the safe default when none is injected (DES-007 null-on-terminal). */
const NULL_GATEWAY: GatewayClient = {
  async invoke(): Promise<GatewayResult> {
    return { ok: false, provider: 'unknown', reason: 'terminal' };
  },
};

/**
 * AgentTranscriptSink (DES-008): the single capture path from a gateway call to
 * `agent-<id>.jsonl` (via RunStore.appendTranscript) and token accounting (via RunGuard.addTokens).
 * One sink feeds workflow_agent_log, the dashboard, and the resume cache — never three separate paths.
 */
export class AgentTranscriptSink {
  private readonly _records = new Map<string, AgentRecord>();
  /** issue #141: THIS attempt's own live-streamed usage, kept SEPARATE from the record's `tokens`
   *  field (which, since this fix, is the running SUM of every already-resolved earlier schema
   *  re-ask attempt). Before this split, `markUsage` overwrote the record's `tokens` directly — on
   *  an abort mid-way through a re-ask, that clobbered the prior attempt's already-committed total
   *  with just the in-flight attempt's own (smaller) figure, so `_finalizeAborted` under-reported. A
   *  delta kept here lets `capture()`'s existing prior-merge (`prev.tokens` + this delta) do the
   *  combining exactly once, the same way every other branch does. Cleared the moment this agentId's
   *  current attempt resolves (`capture()`'s own first line) — there is no "live" figure for an
   *  attempt that is no longer in flight. */
  private readonly _liveAttemptUsage = new Map<string, Tokens>();

  constructor(
    private readonly _guard?: RunGuard,
    private readonly _store?: RunStore,
    private readonly _secretValueProvider?: SecretValueProvider,
    /** v26 (DES-180, ARCH-118, TASK-180): the run's admission-time price/capability pin
     *  (`RunManager.start()`, TASK-178) — looked up ONCE at the capture site by `provider/model`.
     *  Absent (not wired by every caller yet — see this task's `needs_clarification`) means every
     *  call prices `null` through `priceCall`, which is DES-180's own documented "we don't know"
     *  semantics (`costUSD: 0, unpriced: true`), not a stub. */
    private readonly _priceBook?: PriceBook,
  ) {}

  private async _emit(runId: string, agentId: string, ev: TranscriptEvent): Promise<void> {
    if (this._store) {
      // DES-088 (TASK-082): redact on persist write, not in-memory — for EVERY event kind.
      // v21 Gate 8 re-review (review §R2, R-G10): the former `ev.kind !== 'harness'` carve-out is
      // gone. It could not double-redact anything (a harness descriptor persists through
      // `onHarness` in _invokeOnce below, which runs its own single `redact()`, and no gateway
      // routes one through this sink), so it only skipped redaction on a path that should never
      // carry an unredacted secret. Redacting unconditionally keeps DES-088 invariant (a) — one
      // redaction pass per persisted event — and fails safe if a future gateway ever emits one here.
      const stored = this._secretValueProvider
        ? redact(ev, this._secretValueProvider.entries()) as TranscriptEvent
        : ev;
      // v26 (H-3 repair, INV-V26-5): cap a `detail` field AFTER redact — see `capDetail`'s own doc
      // comment (the R-G9 rule `capPrompt` already follows). Covers both the failed-branch `usage`
      // event (`capture()` below) and an SDK `kind:'message'` error event (claude-agent-sdk-client.ts's
      // `_drain`, non-streaming path) — the only two event shapes that ever carry one.
      const data = stored.data as { detail?: unknown } | undefined;
      if (typeof data?.detail === 'string') stored.data = { ...data, detail: capDetail(data.detail) };
      await this._store.appendTranscript(runId, agentId, stored);
    }
  }

  /** D-F12: records an agentId as queued the moment RunGuard allocates it — BEFORE it has acquired
   *  a concurrency slot or reached the gateway — so workflow_status can observe it immediately
   *  rather than only once capture() resolves it (round-5 VAL-002/VAL-007's `agents:[]` gap).
   *  v26 (DES-175, ARCH-114, TASK-186): an OPTIONS OBJECT, not a positional reorder of the old
   *  `(agentId, label?, phase?, frame?)` — silently swapping two optional positionals is the trap
   *  DES-175 calls out by name. `opts.phase` is the receipt-time `{title,index}` snapshot
   *  (SandboxHostConfig.currentPhase, threaded through RunManager._handleAgentRequest) — never the
   *  script's own (unrelated, unused) `AgentOpts.phase` per-call option. */
  markQueued(agentId: string, opts?: { label?: string; frame?: string; phase?: { title: string; index: number } }): void {
    this._records.set(agentId, {
      agentId, label: opts?.label, phase: opts?.phase?.title, phaseIndex: opts?.phase?.index, frame: opts?.frame,
      // v26 (DES-180, DES-188): a queued call never dispatched — the SAME three zeros
      // `deriveAgentRecords`'s harness-only/refused branches derive, so a restart-reconstructed
      // record is byte-identical to this live one (DES-188's own boundary).
      // [v31, REQ-186] no `tokens`: a queued call has not been measured. Mirrors `run-store.ts`'s
      // harness-only branch, which changed in the same commit.
      // [v32, REQ-189] and no `costUSD`/`unpriced`, for the same reason — v31 changed one field of
      // the three and left the other two asserting a measured $0.00 on an undispatched call.
      state: 'queued', provider: '', model: '',
    });
  }

  /** D-F12: flips a queued agentId to running once it has acquired its concurrency slot and is
   *  genuinely dispatched to the gateway — still observable in workflow_status while in flight. */
  markRunning(agentId: string, startedAt?: string): void {
    const existing = this._records.get(agentId);
    // [v32, REQ-189] the fallback seed carries no cost either — see markQueued above.
    this._records.set(agentId, { ...(existing ?? { agentId, provider: '', model: '' }), agentId, state: 'running', startedAt: startedAt ?? existing?.startedAt });
  }

  /** v25 (DES-167, REQ-120, issue #61): records a call the ENGINE refused to dispatch — terminal,
   *  no gateway, no tokens, but VISIBLE in `run_status.agents` with a named reason. Until v25 a
   *  budget refusal produced no record at all: `parallel()` swallowed the throw to `null` and the
   *  only durable trace anywhere was a gap in the journal's callSeq. Merges onto the markQueued
   *  record so label/phase/frame survive.
   *  v26 (DES-188, TASK-188, ADR-046, REQ-120): ALSO emits a `kind:'refused'` transcript event
   *  carrying the same reasonCode/label/phase/phaseIndex/frame — a refused call never has a harness
   *  event, so this is the ONLY durable trace a fresh store (no snapshot, e.g. a crash before the
   *  terminal snapshot save) can reconstruct after a restart (`deriveAgentRecords`'s branch (3)). */
  async markRefused(runId: string, agentId: string, reasonCode: ErrorCode, endedAt?: string): Promise<void> {
    const existing = this._records.get(agentId);
    const merged: AgentRecord = {
      ...(existing ?? { agentId, provider: '', model: '', tokens: ZERO_TOKENS, costUSD: 0, unpriced: false }),
      agentId, state: 'refused', reasonCode, endedAt, tokens: ZERO_TOKENS, costUSD: 0, unpriced: false,
    };
    this._records.set(agentId, merged);
    await this._emit(runId, agentId, {
      ts: endedAt ?? '', kind: 'refused',
      data: {
        reasonCode,
        ...(merged.label !== undefined ? { label: merged.label } : {}),
        ...(merged.frame !== undefined ? { frame: merged.frame } : {}),
        ...(merged.phase !== undefined ? { phase: merged.phase } : {}),
        ...(merged.phaseIndex !== undefined ? { phaseIndex: merged.phaseIndex } : {}),
      },
    });
  }

  /** #20: the moment the gateway builds the session (onHarness, BEFORE the first token), stamp WHICH
   *  model/provider a still-running agent is waiting on — so workflow_status shows the backend instead
   *  of a blank model:""/provider:"" that makes a hung/slow backend indistinguishable from progress.
   *  Merge — never clobber state/startedAt/frame from markRunning. No-op if no record exists yet. */
  markHarness(agentId: string, model: string, provider: string, warnings?: HarnessWarning[]): void {
    const existing = this._records.get(agentId);
    if (!existing) return;
    // Issue #106: the record's `warnings` are the LATEST harness descriptor's, exactly what
    // `deriveAgentRecords` re-reads from the latest harness event — absent clears them.
    const { warnings: _prev, ...rest } = existing;
    this._records.set(agentId, { ...rest, model, provider, ...(warnings !== undefined && warnings.length > 0 ? { warnings } : {}) });
  }

  /** issue #20: stamp lastActivityAt each time the gateway streams a live transcript event, so
   *  workflow_status shows a progressing agent's clock advancing while a hung one's stays put. Merge —
   *  never clobber state/model/provider. No-op if no record exists yet (never fabricates one). */
  markActivity(agentId: string, ts: string): void {
    const existing = this._records.get(agentId);
    if (existing) this._records.set(agentId, { ...existing, lastActivityAt: ts });
  }

  /** issue #127: stamps the LIVE cumulative usage the gateway's own `onUsage` callback reports as a
   *  call streams, so an abort (run_suspend/run_stop) that abandons the gateway's own returned
   *  Promise still has a figure to finalize with — `_finalizeAborted` (AgentExecutor) reads this
   *  record's `tokens` the moment it gives up on that Promise. Merge — never clobber state/model/
   *  provider, mirroring `markActivity`. No-op if no record exists yet (never fabricates one), OR the
   *  record is already TERMINAL (`endedAt` set — `capture()` is the only writer of that field).
   *  Measured on a real engine (issue #127 verification): the SDK CLI subprocess keeps streaming a
   *  handful of messages for a brief window AFTER `_finalizeAborted`/`capture()` has already priced
   *  and charged a figure via `addUsage` — without this guard, a late `onUsage` call silently
   *  overwrote `tokens` on the now-`failed` record with a LARGER figure than the one `costUSD` was
   *  actually computed from (and than `RunGuard`/the durable usage event/the terminal snapshot all
   *  recorded), making the live record internally inconsistent with every other surface for no
   *  reason a caller could see. The figure `capture()` priced and charged is the one every surface
   *  reports — frozen, not "best effort so far". Always `partial:true` when it DOES apply: a figure
   *  that reaches here came from an in-flight call that has not (yet) reported a finalized total.
   *
   *  issue #141: writes to the SEPARATE `_liveAttemptUsage` side channel, not `_records` directly —
   *  see that field's own doc for why (a schema re-ask's committed prior-attempt total lives in
   *  `_records`'s `tokens`, and this must never clobber it). `getLiveAttemptUsage` is the one reader
   *  (`_finalizeAborted`). */
  markUsage(agentId: string, tokens: Tokens): void {
    const existing = this._records.get(agentId);
    if (existing && existing.endedAt === undefined) this._liveAttemptUsage.set(agentId, tokens);
  }

  /** issue #141: the current (possibly still in-flight) attempt's own live-streamed usage — see
   *  `_liveAttemptUsage`'s own doc. `undefined` when nothing has streamed yet for this agentId's
   *  current attempt (or it was never wired, e.g. LiteLLMGatewayClient). */
  getLiveAttemptUsage(agentId: string): Tokens | undefined {
    return this._liveAttemptUsage.get(agentId);
  }

  /** Records the outcome of one agent() call: captures the usage event and feeds RunGuard.addTokens.
   *
   *  issue #141 (schema re-ask undercounting): a `schema`-bearing `agent()` call MAY invoke the
   *  gateway several times before it settles — once for every reply that parses but fails
   *  `ajv.compile(schema)` (`_runTracked`'s bounded re-ask loop, D-V4). Before this fix EVERY attempt
   *  called this method as if it were the last: each call REPLACED the live record's tokens/costUSD
   *  instead of adding to it, so only the FINAL attempt's figures survived — the run's displayed
   *  costUSD/tokens, and a resumed run's re-armed budget (both of which rehydrate from the SAME
   *  folded `AgentRecord`s — `foldUsageFromRecords`/`foldUsage`), both silently undercounted every
   *  earlier attempt (the issue's repro: 56% of the agent's true cost missing). The record also
   *  flashed `state:'done'` with an `endedAt` after the FIRST (still-retrying) attempt, then got
   *  rewritten — an observer polling `run_status` saw a "done" call come back to life.
   *
   *  Fix: `opts.final` (default `true` — every non-schema call and every call's LAST attempt is
   *  unaffected) is `false` on a schema re-ask attempt that is going to retry again. `RunGuard.
   *  addUsage` is still called ONCE PER ATTEMPT with THAT attempt's own delta (unchanged — the guard
   *  already summed correctly across attempts; the bug was only in what the per-agent RECORD
   *  remembered). `prev` (already read below for frame/startedAt/phase) doubles as the running total:
   *  an intermediate (`final:false`) call merges this attempt's own usage onto `prev`'s and writes
   *  BACK a `state:'running'` record with no `endedAt` and no `kind:'usage'` transcript event — a
   *  still-retrying call is never observable as done, and emitting no event keeps exactly ONE usage
   *  event per agentId (the final one, carrying the FULL sum), so `deriveAgentRecords` (which already
   *  reads only the LATEST usage event per agentId) reconstructs the identical total after a restart
   *  with no double counting, and "record ≡ usage event" (DES-177) keeps holding. Only the attempt
   *  that actually ends the loop (conforms, the retry budget is exhausted, or the gateway call itself
   *  failed) is `final`: it folds in `prev`'s running total, writes the terminal record, and emits the
   *  one cumulative usage event. */
  async capture(
    runId: string,
    req: { agentId: string; label?: string },
    result: GatewayResult,
    ts: string,
    callOpts: { final?: boolean } = {},
  ): Promise<void> {
    const final = callOpts.final !== false;
    const prev = this._records.get(req.agentId); // v8 Slice 2/2b: carry frame (markQueued) + startedAt (markRunning)
    const frame = prev?.frame, startedAt = prev?.startedAt;
    // v26 (DES-175, ARCH-114, TASK-186): phase/phaseIndex are stamped ONCE, at markQueued (the
    // receipt-time snapshot) — carried forward here exactly like frame/startedAt, never re-derived
    // from this call's own opts (a script's `agent()` never sets these; the workflow's phase() lane
    // is the only writer). Losing them at the done/failed transition would erase the phase from
    // every agent that finishes before workflow_status is read — nearly all of them.
    const phase = prev?.phase, phaseIndex = prev?.phaseIndex;
    // #20: carry lastActivityAt into the terminal record too — its absence on a failed/timed-out agent
    // (never produced an event) vs its presence (got partway) is diagnostic post-mortem.
    const lastActivityAt = prev?.lastActivityAt;
    // Issue #106: harness warnings (markHarness) survive the terminal transition, like lastActivityAt.
    const warnings = prev?.warnings !== undefined ? { warnings: prev.warnings } : {};
    // issue #141: this agentId's running total from any EARLIER (non-final) schema re-ask attempt —
    // ZERO/false/[] on a fresh record (attempt 0), exactly like every other "not yet measured"
    // default in this file (`markQueued`'s own doc).
    const priorTokens: Tokens = prev?.tokens
      ? { input: prev.tokens.input, output: prev.tokens.output, cacheRead: prev.tokens.cacheRead ?? 0, cacheWrite: prev.tokens.cacheWrite ?? 0 }
      : ZERO_TOKENS;
    const priorCostUSD = prev?.costUSD ?? 0;
    const priorUnpriced = prev?.unpriced ?? false;
    const priorPartial = prev?.partial === true;
    const priorUnmapped = prev?.unmapped ?? [];
    // issue #141: this agentId's current attempt resolved (whichever way) — no "live" partial figure
    // survives it; `_finalizeAborted` only ever reads this for an attempt still in flight.
    this._liveAttemptUsage.delete(req.agentId);
    if (result.ok) {
      // v26 (DES-180): GatewayResult.tokens keeps cacheRead/cacheWrite OPTIONAL (back-compat with
      // ~30 existing test-fake literals — see client.ts's own doc) — normalized to the strict
      // four-column `Tokens` shape here, the one place `sumTokens`/`priceCall` are ever called from
      // a gateway result.
      const tokens = { input: result.tokens.input, output: result.tokens.output, cacheRead: result.tokens.cacheRead ?? 0, cacheWrite: result.tokens.cacheWrite ?? 0 };
      // v26 (DES-177, ARCH-115, TASK-177, REQ-125): the harness stamp WINS where one exists — a
      // done result claiming its own transport-hardcoded provider/model (a pre-v26 gateway, or a
      // gateway that genuinely never fired onHarness) must not clobber what markHarness already
      // recorded. `prev?.provider`/`prev?.model` are '' until the first markHarness/markQueued, so
      // `||` falls through to the gateway's own value exactly on a pre-harness terminal (empty prev).
      const provider = prev?.provider || result.provider;
      const model = prev?.model || result.model;
      // v26 (DES-180, ARCH-118, TASK-180): the ONE capture site — `priced === null` ("we don't know
      // this model's price") collapses to `{costUSD: 0, unpriced: true}` here; it never reaches the
      // persisted record or the usage event as a nullable number. Keyed identically to
      // `RunManager.start()`'s own pin (`run-manager.ts:571`): `${resolved.provider}/${resolved.model}`
      // against this SAME merged (harness-resolved, never transport-hardcoded) provider/model.
      const priced = priceCall(tokens, this._priceBook?.pinned[`${provider}/${model}`]?.price ?? null);
      const costUSD = priced ?? 0;
      const unpriced = priced === null;
      // v26 integration (DES-181, TASK-181, REQ-127, clarifications 31/35): the ONE production
      // caller of `addUsage`. It has to sit HERE, below the pricing collapse, not up beside the
      // token normalization — the guard needs `costUSD`/`unpriced`, which do not exist until
      // `priceCall` has run. Before this line the guard only ever saw `addTokens(input+output)`,
      // so the USD arm of `assertBudget()` was dead code and the two cache columns never counted
      // against a token budget either. `addUsage` folds its token total through `addTokens`, so
      // the per-call token delta stays observable exactly where it always was.
      // issue #141: charged per ATTEMPT (this attempt's own delta), final or not — unchanged from
      // before this fix (the guard already summed correctly across attempts; only the RECORD below
      // used to forget everything but the last one).
      this._guard?.addUsage(tokens, costUSD, unpriced, result.unmapped);
      const totalTokens = addTokenVectors(priorTokens, tokens);
      const totalCostUSD = priorCostUSD + costUSD;
      const totalUnpriced = priorUnpriced || unpriced;
      // issue #141: the sum of two EXACT per-attempt totals is exact — `partial` propagates forward
      // only if some attempt (this one or an earlier one) was itself a `partial` figure (the gateway's
      // own OWN internal retry-merge, issue #127), never synthesized just because attempts were summed.
      const totalPartial = priorPartial || result.partial === true;
      // issue #141: unlike `partial`/`unpriced` (booleans, OR'd — true if ANY attempt qualifies),
      // `unmapped` is a list of OCCURRENCES, not a fact about the call — `foldUsage`/
      // `foldUsageFromRecords` both count one tick per array entry, so a subtype seen on TWO attempts
      // is deliberately counted TWICE here (it really did occur twice — once per attempt that saw
      // it), never deduplicated.
      const totalUnmapped = [...priorUnmapped, ...(result.unmapped ?? [])];
      if (!final) {
        // issue #141: a schema re-ask attempt that is going to retry again — accumulate onto the SAME
        // record and stay `running`: no `endedAt`, no usage transcript event (the attempt that
        // actually ends the loop emits the one cumulative event, below). A still-retrying call must
        // never be observable as `done`.
        //
        // `unpriced: totalUnpriced` IS written here even though v31/v32's rule for every OTHER
        // running-record field is "not yet measured, so absent, never a provisional value" — the
        // deliberate exception. Omitting it would lose whether an EARLIER attempt was unpriced (this
        // method reads it back as `priorUnpriced` the next time `capture()` runs for this agentId —
        // the FINAL attempt's own merge, a few lines above, depends on it to report the true combined
        // `unpriced` even when IT, individually, priced fine). The cost: `foldUsageFromRecords`
        // (no state filter) ticks `unpricedCalls` for a still-running call the instant one of its
        // attempts was unpriced, slightly ahead of settlement — the same "live total, not final" the
        // rest of this fix intentionally exposes for `tokens`/`costUSD`, not a new inconsistency.
        this._records.set(req.agentId, {
          agentId: req.agentId, label: req.label, phase, phaseIndex, frame, startedAt, lastActivityAt,
          state: 'running', provider, model, tokens: totalTokens, costUSD: totalCostUSD, unpriced: totalUnpriced, ...warnings,
          ...(totalPartial ? { partial: true as const } : {}),
          ...(result.transport !== undefined ? { transport: result.transport } : {}),
          ...(result.proxyModel !== undefined ? { proxyModel: result.proxyModel } : {}),
          ...(totalUnmapped.length > 0 ? { unmapped: totalUnmapped } : {}),
        });
        // D-G8-2: forward this attempt's own message/tool_call/tool_result stream too — a
        // nonconforming reply must stay visible in run_agent_log, not just the final attempt's.
        for (const ev of result.events ?? []) {
          await this._emit(runId, req.agentId, ev);
        }
        return;
      }
      this._records.set(req.agentId, {
        agentId: req.agentId, label: req.label, phase, phaseIndex, frame, startedAt, lastActivityAt, endedAt: ts,
        state: 'done', provider, model, tokens: totalTokens, costUSD: totalCostUSD, unpriced: totalUnpriced, ...warnings,
        ...(result.transport !== undefined ? { transport: result.transport } : {}),
        ...(result.proxyModel !== undefined ? { proxyModel: result.proxyModel } : {}),
        ...(totalUnmapped.length > 0 ? { unmapped: totalUnmapped } : {}),
        // issue #127/#141: an ok:true result CAN still be `partial` — either `invoke()`'s OWN retry
        // loop summed a prior failed attempt's lower-bound tokens into this one (issue #127), or an
        // EARLIER schema re-ask attempt on this SAME agent() call was itself partial (issue #141).
        // The success itself is never in question; only the combined FIGURE is an estimate for the
        // part some attempt contributed.
        ...(totalPartial ? { partial: true as const } : {}),
      });
      // D-G8-2: forward the real message/tool_call/tool_result stream the gateway captured (when
      // present — only ClaudeAgentSdkGatewayClient produces these today) BEFORE the terminal usage
      // summary below, preserving turn order (reasoning -> tool_use -> tool_result -> usage).
      for (const ev of result.events ?? []) {
        await this._emit(runId, req.agentId, ev);
      }
      // `record ≡ usage-event` (DES-177's own test): the SAME merged provider/model, never
      // `result.provider`/`result.model` directly — otherwise the LiteLLM route's usage event would
      // disagree with the record it sits beside. v26 (DES-180): costUSD/unpriced ride the SAME event
      // as tokens — "persisted on the usage event and on AgentRecord", one collapse, two writers.
      // v26 integration (DES-183, clarification 38): `unmapped` rides the usage event too. Without
      // it `foldUsage`'s `unmappedMessages` is structurally always `{}` — the gateway counts the
      // subtypes it could not map and then the count died at this boundary, so REQ-127's "tell me
      // what the provider said that we did not understand" was unanswerable. Omitted when the
      // gateway reported none, so a pre-v26 event and an empty-array event stay the same shape.
      // issue #141: `tokens`/`costUSD`/`unpriced`/`unmapped` are the TOTALS across every attempt —
      // this is the ONE usage event this agentId will ever emit, so it must carry the full sum for
      // `foldUsage`/`deriveAgentRecords` to reproduce the live total after a restart.
      await this._emit(runId, req.agentId, {
        ts, kind: 'usage',
        data: {
          tokens: totalTokens, costUSD: totalCostUSD, unpriced: totalUnpriced, provider, model,
          // issue #127/#141: mirrors the record's own `partial` spread above — same rule, same source.
          ...(totalPartial ? { partial: true as const } : {}),
          // v26 integration (DES-177/DES-188, REQ-125): `transport`/`proxyModel` ride the event too.
          // They were written onto the LIVE record and onto the terminal snapshot (which is folded
          // from records) but NOT onto the durable event, so a snapshot-less read after a restart
          // rebuilt the record WITHOUT them — REQ-125's "which wire, which backend" answer survived
          // exactly as long as the process did, and DES-188's derived≡snapshot lock was false on
          // every real-gateway run (the fake gateways in the v26 fixtures set neither field, which
          // is why nothing caught it).
          ...(result.transport !== undefined ? { transport: result.transport } : {}),
          ...(result.proxyModel !== undefined ? { proxyModel: result.proxyModel } : {}),
          ...(totalUnmapped.length > 0 ? { unmapped: totalUnmapped } : {}),
        },
      });
    } else {
      // v26 (H-3 send-back repair, ARCH-111, INV-V26-5): `AgentRecord.detail` — redact FIRST (this
      // sink's own `SecretValueProvider`), THEN cap (`capDetail`, 1024 B) — so `run_status.agents[]`
      // answers "why did this fail" from the record alone (ARCH-115), not only from the per-agent
      // transcript. The usage event below gets the SAME cap independently, applied to the RAW
      // `result.detail` at `_emit`'s own persist site (never this already-capped value — capping
      // twice would double-truncate and double the "…[truncated]" marker).
      const redactedDetail = result.detail === undefined
        ? undefined
        : this._secretValueProvider
          ? (redact({ detail: result.detail }, this._secretValueProvider.entries()) as { detail: string }).detail
          : result.detail;
      const detail = redactedDetail === undefined ? undefined : capDetail(redactedDetail);
      // v26 (DES-177): same harness-wins rule as the done branch, for the pre-harness terminal case
      // — `prev?.provider` is '' until the first markHarness/markQueued, so `||` falls through to
      // the gateway's own value exactly on a pre-harness terminal (empty prev).
      // dash-auth-spec.md section C (2026-09-30) repair: this MERGED value, not `result.provider`
      // raw, must also be what the usage event below persists — before this fix the record (here)
      // and the durable event (below) disagreed on exactly this column for `_finalizeAborted`'s
      // `provider: ''` result, so a restart-reconstructed record (`deriveAgentRecords`, which reads
      // the EVENT, never this live `_records` map) lost the provider a still-running process had
      // right. "record ≡ usage-event" is the done branch's own rule (DES-177) — this branch had
      // silently violated it for one column.
      const provider = prev?.provider || result.provider;
      // issue #127: a failed/aborted/timed-out call MAY still carry real usage — the gateway's own
      // `_drain` now reports the deduped per-turn sum (or, when a terminal `result` message arrived,
      // its own finalized total) instead of nothing. Priced through the SAME `priceCall` the `done`
      // branch uses, so budget enforcement (`RunGuard.addUsage`) sees it too — before this fix the
      // failed branch never called `addUsage` at all, so every token spent before a `run_suspend`/
      // `run_stop`/timeout/terminal failure was invisible to both the cost total and the budget.
      // `result.tokens` absent (the pre-#127 common case: refused before dispatch, or a gateway that
      // predates this fix) keeps the EXACT prior shape — ZERO_TOKENS, costUSD:0, unpriced:false, no
      // `addUsage` call, no `partial` field — UNLESS an EARLIER schema re-ask attempt on this SAME
      // agentId already accumulated something (issue #141: `hasPrior`) before THIS attempt ended the
      // loop with a genuine gateway failure; that prior total must not be lost just because the
      // attempt that happened to end the loop reported nothing of its own.
      const hasPrior = prev?.tokens !== undefined;
      // issue #141 repair (v0374 pre-push regression, failed-call-unmapped-meta /
      // unmapped-column-folds): `unmapped` is NOT usage — a terminally-failed call can carry
      // `result.unmapped` subtype names with NO `tokens` at all (M-2/ADR-046's whole point: the
      // engine still counts what the provider said that it could not map, even when nothing was
      // spent). Gating it behind the SAME `failUsage` object that only exists when there is a
      // tokens figure (this attempt's or a prior re-ask attempt's) silently dropped it on exactly
      // that no-tokens/no-prior case — computed unconditionally here instead, merged with any
      // earlier re-ask attempt's own `unmapped` the same way `tokens`/`costUSD` are, never gated on
      // whether `failUsage` itself ends up defined.
      const totalUnmappedFail = [...priorUnmapped, ...(result.unmapped ?? [])];
      const failUsage = result.tokens === undefined && !hasPrior
        ? undefined
        : (() => {
            // issue #141: only THIS attempt's own tokens (if any) are priced/charged here — the prior
            // total was already priced and charged at its own (non-final) capture() call; merging it
            // again would double-count both the record and the guard.
            const thisTokens = result.tokens === undefined
              ? undefined
              : { input: result.tokens.input, output: result.tokens.output, cacheRead: result.tokens.cacheRead ?? 0, cacheWrite: result.tokens.cacheWrite ?? 0 };
            let thisCostUSD = 0;
            let thisUnpriced = false;
            if (thisTokens !== undefined) {
              const priced = priceCall(thisTokens, this._priceBook?.pinned[`${provider}/${prev?.model ?? ''}`]?.price ?? null);
              thisCostUSD = priced ?? 0;
              thisUnpriced = priced === null;
              this._guard?.addUsage(thisTokens, thisCostUSD, thisUnpriced, result.unmapped);
            }
            const tokens = addTokenVectors(priorTokens, thisTokens ?? ZERO_TOKENS);
            const costUSD = priorCostUSD + thisCostUSD;
            const unpriced = priorUnpriced || thisUnpriced;
            // issue #141: the merge of two EXACT totals is exact — never synthesize `partial` just
            // because a re-ask happened; only THIS attempt's own `result.partial` (issue #127's
            // lower-bound-on-failure figure) or an earlier attempt's already-partial total propagate.
            const partial = priorPartial || result.partial === true ? (true as const) : undefined;
            return { tokens, costUSD, unpriced, partial };
          })();
      this._records.set(req.agentId, {
        agentId: req.agentId, label: req.label, phase, phaseIndex, frame, startedAt, lastActivityAt, endedAt: ts,
        // #20: preserve the model markHarness stamped on the live record — a failed/timed-out call
        // carries no model of its own, and post-mortem (after the operator stops the run) is exactly
        // when "which model failed" matters most. Don't wipe it back to ''.
        // v26 (DES-180 boundary): "a failed call carries no usage and moves no counter" — the SAME
        // known-zero `ZERO_TOKENS` DES-188's derive branch (2) uses, `unpriced: false` (never
        // dispatched, so genuinely not an unpriced call) — UNLESS issue #127's `failUsage` above
        // computed a real figure, which wins.
        state: 'failed', provider, model: prev?.model ?? '',
        tokens: failUsage?.tokens ?? ZERO_TOKENS, costUSD: failUsage?.costUSD ?? 0, unpriced: failUsage?.unpriced ?? false,
        ...(failUsage?.partial === true ? { partial: true as const } : {}),
        // dash-auth-spec.md section C: the gateway's own failure reason, verbatim — see
        // `AgentRecord.failReason`'s own doc for why this is never re-mapped at either producer.
        failReason: result.reason, ...warnings,
        ...(result.transport !== undefined ? { transport: result.transport } : {}),
        ...(detail !== undefined ? { detail } : {}),
        // v26 (M-2 send-back repair, ADR-046, INV-V26-6, ARCH-111): the SAME spread the `done`
        // branch above already has — a terminally-failed call's unmapped provider chatter is the
        // exact call whose unmapped subtypes matter most, and `foldUsage` could never count one
        // from this branch before. The field was dropped at TWO sites, not here only (v26 R-1):
        // here, and again in `foldUsage` itself, whose `!data.tokens` guard used to run before the
        // `unmapped` accumulation and so discarded the names this repair had just taught the event
        // below to carry. Both sites are closed; IT-156 deep-equals the two folds over a run
        // containing exactly this branch.
        // issue #141: `totalUnmappedFail` is the MERGED total (prior re-ask attempts + this one),
        // same convention as `tokens`/`costUSD` above — never `result.unmapped` raw. Computed
        // UNCONDITIONALLY (never gated on `failUsage`, which can be `undefined` on a no-tokens/
        // no-prior call that still carries `unmapped` — see that variable's own doc).
        ...(totalUnmappedFail.length > 0 ? { unmapped: totalUnmappedFail } : {}),
      });
      // Forward any partial transcript + the CLI error detail captured before a terminal failure,
      // so a 0-token `terminal` is diagnosable (the error subtype/text) instead of opaque.
      for (const ev of result.events ?? []) {
        await this._emit(runId, req.agentId, ev);
      }
      await this._emit(runId, req.agentId, {
        ts, kind: 'usage',
        // v26 integration: same reason as the done branch — a failed call's record carries
        // `transport` live, so the event must carry it or the restart-rebuilt record loses it.
        // v26 (M-2 send-back repair): `unmapped` rides this event too, same spread as the done
        // branch — the terminally-failed call whose unmapped provider chatter matters most.
        // issue #127: `tokens`/`costUSD`/`unpriced`/`partial` ride this event too, beside `reason` —
        // ONLY when `failUsage` computed a real figure (see `deriveAgentRecords`'s matching read,
        // keyed off `reason` presence rather than `tokens` presence now that a FAILED event can also
        // carry tokens — run-store.ts).
        data: {
          // dash-auth-spec.md section C: `provider` is the SAME merged local var the record above
          // was built from — not `result.provider` raw (see that binding's own comment).
          reason: result.reason, provider, detail: result.detail,
          ...(result.transport !== undefined ? { transport: result.transport } : {}),
          // issue #141: the merged total, same as the record above — not `result.unmapped` raw, and
          // never gated on `failUsage` (see `totalUnmappedFail`'s own doc).
          ...(totalUnmappedFail.length > 0 ? { unmapped: totalUnmappedFail } : {}),
          ...(failUsage !== undefined ? { tokens: failUsage.tokens, costUSD: failUsage.costUSD, unpriced: failUsage.unpriced, ...(failUsage.partial === true ? { partial: true as const } : {}) } : {}),
        },
      });
    }
  }

  getRecord(agentId: string): AgentRecord | undefined {
    return this._records.get(agentId);
  }

  getAllRecords(): AgentRecord[] {
    return [...this._records.values()];
  }
}

export interface AgentExecutorDeps {
  gateway?: GatewayClient;
  guard?: RunGuard;
  store?: RunStore;
  clock?: { isoNow(): string };
  /** DES-088 (TASK-082): inject to enable redact-at-capture on all transcript persist sinks. */
  secretValueProvider?: SecretValueProvider;
  /** v26 (DES-180, ARCH-118, TASK-180): this run's admission-time price/capability pin — see
   *  `AgentTranscriptSink`'s own doc for the absent-pin fallback. */
  priceBook?: PriceBook;
}

/** Bounded retry budget for schema-mismatched agent() responses (D-V4) — never an infinite loop. */
const SCHEMA_RETRY_ATTEMPTS = 3;

/**
 * One Claude Agent SDK headless session per agent() call (DES-007): no schema → final text,
 * schema → validated object, terminal gateway failure → null (never rejects). GatewayClient and
 * RunGuard are constructor-injected seams (DES-009/DES-002); a fresh AgentTranscriptSink (DES-008)
 * captures every outcome.
 */
export class AgentExecutor implements AgentSpawner {
  private readonly _gateway: GatewayClient;
  private readonly _sink: AgentTranscriptSink;
  private readonly _store?: RunStore;
  private readonly _clock: { isoNow(): string };
  private readonly _secretValueProvider?: SecretValueProvider;
  private readonly _priceBook?: PriceBook;

  constructor(deps: AgentExecutorDeps = {}) {
    this._gateway = deps.gateway ?? NULL_GATEWAY;
    this._secretValueProvider = deps.secretValueProvider;
    this._sink = new AgentTranscriptSink(deps.guard, deps.store, deps.secretValueProvider, deps.priceBook);
    this._store = deps.store;
    this._clock = deps.clock ?? { isoNow: () => new Date().toISOString() }; // det:allow — transcript timestamp, not a decision
    this._priceBook = deps.priceBook;
  }

  /** v26 integration (DES-179, INV-V26-4, REQ-126): the run's PINNED capability for this call's
   *  effective model — never a fresh catalog lookup at dispatch. Keyed exactly as
   *  `RunManager.start()` keyed the pin (`${provider}/${model}`). 2026-09-26 (alias mechanism
   *  removed): `model` is now the full ref itself, so `parseModelRef` (no alias table needed) is
   *  the only normalization step. Returns `undefined` when there is no pin, no model, or the ref
   *  does not parse; the gateway then falls through to its own `UNKNOWN_CAPS`, which is the
   *  documented fail-safe (effort not applied, and `effortApplied.reason` says the catalog could
   *  not be read). */
  private _pinnedCapsFor(model: string | undefined): Caps | undefined {
    if (!this._priceBook || model === undefined) return undefined;
    const resolved = parseModelRef(model);
    if (!resolved) return undefined;
    return this._priceBook.pinned[`${resolved.provider}/${resolved.model}`]?.caps;
  }

  /** issue #53: finalizes the record of a call the run's abort (run_suspend/run_stop) cut short.
   *  Before this, both aborted exits of `run()` returned BEFORE `capture()`, so the record kept its
   *  `markRunning` stamp — `state:'running'`, no `endedAt` — for the rest of the process's life.
   *  Routed through the SAME `capture()` failed branch every other unfinished call takes: the record
   *  becomes `failed` with `endedAt` and a detail naming the abort, and the durable usage event it
   *  journals makes `deriveAgentRecords` rebuild the same record after a restart. `failed`, not a new
   *  state: the call reached (or was about to reach) a gateway and did not complete, which is what
   *  `failed` already means; its `detail` says why. The resumed re-run gets a NEW agentId. */
  /** dash-auth-spec.md section C (2026-09-30): `reason: 'aborted'` (never `'terminal'`) — a real
   *  gateway failure and a suspend/stop cutoff are distinct causes (`AgentFailureSummary.reason`,
   *  observed-stats.ts's exclusion, both key off this). `provider: ''` here is deliberately the
   *  UNRESOLVED sentinel, not a claim — `capture()`'s failed branch (below) merges in whatever the
   *  live record (`markHarness`) already resolved, exactly like every other failure path; this call
   *  site never needs to know whether that happened. */
  private async _finalizeAborted(req: AgentReq): Promise<AgentOutcome> {
    // issue #127: the gateway's own returned Promise is abandoned the instant the run's abort wins
    // `_invokeOnce`'s race (below) — whatever it would eventually report is lost UNLESS it already
    // streamed a live figure onto this agent's record via `onUsage`/`markUsage` before that happened.
    //
    // issue #141: read via `getLiveAttemptUsage`, NOT `getRecord(...).tokens` — on a call aborted
    // mid-way through a schema re-ask, the record's own `tokens` is the COMMITTED total from every
    // already-resolved earlier attempt (this method's caller, `capture()`'s own `prev`-merge, adds
    // that in). Passing the record's `tokens` here too would double it in. `getLiveAttemptUsage`
    // carries ONLY the currently in-flight attempt's own live-streamed delta, exactly what
    // `capture()`'s failed branch expects to merge onto the committed total.
    const liveAttempt = this._sink.getLiveAttemptUsage(req.agentId);
    await this._sink.capture(
      req.runId,
      { agentId: req.agentId, label: req.opts.label },
      {
        ok: false, provider: '', reason: 'aborted', detail: 'ABORTED: the run was suspended or stopped while this call was in flight',
        ...(liveAttempt !== undefined ? { tokens: liveAttempt, partial: true as const } : {}),
      },
      this._clock.isoNow(),
    );
    return { kind: 'null', aborted: true };
  }

  /** issue #127: every in-flight `run()` call, tracked so `settleInflight` (below) can wait for them.
   *  A plain `Set` of the SAME Promise `run()` itself returns — removed the instant that Promise
   *  settles, whichever way. */
  private readonly _inflight = new Set<Promise<AgentOutcome>>();

  async run(req: AgentReq): Promise<AgentOutcome> {
    const p = this._runTracked(req);
    this._inflight.add(p);
    // A SEPARATE derived promise does the tracking cleanup + swallows its own rejection (a pre-
    // dispatch validation throw, e.g. PARAM_OUT_OF_RANGE) so that never becomes an unhandled
    // rejection on its own account — the caller below still gets `p` itself, untouched, so a
    // genuine throw still propagates to it exactly as before this change.
    p.finally(() => this._inflight.delete(p)).catch(() => {});
    return p;
  }

  /** issue #127 (#53/adjudication #9 I-2 follow-up): bounded wait for every `run()` call in flight
   *  AT THE MOMENT THIS IS CALLED to settle — called by `RunManager.stop()`/`suspend()` AFTER
   *  aborting (so every in-flight call is already racing its own abort listener, see `_invokeOnce`'s
   *  own race) and BEFORE the terminal/suspend snapshot is taken, closing the race
   *  `tests/integration/terminal-state-warnings.test.ts` (IT-133) used to document as "deliberately
   *  NOT a fix … adjudication #9 I-2 rules against guessing at a fix on a concurrency path" — that
   *  2026-09-07 ruling was about THIS EXACT #53 race (not, as an earlier draft of this comment
   *  wrongly said, issue #61's separate `BudgetExceededError` reservation-arithmetic ruling, which
   *  lives in `run-guard.ts`'s own header); issue #127's 2026-10-02 owner ruling is the named revisit
   *  that authorizes fixing it now. A caller is never blocked unboundedly — `timeoutMs` (default
   *  2000) caps the wait; whatever has not settled by then is left for `_transition`'s snapshot to
   *  miss, exactly as before this fix, and the `agent_live_at_terminal` EngineWarning (run-manager.ts)
   *  still fires on it so the miss stays observable, never silent — though in practice the in-memory
   *  record update (`capture()`'s own `this._records.set`, synchronous, before any of its own awaits)
   *  lands within the first couple of microtask ticks after the abort fires, well inside ANY nonzero
   *  bound, so reproducing that residual path needs something that never gets `run()`-tracked at all
   *  (see IT-133's own updated comments), not merely a slow store. */
  async settleInflight(timeoutMs = 2000): Promise<void> {
    if (this._inflight.size === 0) return;
    const all = Promise.allSettled([...this._inflight]);
    await Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  private async _runTracked(req: AgentReq): Promise<AgentOutcome> {
    if (req.signal.aborted) return this._finalizeAborted(req);

    // v21 (ARCH-068, DES-105, TASK-101): a script-supplied per-call knob outside the contract
    // (today: an invalid `effort`) must be RECORDED then THROWN, pre-dispatch — never a silent
    // null via parallel()'s swallow-into-null (sandbox/guards.ts). Validation and record live in
    // the same function, so whoever validates records — no _spawnerOverride carve-out needed.
    if (req.opts.effort !== undefined && !isEffort(req.opts.effort)) {
      const detail = `PARAM_OUT_OF_RANGE: effort '${String(req.opts.effort)}' is not a recognized effort level`;
      await this._sink.capture(
        req.runId,
        { agentId: req.agentId, label: req.opts.label },
        { ok: false, provider: '', reason: 'terminal', detail },
        this._clock.isoNow(),
      );
      throw codedError('PARAM_OUT_OF_RANGE', detail);
    }

    // v34 (DES-226, ADR-063, TASK-229, REQ-203/096): `agentType` was retired with the server-side
    // agent-definition mechanism (DES-224/DES-225) — a script (or a pinned pre-v34 version)
    // dispatching one is RECORDED then THROWN, mirroring the effort guard above: inside parallel()
    // a bare throw is swallowed into `null` (sandbox/guards.ts), so without the capture the
    // refusal would be invisible in workflow_status. `Object.hasOwn`, not a typed field read —
    // `AgentOpts` no longer declares `agentType`, but neither the sandbox boundary (opaque) nor the
    // run-manager IPC hop (a cast) strips an unknown key, so a pre-v34-shaped call can still carry
    // one at runtime; the marker is the SAME `detail.violation` DES-224 mints at registration, so a
    // client writes one branch for both halves.
    if (Object.hasOwn(req.opts, 'agentType')) {
      const detail = "PARAM_UNKNOWN: 'agentType' was retired at v34 — the server-side agent-definition "
        + "mechanism is gone; put the system prompt in your script's own prompt. "
        + "See workflow_authoring_guide, 'prompt layering'.";
      await this._sink.capture(
        req.runId,
        { agentId: req.agentId, label: req.opts.label },
        { ok: false, provider: '', reason: 'terminal', detail },
        this._clock.isoNow(),
      );
      throw codedError('PARAM_UNKNOWN', detail, { param: 'agentType', agent: req.opts.label, violation: 'AGENT_OPT_RETIRED' });
    }

    // v24 (ARCH-095/DES-146, TASK-145): the 'call' and 'agentType' rungs are RETIRED — an agent()
    // call may no longer carry tunable values (ARCH-096 refuses PARAM_IN_SCRIPT) and every declared
    // label's model/effort/timeoutMs.default is required at registration, so the run's admission
    // snapshot (override > contract default > engine, already resolved per DES-146's three-rung
    // ladder — its `provenance` values are already drawn from the same `Rung` set) IS the effective
    // params directly; `resolveCallParams`'s former per-call/agentType merge is gone with it.
    const eff: EffectiveCallParams = { ...req.runParams };

    // v25 (#55, adjudication #9 I-1.1): read as a DECLARED field, an explicit per-call
    // opts.allowedTools (already carried by the `...req.opts` spread below). v34 (DES-225/DES-228):
    // the agentType-frontmatter `tools` rung and the `defaults.tools` rung below it are both gone —
    // the tool surface is exactly per-call `allowedTools` > the gateway's `defaultAllowedTools`.
    const effectiveOpts: AgentOpts = {
      ...req.opts,
      model: eff.model,
      effort: eff.effort,
      timeoutMs: eff.timeoutMs,
    };

    // v34 (DES-225, REQ-094/202/203/204): two-segment composition — [script prompt] +
    // [framed appendPrompt]. Byte-identical to the prior bare `prompt` when appendPrompt is absent.
    const effectivePrompt = composePrompt(req.prompt, req.runParams.appendPrompt);

    // D-V4: schema present → real JSON-schema validation with bounded retry-on-mismatch
    // (never a type-cast passthrough). No schema → single attempt, final text.
    // issue #162 item C: `ajv.compile` throws SYNCHRONOUSLY for a non-object/non-boolean schema
    // (e.g. a string) — Ajv's own `schema must be object or boolean`. Before this, that throw
    // propagated out of `_runTracked` with no try/catch, AFTER `markQueued`/`markRunning` had
    // already recorded this agent as 'running' and BEFORE any `_sink.capture(...)` terminal call —
    // leaving an orphan transcript record stuck at `running` forever. Same pre-dispatch-guard shape
    // as the `effort`/`agentType` guards immediately above: capture a terminal refusal, then throw.
    let validate: ValidateFunction | undefined;
    if (req.opts.schema) {
      try {
        validate = ajv.compile(req.opts.schema as object);
      } catch (e) {
        const detail = `INVALID_SCHEMA: agent()'s schema option is not a valid JSON Schema: ${e instanceof Error ? e.message : String(e)}`;
        await this._sink.capture(
          req.runId,
          { agentId: req.agentId, label: req.opts.label },
          { ok: false, provider: '', reason: 'terminal', detail },
          this._clock.isoNow(),
        );
        throw codedError('INVALID_SCHEMA', detail);
      }
    }
    const attempts = validate ? SCHEMA_RETRY_ATTEMPTS : 1;
    // D-V4 hardening: the engine validates the agent's FINAL TEXT as JSON (no injected
    // StructuredOutput tool), so — especially for OpenAI models, which after a multi-turn tool loop
    // tend to answer in prose instead of raw JSON — the schema must be stated in the prompt and a
    // failed attempt must be corrected, not silently re-run identically (which returned null on
    // every gate of a real sdlc-run). Append the exact schema + an output contract when a schema is
    // set; nudge harder on retry.
    const schemaPrompt = validate
      ? `${effectivePrompt}\n\n=== OUTPUT FORMAT (REQUIRED) ===\nAfter any tool use, your FINAL message MUST be ONLY a single JSON value that validates against this JSON Schema — no prose, no markdown code fences, no explanation before or after:\n${JSON.stringify(req.opts.schema)}`
      : effectivePrompt;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const prompt =
        attempt === 0
          ? schemaPrompt
          : `${schemaPrompt}\n\n(Your previous reply did not parse as JSON matching the schema above. Reply with ONLY the JSON value — nothing else.)`;
      const outcome = await this._invokeOnce(req, prompt, effectiveOpts, eff, attempt);
      if (outcome === 'aborted') return this._finalizeAborted(req);
      const result = outcome;

      if (!result.ok) {
        // A genuine gateway failure always ends the loop — `capture()`'s default `final:true` is
        // correct here unchanged (it also folds in any earlier re-ask attempt's committed total —
        // see `capture()`'s own doc).
        await this._sink.capture(req.runId, { agentId: req.agentId, label: effectiveOpts.label }, result, this._clock.isoNow());
        return { kind: 'null' };
      }
      if (!validate) {
        await this._sink.capture(req.runId, { agentId: req.agentId, label: effectiveOpts.label }, result, this._clock.isoNow());
        return { kind: 'text', value: String(result.content) };
      }

      const parsed = parseJsonContent(result.content);
      const conforms = parsed !== undefined && validate(parsed);
      const isLastAttempt = attempt === attempts - 1;
      // issue #141: `final` is the attempt that ENDS the loop — conforms, or the retry budget is
      // exhausted (schema-exhausted outcome, unchanged: still resolves `null`, record still `done`).
      // Every earlier nonconforming attempt accumulates onto the SAME record instead of replacing it
      // (`capture()`'s own doc) and stays `running`, never observably `done`.
      await this._sink.capture(
        req.runId, { agentId: req.agentId, label: effectiveOpts.label }, result, this._clock.isoNow(),
        { final: conforms || isLastAttempt },
      );
      if (conforms) return { kind: 'object', value: parsed as object };
      if (isLastAttempt) return { kind: 'null' };
      // nonconforming, attempts remain — loop retries up to `attempts`
    }
    return { kind: 'null' };
  }

  private async _invokeOnce(req: AgentReq, prompt: string, opts: AgentOpts, eff: EffectiveCallParams, attempt: number): Promise<GatewayResult | 'aborted'> {
    // issue #53: a schema-retry attempt that begins after the abort must not dispatch — the race
    // below adds its listener to an already-aborted signal, which never fires.
    if (req.signal.aborted) return 'aborted';
    // D-V2V-1: forward the run's own workspace — only ClaudeAgentSdkGatewayClient consumes it
    // (per-call cwd re-scoping + asset materialization); other gateways ignore the extra field.
    // DES-066 (TASK-069): onHarness closure — appends a kind:'harness' transcript event when the
    // gateway calls it (post-curation, before query). Latest-wins: the loop may call _invokeOnce
    // multiple times (schema-retry); each overwrites the previous harness entry for this agentId.
    const store = this._store;
    const clock = this._clock;
    const sink = this._sink;
    const secretValueProvider = this._secretValueProvider;
    // v21 (ARCH-068, DES-105, TASK-101): the ONE descriptor-decoration site — merges the resolved
    // per-key provenance (+ effort/timeoutMs, + effortApplied when the gateway supplies it, DES-106)
    // onto the gateway-emitted descriptor before persisting. Never overwrites descriptor.model/
    // provider (the gateway's own resolution is the record of what was actually dispatched).
    const onHarness = async (
      descriptor: HarnessDescriptor,
      applied?: { applied: true; param: string; value: unknown } | { applied: false; reason: string },
    ): Promise<void> => {
      // v24 (ARCH-104/DES-160, TASK-145): `label` names this dispatch's script agent() label; a
      // `surfaceType:'none'` dispatch (or one with no `req.assets` at all) never materializes
      // anything (DES-154), so the gateway leaves `descriptor.materialized` unset and THIS site
      // fills the honest empty set — every declared name (skills+mcp) lands in `missing`, never
      // silently absent.
      const declaredNames = req.assets ? [...req.assets.declared.skills, ...req.assets.declared.mcp] : [];
      // v26 integration (DES-176 cohort (i), REQ-124): the receipt-time phase lane `markQueued`
      // stamped on the live record travels onto the DURABLE descriptor here, beside `label` and for
      // the same reason — `deriveAgentRecords` reads the harness event to rebuild a record after a
      // restart, and without this the lane existed only in this process's memory.
      const queued = sink.getRecord(req.agentId);
      // v34 (DES-225): `descriptor.prompt` is DEFINED as the exact string this dispatch handed the
      // gateway — both real gateways echo `req.prompt` verbatim, and this site no longer takes
      // ownership of it (the retired agentType-systemPrompt strip + the `harness_prompt_prefix_
      // mismatch` fail-closed that verified the echo went with it, ADR-063 rationale item 1).
      const decorated: HarnessDescriptor = {
        ...descriptor,
        effort: eff.effort,
        timeoutMs: eff.timeoutMs,
        provenance: eff.provenance,
        ...(req.opts.label !== undefined ? { label: req.opts.label } : {}),
        ...(queued?.phase !== undefined ? { phase: queued.phase } : {}),
        ...(queued?.phaseIndex !== undefined ? { phaseIndex: queued.phaseIndex } : {}),
        materialized: descriptor.materialized ?? { skills: [], mcp: [], missing: declaredNames },
        // #81/#83: a gateway that exposes no skill (e.g. direct-fetch) leaves this unset -> none.
        skillsExposed: descriptor.skillsExposed ?? [],
        ...(applied !== undefined ? { effortApplied: applied.applied ? { param: applied.param, value: applied.value } : { reason: applied.reason } } : {}),
        // issue #141: see `HarnessDescriptor.reaskCount`'s own doc for why `prompt` (the gateway's
        // verbatim echo, ADR-061/TASK-229) is left untouched here instead of being pinned back to
        // attempt 0's — absent on the first attempt, never `0`.
        ...(attempt > 0 ? { reaskCount: attempt } : {}),
      };
      // #20: surface model/provider on the LIVE agent record the moment the session is built (before
      // the first token) so workflow_status shows WHICH backend a still-running agent is waiting on,
      // instead of a blank model:""/provider:"" that makes a hung backend indistinguishable from
      // progress. The record lives on the transcript sink; markHarness merges (never clobbers state).
      sink.markHarness(req.agentId, decorated.model, decorated.provider, decorated.warnings);
      if (store) {
        // v21 Gate 8 send-back (review §4 B3, ARCH-066 inv-5 sink-completeness): `redactHarness`
        // (called upstream by the gateway to build `descriptor`) is a STRUCTURAL strip only — it
        // redacts no secret values. So this sink redacts at persist write, same convention as every
        // other sink (DES-088/TASK-082).
        // v21 Gate 8 re-review (review §R2, R-G9): REDACT FIRST, cap SECOND. The cap used to run
        // upstream inside `redactHarness`, which could cut a secret in half at a 2048-char seam and
        // defeat `redact()`'s value-exact match, persisting partial credential bytes. `capPrompt` is
        // applied unconditionally — a deployment with no SecretValueProvider must still get a
        // size-bounded descriptor, since the cap is a size bound and not a security control.
        const base = { agentId: req.agentId, descriptor: decorated };
        const redacted = secretValueProvider
          ? (redact(base, secretValueProvider.entries()) as { agentId: string; descriptor: HarnessDescriptor })
          : base;
        const data = { ...redacted, descriptor: { ...redacted.descriptor, prompt: capPrompt(redacted.descriptor.prompt) } };
        await store.appendTranscript(req.runId, req.agentId, {
          ts: clock.isoNow(),
          kind: 'harness',
          data,
        });
      }
    };
    // #20: stream each live transcript event to the store AND bump the record's lastActivityAt, so
    // agent_log grows and a progressing agent's clock advances DURING the call — a hung agent (no
    // events) keeps lastActivityAt at startedAt. Fire-and-forget-ordered: awaited by the gateway per
    // event, so file appends stay in arrival order. Gateways without a turn stream never call it.
    // DES-088 (TASK-082): redact on persist write (sink 1 — live stream events), every event kind.
    // v21 Gate 8 re-review (review §R2, R-G10): the former `ev.kind !== 'harness'` carve-out is gone
    // for the same reason as in `AgentTranscriptSink._emit` above — harness descriptors persist
    // through `onHarness`, which runs its own single `redact()`, so unconditional redaction here
    // cannot double-redact and fails safe if a gateway ever streams one through this sink.
    const onEvent = async (ev: TranscriptEvent): Promise<void> => {
      if (store) {
        const stored = secretValueProvider
          ? redact(ev, secretValueProvider.entries()) as TranscriptEvent
          : ev;
        // v26 (H-3 repair, INV-V26-5): same cap-after-redact as `_emit` above — the streaming path's
        // own persist site for an SDK `kind:'message'` error event (`_drain`'s streaming branch).
        const data = stored.data as { detail?: unknown } | undefined;
        if (typeof data?.detail === 'string') stored.data = { ...data, detail: capDetail(data.detail) };
        await store.appendTranscript(req.runId, req.agentId, stored);
      }
      sink.markActivity(req.agentId, ev.ts);
    };
    // issue #127: the gateway's live cumulative-usage callback — stamps the record so a later abort
    // (`_finalizeAborted`) has a figure to finalize with even if it never awaits `invokePromise`
    // itself. Gateways with nothing to report (LiteLLMGatewayClient) simply never call it.
    const onUsage = (tokens: Tokens): void => {
      sink.markUsage(req.agentId, tokens);
    };
    // v26 integration (DES-179's own signature line: "`GatewayClient.invoke(req)` gains `caps?:
    // Caps`, threaded by the executor from the RUN'S PIN"). This is that thread; before it, the
    // field existed on both sides and nothing ever filled it.
    const caps = this._pinnedCapsFor(opts.model);
    const invokePromise = this._gateway.invoke({ prompt, opts, runId: req.runId, agentId: req.agentId, signal: req.signal, workspace: req.workspace, assets: req.assets, onHarness, onEvent, onUsage, ...(caps !== undefined ? { caps } : {}) });
    const aborted = new Promise<'aborted'>((resolve) => {
      req.signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });
    return Promise.race([invokePromise, aborted]);
  }

  /** D-F12: RunManager calls this the moment it allocates an agentId (before acquireSlot()
   *  resolves) so the in-flight agent is observable via workflow_status as "queued", not absent. */
  markQueued(agentId: string, opts?: { label?: string; frame?: string; phase?: { title: string; index: number } }): void {
    this._sink.markQueued(agentId, opts);
  }

  /** D-F12: RunManager calls this once the agentId's concurrency slot is acquired and it is
   *  genuinely dispatched to the gateway — observable as "running" until capture() resolves it. */
  markRunning(agentId: string, startedAt?: string): void {
    this._sink.markRunning(agentId, startedAt);
  }

  /** v25 (REQ-120): RunManager calls this when RunGuard refuses this call's budget admission — the
   *  call is terminal before it ever reaches a gateway, and says why.
   *  v26 (DES-188, TASK-188): now ASYNC — it journals a `kind:'refused'` transcript event (the only
   *  durable trace across a restart with no snapshot), so callers must `await` it before proceeding
   *  (RunManager awaits it before re-throwing the refusal). */
  async markRefused(runId: string, agentId: string, reasonCode: ErrorCode, endedAt?: string): Promise<void> {
    await this._sink.markRefused(runId, agentId, reasonCode, endedAt);
  }

  /** Exposes the captured AgentRecord for a completed/failed agent (DES-008). */
  getRecord(agentId: string): AgentRecord | undefined {
    return this._sink.getRecord(agentId);
  }

  /** Exposes every AgentRecord captured so far this run (feeds RunStatusView.agents, DES-008). */
  getAllRecords(): AgentRecord[] {
    return this._sink.getAllRecords();
  }
}
