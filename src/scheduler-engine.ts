// Scheduler firing engine (DES-017 / ARCH-010 / TASK-024): the clock/boundary-heavy half of the
// scheduler. `tick(schedules, now)` is a PURE function of persisted schedules + `now` — it decides
// what is due, it never starts a run itself (the impure driver loop does that). Every method that
// reads time takes the injected Clock explicitly (Exit-Gate-5 seam consistency, DES-014) — this
// module never calls `Date.now()`/`setTimeout` itself. // det:allow — a comment naming the API, not a call
import type { Clock } from './clock.js';
import { codedError } from './errors.js';

/** The persisted schedule shape this engine operates on (a superset of scheduler.ts's own CRUD
 *  `Schedule` type: cron/once variants carry a persisted `nextFire` computed field; `resident`
 *  schedules have no time field — they are trigger-only, never returned by `tick()`). */
export type StoredSchedule =
  | { kind: 'cron'; id: string; workflow: string; args?: unknown; cron: string; tz?: string; enabled: boolean; nextFire: number }
  | { kind: 'once'; id: string; workflow: string; args?: unknown; at: string; enabled: boolean; nextFire: number }
  | { kind: 'resident'; id: string; workflow: string; args?: unknown; enabled: boolean };

export interface ScheduleFiring {
  id: string;
  workflow: string;
  args?: unknown;
  kind: StoredSchedule['kind'];
}

/** PURE: which enabled, due (`nextFire <= now`) cron/once schedules should fire right now.
 *  Residents never fire here (trigger-only, DES-016). Missed-fire catch-up (a schedule whose
 *  `nextFire` is minutes/hours in the past) still returns it exactly ONCE — the caller is
 *  responsible for recomputing a fresh `nextFire` after firing (fire-once-then-resume, never
 *  backfill every missed slot). */
export function tick(schedules: StoredSchedule[], now: number): ScheduleFiring[] {
  const firings: ScheduleFiring[] = [];
  for (const s of schedules) {
    if (!s.enabled) continue;
    if (s.kind === 'resident') continue;
    if (s.nextFire > now) continue;
    firings.push({ id: s.id, workflow: s.workflow, args: s.args, kind: s.kind });
  }
  return firings;
}

// Exported (issue #92 item 1): `scheduler.ts`'s create-time validator reuses these SAME bounds via
// `parseCron` below, rather than hand-duplicating a second guess at each field's range.
export const CRON_FIELD_NAMES = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'] as const;
export const CRON_FIELD_MIN = [0, 0, 1, 1, 0]; // minute, hour, day-of-month, month, day-of-week
export const CRON_FIELD_MAX = [59, 23, 31, 12, 6];
// No Sunday alias: `7` for day-of-week is NOT normalized to `0` — checked against the live
// behaviour this replaces (issue #92 item 1's "keep behaviour" instruction). Pre-fix, `7` passed
// the old syntax-only regex, landed in the dow set as the literal value 7, and — since `fieldsAt`
// only ever yields 0-6 — never matched anything, so a `* * * * 7` cron silently never fired (the
// SAME "never fires" class as `0 0 31 2 *`/Feb 31, just discovered by the horizon scan instead of
// the semantic check below). Below, `7` is refused up front as "day-of-week out of range 0-6"
// instead of being accepted and then quietly starving — an earlier, clearer refusal for the exact
// same non-functional input, not a new alias.

// One comma-separated cron token: `*`, a bare number, or a range `a-b`, each with an optional
// `/step`. Anchored so a malformed token can never reach `Number()`, which is silently permissive
// in ways that used to parse instead of refuse — `Number('')` is `0` (an empty part from a stray
// `1,,2`), `Number('abc')` is `NaN` (a non-numeric field yields an empty, never-matching set).
const CRON_TOKEN = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/;

/** Parses one 5-field cron field (a star, a number, a range `a-b`, a step suffix `/n` on either a
 *  star or a range, or a comma list of the above) into the concrete set of allowed values.
 *
 *  Defence in depth (issue #92 item 1): throws a typed `INVALID_CRON` — NEVER loops — on a step
 *  less than 1 (closes the step-zero infinite-loop freeze: the old `for (v = lo; v <= hi; v += step)`
 *  never terminated when `step` was 0) or any value outside `[min, max]` / a range with `a > b`. The
 *  create-time door (`scheduler.ts`'s `validateCron`, via `parseCron` below) already refuses these
 *  before a row is ever written — this function throws too because it is also reached directly
 *  against a STORED row (`claimFiring`'s fire path, boot re-arm) that may predate that door, e.g. a
 *  row written before this validation existed. */
