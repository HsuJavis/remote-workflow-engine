// AgentExecutor (DES-007 / ARCH-004) + AgentTranscriptSink (DES-008 / TASK-010).
import Ajv from 'ajv';
import type { AgentOpts, AgentRecord, HarnessDescriptor, TranscriptEvent, PriceBook, Caps } from './types.js';
import { resolveAlias } from './providers.js';
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
  markHarness(agentId: string, model: string, provider: string): void {
    const existing = this._records.get(agentId);
    if (existing) this._records.set(agentId, { ...existing, model, provider });
  }

  /** issue #20: stamp lastActivityAt each time the gateway streams a live transcript event, so
   *  workflow_status shows a progressing agent's clock advancing while a hung one's stays put. Merge —
   *  never clobber state/model/provider. No-op if no record exists yet (never fabricates one). */
  markActivity(agentId: string, ts: string): void {
    const existing = this._records.get(agentId);
    if (existing) this._records.set(agentId, { ...existing, lastActivityAt: ts });
  }

  /** Records the outcome of one agent() call: captures the usage event and feeds RunGuard.addTokens exactly once. */
  async capture(runId: string, req: { agentId: string; label?: string }, result: GatewayResult, ts: string): Promise<void> {
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
      this._guard?.addUsage(tokens, costUSD, unpriced, result.unmapped);
      this._records.set(req.agentId, {
        agentId: req.agentId, label: req.label, phase, phaseIndex, frame, startedAt, lastActivityAt, endedAt: ts,
        state: 'done', provider, model, tokens, costUSD, unpriced,
        ...(result.transport !== undefined ? { transport: result.transport } : {}),
        ...(result.proxyModel !== undefined ? { proxyModel: result.proxyModel } : {}),
        ...(result.unmapped && result.unmapped.length > 0 ? { unmapped: result.unmapped } : {}),
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
      await this._emit(runId, req.agentId, {
        ts, kind: 'usage',
        data: {
          tokens, costUSD, unpriced, provider, model,
          // v26 integration (DES-177/DES-188, REQ-125): `transport`/`proxyModel` ride the event too.
          // They were written onto the LIVE record and onto the terminal snapshot (which is folded
          // from records) but NOT onto the durable event, so a snapshot-less read after a restart
          // rebuilt the record WITHOUT them — REQ-125's "which wire, which backend" answer survived
          // exactly as long as the process did, and DES-188's derived≡snapshot lock was false on
          // every real-gateway run (the fake gateways in the v26 fixtures set neither field, which
          // is why nothing caught it).
          ...(result.transport !== undefined ? { transport: result.transport } : {}),
          ...(result.proxyModel !== undefined ? { proxyModel: result.proxyModel } : {}),
          ...(result.unmapped && result.unmapped.length > 0 ? { unmapped: result.unmapped } : {}),
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
      this._records.set(req.agentId, {
        agentId: req.agentId, label: req.label, phase, phaseIndex, frame, startedAt, lastActivityAt, endedAt: ts,
        // #20: preserve the model markHarness stamped on the live record — a failed/timed-out call
        // carries no model of its own, and post-mortem (after the operator stops the run) is exactly
        // when "which model failed" matters most. Don't wipe it back to ''.
        // v26 (DES-177): same harness-wins rule as the done branch, for the pre-harness terminal case.
        // v26 (DES-180 boundary): "a failed call carries no usage and moves no counter" — the SAME
        // known-zero `ZERO_TOKENS` DES-188's derive branch (2) uses, `unpriced: false` (never
        // dispatched, so genuinely not an unpriced call).
        state: 'failed', provider: prev?.provider || result.provider, model: prev?.model ?? '', tokens: ZERO_TOKENS, costUSD: 0, unpriced: false,
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
        ...(result.unmapped && result.unmapped.length > 0 ? { unmapped: result.unmapped } : {}),
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
        data: {
          reason: result.reason, provider: result.provider, detail: result.detail,
          ...(result.transport !== undefined ? { transport: result.transport } : {}),
          ...(result.unmapped && result.unmapped.length > 0 ? { unmapped: result.unmapped } : {}),
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
  /** v26 integration (DES-179, ARCH-116/117, INV-V26-4, REQ-126, clarification 14): the alias table
   *  the pin above was KEYED by. The executor needs it to turn this call's effective alias
   *  (`opts.model`, resolved by the parameter-precedence chain here, which is the only place that
   *  knows it) into the `provider/model` key `priceBook.pinned` uses, so it can thread the pinned
   *  `caps` onto the gateway request. Without this, `wireEffort` always saw `UNKNOWN_CAPS` and no
   *  OpenRouter model ever got an effort dial — REQ-126 inert in production, every unit test green
   *  because the unit tests pass `caps` to `wireEffort` directly. Absent -> the same fail-safe
   *  `'unknown'` branch as an absent pin. */
  aliases?: Record<string, { provider: string; model: string; proxyModel?: string }>;
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
  private readonly _aliases?: Record<string, { provider: string; model: string; proxyModel?: string }>;

  constructor(deps: AgentExecutorDeps = {}) {
    this._gateway = deps.gateway ?? NULL_GATEWAY;
    this._secretValueProvider = deps.secretValueProvider;
    this._sink = new AgentTranscriptSink(deps.guard, deps.store, deps.secretValueProvider, deps.priceBook);
    this._store = deps.store;
    this._clock = deps.clock ?? { isoNow: () => new Date().toISOString() }; // det:allow — transcript timestamp, not a decision
    this._priceBook = deps.priceBook;
    this._aliases = deps.aliases;
  }

  /** v26 integration (DES-179, INV-V26-4, REQ-126): the run's PINNED capability for this call's
   *  effective alias — never a fresh catalog lookup at dispatch. Keyed exactly as
   *  `RunManager.start()` keyed the pin (`${resolved.provider}/${resolved.model}`). Returns
   *  `undefined` when there is no pin, no alias table, or the alias is not in it; the gateway then
   *  falls through to its own `UNKNOWN_CAPS`, which is the documented fail-safe (effort not
   *  applied, and `effortApplied.reason` says the catalog could not be read). */
  private _pinnedCapsFor(model: string | undefined): Caps | undefined {
    if (!this._priceBook || !this._aliases) return undefined;
    const resolved = resolveAlias(this._aliases, model ?? 'default');
    if (!resolved) return undefined;
    return this._priceBook.pinned[`${resolved.provider}/${resolved.model}`]?.caps;
  }

  async run(req: AgentReq): Promise<AgentOutcome> {
    if (req.signal.aborted) return { kind: 'null', aborted: true };

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
    const validate = req.opts.schema ? ajv.compile(req.opts.schema as object) : undefined;
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
      const outcome = await this._invokeOnce(req, prompt, effectiveOpts, eff);
      if (outcome === 'aborted') return { kind: 'null', aborted: true };
      const result = outcome;

      await this._sink.capture(req.runId, { agentId: req.agentId, label: effectiveOpts.label }, result, this._clock.isoNow());

      if (!result.ok) return { kind: 'null' };
      if (!validate) return { kind: 'text', value: String(result.content) };

      const parsed = parseJsonContent(result.content);
      if (parsed !== undefined && validate(parsed)) return { kind: 'object', value: parsed as object };
      // nonconforming (or unparsable) response — loop retries up to `attempts`
    }
    return { kind: 'null' };
  }

  private async _invokeOnce(req: AgentReq, prompt: string, opts: AgentOpts, eff: EffectiveCallParams): Promise<GatewayResult | 'aborted'> {
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
        ...(applied !== undefined ? { effortApplied: applied.applied ? { param: applied.param, value: applied.value } : { reason: applied.reason } } : {}),
      };
      // #20: surface model/provider on the LIVE agent record the moment the session is built (before
      // the first token) so workflow_status shows WHICH backend a still-running agent is waiting on,
      // instead of a blank model:""/provider:"" that makes a hung backend indistinguishable from
      // progress. The record lives on the transcript sink; markHarness merges (never clobbers state).
      sink.markHarness(req.agentId, decorated.model, decorated.provider);
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
    // v26 integration (DES-179's own signature line: "`GatewayClient.invoke(req)` gains `caps?:
    // Caps`, threaded by the executor from the RUN'S PIN"). This is that thread; before it, the
    // field existed on both sides and nothing ever filled it.
    const caps = this._pinnedCapsFor(opts.model);
    const invokePromise = this._gateway.invoke({ prompt, opts, runId: req.runId, agentId: req.agentId, signal: req.signal, workspace: req.workspace, assets: req.assets, onHarness, onEvent, ...(caps !== undefined ? { caps } : {}) });
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
