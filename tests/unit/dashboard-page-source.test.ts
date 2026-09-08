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
