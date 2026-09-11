// src/dashboard/lib/status.js
// v27 (DES-200, ARCH-040, TASK-205, REQ-070): updatePanelModel — a pure projection of the
// `#rwe-init` data island into the update-panel view model. Extracted from dashboard-page.ts's old
// inline panelScript (the four branches it hard-coded: no outcome at all / applied+interrupted-runs
// call-to-action / failed+detail / skipped-configCheck-must-be-visible). INV-V27-5: the shell rebuild
// (ARCH-122 empties DASHBOARD_HTML of executable JS) must not silently drop this panel — no v27 REQ
// names it, so the first person to notice a regression here would be an operator not seeing that a
// self-update FAILED.
//
// Pure, no DOM, no fetch, no localStorage — this module only projects the object the server already
// injected into the page (dashboard-page.ts's `buildDashboardHtml`).

const CTA = {
  en: (n) => `${n} run(s) interrupted by the update; use workflow_resume`,
  zh: (n) => `${n} 個執行因本次更新而中斷,請使用 workflow_resume 復原`,
};

/**
 * @param {{ version: string, lastUpdate?: { tag: string, status: 'pending'|'applied'|'failed'|'skipped', ts: string, detail?: string, configCheck?: 'passed'|'skipped'|'failed' } | null, interruptedRuns?: number }} init
 * @param {'en'|'zh'} lang
 */
export function updatePanelModel(init, lang) {
  const version = init.version;
  const u = init.lastUpdate;
  if (!u) {
    return { version, update: null, configCheck: null, cta: null };
  }
  let text = `${u.tag}: ${u.status}`;
  if (u.detail) text += ` — ${u.detail}`;
  const cta = u.status === 'applied' && (init.interruptedRuns ?? 0) > 0
    ? (CTA[lang] || CTA.en)(init.interruptedRuns)
    : null;
  return {
    version,
    update: { text, tone: u.status },
    configCheck: u.configCheck ?? null,
    cta,
  };
}