function parseCronField(field: string, min: number, max: number, fieldName: string): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const m = CRON_TOKEN.exec(part);
    if (!m) {
      throw codedError('INVALID_CRON', `Invalid cron ${fieldName} field "${field}": "${part}" is not "*", a number, or a range, optionally with "/step"`);
    }
    const rangePart = m[1]!;
    const stepPart = m[2];
    const step = stepPart !== undefined ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw codedError('INVALID_CRON', `Invalid cron ${fieldName} field "${field}": step must be an integer >= 1, got "${stepPart}"`);
    }
    let lo = min;
    let hi = max;
    if (rangePart !== '*') {
      const [a, b] = rangePart.split('-');
      lo = Number(a);
      hi = b !== undefined ? Number(b) : lo;
    }
    if (lo > hi || lo < min || hi > max) {
      throw codedError('INVALID_CRON', `Invalid cron ${fieldName} field "${field}": value(s) out of range [${min}, ${max}]`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

interface CronFieldSets {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

/** Parses AND semantically validates a full 5-field cron expression — the ONE grammar every
 *  reader of a cron string goes through (`scheduler.ts`'s create-time `validateCron`,
 *  `computeNextFire` below, and transitively `claimFiring`/boot re-arm), so a rule can never drift
 *  between "what create() accepts" and "what the engine actually parses". Throws a typed
 *  `INVALID_CRON` naming the offending field — a wrong field count (previously an uncaught
 *  `fields[1]!.split` TypeError on e.g. a 3-field string) included. */
export function parseCron(cron: string): CronFieldSets {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw codedError('INVALID_CRON', `Invalid cron expression "${cron}": expected 5 space-separated fields (minute hour day-of-month month day-of-week), got ${fields.length}`);
  }
  return {
    minute: parseCronField(fields[0]!, CRON_FIELD_MIN[0]!, CRON_FIELD_MAX[0]!, CRON_FIELD_NAMES[0]),
    hour: parseCronField(fields[1]!, CRON_FIELD_MIN[1]!, CRON_FIELD_MAX[1]!, CRON_FIELD_NAMES[1]),
    dom: parseCronField(fields[2]!, CRON_FIELD_MIN[2]!, CRON_FIELD_MAX[2]!, CRON_FIELD_NAMES[2]),
    month: parseCronField(fields[3]!, CRON_FIELD_MIN[3]!, CRON_FIELD_MAX[3]!, CRON_FIELD_NAMES[3]),
    dow: parseCronField(fields[4]!, CRON_FIELD_MIN[4]!, CRON_FIELD_MAX[4]!, CRON_FIELD_NAMES[4]),
  };
}

// issue #92 item 1: `computeNextFire`'s horizon scan (below) can call `fieldsAt` up to
// `MAX_MINUTES_AHEAD` (~2.1M) times for a single cron that never matches (e.g. `0 0 31 2 *`, day-
// of-month=31 AND month=2, which no calendar date ever satisfies) — a `new Intl.DateTimeFormat(...)`
// per call, at that count, is itself a multi-second-to-minute stall (measured: ~2.1M constructions
// of the exact options object below run well past a minute on this host), i.e. a SECOND freeze door
// the semantic field validation above does not close (that door catches out-of-range VALUES; a
// never-satisfiable COMBINATION of otherwise-valid fields still reaches this scan). One formatter
// per distinct `tz` is enough — `Intl.DateTimeFormat` has no mutable state `formatToParts` could
// leak between calls, so reuse across every `ms` is safe.
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtfFor(tz: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23', weekday: 'short',
    });
    dtfCache.set(tz, dtf);
  }
  return dtf;
}

/** Reads a UTC instant's minute/hour/day/month/weekday IN a given IANA timezone (default UTC)
 *  without any external cron/timezone dependency — `Intl.DateTimeFormat` already carries the
 *  platform's own tz database. */
function fieldsAt(ms: number, tz: string | undefined): { minute: number; hour: number; dom: number; month: number; dow: number } {
  const d = new Date(ms);
  if (!tz) {
    return { minute: d.getUTCMinutes(), hour: d.getUTCHours(), dom: d.getUTCDate(), month: d.getUTCMonth() + 1, dow: d.getUTCDay() };
  }
  const parts = dtfFor(tz).formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minute: Number(get('minute')),
    hour: Number(get('hour')),
    dom: Number(get('day')),
    month: Number(get('month')),
    dow: weekdayMap[get('weekday')] ?? 0,
  };
}

const ONE_MINUTE_MS = 60_000;
// Bounded search horizon — a 5-field cron always has a next fire within 4 years (covers Feb 29).
const MAX_MINUTES_AHEAD = 4 * 366 * 24 * 60;

const DAYS_IN_MONTH: Record<number, number> = { 1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 }; // Feb uses 29 (leap-year max)

