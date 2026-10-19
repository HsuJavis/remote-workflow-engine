// Clock seam (DES-014). FixedClock is implemented — pure value object for tests.
// All kernel code must use the injected Clock; never call Date.now() directly.

export interface Clock {
  now(): number;
  isoNow(): string;
}

/** Fixed-time clock for deterministic unit tests. */
export class FixedClock implements Clock {
  private readonly _ms: number;
  constructor(anchor: Date) {
    this._ms = anchor.getTime();
  }
  now(): number { return this._ms; }
  isoNow(): string { return new Date(this._ms).toISOString(); }
}

/** Production clock — wall-time used ONLY for recording when something happened, never for decisions. */
export class SystemClock implements Clock {
  now(): number { return Date.now(); }     // det:allow — wall timestamp for event recording only
  isoNow(): string { return new Date().toISOString(); } // det:allow — wall timestamp for event recording only
}
