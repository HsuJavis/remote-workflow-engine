// AgentExecutor (DES-007 / ARCH-004) + AgentTranscriptSink (DES-008 / TASK-010).
import Ajv from 'ajv';
import type { AgentOpts, AgentRecord, HarnessDescriptor, TranscriptEvent } from './types.js';
import type { GatewayClient, GatewayResult } from './gateway/client.js';
import type { RunGuard } from './run-guard.js';
import type { RunStore } from './run-store.js';
import { redact } from './secret-resolver.js';
import type { SecretValueProvider } from './secret-resolver.js';
import { resolveCallParams, composePrompt, type RunParams, type EffectiveCallParams } from './params/resolve.js';
import { isEffort } from './params/contract.js';
import { codedError } from './errors.js';

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

/** DES-066 (TASK-069): pure STRUCTURAL transform — strips all resolved values, keeps names only.
 *  Redacts no secret VALUES and emits no `‹secret:NAME›` markers; that is the persist site's job.
 *  - surfaceType:'none' (direct-fetch) → all arrays empty (no curated surface available).
 *  - MCP configs: name only, never URL/key/token.
 *  - prompt passes through UNCUT — see `capPrompt` (R-G9: cap after redact, never before).
 *  - `unresolvedMcp` (v22, REQ-099 / adjudication #4 N-1): referenced MCP names the dispatch site
 *    could not resolve. Carried onto `mcpUnresolved` only when non-empty, so an unaffected run's
 *    descriptor keeps exactly the keys it had before. */
