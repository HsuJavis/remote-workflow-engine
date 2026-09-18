// UT-264 (v29, REQ-149): `lib/status.js` gains the two pure decisions `ui/app.js` and
// `ui/workflow.js` were making inline and getting wrong.
//
// Tier: unit, `.js`, pure. vitest runs `environment: 'node'`, so no `ui/*.js` module that touches
// `document` at import time is reachable from a unit test (ADR-049's own conclusion) — which is
// exactly why both decisions move here rather than being pinned as source text.
//
// Red reason (measured): `makeIslandReader` and `versionTagText` are not exported by
// `src/dashboard/lib/status.js` (named-import failure).
import { describe, it, expect } from 'vitest';
import { makeIslandReader, versionTagText } from '../../src/dashboard/lib/status.js';

describe('lib/status.js: makeIslandReader (UT-264, REQ-149)', () => {
  // The defect this repairs: `ui/app.js:595` does `document.body.replaceChildren(...)`, and the
  // server-rendered island lives in the BODY (`dashboard-page.ts:93`). The first mount reads it
  // before the wipe; every later mount — a language switch calls `mountApp()` again — reads a
  // document with no `#rwe-init` at all. The nav then painted `vundefined` AND silently dropped
  // the whole update panel. Memoizing the read is the repair; guarding `undefined` at the paint
  // site would have hidden it.
  it('reads ONCE and serves the same value afterwards, even when the source is gone', () => {
    let calls = 0;
    let present = true;
    const read = () => {
      calls += 1;
      return present ? { version: '0.1.0 (v0.20.0)', lastUpdate: { tag: 'v0.20.0', status: 'applied' } } : {};
    };
    const island = makeIslandReader(read);

    const first = island();
    expect(calls).toBe(1);
    expect(first.version).toBe('0.1.0 (v0.20.0)');

    present = false; // body.replaceChildren() has now destroyed <script id="rwe-init">
    const second = island();
    expect(calls).toBe(1);
    expect(second).toBe(first);
    expect(second.lastUpdate.status).toBe('applied');
  });

  it('two readers are independent (module-level state would make one page poison the next)', () => {
    const a = makeIslandReader(() => ({ version: 'a' }));
    const b = makeIslandReader(() => ({ version: 'b' }));
    expect(a().version).toBe('a');
    expect(b().version).toBe('b');
  });
});

describe('lib/status.js: versionTagText (UT-264, REQ-149)', () => {
  // `/api/workflows/:name/describe` returns `version: 'v4'` — the value already carries its own
  // `v`. `ui/workflow.js:183` prefixed a second one, so the detail page read 「版本 vv4」.
  it('does not double the prefix when the wire value already carries one', () => {
    expect(versionTagText('zh', 'v4')).toBe('版本 v4');
    expect(versionTagText('en', 'v4')).toBe('v4');
  });

  it('adds the prefix when the wire value lacks one', () => {
    expect(versionTagText('zh', '4')).toBe('版本 v4');
    expect(versionTagText('en', '4')).toBe('v4');
  });

  it('renders NO tag rather than a tag naming a version it does not have', () => {
    expect(versionTagText('zh', undefined)).toBe('');
    expect(versionTagText('zh', null)).toBe('');
    expect(versionTagText('en', '')).toBe('');
  });
});
