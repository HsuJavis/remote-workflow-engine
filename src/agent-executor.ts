// AgentExecutor (DES-007 / ARCH-004) + AgentTranscriptSink (DES-008 / TASK-010).
import Ajv from 'ajv';
import type { AgentOpts, AgentRecord, TranscriptEvent } from './types.js';
import type { GatewayClient, GatewayResult } from './gateway/client.js';
import type { RunGuard } from './run-guard.js';
import type { RunStore } from './run-store.js';

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
  ) {}

  private async _emit(runId: string, agentId: string, ev: TranscriptEvent): Promise<void> {
    if (this._store) await this._store.appendTranscript(runId, agentId, ev);
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
  markRunning(agentId: string): void {
    const existing = this._records.get(agentId);
    this._records.set(agentId, { ...(existing ?? { agentId, provider: '', model: '', tokens: { input: 0, output: 0 } }), agentId, state: 'running' });
  }

  /** Records the outcome of one agent() call: captures the usage event and feeds RunGuard.addTokens exactly once. */
  async capture(runId: string, req: { agentId: string; label?: string; phase?: string }, result: GatewayResult, ts: string): Promise<void> {
    const frame = this._records.get(req.agentId)?.frame; // v8 Slice 2: carry the frame set at markQueued
    if (result.ok) {
      const delta = result.tokens.input + result.tokens.output;
      this._guard?.addTokens(delta);
      this._records.set(req.agentId, {
        agentId: req.agentId, label: req.label, phase: req.phase, frame,
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
        agentId: req.agentId, label: req.label, phase: req.phase, frame,
        state: 'failed', provider: result.provider, model: '', tokens: { input: 0, output: 0 },
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
  private readonly _clock: { isoNow(): string };
  private readonly _agentTypes: Record<string, AgentTypeDef>;

  constructor(deps: AgentExecutorDeps = {}) {
    this._gateway = deps.gateway ?? NULL_GATEWAY;
    this._sink = new AgentTranscriptSink(deps.guard, deps.store);
    this._clock = deps.clock ?? { isoNow: () => new Date().toISOString() }; // det:allow — transcript timestamp, not a decision
    this._agentTypes = deps.agentTypes ?? {};
  }

  async run(req: AgentReq): Promise<AgentOutcome> {
    if (req.signal.aborted) return { kind: 'null', aborted: true };

    // D-V5/D-F2: resolve agentType against the server-side registry before any gateway dispatch —
    // a known type's systemPrompt is applied to the outbound prompt (and its `model`, when given,
    // routes the call the same way an explicit opts.model would, unless the caller already set
    // one); an unknown type is a reported error (rejects), never a silent no-op and never a hang.
    let effectivePrompt = req.prompt;
    let effectiveOpts: AgentOpts & { allowedTools?: string[] } = req.opts;
    if (req.opts.agentType !== undefined) {
      const def = this._agentTypes[req.opts.agentType];
      if (!def) throw new Error(`Unknown agentType: ${req.opts.agentType}`);
      effectivePrompt = `${def.systemPrompt}\n\n${req.prompt}`;
      if (def.model !== undefined && req.opts.model === undefined) {
        effectiveOpts = { ...effectiveOpts, model: def.model };
      }
      // D-F11: the agentType definition's own `tools` frontmatter field is authoritative for the
      // outbound opts.allowedTools — but only when the caller didn't already set one of their own
      // (an explicit per-call opts.allowedTools always wins, same precedence rule `model` follows).
      if (def.tools !== undefined && (req.opts as AgentOpts & { allowedTools?: string[] }).allowedTools === undefined) {
        effectiveOpts = { ...effectiveOpts, allowedTools: def.tools };
      }
    }

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
      const outcome = await this._invokeOnce(req, prompt, effectiveOpts);
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

  private async _invokeOnce(req: AgentReq, prompt: string, opts: AgentOpts): Promise<GatewayResult | 'aborted'> {
    // D-V2V-1: forward the run's own workspace — only ClaudeAgentSdkGatewayClient consumes it
    // (per-call cwd re-scoping + asset materialization); other gateways ignore the extra field.
    const invokePromise = this._gateway.invoke({ prompt, opts, runId: req.runId, agentId: req.agentId, signal: req.signal, workspace: req.workspace });
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
  markRunning(agentId: string): void {
    this._sink.markRunning(agentId);
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
