// UT-258 (DES-211, ARCH-134, TASK-218, REQ-142): `lib/scheduler.js` — `nextPoll(state, event)`, a
// pure decision table over `state = {parked: boolean}` and `event ∈ {settled, hidden, visible,
// view-changed}`, returning `{state, action}` with `action ∈ {fire, arm, park}`. The machine owns
// NOTHING else — no timer, no DOM, no fetch, not `viewGeneration`, not the demo predicate — `ui/
// app.js` (DES-210/DES-211's own wiring section) is what calls `setTimeout`/`clearTimeout` off the
// `action` this file returns.
//
// Tier: unit, `.js`, pure — a literal decision-table fixture (mock policy v27/v28: never the
// function's own output as the oracle).
//
// Why `park` must be the ABSENCE of a timer and not a suppressed tick (DES-211's boundary): REQ-
// 142's "0 requests over the hidden window" must hold BY CONSTRUCTION, and the race this table
// exists to close is real — `app.js`'s current `scheduleTick`/`tick().finally(() => setTimeout(loop,
// 3000))` (`app.js:389-397`, measured) re-arms after an in-flight tick even if the page went hidden
// while that tick was in the air, so `'settled'` must consult `parked` rather than always arming.
//
// Red reason (measured): `src/dashboard/lib/scheduler.js` does not exist — whole-file import
// failure (`Failed to resolve import`).
import { describe, it, expect } from 'vitest';
import { nextPoll } from '../../src/dashboard/lib/scheduler.js';

describe('lib/scheduler.js: nextPoll(state, event) — the full 2x4 table (UT-258, DES-211)', () => {
  it('hidden, from unparked -> {parked:true}, park', () => {
    expect(nextPoll({ parked: false }, 'hidden')).toEqual({ state: { parked: true }, action: 'park' });
  });
  it('hidden, from already-parked -> {parked:true}, park (idempotent)', () => {
    expect(nextPoll({ parked: true }, 'hidden')).toEqual({ state: { parked: true }, action: 'park' });
  });
  it('visible, from parked -> {parked:false}, fire (REQ-142: "切回立即輪詢一次")', () => {
    expect(nextPoll({ parked: true }, 'visible')).toEqual({ state: { parked: false }, action: 'fire' });
  });
  it('visible, from already-unparked -> {parked:false}, fire (idempotent)', () => {
    expect(nextPoll({ parked: false }, 'visible')).toEqual({ state: { parked: false }, action: 'fire' });
  });
  it('view-changed, from unparked -> {parked:false}, fire (ARCH-133 tab-activation event)', () => {
    expect(nextPoll({ parked: false }, 'view-changed')).toEqual({ state: { parked: false }, action: 'fire' });
  });
  it('view-changed, from parked -> {parked:false}, fire (switching tabs while hidden is not reachable in practice, but the table is total)', () => {
    expect(nextPoll({ parked: true }, 'view-changed')).toEqual({ state: { parked: false }, action: 'fire' });
  });
  it('settled, while NOT parked -> stays unparked, arm (the normal 3s re-arm)', () => {
    expect(nextPoll({ parked: false }, 'settled')).toEqual({ state: { parked: false }, action: 'arm' });
  });
  it('settled, while parked -> stays parked, park (NEVER arm — the race this table exists to close)', () => {
    expect(nextPoll({ parked: true }, 'settled')).toEqual({ state: { parked: true }, action: 'park' });
  });
});

describe('lib/scheduler.js: the named race — hidden arriving between fire and settled (UT-258, DES-211)', () => {
  it('a tick in flight, then hidden, then that SAME tick settling: the settle must park, not re-arm', () => {
    let state = { parked: false };
    // fire (armed the tick) ... time passes ... page goes hidden WHILE the tick is in flight:
    const hiddenStep = nextPoll(state, 'hidden');
    state = hiddenStep.state;
    expect(hiddenStep.action).toBe('park');
    // ...the in-flight tick NOW settles (its own `.finally`) — it must consult the CURRENT
    // (parked) state, not the state at the moment it was fired:
    const settleStep = nextPoll(state, 'settled');
    expect(settleStep.action).toBe('park');
    expect(settleStep.state).toEqual({ parked: true });
  });

  it('a normal (non-raced) settle while visible keeps the 3s rhythm going', () => {
    let state = { parked: false };
    const visibleStep = nextPoll(state, 'visible');
    state = visibleStep.state;
    const settleStep = nextPoll(state, 'settled');
    expect(settleStep.action).toBe('arm');
  });
});
