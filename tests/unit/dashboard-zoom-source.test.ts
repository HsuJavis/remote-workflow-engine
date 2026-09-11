// UT-200 (DES-186, ARCH-120, ADR-044, TASK-191, v26, REQ-129/REQ-119): the run DAG scales with its
// container (`viewBox`, `width="100%"`, `preserveAspectRatio`, NO absolute `width=`) and one
// `.zoomable` wrapper serves BOTH figures, surviving the 3-second poll (the transform lives on the
// wrapper, never on rebuilt SVG children the 3s `renderGraph` destroys). Written test-first (Gate 5,
// RED): `dashboard-page.ts:394-403` still sets an absolute pixel `width`/`height` and there is no
// `.zoomable` class anywhere in the page.
// Mock policy (unit): page-source text assertion over the exported DASHBOARD_HTML.
import { describe, it, expect } from 'vitest';
import { DASHBOARD_HTML } from '../../src/dashboard-page.js';

describe('the run DAG and author SVG scale via viewBox + one .zoomable wrapper (UT-200, DES-186)', () => {
  it('the page source sets viewBox and preserveAspectRatio on the DAG', () => {
    expect(DASHBOARD_HTML).toMatch(/viewBox/);
    expect(DASHBOARD_HTML).toMatch(/preserveAspectRatio/);
  });

  it('no absolute pixel width= is set on the DAG svg element', () => {
    expect(DASHBOARD_HTML).not.toMatch(/setAttribute\('width',\s*W\)/);
    expect(DASHBOARD_HTML).not.toMatch(/setAttribute\("width",\s*W\)/);
  });

  it('a .zoomable wrapper class exists in the page', () => {
    expect(DASHBOARD_HTML).toMatch(/zoomable/);
  });

  it('a fit button/control exists', () => {
    expect(DASHBOARD_HTML).toMatch(/fit/i);
  });
});

// v27 (UT-253, DES-208, TASK-213, REQ-134/129): the `viewBox`/`preserveAspectRatio`/no-absolute-
// `width` behaviour pins MOVE into `ui/run.js` (the swimlane painter) under this SAME UT id, per
// DES-208's "MOVES" disposition — a positive anchor beside the negative, or the corpus going empty
// would pass this vacuously (adjudication (v23) #4).
//
// Red reason (measured): `clientCorpus()` throws today — `src/dashboard/**/*.js` does not exist.
describe('v27 disposition anchor: viewBox/preserveAspectRatio re-points to ui/run.js (UT-253, DES-208)', () => {
  it('the client corpus (once built) carries the SVG viewBox/preserveAspectRatio wiring and is not vacuously tiny', async () => {
    const { clientCorpus } = await import('../helpers/client-corpus.js');
    const corpus = clientCorpus();
    expect(corpus).toContain('viewBox');
    expect(corpus).toContain('preserveAspectRatio');
    expect(corpus.length).toBeGreaterThan(5000);
  });
});
