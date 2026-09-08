// Scheduler firing engine (DES-017 / ARCH-010 / TASK-024): the clock/boundary-heavy half of the
// scheduler. `tick(schedules, now)` is a PURE function of persisted schedules + `now` — it decides
// what is due, it never starts a run itself (the impure driver loop does that). Every method that
// reads time takes the injected Clock explicitly (Exit-Gate-5 seam consistency, DES-014) — this
// module never calls `Date.now()`/`setTimeout` itself. // det:allow — a comment naming the API, not a call
import type { Clock } from './clock.js';

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

const CRON_FIELD_MIN = [0, 0, 1, 1, 0]; // minute, hour, day-of-month, month, day-of-week
const CRON_FIELD_MAX = [59, 23, 31, 12, 6];

/** Parses one 5-field cron field (a star, a number, a range `a-b`, a step suffix `/n` on either
 *  a star or a range, or a comma list of the above) into the concrete set of allowed values. */
function parseCronField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart !== undefined ? Number(stepPart) : 1;
    let lo = min;
    let hi = max;
    if (rangePart !== '*') {
      const [a, b] = rangePart!.split('-');
      lo = Number(a);
      hi = b !== undefined ? Number(b) : lo;
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

function parseCron(cron: string): CronFieldSets {
  const fields = cron.trim().split(/\s+/);
  return {
    minute: parseCronField(fields[0]!, CRON_FIELD_MIN[0]!, CRON_FIELD_MAX[0]!),
    hour: parseCronField(fields[1]!, CRON_FIELD_MIN[1]!, CRON_FIELD_MAX[1]!),
    dom: parseCronField(fields[2]!, CRON_FIELD_MIN[2]!, CRON_FIELD_MAX[2]!),
    month: parseCronField(fields[3]!, CRON_FIELD_MIN[3]!, CRON_FIELD_MAX[3]!),
    dow: parseCronField(fields[4]!, CRON_FIELD_MIN[4]!, CRON_FIELD_MAX[4]!),
  };
}

/** Reads a UTC instant's minute/hour/day/month/weekday IN a given IANA timezone (default UTC)
 *  without any external cron/timezone dependency — `Intl.DateTimeFormat` already carries the
 *  platform's own tz database. */
function fieldsAt(ms: number, tz: string | undefined): { minute: number; hour: number; dom: number; month: number; dow: number } {
  const d = new Date(ms);
  if (!tz) {
    return { minute: d.getUTCMinutes(), hour: d.getUTCHours(), dom: d.getUTCDate(), month: d.getUTCMonth() + 1, dow: d.getUTCDay() };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d);
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

/** PURE named helper: the next minute-boundary timestamp strictly after `after` that matches
 *  `cron` (interpreted in `tz`, default UTC). Minute-granularity, matching this cron dialect's own
 *  precision — searches forward minute-by-minute up to a bounded horizon (no external cron lib
 *  needed for a 5-field expression at minute resolution). */
export function computeNextFire(cron: string, tz: string | undefined, after: number): number {
  const sets = parseCron(cron);
  let candidate = Math.floor(after / ONE_MINUTE_MS) * ONE_MINUTE_MS + ONE_MINUTE_MS;
  for (let i = 0; i < MAX_MINUTES_AHEAD; i++) {
    const f = fieldsAt(candidate, tz);
    if (sets.minute.has(f.minute) && sets.hour.has(f.hour) && sets.dom.has(f.dom) && sets.month.has(f.month) && sets.dow.has(f.dow)) {
      return candidate;
    }
    candidate += ONE_MINUTE_MS;
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
