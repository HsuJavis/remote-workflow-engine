// UT-159 (DES-157, v24): buildAuthoringGuide(inputs) — pure over resolved ServerConfig ceilings;
// GUIDE_EXAMPLES; every ERROR_CATALOG-key-shaped token traced, every tool name real, no model
// alias in any example script. Written test-first (Gate 5, RED) — src/authoring-guide.ts does
// not exist yet.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — src/authoring-guide.ts does not exist yet (v24 DES-157/TASK-150)
import { buildAuthoringGuide, GUIDE_EXAMPLES } from '../../src/authoring-guide.js';

describe('buildAuthoringGuide (UT-159, DES-157)', () => {
  it('a FAKE ceiling appears verbatim in the text (proves interpolation, not a hard-coded 600000)', () => {
    const text = buildAuthoringGuide({ maxTimeoutMs: 12345, maxAppendPromptBytes: 999, maxEffort: 'medium' });
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
    const text = buildAuthoringGuide({ maxTimeoutMs: 600000, maxAppendPromptBytes: 1024, maxEffort: 'high' });
    expect(text).toMatch(/one.level/i);
    expect(text).toMatch(/flatten/i);
  });

  it('the guide states LEGACY_REREGISTER and what to do', () => {
    const text = buildAuthoringGuide({ maxTimeoutMs: 600000, maxAppendPromptBytes: 1024, maxEffort: 'high' });
    expect(text).toMatch(/LEGACY_REREGISTER/);
  });
});
