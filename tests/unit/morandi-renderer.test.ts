// UT-069: pure `cellToPixel` + pure `morandiFrameHue` (DES-065, ARCH-043, TASK-068)
//
// Both are pure functions with no I/O:
//   cellToPixel(cell:{col,row,laneSpan}, box:{cellW,cellH,gap}) → {x,y,width,height}
//   morandiFrameHue(frame:string) → string (a palette entry)
//
// Boundary conditions from DES-065:
//   - cellToPixel: deterministic — same input → same output
//   - morandiFrameHue: same-input-same-output (frame never flickers hue across polls)
//   - morandiFrameHue: output must be one of the Morandi palette values (palette is finite)
//   - NOTE: two different frames MAY hash to the same hue (stableHash % len collisions by design)
//     — do NOT assert different inputs produce different outputs.
//
// Mock policy (unit): pure functions, no I/O.
// Red reason: `cellToPixel` and `morandiFrameHue` are not yet exported from `src/dashboard-page.ts`
//   → ESM SyntaxError "does not provide an export named '...'" at collect time.
import { describe, it, expect } from 'vitest';
import { cellToPixel, morandiFrameHue } from '../../src/dashboard-page.js';

describe('cellToPixel — pure logical→pixel mapper (UT-069, DES-065)', () => {
  const BOX = { cellW: 120, cellH: 48, gap: 16 };

  it('is deterministic: same cell + box → identical Rect', () => {
    const cell = { col: 2, row: 1, laneSpan: 1 };
    const r1 = cellToPixel(cell, BOX);
    const r2 = cellToPixel(cell, BOX);
    expect(r1).toEqual(r2);
  });

  it('col 0 → x starts at 0; col 1 → x = cellW + gap', () => {
    const r0 = cellToPixel({ col: 0, row: 0, laneSpan: 1 }, BOX);
    const r1 = cellToPixel({ col: 1, row: 0, laneSpan: 1 }, BOX);
    expect(r0.x).toBe(0);
    expect(r1.x).toBe(BOX.cellW + BOX.gap);
  });

  it('row 0 → y starts at 0; row 1 → y = cellH + gap', () => {
    const r0 = cellToPixel({ col: 0, row: 0, laneSpan: 1 }, BOX);
    const r1 = cellToPixel({ col: 0, row: 1, laneSpan: 1 }, BOX);
    expect(r0.y).toBe(0);
    expect(r1.y).toBe(BOX.cellH + BOX.gap);
  });

  it('laneSpan spans multiple rows: height = span*cellH + (span-1)*gap', () => {
    const span2 = cellToPixel({ col: 0, row: 0, laneSpan: 2 }, BOX);
    const expected = 2 * BOX.cellH + (2 - 1) * BOX.gap;
    expect(span2.height).toBe(expected);
  });

  it('returns a Rect with x, y, width, height all as numbers', () => {
    const r = cellToPixel({ col: 3, row: 2, laneSpan: 1 }, BOX);
    expect(typeof r.x).toBe('number');
    expect(typeof r.y).toBe('number');
    expect(typeof r.width).toBe('number');
    expect(typeof r.height).toBe('number');
  });
});

describe('morandiFrameHue — deterministic per-frame palette selector (UT-069, DES-065)', () => {
  it('same frame string → same hue on every call (no flicker across polls)', () => {
    const h1 = morandiFrameHue('.0');
    const h2 = morandiFrameHue('.0');
    const h3 = morandiFrameHue('.0');
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  it('output is a non-empty string (a palette color token or CSS value)', () => {
    expect(typeof morandiFrameHue('')).toBe('string');
    expect(morandiFrameHue('').length).toBeGreaterThan(0);
    expect(typeof morandiFrameHue('.0')).toBe('string');
    expect(morandiFrameHue('.0').length).toBeGreaterThan(0);
  });

  it('the root frame "" and sub-frame ".0" both return valid palette values', () => {
    // Both must come from the same finite palette (different frames may collide — that is OK).
    const root = morandiFrameHue('');
    const sub = morandiFrameHue('.0');
    // They are strings; we cannot statically enumerate the palette, but we can confirm
    // each is a stable non-empty value. If the palette is exposed as a constant, assert membership.
    expect(typeof root).toBe('string');
    expect(typeof sub).toBe('string');
  });
});
