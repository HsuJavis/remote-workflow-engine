// UT-180 (DES-172, ARCH-112, ADR-042, TASK-172, v26): `UpdateOutcome` gains a fifth key,
// `configCheck: 'passed' | 'skipped' | 'failed'`, and the dashboard banner renders it — `skipped`
// VISIBLY (never a silent pass), and an update-result written by an OLDER updater (the key entirely
// absent) still renders without crashing or printing the literal string "undefined". Written
// test-first (Gate 5, RED): `buildDashboardHtml`'s panel script has no `configCheck` reference today.
// Mock policy (unit): pure string-render function, no I/O.
import { describe, it, expect } from 'vitest';
import { buildDashboardHtml } from '../../src/dashboard-page.js';
import type { UpdateOutcome } from '../../src/update-types.js';

function panelScript(outcome: UpdateOutcome): string {
  return buildDashboardHtml({ lastUpdate: outcome });
}

describe('UpdateOutcome.configCheck renders on the dashboard banner (UT-180, DES-172)', () => {
  it('configCheck: "passed" is visible in the rendered page', () => {
    const html = panelScript({ tag: 'v26', status: 'applied', ts: '2026-09-08T00:00:00Z', configCheck: 'passed' } as UpdateOutcome);
    expect(html).toContain('passed');
  });

  it('configCheck: "failed" is visible in the rendered page', () => {
    const html = panelScript({ tag: 'v26', status: 'failed', ts: '2026-09-08T00:00:00Z', configCheck: 'failed' } as UpdateOutcome);
    expect(html).toContain('failed');
  });

  it('configCheck: "skipped" is VISIBLE — never a silent pass', () => {
    const html = panelScript({ tag: 'v26', status: 'applied', ts: '2026-09-08T00:00:00Z', configCheck: 'skipped' } as UpdateOutcome);
    expect(html).toContain('skipped');
  });

  it('an outcome written by an OLDER updater (no configCheck key at all) renders without the literal string "undefined"', () => {
    const legacy = { tag: 'v25', status: 'applied', ts: '2026-09-01T00:00:00Z' } as UpdateOutcome;
    const html = buildDashboardHtml({ lastUpdate: legacy });
    expect(html).not.toContain('undefined');
  });
});