/** issue #92 item 1: a cheap analytical short-circuit for the most common "never fires" mistake
 *  (the issue's own worked example — `0 0 31 2 *`, day-of-month 31 in February, which has at most
 *  29 days in any year). If every selected month's max day count is smaller than every selected
 *  day-of-month value, no calendar date can EVER satisfy the cron — full stop, not "not within the
 *  search horizon". Checked BEFORE the minute-by-minute scan below: at
 *  `MAX_MINUTES_AHEAD` (~2.1M) iterations even a cached-formatter `fieldsAt` (see `dtfFor` above)
 *  measured ~15s wall time for a `tz`-bearing cron — this turns that into an O(|dom| * |month|)
 *  check (at most 31*12) that returns before the loop ever starts.
 *
 *  Not exhaustive: a `dow` value that never coincides with an otherwise-satisfiable `dom`/`month`
 *  still falls through to the bounded scan (structurally near-impossible — weekdays cycle
 *  independently of the calendar date, so any achievable dom/month eventually lands on every dow
 *  within a 4-year/leap cycle) — this covers the one class this dialect's error catalog and the
 *  reported issue actually name, not every conceivable unsatisfiable combination. */
function hasPossibleDate(sets: CronFieldSets): boolean {
  for (const month of sets.month) {
    const maxDay = DAYS_IN_MONTH[month] ?? 31;
    for (const dom of sets.dom) {
      if (dom <= maxDay) return true;
    }
  }
  return false;
}

const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
// Same 4-year horizon as MAX_MINUTES_AHEAD, expressed in hours (~35,136).
const MAX_HOURS_AHEAD = 4 * 366 * 24;

/** issue #92 follow-up (part A residual DoS): a cron that passes `hasPossibleDate` (the date exists
 *  in principle) can still fail to match ANY instant within the 4-year horizon once `dow` is ANDed
 *  in — e.g. `0 0 29 2 1` (Feb 29 that also falls on a Monday): most 4-year windows contain zero or
 *  one Feb 29, and it is a Monday in only 1 of 7 possible weekday alignments, so the minute-by-minute
 *  scan below used to run its full ~2.1M iterations (measured ~15s even with a cached tz formatter,
 *  §`dtfFor`) before throwing — an event-loop stall on ANY caller's input, not just a malformed one.
 *
 *  Reference (obviously-correct, NOT DoS-safe) implementation, kept only so `computeNextFire`'s
 *  optimized search below can be property-tested against it for identical results — see
 *  `tests/unit/scheduler-engine.test.ts`'s cross-check suite. Never called in production. */
export function computeNextFireBruteForce(cron: string, tz: string | undefined, after: number): number {
  const sets = parseCron(cron);
  let candidate = Math.floor(after / ONE_MINUTE_MS) * ONE_MINUTE_MS + ONE_MINUTE_MS;
  for (let i = 0; i < MAX_MINUTES_AHEAD; i++) {
    const f = fieldsAt(candidate, tz);
    if (sets.minute.has(f.minute) && sets.hour.has(f.hour) && sets.dom.has(f.dom) && sets.month.has(f.month) && sets.dow.has(f.dow)) {
      return candidate;
    }
    candidate += ONE_MINUTE_MS;
  }
  throw new Error(`computeNextFireBruteForce: no match found for cron "${cron}" within the search horizon`);
}

/** PURE named helper: the next minute-boundary timestamp strictly after `after` that matches
 *  `cron` (interpreted in `tz`, default UTC). Minute-granularity, matching this cron dialect's own
 *  precision.
 *
 *  Two-level search (issue #92 follow-up), NOT a plain minute-by-minute scan: an OUTER loop steps
 *  by whole HOURS (≤ `MAX_HOURS_AHEAD`, ~35k, vs. the ~2.1M-minute brute force above) checking only
 *  month/dom/dow/hour at each hour-spaced checkpoint; only when those 4 fields match does an INNER
 *  loop check all 60 minutes of that checkpoint's own local hour.
 *
 *  Why this is safe for a NON-whole-hour tz offset (Asia/Kolkata is UTC+5:30) and for DST (America/
 *  New_York): the outer checkpoints are spaced exactly one real UTC hour apart, all sharing `after`'s
 *  own minute-of-hour (adding whole hours never changes minute-of-hour). A local "hour block" (all
 *  60 local minutes sharing one date+hour reading) is always either 60 real minutes wide (the normal
 *  case), 120 minutes wide (a DST "fall back" repeated hour), or 0 minutes wide (a DST "spring
 *  forward" skipped hour — no checkpoint can ever land in an hour that does not exist, correctly).
 *  A non-empty block's width is therefore always >= the 60-minute checkpoint spacing, so by a
 *  pigeonhole argument (points spaced <= a window's width cannot all miss that window) at least one
 *  checkpoint is GUARANTEED to land inside every such block — this fix cannot introduce a false
 *  negative (a skipped real match), only skip hour-blocks it can prove have no chance. Once a
 *  checkpoint lands inside a block, the block's true boundaries are reconstructed from that
 *  checkpoint's OWN observed local minute-of-hour (`f.minute`) — not assumed to start at the
 *  checkpoint — so the inner scan covers the block's real start, not an offset window (the bug an
 *  earlier draft of this fix had for Kolkata: scanning the 60 minutes highlighted at the checkpoint,
 *  rather than the 60 minutes of the checkpoint's OWN local hour, silently skips part of the true
 *  window under a fractional-hour offset). Verified against the brute-force reference above by a
 *  property test across UTC/America/New_York/Asia/Kolkata and various cron shapes. */
