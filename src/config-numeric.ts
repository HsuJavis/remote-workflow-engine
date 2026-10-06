// Issue audit A9/B4/B21 (owner decision 2026-10-06): the ONE positive-integer rule every caller
// that validates a ceiling/cap config value uses — extracted from RunManager's own previously
// PRIVATE `_positiveInt` static so `composeConfig()` can reach the identical rule at `--check-config`
// time (RunManager's own check only ever ran once `createServer()` constructed it, which
// `--check-config` never reaches). "One shared validator, no duplicated rules" (A9): a second
// hand-written copy of "must be a positive integer" is exactly the drift risk this module removes.
// Pure: no I/O, no clock.
export function assertPositiveInteger(value: number | undefined, name: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
}
