// src/dashboard/lib/scheduler.js
// DES-211, ARCH-134, ARCH-133, ADR-059, TASK-218, REQ-142 — `nextPoll(state, event)`, a pure
// decision table. No timer, no DOM, no fetch, no import: `ui/app.js` is what turns the returned
// `action` into an actual `setTimeout`/`clearTimeout`/`data-poll` write.
//
// `park` is the ABSENCE of a timer, not a suppressed tick — REQ-142's "0 requests over the hidden
// window" holds by construction rather than by a guard that can fail open. The race this table
// exists to close: a tick fires, then the page goes `hidden` WHILE that tick is in flight, so
// `'settled'` must consult the CURRENT `parked` state rather than always re-arming.
export function nextPoll(state, event) {
  if (event === 'hidden') return { state: { parked: true }, action: 'park' };
  if (event === 'visible') return { state: { parked: false }, action: 'fire' };
  if (event === 'view-changed') return { state: { parked: false }, action: 'fire' };
  // event === 'settled'
  return state.parked
    ? { state: { parked: true }, action: 'park' }
    : { state: { parked: false }, action: 'arm' };
}
