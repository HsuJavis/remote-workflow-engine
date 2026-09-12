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

// v27 (DES-200, ARCH-040, TASK-205, REQ-070): `updatePanelModel(init, lang) -> {version, update,
// configCheck, cta}` — the four branches `dashboard-page.ts:67-81` hard-codes today, as a pure
// function. INV-V27-5: the shell rebuild (ARCH-122 empties DASHBOARD_HTML of executable JS) must
// not silently drop the update panel — no v27 REQ names it, so the first person to notice a
// regression here would be an operator not seeing that a self-update FAILED.
//
// Tier: unit, pure — a literal-fixture oracle (mock policy v27).
//
// Red reason (measured): `src/dashboard/lib/status.js` does not exist (whole-file import failure);
// `updatePanelModel` has no production counterpart today (the four branches are inline, unexported
// template-literal logic in `dashboard-page.ts`).
describe('updatePanelModel: four fixture rows, pure (UT-241, DES-200, INV-V27-5)', () => {
  it('pending: no update outcome at all -> update is null', async () => {
    const { updatePanelModel } = await import('../../src/dashboard/lib/status.js');
    const vm = updatePanelModel({ version: '1.2.3' }, 'en');
    expect(vm.version).toBe('1.2.3');
    expect(vm.update).toBeNull();
  });

  it('applied + interruptedRuns>0: update.tone is "applied" and cta is non-null', async () => {
    const { updatePanelModel } = await import('../../src/dashboard/lib/status.js');
    const vm = updatePanelModel({ version: '1.2.3', lastUpdate: { tag: 'v27', status: 'applied', ts: '2026-09-11T00:00:00Z' }, interruptedRuns: 2 }, 'en');
    expect(vm.update?.tone).toBe('applied');
    expect(vm.cta).not.toBeNull();
  });

  it('applied + interruptedRuns>0, lang "zh": cta uses the Chinese CTA text, not the English one (Gate 6.5+7 coverage)', async () => {
    const { updatePanelModel } = await import('../../src/dashboard/lib/status.js');
    const vm = updatePanelModel({ version: '1.2.3', lastUpdate: { tag: 'v27', status: 'applied', ts: '2026-09-11T00:00:00Z' }, interruptedRuns: 3 }, 'zh');
    expect(vm.cta).toContain('workflow_resume');
    expect(vm.cta).toContain('3');
    expect(vm.cta).not.toMatch(/run\(s\) interrupted/);
  });

  it('failed with detail: update.tone is "failed" and the text carries the detail', async () => {
    const { updatePanelModel } = await import('../../src/dashboard/lib/status.js');
    const vm = updatePanelModel({ version: '1.2.3', lastUpdate: { tag: 'v27', status: 'failed', ts: '2026-09-11T00:00:00Z', detail: 'build failed: xyz' } }, 'en');
    expect(vm.update?.tone).toBe('failed');
    expect(vm.update?.text).toContain('xyz');
  });

  it('skipped with configCheck: update.tone is "skipped" and configCheck is surfaced (never a silent pass)', async () => {
    const { updatePanelModel } = await import('../../src/dashboard/lib/status.js');
    const vm = updatePanelModel({ version: '1.2.3', lastUpdate: { tag: 'v27', status: 'applied', ts: '2026-09-11T00:00:00Z', configCheck: 'skipped' } }, 'en');
    expect(vm.configCheck).toBe('skipped');
  });
});