export function computeNextFire(cron: string, tz: string | undefined, after: number): number {
  const sets = parseCron(cron);
  if (!hasPossibleDate(sets)) {
    throw new Error(`computeNextFire: cron "${cron}" can never match any calendar date — every selected day-of-month value exceeds the maximum day count of every selected month`);
  }
  let hourCandidate = Math.floor(after / ONE_MINUTE_MS) * ONE_MINUTE_MS + ONE_MINUTE_MS;
  for (let h = 0; h < MAX_HOURS_AHEAD; h++) {
    const f = fieldsAt(hourCandidate, tz);
    if (sets.month.has(f.month) && sets.dom.has(f.dom) && sets.dow.has(f.dow) && sets.hour.has(f.hour)) {
      // `hourCandidate` sits `f.minute` minutes into its own local hour block — reconstruct the
      // block's true start rather than assuming `hourCandidate` itself is minute 0 of it.
      const blockStart = hourCandidate - f.minute * ONE_MINUTE_MS;
      for (let m = 0; m < 60; m++) {
        const candidate = blockStart + m * ONE_MINUTE_MS;
        if (candidate <= after) continue; // strictly after `after`, matching the brute-force contract
        const mf = candidate === hourCandidate ? f : fieldsAt(candidate, tz);
        if (sets.minute.has(mf.minute) && sets.hour.has(mf.hour) && sets.dom.has(mf.dom) && sets.month.has(mf.month) && sets.dow.has(mf.dow)) {
          return candidate;
        }
      }
    }
    hourCandidate += ONE_HOUR_MS;
  }
  throw new Error(`computeNextFire: no match found for cron "${cron}" within the search horizon`);
}

/** Ticker port (DES-017): the one impure driver primitive. Real = `setInterval`; `FakeTicker`
 *  drives ticks deterministically via `advance()` in tests (no wallclock waiting, ever). */
export interface Ticker {
  start(cb: () => void): void;
  stop(): void;
}

/** Real setInterval-backed ticker — the production driver loop's own impure edge. */
export class RealTicker implements Ticker {
  private _handle: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly intervalMs: number = 1000) {}
  start(cb: () => void): void {
    this._handle = setInterval(cb, this.intervalMs);
  }
  stop(): void {
    if (this._handle) clearInterval(this._handle);
    this._handle = undefined;
  }
}

/** Deterministic fake ticker for tests: `advance()` synchronously invokes the registered callback
 *  once (simulating one tick), `stop()` unregisters it. */
export class FakeTicker implements Ticker {
  private _cb: (() => void) | undefined;

  start(cb: () => void): void {
    this._cb = cb;
  }

  stop(): void {
    this._cb = undefined;
  }

  advance(): void {
    this._cb?.();
  }
}

/** Re-arms every persisted cron/once schedule's `nextFire` relative to `clock.now()` at boot
 *  (never wall time directly — Exit-Gate-5 seam consistency). Resident schedules pass through
 *  unchanged (no time field to re-arm). Missed one-shot (`at` already past) fires immediately —
 *  handled by `tick()` returning it right after boot, not by this function inventing a future time. */
export function bootRearm(schedules: StoredSchedule[], clock: Clock): StoredSchedule[] {
  const now = clock.now();
  return schedules.map((s) => {
    if (s.kind === 'resident') return s;
    if (s.kind === 'once') {
      const at = Date.parse(s.at);
      return { ...s, nextFire: Number.isNaN(at) ? now : at };
    }
    // cron: recompute from now (fresh nextFire >= now) — a schedule that was already due before
    // the restart still gets caught by the driver's own first tick, matching fire-once-catch-up.
    return { ...s, nextFire: computeNextFire(s.cron, s.tz, now - 1) };
  });
}
