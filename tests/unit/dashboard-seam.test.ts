// UT-261 (DES-210, ARCH-133, ARCH-125, ARCH-124, ADR-057, ADR-058, ADR-059, TASK-217, REQ-137/138/
// 139/142/143): five source tripwires over `clientCorpus()`/`clientFile()` — NOT a proof of
// behaviour (a tripwire cannot see what a call DOES, only that a pattern occurs a counted number of
// times), but each one closes an invisible-to-every-other-oracle failure mode DES-210 names by
// number: (1) INV-V28-1 — a `ui/` module that keeps importing `getJSON` silently renders Unavailable
// forever in demo mode; (2) the seam's own exports/route table; (3) the one-timer tripwire (a
// second `setTimeout` would double the poll rate); (4) the one-commit tripwire (K2) — committing a
// PREVIEW `nextConnection` result breaks REQ-131's >=2-tick offline rule invisibly to any
// request-count oracle; (5) the two `data-*` stamps app.js must set.
//
// Tier: unit — pure static analysis, no server boot, no DOM.
//
// Red reason (measured against HEAD, see each case).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientFile } from '../helpers/client-corpus.js';

const UI_DIR = join(__dirname, '..', '..', 'src', 'dashboard', 'ui');

function uiFiles(): string[] {
  return readdirSync(UI_DIR).filter((f) => f.endsWith('.js'));
}

describe('the v28 seam — five source tripwires (UT-261, DES-210)', () => {
  // Red reason (measured): `run.js`, `workflow.js`, `agent-panel.js`, `issues.js`, `models.js`,
  // `system.js` ALL import `getJSON` from `./poll.js` today — 6 offenders, not 0.
  it('INV-V28-1: only ui/app.js (and poll.js itself) may import getJSON from ./poll.js — every other ui/ module imports getViewJSON', () => {
    const offenders: string[] = [];
    for (const file of uiFiles()) {
      if (file === 'app.js' || file === 'poll.js') continue;
      const src = readFileSync(join(UI_DIR, file), 'utf8');
      const importsGetJSON = /import\s*\{[^}]*\bgetJSON\b[^}]*\}\s*from\s*['"]\.\/poll\.js['"]/.test(src);
      if (importsGetJSON) offenders.push(file);
    }
    expect(offenders, `these ui/ files still import getJSON directly: ${offenders.join(', ')}`).toEqual([]);
  });

  // Red reason (measured): `src/dashboard/ui/poll.js` exports `endpointsFor`/`getJSON` only —
  // neither `getViewJSON` nor `setDemoBodies` exists yet, and `ROUTES.system` is `() =>
  // ['/api/system']`, not the three-URL array ADR-057 requires.
  it('poll.js exports getViewJSON/setDemoBodies, and ROUTES.system (via endpointsFor) is the 3-url ADR-057 fold', async () => {
    const mod = await import('../../src/dashboard/ui/poll.js') as Record<string, unknown>;
    expect(typeof mod['getViewJSON']).toBe('function');
    expect(typeof mod['setDemoBodies']).toBe('function');
    const endpointsFor = mod['endpointsFor'] as (view: string) => string[];
    expect(endpointsFor('system')).toEqual(['/api/system', '/api/workflows', '/api/runs']);
  });

  // Measured: `app.js` calls `setTimeout(` exactly once today (`:396`, `scheduleTick`'s re-arm) —
  // this case is GREEN BY CONSTRUCTION (Mode C), not forced red: the property already holds and
  // DES-210's seven-step tick does not add a second timer, so nothing here should ever need to
  // change. Recorded, not skipped, because a REGRESSION (a second timer sneaking in during Gate 6)
  // must fail loudly.
  it('the one-timer tripwire: setTimeout( occurs exactly once in ui/app.js', () => {
    const src = clientFile('ui/app.js');
    const count = (src.match(/setTimeout\(/g) || []).length;
    expect(count).toBe(1);
  });

  // Red reason (measured): `nextConnection(` occurs exactly ONCE in app.js today (`:383`) — DES-
  // 210's seven-step tick needs a SECOND call (the uncommitted `preview` at step 2) before step 7's
  // single commit, so this assertion (`=== 2`) is false at HEAD. The `connectionState =
  // nextConnection(` sub-assertion is ALREADY true today (also measured) but is meaningless on its
  // own — it is the CONJUNCTION with the total-count-of-2 that proves a preview is computed AND
  // left uncommitted, which is the actual K2 property DES-210 needs (a bare
  // `connectionState =` anchor is the WRONG one: it already matches twice once TASK-218 adds
  // `connectionState = resumeReset(...)`, so it would pass vacuously post-Gate-6 even with the bug).
  it('the one-commit tripwire (K2): nextConnection( occurs exactly twice, but "connectionState = nextConnection(" occurs exactly once', () => {
    const src = clientFile('ui/app.js');
    const totalCalls = (src.match(/nextConnection\(/g) || []).length;
    const committedCalls = (src.match(/connectionState = nextConnection\(/g) || []).length;
    expect(totalCalls, 'total nextConnection( call sites').toBe(2);
    expect(committedCalls, 'connectionState = nextConnection( call sites').toBe(1);
  });

  // Red reason (measured): `documentElement.setAttribute('data-poll'` / `'data-source'` — 0 hits,
  // neither stamp exists in app.js today.
  it('the two data-* stamps: data-poll and data-source are each set exactly once', () => {
    const src = clientFile('ui/app.js');
    expect((src.match(/setAttribute\(\s*['"]data-poll['"]/g) || []).length).toBe(1);
    expect((src.match(/setAttribute\(\s*['"]data-source['"]/g) || []).length).toBe(1);
  });

  // [v28b, DES-220, TASK-226, REQ-143] (6) a SOURCE tripwire, not a proof of behaviour: `ui/
  // workflow.js`, `ui/issues.js` and, **[widened v28b, owner ruling 2026-09-18]** `ui/system.js`,
  // are the three view files DES-220 opens to paint the 「此路由無示範資料」disclosure, and this is
  // how a view with NO unit tier at all (ADR-049 refuses jsdom) gets a unit-tier anchor for that
  // work — it can only see that the string LITERAL is present, never that it is painted correctly
  // (the real behaviour is val-207's job).
  //
  // Red reason (measured, widened v28b): `ui/workflow.js` and `ui/issues.js` already contain
  // `noDemoData` (landed at 87eee96, for the pre-widened sentence); `ui/system.js` does not —
  // `paintCountsUnavailable` there still takes no `text` parameter and never references the key.
  it('DES-220: ui/workflow.js, ui/issues.js and ui/system.js each reference noDemoData (a tripwire, not a proof)', () => {
    expect(clientFile('ui/workflow.js')).toContain('noDemoData');
    expect(clientFile('ui/issues.js')).toContain('noDemoData');
    expect(clientFile('ui/system.js')).toContain('noDemoData');
  });
});
