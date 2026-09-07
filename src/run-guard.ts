// RunGuard (DES-002). Single-authority caps + budget accounting, shared by orchestration and the agent spawner.
import { AgentCapError, BudgetExceededError } from './errors.js';
import type { Budget } from './types.js';

const AGENT_CAP = 1000;

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
  budget: number | null;
}

export class RunGuard {
  readonly concurrency: number;
  private readonly total: number | null;
  private _spent = 0;
  private _agentsIssued = 0;
  private _inFlight = 0;
  private readonly _queue: Array<() => void> = [];

  constructor(config: RunGuardConfig) {
    this.concurrency = config.concurrency;
    this.total = config.budget;
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

  addTokens(delta: number): void {
    this._spent += delta;
  }

  /** DES-068 (TASK-071): set the already-spent count on resume — called ONCE by the resume path
   *  after folding the persisted journal (sumUsageTokens), never by addTokens again for those
   *  events. Prevents double-counting snapshot tokens already captured before a crash. */
  setSpent(n: number): void {
    this._spent = n;
  }

  budgetView(): Budget {
    const total = this.total;
    const spent = () => this._spent;
    return {
      total,
      spent,
      remaining: () => (total === null ? Infinity : total - spent()),
    };
  }

  /** The ONE budget door: this run has spent its whole allowance, so stop dispatching. Nothing
   *  about reservations, in-flight calls or per-call estimates enters this decision (v25 ruling —
   *  see the header). RunManager calls it immediately before each dispatch and turns the throw into
   *  a `refused` AgentRecord carrying BUDGET_EXCEEDED, so the caller learns why instead of silently
   *  losing a branch. */
  assertBudget(): void {
    if (this.total !== null && this._spent >= this.total) {
      throw new BudgetExceededError(this._spent, this.total);
    }
  }
}
