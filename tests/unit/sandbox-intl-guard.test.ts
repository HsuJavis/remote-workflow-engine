// Issue #157 B2: `Intl.DateTimeFormat` (and friends) read the wall clock the same way `Date.now()`/
// `new Date()` do, defeating the same resume-replay-key hazard the Date/Math guards exist for — but
// `Intl` was never added to the `sandbox` object `evaluateScript` builds, nor shadowed, so it was
// reachable unguarded as a standard vm-context-default global.
//
// RED before the fix: `new Intl.DateTimeFormat().format()` (and the other construction forms below)
// return a real wall-clock-derived string with no guard thrown, while Date.now()/Math.random() are
// correctly refused.
//
// Mock policy (unit): pure evaluateScript calls, no I/O.
import { describe, it, expect } from 'vitest';
import { evaluateScript, SANDBOX_GLOBALS, DETERMINISM_GUARDED } from '../../src/sandbox/guards.js';
import type { SandboxApi } from '../../src/sandbox/guards.js';
import type { Budget } from '../../src/types.js';

const NEVER_BUDGET: Budget = { total: null, spent: () => 0, remaining: () => Infinity };
const FAKE_API: SandboxApi = { async agent() { return 'fake'; }, args: undefined, budget: NEVER_BUDGET };

describe('#157 B2: Intl.DateTimeFormat is determinism-guarded, not reachable unguarded', () => {
  it('Intl is listed in SANDBOX_GLOBALS (guide-driven data must not drift from the real context)', () => {
    expect([...SANDBOX_GLOBALS]).toContain('Intl');
  });

  it('new Intl.DateTimeFormat().format() throws DETERMINISM_GUARD instead of reading the wall clock', async () => {
    const r = await evaluateScript('return new Intl.DateTimeFormat().format();', FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('DETERMINISM_GUARD');
  });

  it('Intl.DateTimeFormat() without `new` is refused the same way', async () => {
    const r = await evaluateScript('return Intl.DateTimeFormat().format();', FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('DETERMINISM_GUARD');
  });

  it('.resolvedOptions() on a constructed instance never happens — construction itself is refused', async () => {
    const r = await evaluateScript('const f = new Intl.DateTimeFormat(); return f.resolvedOptions();', FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('DETERMINISM_GUARD');
  });

  it('.formatToParts() is refused the same way (construction-time refusal covers every instance method)', async () => {
    const r = await evaluateScript('return new Intl.DateTimeFormat().formatToParts();', FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('DETERMINISM_GUARD');
  });

  it('other Intl constructors (no wall-clock hazard) are unaffected — not a blanket Intl removal', async () => {
    const r = await evaluateScript("return new Intl.NumberFormat('en-US').format(1234.5);", FAKE_API);
    expect(r.kind).toBe('done');
    expect(r.value).toBe('1,234.5');
  });

  it('.constructor.constructor on Intl itself cannot reach the embedding realm (same #157 B1 vector, new global)', async () => {
    const script = `
      try {
        const v = Intl.constructor.constructor('return process')();
        return { escaped: (typeof v === 'object' && v !== null) || typeof v === 'function' };
      } catch (e) {
        return { escaped: false };
      }
    `;
    const r = await evaluateScript(script, FAKE_API);
    expect(r.kind).toBe('done');
    expect((r.value as { escaped: boolean }).escaped).toBe(false);
  });

  it('DETERMINISM_GUARDED now documents 4 guarded calls, including Intl.DateTimeFormat, each with why + instead', () => {
    expect(DETERMINISM_GUARDED.length).toBe(4);
    const intlEntry = DETERMINISM_GUARDED.find((g) => g.call.includes('Intl.DateTimeFormat'));
    expect(intlEntry).toBeDefined();
    expect(intlEntry!.why).toBeTruthy();
    expect(intlEntry!.instead).toBeTruthy();
  });
});
