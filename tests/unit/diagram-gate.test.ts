// UT-107 (TASK-113, DES-124, ARCH-080): `gateDiagram` — the pure allowlist gate over model-authored
// diagram text. Four passes in order: (1) type — non-string/empty ⇒ GATE_REJECTED_SHAPE/'type';
// (2) codepoint — every char must be in DIAGRAM_CODEPOINTS ⇒ else GATE_REJECTED_SHAPE/'codepoint';
// (3) size — maxBytes (UTF-8)/maxLines ⇒ else GATE_REJECTED_SHAPE/'size'; (4) token — every
// non-vocabulary token must be an EXACT, case-sensitive member of allowedLabels ⇒ else
// GATE_REJECTED_CONTENT/'token'. On success: returns `raw` byte-identical (validator, not
// transformer) — never a transform of the input.
//
// Per the ledger's carried-in rule 1 (01-requirements.md v21/v22/v23): every hostile-input
// assertion below names the LITERAL secret/codepoint, never `not.toContain(wholeScript)`.
//
// Mock policy (unit, per-tier IO contract): pure module, zero I/O, zero model involvement — the
// REQ-102/A3 security invariant is unit-testable with no model in the loop (ADR-015's own stated
// reason this module is separate and pure).
//
// Red reason: `src/diagram-gate.ts` does not exist yet → MODULE NOT FOUND at collect time. Correct
// red for an unimplemented module (same precedent as UT-082/UT-084/IT-073, seedref-* v13 RED batch).
import { describe, it, expect } from 'vitest';
import { gateDiagram, DIAGRAM_CODEPOINTS } from '../../src/diagram-gate.js';

const ALLOWED = new Set(['Draft', 'Verify', 'sonnet-5', 'cron', 'webhook', 'model:param']);
const LIMITS = { maxBytes: 200, maxLines: 10 };

describe('gateDiagram — pass 1: type (DES-124)', () => {
  it('a non-string raw value (undefined) is GATE_REJECTED_SHAPE / type — the live-path guard for an unexpected 200-shape', () => {
    const r = gateDiagram(undefined as unknown as string, ALLOWED, LIMITS);
    expect(r).toEqual({ ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'type' });
  });

  it('an empty string is GATE_REJECTED_SHAPE / type', () => {
    expect(gateDiagram('', ALLOWED, LIMITS)).toEqual({ ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'type' });
  });

  it('a whitespace-only string is GATE_REJECTED_SHAPE / type', () => {
    expect(gateDiagram('   \n  ', ALLOWED, LIMITS)).toEqual({ ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'type' });
  });
});

describe('gateDiagram — pass 2: codepoint (DES-124)', () => {
  it('an ANSI/CSI escape sequence is GATE_REJECTED_SHAPE / codepoint', () => {
    const r = gateDiagram('Draft \x1b[31mred\x1b[0m Verify', ALLOWED, LIMITS);
    expect(r).toEqual({ ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'codepoint' });
  });

  it('a zero-width space (U+200B) is GATE_REJECTED_SHAPE / codepoint', () => {
    const r = gateDiagram('Draft​Verify', ALLOWED, LIMITS);
    expect(r).toEqual({ ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'codepoint' });
  });

  it('a raw tab (\\t) is GATE_REJECTED_SHAPE / codepoint', () => {
    expect(gateDiagram('Draft\tVerify', ALLOWED, LIMITS)).toEqual({ ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'codepoint' });
  });

  it('a raw carriage return (\\r) is GATE_REJECTED_SHAPE / codepoint', () => {
    expect(gateDiagram('Draft\rVerify', ALLOWED, LIMITS)).toEqual({ ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'codepoint' });
  });

  it("a literal `<` is GATE_REJECTED_SHAPE / codepoint — excluded from DIAGRAM_CODEPOINTS by subtraction (the gate, not the renderer's textContent, is the first layer)", () => {
    expect(gateDiagram('Draft < Verify', ALLOWED, LIMITS)).toEqual({ ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'codepoint' });
  });

  it('DIAGRAM_CODEPOINTS excludes `<`, `>`, `&` even though they are printable ASCII', () => {
    expect(DIAGRAM_CODEPOINTS.has('<')).toBe(false);
    expect(DIAGRAM_CODEPOINTS.has('>')).toBe(false);
    expect(DIAGRAM_CODEPOINTS.has('&')).toBe(false);
  });

  it('the named vocabulary glyphs ARE members of DIAGRAM_CODEPOINTS', () => {
    for (const g of ['◇', '⟲', '─', '│', '┬', '┴', '├', '┤', '▶', '╭', '╮', '╰', '╯']) {
      expect(DIAGRAM_CODEPOINTS.has(g)).toBe(true);
    }
  });
});

describe('gateDiagram — pass 3: size (DES-124)', () => {
  it('over maxBytes (UTF-8 byte length, not .length) is GATE_REJECTED_SHAPE / size', () => {
    const r = gateDiagram('Draft '.repeat(60), ALLOWED, { maxBytes: 20, maxLines: 10 });
    expect(r).toEqual({ ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'size' });
  });

  it('over maxLines (newline count + 1) is GATE_REJECTED_SHAPE / size', () => {
    const raw = Array.from({ length: 5 }, () => 'Draft').join('\n');
    const r = gateDiagram(raw, ALLOWED, { maxBytes: 1000, maxLines: 2 });
    expect(r).toEqual({ ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'size' });
  });
});

describe('gateDiagram — pass 4: token, exact + case-sensitive allowlist membership (DES-124, REQ-102/A3)', () => {
  it('the bare secret literal is GATE_REJECTED_CONTENT / token — a model that tried to emit script-derived text', () => {
    const r = gateDiagram('╭─Draft─╮ ─▶ sk-live-abc123', new Set(['Draft']), LIMITS);
    expect(r).toEqual({ ok: false, reason: 'GATE_REJECTED_CONTENT', gateFail: 'token' });
  });

  it('the secret glued to a glyph (╭─sk-live-abc123─╮) is STILL GATE_REJECTED_CONTENT — exactness, no substring/prefix leniency', () => {
    const r = gateDiagram('╭─sk-live-abc123─╮', new Set([]), LIMITS);
    expect(r).toEqual({ ok: false, reason: 'GATE_REJECTED_CONTENT', gateFail: 'token' });
  });

  it('a token differing only by case from an allowed label is REJECTED — matching is exact and case-sensitive, no normalisation', () => {
    const r = gateDiagram('draft', new Set(['Draft']), LIMITS);
    expect(r).toEqual({ ok: false, reason: 'GATE_REJECTED_CONTENT', gateFail: 'token' });
  });

  it('a valid diagram whose every token is in allowedLabels is accepted, returned VERBATIM (byte-identical to input)', () => {
    const raw = '╭─Draft─╮ ─▶ ╭─Verify─╮\nmodel:param';
    const r = gateDiagram(raw, ALLOWED, LIMITS);
    expect(r).toEqual({ ok: true, diagram: raw });
  });
});
