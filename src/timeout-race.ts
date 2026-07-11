// DES-027 outer timeout race (TASK-033): Promise.race(call, timeoutMs) with kill-on-timeout and
// slot-free-exactly-once (D-V3a #1 HIGH risk, both design panels). Lives inside each GatewayClient
// impl — classification of tool_error/schema_mismatch happens at that call site; this primitive
// only distinguishes timeout vs a rejected call (provider_error). Never smuggles a timeout/error as
// fake success (REQ-020 clause 2): the caller always gets an explicit ok:false FailureEnvelope.
import type { Clock } from './clock.js';

export type FailureKind = 'timeout' | 'provider_error' | 'tool_error' | 'schema_mismatch';

export interface FailureEnvelope {
  kind: FailureKind;
  attempts: number;
  elapsedMs: number;
  providerDetail?: string;
}

export type RaceResult<T> = { ok: true; value: T } | { ok: false; envelope: FailureEnvelope };

export interface AgentSemaphoreLike {
  withSlot<T>(fn: () => Promise<T>): Promise<T>;
}

export interface RaceWithTimeoutOpts {
  clock: Clock;
  timeoutMs: number;
  kill: () => void;
  semaphore: AgentSemaphoreLike;
}

export function raceWithTimeout<T>(call: () => Promise<T>, opts: RaceWithTimeoutOpts): Promise<RaceResult<T>> {
  const { clock, timeoutMs, kill, semaphore } = opts;

  return semaphore.withSlot(async () => {
    const startedAt = clock.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timedOut = new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    const settled = call().then((value) => ({ timedOut: false as const, value }));

    try {
      const winner = await Promise.race([settled, timedOut]);
      if (winner.timedOut) {
        kill();
        return { ok: false, envelope: { kind: 'timeout', attempts: 1, elapsedMs: timeoutMs } };
      }
      return { ok: true, value: winner.value };
    } catch (err) {
      return {
        ok: false,
        envelope: {
          kind: 'provider_error',
          attempts: 1,
          elapsedMs: clock.now() - startedAt,
          providerDetail: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  });
}
