// UT-269 (v29 c4, REQ-151): the workflow-detail page's diagram SURFACE is retired.
//
// Owner ruling V29-Q2 (2026-09-18): 「移除底部流程圖」. The delivery handoff's workflow-detail
// screen has no such element at all; the engine rendered its mermaid SVG into an `<img>` at the
// foot of the page, white-on-dark against every other surface.
//
// REQ-102 is NOT retired: `/api/workflows/:name/diagram.svg`, `src/diagram-render.ts` and their
// integration coverage stay. Only the dashboard's rendering of it goes.
//
// This file is the REQ-105 / ADR-048 anti-rot half — this ledger's most repeated defect is
// deleting a thing and leaving something that still describes it.
import { describe, it, expect } from 'vitest';

describe('the diagram surface is gone from the client (UT-269, REQ-151)', () => {
  it('no client module builds or addresses the diagram elements', async () => {
    const { clientCorpus } = await import('../helpers/client-corpus.js');
    const corpus = clientCorpus();
    for (const token of ['diagram-img', 'diagram-zoom', 'diagram-fit', 'mermaidNote']) {
      expect(corpus, `${token} still referenced in the client corpus`).not.toContain(token);
    }
    // the `<pre id="diagram">` fallback, which only ever existed to explain a missing diagram
    expect(corpus).not.toMatch(/\.id = 'diagram';/);
  });

  it('no stylesheet rule survives its element', async () => {
    const { clientFile } = await import('../helpers/client-corpus.js');
    expect(clientFile('dashboard.css')).not.toMatch(/#diagram-/);
  });

  it('.fit-btn SURVIVES — it is the swimlane’s zoom control, not the diagram’s', async () => {
    // `ui/run.js:413` sets this class for `#dag-fit`. Deleting the rule with the diagram would
    // break a control on a different view; the C1 pin on `.fit-btn{position:relative;z-index:1;`
    // stays for the same reason. Stated as a POSITIVE anchor beside the negatives (DES-208's rule).
    const { clientFile, clientCorpus } = await import('../helpers/client-corpus.js');
    expect(clientFile('dashboard.css')).toContain('.fit-btn{position:relative;z-index:1;');
    expect(clientCorpus()).toContain("fitBtn.className = 'fit-btn'");
  });
});
