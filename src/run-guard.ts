// RunGuard (DES-002). Single-authority caps + budget accounting, shared by orchestration and the agent spawner.
import { AgentCapError, BudgetExceededError } from './errors.js';
import type { Budget } from './types.js';

const AGENT_CAP = 1000;

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
    if (this._agentsIssued >= AGENT_CAP) {
      throw new AgentCapError();
    }
    this._agentsIssued += 1;
    return `agent-${this._agentsIssued}`;
  }

  addTokens(delta: number): void {
    this._spent += delta;
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

  /** D-G8-6: atomically reserves this run's entire currently-remaining budget for one
   *  about-to-dispatch agent() call — synchronous, no per-call cost estimate needed, so a burst of
   *  concurrent parallel() calls cannot all pass assertBudget() before any one of them has
   *  recorded real spend via addTokens(). No-op (returns 0) when the budget is unbounded. Release
   *  the returned amount via releaseReserved() once the call settles, regardless of its real cost. */
  reserve(): number {
    if (this.total === null) return 0;
    const amount = Math.max(0, this.total - this._spent - this._reserved);
    this._reserved += amount;
    return amount;
  }

  /** Releases a reservation obtained from reserve() — the call's real cost (if any) was already
   *  recorded separately via addTokens(), so this only frees the reservation, never touches _spent. */
  releaseReserved(amount: number): void {
    this._reserved -= amount;
  }
}
