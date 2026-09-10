// RunGuard (DES-002). Single-authority caps + budget accounting, shared by orchestration and the agent spawner.
import { AgentCapError, BudgetExceededError, codedError } from './errors.js';
import type { Budget, FourRates, RunUsage, Tokens, TranscriptEvent } from './types.js';

const AGENT_CAP = 1000;

// v26 (DES-180, ARCH-118, TASK-180): the four-column zero, canonical export — `AgentTranscriptSink`
// (agent-executor.ts) and every derive branch (DES-188) import THIS one rather than each declaring
// their own literal, so "what counts as a known zero" cannot drift between writers.
export const ZERO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** v26 (DES-180): pure — the four-column total, used for the dashboard cell and for the
 *  1000-calls-summed-correctly float check. */
export function sumTokens(t: Tokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

/** v26 (DES-180, ARCH-118): pure — `Σ tokens[k] × rates[k]`. `rates: null` means "we don't know
 *  this model's price" and yields `null` (never `0` — an unknown price and a genuinely free model
 *  must stay distinguishable); an all-zero `FourRates` (ollama, a free openrouter route) is a KNOWN
 *  price and correctly yields `0`. `null` is meant to survive exactly this one hop — the caller
 *  collapses it to `{costUSD: 0, unpriced: true}` at the capture site, never further upstream. */
export function priceCall(tokens: Tokens, rates: FourRates | null): number | null {
  if (rates === null) return null;
  return tokens.input * rates.in + tokens.output * rates.out + tokens.cacheRead * rates.cacheRead + tokens.cacheWrite * rates.cacheWrite;
}

/** v26 (DES-183, ARCH-118, ADR-046/047, TASK-183, REQ-127): pure — the "at rest" `RunUsage`
 *  producer, folded over one run's PERSISTED transcript events (every agent's, flattened). Never
 *  throws. Two column groups, two rules — the SAME split the LIVE fold (`foldUsageFromRecords`,
 *  run-manager.ts) applies to records, so the two cannot disagree:
 *   - **tokens / costUSD / unpricedCalls** count only on a usage event carrying `tokens`, i.e. a
 *     `done` call (DES-180: "a failed call carries no usage and moves no counter"). `unpriced`
 *     follows the SAME rule `deriveAgentRecords` (run-store.ts) applies to its `done` branch —
 *     absent means "pre-v26 event", read as unpriced, never as free. The live fold spells this
 *     `r.state === 'done'`; the two spellings are ONE rule, because a `tokens` field on a usage
 *     event is exactly what makes `deriveAgentRecords` derive `state: 'done'` (and `capture()`
 *     writes `tokens`/`costUSD`/`unpriced` together, unconditionally, on that one event) —
 *     DES-183's "`unpricedCalls` follows ONE rule … applied by the guard live and by `foldUsage`
 *     at rest".
 *   - **unmappedMessages** counts on EVERY usage event, tokens or not — v26 R-1: the failed branch
 *     emits `unmapped` with no `tokens` (M-2), and the live fold counts `r.unmapped` on records of
 *     every state, so gating this column on `tokens` is precisely how the two folds disagreed on a
 *     whole column. Names only, never values (the sanitized-subtype injection guard). */
export function foldUsage(events: TranscriptEvent[]): RunUsage {
  const tokens: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let costUSD = 0;
  let unpricedCalls = 0;
  const unmappedMessages: Record<string, number> = {};
  for (const ev of events) {
    if (ev.kind !== 'usage') continue;
    const data = ev.data as {
      tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
      costUSD?: number; unpriced?: boolean; unmapped?: string[];
    };
    // v26 (R-1): ABOVE the tokens guard on purpose — a terminally-failed call's unmapped provider
    // chatter is the call whose chatter matters most, and it rides a usage event with no `tokens`.
    for (const name of data.unmapped ?? []) {
      unmappedMessages[name] = (unmappedMessages[name] ?? 0) + 1;
    }
    if (!data.tokens) continue; // failed/no-tokens usage event — moves no token/cost/unpriced counter
    tokens.input += data.tokens.input ?? 0;
    tokens.output += data.tokens.output ?? 0;
    tokens.cacheRead += data.tokens.cacheRead ?? 0;
    tokens.cacheWrite += data.tokens.cacheWrite ?? 0;
    costUSD += data.costUSD ?? 0;
    if (data.unpriced ?? true) unpricedCalls += 1;
  }
  return { tokens, costUSD, unpricedCalls, unmappedMessages };
}

/** v26 (DES-181, ARCH-118, ADR-037, TASK-181, REQ-127/REQ-120): the ONE door a `budget` value
 *  passes through, on either side of the store boundary — `'wire'` (a fresh admission, still ajv-
 *  unvalidated) and `'store'` (a persisted/resumed row) mean DIFFERENT things for a bare NUMBER,
 *  the v25 shape: a wire number is refused (the v26 breaking change — send `{tokens: N}` instead),
 *  a store number REHYDRATES as `{usd: null, tokens: N}`, its true v25 meaning, so an in-flight
 *  pre-v26 run resumes under the same limit it started with. `null`/`undefined` mean unbounded on
 *  both sides — the schema must keep accepting `null` (see DES-181 boundary). An object is
 *  validated the same way on both sides: no unknown keys, at least one of `usd`/`tokens` present
 *  (an empty object is refused — "explicitly no limits" is spelled `null`, never `{}`), each
 *  non-negative when present. */
export function parseBudget(v: unknown, opts: { source: 'wire' | 'store' }): { usd: number | null; tokens: number | null } {
  if (v === null || v === undefined) return { usd: null, tokens: null };
  if (typeof v === 'number') {
    if (opts.source === 'store') return { usd: null, tokens: v };
    throw codedError(
      'INVALID_ARGUMENT',
      `INVALID_ARGUMENT: budget is an object since v26: {usd?: <USD>, tokens?: <tokens>}; a bare number was a TOKEN limit — send {tokens: ${v}}`,
      { param: 'budget', supplied: v, migration: { tokens: v } },
    );
  }
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw codedError('INVALID_ARGUMENT', 'INVALID_ARGUMENT: budget must be null, a number (legacy store rows only), or {usd?, tokens?}', { param: 'budget' });
  }
  const obj = v as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k !== 'usd' && k !== 'tokens') {
      throw codedError('INVALID_ARGUMENT', `INVALID_ARGUMENT: budget has unknown key '${k}'`, { param: 'budget' });
    }
  }
  if (Object.keys(obj).length === 0) {
    throw codedError('INVALID_ARGUMENT', 'INVALID_ARGUMENT: budget object must set at least one of usd/tokens (omit budget, or pass null, for unbounded)', { param: 'budget' });
  }
  // `null` (not only `undefined`) means "not set" per-field too — this is what makes the shape
  // ROUND-TRIP: `parseBudget`'s own output for `{tokens:5000}` is `{usd:null, tokens:5000}`, and a
  // persisted/resumed row IS that exact object read back from the store on 'store' source.
  const parseField = (key: 'usd' | 'tokens'): number | null => {
    const field = obj[key];
    if (field === undefined || field === null) return null;
    if (typeof field !== 'number' || !Number.isFinite(field) || field < 0) {
      throw codedError('INVALID_ARGUMENT', `INVALID_ARGUMENT: budget.${key} must be a non-negative number`, { param: `budget.${key}` });
    }
    return field;
  };
  return { usd: parseField('usd'), tokens: parseField('tokens') };
}

