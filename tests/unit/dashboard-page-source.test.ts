// UT-191 (DES-180, ARCH-118, TASK-180, v26): the DAG cell renders `sumTokens()` + `$0.0000` cost +
// an `(unpriced)` badge — never `300 tok`, never `[object Object] tok` (the widened `tokens` shape
// makes the old `(a.tokens||0)+' tok'` literal render the object's own toString). Written test-first
// (Gate 5, RED): `dashboard-page.ts:359` still reads `(a.tokens||0)+' tok'` and has no `costUSD`/
// `unpriced` rendering at all.
// Mock policy (unit): page-source text assertion over the exported DASHBOARD_HTML/inline script.
import { describe, it, expect } from 'vitest';
import { DASHBOARD_HTML } from '../../src/dashboard-page.js';

describe('the DAG cell renders sumTokens() + costUSD + unpriced badge (UT-191, DES-180)', () => {
  it('the old (a.tokens||0) literal is GONE', () => {
    expect(DASHBOARD_HTML).not.toContain('a.tokens||0');
  });

  it('the page source calls sumTokens for the cell token count', () => {
    expect(DASHBOARD_HTML).toMatch(/sumTokens/);
  });

  it('the page source renders a costUSD figure and an unpriced badge', () => {
    expect(DASHBOARD_HTML).toMatch(/costUSD/);
    expect(DASHBOARD_HTML).toMatch(/unpriced/);
  });
});

// UT-222 (v26 Gate 7.5 round 1, defects D8 + REQ-129's fit clause): the two page-source facts the
// browser test (VAL-193) proves behaviourally, pinned here so a CSS/render regression is caught by
// the fast suite too — and so the reason survives next to the rule.
describe('the run page renders four token columns and keeps Fit clickable (UT-222, D8/REQ-129)', () => {
  it('.fit-btn is positioned with a z-index (a transformed .zoomable paints above in-flow content)', () => {
    expect(DASHBOARD_HTML).toMatch(/\.fit-btn\{position:relative;z-index:1;/);
  });

  it('the run usage summary renders all four columns by name, not only their sum', () => {
    expect(DASHBOARD_HTML).toMatch(/function tokenCols/);
    expect(DASHBOARD_HTML).toMatch(/'in '\+\(t\.input\|\|0\)/);
    expect(DASHBOARD_HTML).toMatch(/cache read/);
    expect(DASHBOARD_HTML).toMatch(/cache write/);
    // the sum stays — it is what a budget.tokens ceiling counts
    expect(DASHBOARD_HTML).toMatch(/sumTokens\(usage\.tokens\)/);
  });
});

// UT-224 (v26 Gate 7.5 round 3, defect D10): the three page-source facts VAL-197 proves
// behaviourally in a real browser, pinned here so the fast suite (no Chrome, no mmdc) catches a
// regression too — and so the REASON survives next to the rule. Not independently forced red: all
// three strings occur ZERO times in the pre-fix file (`git show HEAD:src/dashboard-page.ts | grep
// -c` ⇒ 0, 0, 0).
describe("the author's diagram can be drag-panned: no native image drag (UT-224, D10/REQ-129)", () => {
  it('the diagram <img> is explicitly non-draggable', () => {
    expect(DASHBOARD_HTML).toMatch(/<img id="diagram-img"[^>]*draggable="false"/);
  });

  it('#diagram-img also disables the webkit image drag and text selection', () => {
    expect(DASHBOARD_HTML).toMatch(/#diagram-img\{[^}]*-webkit-user-drag:none;user-select:none\}/);
  });

  it("the zoomable's mousedown preventDefault()s the browser's own press action", () => {
    expect(DASHBOARD_HTML).toMatch(/addEventListener\('mousedown', function\(e\)\{ e\.preventDefault\(\);/);
  });
});

// UT-227 (v26 Gate 7.5 round 4, defect D11): the harness table resolves a run's declared alias by
// indexing `/api/models` on the catalog row's alias name. It indexed the SINGULAR `m.alias`, which
// only ever worked for a second alias (`claude-haiku-4-5`, `claude-fable-5`, …) because the defect
// D11 fixes served that alias as its OWN duplicate row. With one row per model, an index over
// `m.alias` would resolve the first alias and silently answer "unresolved" for every other name
// this deployment configures — so the page must read the row's full `aliases` list.
describe('the harness table indexes EVERY alias a catalog row carries (UT-227, D11)', () => {
  it('the singular m.alias index is GONE', () => {
    expect(DASHBOARD_HTML).not.toContain('if(m.alias)');
  });

  it('the page indexes byAlias over every name in the row aliases list', () => {
    expect(DASHBOARD_HTML).toMatch(/\(m\.aliases\|\|\[\]\)\.forEach\(function\(a\)\{ byAlias\[a\]=m; \}\)/);
  });
});
