// D-DOS: process-global agent-slot semaphore (TASK-035, DES-027/ARCH-002).
// ONE instance is built at the composition root and passed by reference into every RunGuard —
// never a module-level static — so it stays injectable/resettable for tests while still rationing
// SDK-CLI subprocess spawns globally. FIFO queue: a single greedy caller can queue others out
// (documented accepted single-node behavior).

export interface SemaphoreGauge {
  total: number;
  inUse: number;
  queued: number;
}

export interface Semaphore {
  gauge(): SemaphoreGauge;
  withSlot<T>(fn: () => Promise<T>): Promise<T>;
}

export function createSemaphore(total: number): Semaphore {
  let inUse = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (inUse < total) {
      inUse++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        inUse++;
        resolve();
      });
    });
  }

  function release(): void {
    inUse--;
    const next = queue.shift();
    if (next) next();
  }

  return {
    gauge(): SemaphoreGauge {
      return { total, inUse, queued: queue.length };
    },
    async withSlot<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