// v25 (DES-167, REQ-120, issue #61, OWNER RULING 2026-09-07): there is no reservation here any
// more, and there must not be one again.
//
// What was here: `RESERVATION_FRACTION = 0.5`, `reserve()`, `releaseReserved()` and a `_reserved`
// counter. Each about-to-dispatch agent() call reserved half the TOTAL budget, so two concurrent
// calls reserved 100% and the THIRD call's `assertBudget()` threw BudgetExceededError however
// little had actually been spent. Arithmetic, not a race: every budgeted `parallel()` wider than 2
// silently lost every branch past the second (issue #61, run a88e5d07).
//
// Why the whole mechanism is gone rather than re-tuned: what one call will cost is unknowable
// before it finishes, so any per-call reservation is a guess — guess high and you cap fan-out
// (the bug), guess low and you protect nothing. Learning the estimate from the run's own history
// does not rescue it either: a workflow whose FIRST act is an N-wide fan-out has no observation
// yet, so the bootstrap value becomes the new cap in exactly the case being fixed. An engine should
// not pretend to a guarantee it cannot hold.
//
// The two concerns are now separate, each held by the thing that can actually hold it:
//   - CONCURRENCY is capped by `acquireSlot()` below, which QUEUES at the cap rather than refusing
//     (the reservation arithmetic was what silently cut that cap from 14 to 2 on the owner's host);
//   - BUDGET is the run's total spend: `assertBudget()` checks `spent >= total`, nothing else.
// So a budget is a STOP-DISPATCHING signal, not a hard ceiling: calls already in flight can
// overshoot it by at most one concurrency window (concurrency × one call's cost). That is exactly
// what the engine can enforce, and `workflow_authoring_guide` says so in those words.

export interface RunGuardConfig {
  concurrency: number;
  // v26 (DES-181, ARCH-118, TASK-181): two INDEPENDENT limits, `{usd, tokens}` — the shape
  // `parseBudget` produces. The bare-`number` arm is kept ONLY so a caller that already holds a
  // legacy token count (a direct construction, e.g. many pre-v26 tests) does not need to wrap it —
  // normalized below exactly as `parseBudget(n, {source:'store'})` would: a plain number is a TOKEN
  // limit, never USD.
  budget: number | { usd: number | null; tokens: number | null } | null;
}

export class RunGuard {
  readonly concurrency: number;
  private readonly _totalUsd: number | null;
  private readonly _totalTokens: number | null;
  private _spentUsd = 0;
  private _spentTokens = 0;
  private _unpriced = 0;
  private _agentsIssued = 0;
  private _inFlight = 0;
  private readonly _queue: Array<() => void> = [];

