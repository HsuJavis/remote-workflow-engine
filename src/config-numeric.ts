// Issue audit A9/B4/B21 (owner decision 2026-10-06): the ONE positive-integer rule every caller
// that validates a ceiling/cap config value uses — extracted from RunManager's own previously
// PRIVATE `_positiveInt` static so `composeConfig()` can reach the identical rule at `--check-config`
// time (RunManager's own check only ever ran once `createServer()` constructed it, which
// `--check-config` never reaches). "One shared validator, no duplicated rules" (A9): a second
// hand-written copy of "must be a positive integer" is exactly the drift risk this module removes.
// Pure: no I/O, no clock.
// Repair round defect NULL-WAS-DEFAULT (2026-10-06): before the A9/B4/B21 guards above were added,
// an explicit JSON `null` for any of these keys meant "use the default" (each call site fell back
// via `?? <default>`). `value === undefined` alone treats an explicit `null` as a PRESENT bad value
// and refuses a config that used to boot clean — `value == null` (matches both) is what "no
// behaviour change for valid configs" actually requires.
export function assertPositiveInteger(value: number | null | undefined, name: string): void {
  if (value == null) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
}
