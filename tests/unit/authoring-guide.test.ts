// UT-159 (DES-157, v24): buildAuthoringGuide(inputs) — pure over resolved ServerConfig ceilings;
// GUIDE_EXAMPLES; every ERROR_CATALOG-key-shaped token traced, every tool name real, no model
// alias in any example script. Written test-first (Gate 5, RED) — src/authoring-guide.ts does
// not exist yet.
import { describe, it, expect } from 'vitest';
import { buildAuthoringGuide, GUIDE_EXAMPLES } from '../../src/authoring-guide.js';
import { SHAPES, EDGE_FORMS } from '../../src/check-mermaid.js';

const CEILINGS = { maxTimeoutMs: 600000, maxAppendPromptBytes: 1024, maxEffort: 'high' as const, aliases: ['default', 'sonnet'] };

describe('buildAuthoringGuide (UT-159, DES-157)', () => {
  it('a FAKE ceiling appears verbatim in the text (proves interpolation, not a hard-coded 600000)', () => {
    const text = buildAuthoringGuide({ maxTimeoutMs: 12345, maxAppendPromptBytes: 999, maxEffort: 'medium', aliases: ['default'] });
    expect(text).toMatch(/12345/);
  });

  it('at least ten GUIDE_EXAMPLES, each with title/script/mermaid/expectRegister', () => {
    expect(GUIDE_EXAMPLES.length).toBeGreaterThanOrEqual(10);
    for (const ex of GUIDE_EXAMPLES as Array<{ title: string; script: string; mermaid: string; expectRegister: string }>) {
      expect(ex.title).toBeTruthy();
      expect(ex.script).toBeTruthy();
      expect(ex.mermaid).toBeTruthy();
      expect(ex.expectRegister).toBe('ok');
    }
  });

  it('no example script contains a hard-coded model alias literal', () => {
    for (const ex of GUIDE_EXAMPLES as Array<{ script: string }>) {
      expect(ex.script).not.toMatch(/sonnet-5|opus|haiku|gpt-4/);
    }
  });

  it('the guide names the one-level nesting limit and the flatten instruction', () => {
    const text = buildAuthoringGuide(CEILINGS);
    expect(text).toMatch(/one.level/i);
    expect(text).toMatch(/flatten/i);
  });

  it('the guide states LEGACY_REREGISTER and what to do', () => {
    const text = buildAuthoringGuide(CEILINGS);
    expect(text).toMatch(/LEGACY_REREGISTER/);
  });
});

// v24 Gate 7.5 (D-12, REQ-117): the cold subject's FIRST registration was refused
// `PARAM_CONTRACT_INVALID: default not a known alias: claude-haiku-4-5-20251001` — it took a model
// id from `models_list` because nothing on the tool surface said which alias names this deployment
// accepts. The guide's own "Engine ceilings (this deployment)" section rendered the three numeric
// ceilings and not the alias table, no tool schema listed them, and `models_list` lists catalog
// models, not aliases. Per REQ-117's own rule ("write it right the first time; if not, the
// documentation is at fault"), that is a documentation defect.
describe('the accepted model aliases are ON the surface (UT-159 v24, D-12, REQ-117)', () => {
  it("this deployment's alias names appear in the ceilings section, interpolated — never a hard-coded table", () => {
    const text = buildAuthoringGuide({ maxTimeoutMs: 600000, maxAppendPromptBytes: 1024, maxEffort: 'high', aliases: ['zz-alpha', 'zz-beta'] });
    const section = text.slice(text.indexOf('Engine ceilings (this deployment)'));
    expect(section).toMatch(/zz-alpha/);
    expect(section).toMatch(/zz-beta/);
    // A different deployment renders different names — the same proof the numeric ceilings get.
    expect(buildAuthoringGuide(CEILINGS)).not.toMatch(/zz-alpha/);
  });

  it('the alias names are named as such, so a reader knows what to put in `model.default`', () => {
    const text = buildAuthoringGuide(CEILINGS);
    expect(text).toMatch(/model.*alias|alias.*model/i);
    expect(text).toMatch(/UNKNOWN_ALIAS|not a known alias/);
  });
});

// v24 Gate 7.5 (D-4, REQ-116/REQ-112): the guide taught THREE node shapes while `checkMermaid`
// accepts FIVE (both extras registered live), and never mentioned the `<br/>` value triple, the
// one-edge-per-line rule (`COLLAPSED_EDGE`) or dashed = skipped. A guide that teaches less than the
// engine accepts makes an author believe they cannot draw what they can draw. The vocabulary is
// interpolated from `check-mermaid.ts`'s own SHAPES/EDGE_FORMS — the modules' comments already say
// this file should read them rather than re-type the grammar.
describe('the diagram section teaches the COMPLETE checkMermaid vocabulary (UT-159 v24, D-4)', () => {
  const text = () => buildAuthoringGuide(CEILINGS);

  it('every one of the five node shapes appears, by token pair', () => {
    for (const shape of SHAPES) {
      expect(text(), `shape ${shape.name} is accepted by checkMermaid but missing from the guide`).toContain(`${shape.open}…${shape.close}`);
    }
  });

  it('every one of the three edge forms appears', () => {
    for (const edge of EDGE_FORMS) expect(text()).toContain(edge.token);
  });

  it('the `<br/>` value triple, its separator and its units are stated', () => {
    expect(text()).toContain('<br/>');
    expect(text()).toContain(' · ');
    expect(text()).toMatch(/VALUE_MISMATCH/);
  });

  it('the one-edge-per-line rule is stated with the code it is refused under', () => {
    expect(text()).toMatch(/COLLAPSED_EDGE/);
  });

  it('the dashed edge is explained as a skipped path, not just listed', () => {
    expect(text()).toMatch(/skip/i);
  });
});