  constructor(config: RunGuardConfig) {
    this.concurrency = config.concurrency;
    const b = config.budget;
    if (typeof b === 'number') {
      this._totalUsd = null;
      this._totalTokens = b;
    } else {
      this._totalUsd = b?.usd ?? null;
      this._totalTokens = b?.tokens ?? null;
    }
  }

  acquireSlot(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this._inFlight += 1;
        resolve(() => this.release());
      };
      if (this._inFlight < this.concurrency) {
        grant();
      } else {
        this._queue.push(grant);
      }
    });
  }

  private release(): void {
    this._inFlight -= 1;
    const next = this._queue.shift();
    if (next) next();
  }

  nextAgentId(): string {
    // AGENT_CAP is a PER-RUN runaway-loop backstop (one workflow must not spawn >1000 agents over
    // its whole life). The HOST-wide concurrency bound that review finding V2 was about — the one K
    // runs must not multiply — is the process-global AgentSemaphore (D-DOS, 02-architecture.md §D-DOS),
    // shared by every run and wrapping each real dispatch in RunManager. These are different caps:
    // this one bounds a single run's lifetime issuance; the semaphore bounds concurrent host spawns.
    if (this._agentsIssued >= AGENT_CAP) {
      throw new AgentCapError();
    }
    this._agentsIssued += 1;
    return `agent-${this._agentsIssued}`;
  }

  /** The single token accumulator. `addUsage` (below) folds its four columns through HERE rather
   *  than touching `_spentTokens` itself, so there is exactly one place a token total can move —
   *  and UT-008's spy on this method still observes the real per-call delta now that the capture
   *  site calls `addUsage`. Still callable on its own by a caller that only holds a scalar. */
  addTokens(delta: number): void {
    this._spentTokens += delta;
  }

  /** v26 (DES-181, ARCH-118, TASK-181): the two-limit accounting door — accumulates UNCONDITIONALLY,
   *  whether or not a limit is armed (the v25 tracking-without-a-cap principle, now also ADR-047(b)'s
   *  reason every trigger-started run must still be tracked). `unmapped` is accepted for the DES-181
   *  signature but NOT accumulated here — the read-path fold (DES-183, TASK-183) counts unmapped
   *  messages from the persisted journal, not from this live guard. Neither `unmapped` nor `_unpriced`
   *  affects either limit. */
  addUsage(tokens: Tokens, costUSD: number, unpriced: boolean, _unmapped?: string[]): void {
    this._spentUsd += costUSD;
    this.addTokens(sumTokens(tokens));
    if (unpriced) this._unpriced += 1;
  }

  /** DES-068 (TASK-071): set the already-spent totals on resume — called ONCE by the resume path
   *  after folding the persisted journal, never by addTokens/addUsage again for those events.
   *  Prevents double-counting snapshot tokens already captured before a crash.
   *
   *  v26 integration (DES-181/DES-183): widened from a bare token count to `{usd, tokens}`. The
   *  resume path folds with `foldUsage` (four columns + USD), so a resumed run re-arms BOTH limits
   *  at the same numbers a fresh run would have reached; hydrating tokens alone left `_spentUsd` at
   *  0 and the USD arm of `assertBudget` unenforced for the whole rest of a resumed run. The bare-
   *  number arm survives for a caller that genuinely only holds a token count. */
  setSpent(spent: number | { usd: number; tokens: number }): void {
    if (typeof spent === 'number') {
      this._spentTokens = spent;
      return;
    }
    this._spentUsd = spent.usd;
    this._spentTokens = spent.tokens;
  }

  /** v25-shaped view, unchanged: today's only consumer (the sandbox script-visible `budget` object,
   *  DES-182/TASK-182) has always meant TOKENS by "total" — the pre-v26 `budget` shape had no other
   *  meaning. `total`/`.total` here is never USD; a run with only a USD limit reports `total: null`. */
  budgetView(): Budget {
    const total = this._totalTokens;
    const spent = () => this._spentTokens;
    return {
      total,
      spent,
      remaining: () => (total === null ? Infinity : total - spent()),
    };
  }

  /** The ONE budget door: this run has spent its whole allowance on EITHER of the two independent
   *  limits, so stop dispatching. Nothing about reservations, in-flight calls or per-call estimates
   *  enters this decision (v25 ruling — see the header). RunManager calls it immediately before each
   *  dispatch and turns the throw into a `refused` AgentRecord carrying BUDGET_EXCEEDED, so the
   *  caller learns why instead of silently losing a branch. */
  assertBudget(): void {
    if (this._totalUsd !== null && this._spentUsd >= this._totalUsd) {
      throw new BudgetExceededError({ limit: 'usd', spent: this._spentUsd, total: this._totalUsd });
    }
    if (this._totalTokens !== null && this._spentTokens >= this._totalTokens) {
      throw new BudgetExceededError({ limit: 'tokens', spent: this._spentTokens, total: this._totalTokens });
    }
  }
}