export function redactHarness(resolved: {
  surfaceType: 'curated' | 'none';
  modelName: string;
  provider?: string;
  prompt: string;
  curatedTools: string[];
  mergedMcp: Array<{ name: string; [key: string]: unknown }>;
  skills: string[];
  unresolvedMcp?: string[];
}): HarnessDescriptor {
  const provider = resolved.provider ?? '';
  const prompt = resolved.prompt;
  if (resolved.surfaceType === 'none') {
    return { model: resolved.modelName, provider, prompt, tools: [], skills: [], mcpServers: [], surfaceType: 'none' };
  }
  return {
    model: resolved.modelName,
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

/** Server-side agent-type definition (D-V5/D-F2): resolved by name against
 *  AgentExecutorDeps.agentTypes. `model` (an alias name, resolved the same way opts.model already
 *  is) is optional — loaded from `agents/*.md` frontmatter's `model:` key when present. `tools`
 *  (D-F11) is the frontmatter `tools:` list — the authoritative curated set applied to the outbound
 *  opts.allowedTools when the caller didn't already set one of their own. */
export interface AgentTypeDef {
  systemPrompt: string;
  model?: string;
  tools?: string[];
}

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
      await this._store.appendTranscript(runId, agentId, stored);
    }
  }

  /** D-F12: records an agentId as queued the moment RunGuard allocates it — BEFORE it has acquired
   *  a concurrency slot or reached the gateway — so workflow_status can observe it immediately
   *  rather than only once capture() resolves it (round-5 VAL-002/VAL-007's `agents:[]` gap). */
  markQueued(agentId: string, label?: string, phase?: string, frame?: string): void {
    this._records.set(agentId, {
      agentId, label, phase, frame,
      state: 'queued', provider: '', model: '', tokens: { input: 0, output: 0 },
    });
  }

  /** D-F12: flips a queued agentId to running once it has acquired its concurrency slot and is
   *  genuinely dispatched to the gateway — still observable in workflow_status while in flight. */
  markRunning(agentId: string, startedAt?: string): void {
    const existing = this._records.get(agentId);
    this._records.set(agentId, { ...(existing ?? { agentId, provider: '', model: '', tokens: { input: 0, output: 0 } }), agentId, state: 'running', startedAt: startedAt ?? existing?.startedAt });
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
  async capture(runId: string, req: { agentId: string; label?: string; phase?: string }, result: GatewayResult, ts: string): Promise<void> {
    const prev = this._records.get(req.agentId); // v8 Slice 2/2b: carry frame (markQueued) + startedAt (markRunning)
    const frame = prev?.frame, startedAt = prev?.startedAt;
    // #20: carry lastActivityAt into the terminal record too — its absence on a failed/timed-out agent
    // (never produced an event) vs its presence (got partway) is diagnostic post-mortem.
    const lastActivityAt = prev?.lastActivityAt;
    if (result.ok) {
      const delta = result.tokens.input + result.tokens.output;
      this._guard?.addTokens(delta);
      this._records.set(req.agentId, {
        agentId: req.agentId, label: req.label, phase: req.phase, frame, startedAt, lastActivityAt, endedAt: ts,
        state: 'done', provider: result.provider, model: result.model, tokens: result.tokens,
      });
      // D-G8-2: forward the real message/tool_call/tool_result stream the gateway captured (when
      // present — only ClaudeAgentSdkGatewayClient produces these today) BEFORE the terminal usage
      // summary below, preserving turn order (reasoning -> tool_use -> tool_result -> usage).
      for (const ev of result.events ?? []) {
        await this._emit(runId, req.agentId, ev);
      }
      await this._emit(runId, req.agentId, { ts, kind: 'usage', data: { tokens: result.tokens, provider: result.provider, model: result.model } });
    } else {
      this._records.set(req.agentId, {
        agentId: req.agentId, label: req.label, phase: req.phase, frame, startedAt, lastActivityAt, endedAt: ts,
        // #20: preserve the model markHarness stamped on the live record — a failed/timed-out call
        // carries no model of its own, and post-mortem (after the operator stops the run) is exactly
        // when "which model failed" matters most. Don't wipe it back to ''.
        state: 'failed', provider: result.provider, model: prev?.model ?? '', tokens: { input: 0, output: 0 },
      });
      // Forward any partial transcript + the CLI error detail captured before a terminal failure,
      // so a 0-token `terminal` is diagnosable (the error subtype/text) instead of opaque.
      for (const ev of result.events ?? []) {
        await this._emit(runId, req.agentId, ev);
      }
      await this._emit(runId, req.agentId, { ts, kind: 'usage', data: { reason: result.reason, provider: result.provider, detail: result.detail } });
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
  /** Server-side agent-type registry (D-V5): known opts.agentType values apply their systemPrompt. */
  agentTypes?: Record<string, AgentTypeDef>;
  /** DES-088 (TASK-082): inject to enable redact-at-capture on all transcript persist sinks. */
  secretValueProvider?: SecretValueProvider;
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
  private readonly _agentTypes: Record<string, AgentTypeDef>;
  private readonly _secretValueProvider?: SecretValueProvider;

  constructor(deps: AgentExecutorDeps = {}) {
    this._gateway = deps.gateway ?? NULL_GATEWAY;
    this._secretValueProvider = deps.secretValueProvider;
    this._sink = new AgentTranscriptSink(deps.guard, deps.store, deps.secretValueProvider);
    this._store = deps.store;
    this._clock = deps.clock ?? { isoNow: () => new Date().toISOString() }; // det:allow — transcript timestamp, not a decision
    this._agentTypes = deps.agentTypes ?? {};
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
        { agentId: req.agentId, label: req.opts.label, phase: req.opts.phase },
        { ok: false, provider: '', reason: 'terminal', detail },
        this._clock.isoNow(),
      );
      throw codedError('PARAM_OUT_OF_RANGE', detail);
    }

    // D-V5/D-F2: resolve agentType against the server-side registry before any gateway dispatch —
    // a known type's systemPrompt is applied to the outbound prompt (and its `model`, when given,
    // routes the call the same way an explicit opts.model would, unless the caller already set
    // one); an unknown type is a reported error (rejects), never a silent no-op and never a hang.
    let def: AgentTypeDef | undefined;
    if (req.opts.agentType !== undefined) {
      def = this._agentTypes[req.opts.agentType];
      if (!def) throw new Error(`Unknown agentType: ${req.opts.agentType}`);
    }

    // v21 (DES-102/DES-105): one resolution pass — per-call opts > agentType > run snapshot
    // (override/default) > engine, with per-key provenance for the harness descriptor.
    const eff: EffectiveCallParams = resolveCallParams(req.opts, def, req.runParams, {});

    let effectiveOpts: AgentOpts & { allowedTools?: string[] } = {
      ...req.opts,
      model: eff.model,
      effort: eff.effort,
      timeoutMs: eff.timeoutMs,
    };
    const callerAllowedTools = (req.opts as AgentOpts & { allowedTools?: string[] }).allowedTools;
    // D-F11: the agentType definition's own `tools` frontmatter field is authoritative for the
    // outbound opts.allowedTools — but only when the caller didn't already set one of their own
    // (an explicit per-call opts.allowedTools always wins, same precedence rule `model` follows).
    if (def?.tools !== undefined && callerAllowedTools === undefined) {
      effectiveOpts = { ...effectiveOpts, allowedTools: def.tools };
    } else if (eff.tools !== undefined && callerAllowedTools === undefined) {
      // v21 (DES-102 note): defaults.tools sits directly BELOW agentType in the tool surface —
      // per-call allowedTools > agentType tools > defaults.tools.
      effectiveOpts = { ...effectiveOpts, allowedTools: eff.tools };
    }

    // v21 (REQ-094, DES-102): five-segment composition — [agentType systemPrompt] +
    // [defaults.prompt] + [script prompt] + [framed appendPrompt]. Byte-identical to the prior
    // `${systemPrompt}\n\n${prompt}` / bare `prompt` when defaults.prompt/appendPrompt are absent.
    const effectivePrompt = composePrompt(def?.systemPrompt, req.runParams.prompt, req.prompt, req.runParams.appendPrompt);

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

      await this._sink.capture(req.runId, { agentId: req.agentId, label: effectiveOpts.label, phase: effectiveOpts.phase }, result, this._clock.isoNow());

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
      const decorated: HarnessDescriptor = {
        ...descriptor,
        effort: eff.effort,
        timeoutMs: eff.timeoutMs,
        provenance: eff.provenance,
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
        await store.appendTranscript(req.runId, req.agentId, stored);
      }
      sink.markActivity(req.agentId, ev.ts);
    };
    const invokePromise = this._gateway.invoke({ prompt, opts, runId: req.runId, agentId: req.agentId, signal: req.signal, workspace: req.workspace, onHarness, onEvent });
    const aborted = new Promise<'aborted'>((resolve) => {
      req.signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });
    return Promise.race([invokePromise, aborted]);
  }

  /** D-F12: RunManager calls this the moment it allocates an agentId (before acquireSlot()
   *  resolves) so the in-flight agent is observable via workflow_status as "queued", not absent. */
  markQueued(agentId: string, label?: string, phase?: string, frame?: string): void {
    this._sink.markQueued(agentId, label, phase, frame);
  }

  /** D-F12: RunManager calls this once the agentId's concurrency slot is acquired and it is
   *  genuinely dispatched to the gateway — observable as "running" until capture() resolves it. */
  markRunning(agentId: string, startedAt?: string): void {
    this._sink.markRunning(agentId, startedAt);
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
