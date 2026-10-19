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
//
// V3-M2 (repair-round defect, 2026-10-06): `value` used to be interpolated unquoted — for a STRING
// value like "8" the message read "… got 8", indistinguishable from the valid number 8. `value` is
// typed `unknown` (not `number | null | undefined`) precisely because JSON.parse can hand this a
// string/boolean/object at runtime despite FileConfig's static type; `JSON.stringify` makes the
// actual runtime type visible ("8" vs 8). The optional `prefix` lets composeConfig() frame the
// message like every other boot refusal ("rwe.config.json: … Refusing to start (ADR-028
// fail-closed)."), while RunManager's own call site (no prefix) keeps its existing plain wording.
export function assertPositiveInteger(
  value: unknown,
  name: string,
  opts?: { prefix?: string },
): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    const label = opts?.prefix !== undefined ? `${opts.prefix}${name}` : name;
    const base = `${label} must be a positive integer, got ${JSON.stringify(value)}`;
    throw new Error(opts?.prefix !== undefined ? `${base}. Refusing to start (ADR-028 fail-closed).` : base);
  }
}
