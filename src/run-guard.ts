// RunGuard (DES-002). Single-authority caps + budget accounting, shared by orchestration and the agent spawner.
import { AgentCapError, BudgetExceededError } from './errors.js';
import type { Budget } from './types.js';

const AGENT_CAP = 1000;

// D-V2G8-2 (review finding V4): fraction of the TOTAL budget each agent() call reserves ahead of
// dispatch. There's no per-call cost estimate, so reserve() takes a flat share rather than the whole
// remainder — reserving 100% collapsed parallel() to 1 concurrent call; a HALF lets a burst push at
// most 2 calls' reservations through before the 3rd hits a real assertBudget() check against what's
// actually left. Restores genuine concurrency while still hard-capping overshoot on a tight budget.
const RESERVATION_FRACTION = 0.5;

export interface RunGuardConfig {
  concurrency: number;
  budget: number | null;
}

export class RunGuard {
  readonly concurrency: number;
  private readonly total: number | null;
  private _spent = 0;
  private _reserved = 0;
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

  assertBudget(): void {
    if (this.total !== null && this._spent + this._reserved >= this.total) {
      throw new BudgetExceededError(this._spent, this.total);
    }
  }

  /** Atomically reserves a per-call share (RESERVATION_FRACTION of the total budget, capped at what's
   *  actually left) for one about-to-dispatch agent() call — synchronous, no `await` before the
   *  caller's own assertBudget() check, so a burst of concurrent parallel() calls cannot all pass
   *  assertBudget() before any one of them has recorded real spend via addTokens(). See
   *  RESERVATION_FRACTION (top of file) for why a flat fraction, not the whole remainder (D-V2G8-2,
   *  review finding V4). No-op (returns 0) when the budget is unbounded. Release the returned amount
   *  via releaseReserved() once the call settles, regardless of its real cost. */
  reserve(): number {
    if (this.total === null) return 0;
    const remaining = Math.max(0, this.total - this._spent - this._reserved);
    const amount = Math.min(remaining, this.total * RESERVATION_FRACTION);
    this._reserved += amount;
    return amount;
  }

  /** Releases a reservation obtained from reserve() — the call's real cost (if any) was already
   *  recorded separately via addTokens(), so this only frees the reservation, never touches _spent. */
  releaseReserved(amount: number): void {
    this._reserved -= amount;
  }
}
