// UT-245 (DES-203, ARCH-124/120, TASK-207, REQ-134/135): `lib/swimlane.js` — the geometry
// (`SWIMLANE_BOX`, `laneX`, `cellRect`, `edgePath`, `svgBox`) and the panel side (`panelSide`).
// REQ-134's seven layout constants verbatim, in ONE place.
//
// Tier: unit, `.js`, pure — no DOM, no fetch.
//
// Red reason (measured): `src/dashboard/lib/swimlane.js` does not exist (whole-file import
// failure).
import { describe, it, expect } from 'vitest';
import { SWIMLANE_BOX, laneX, cellRect, edgePath, svgBox, panelSide } from '../../src/dashboard/lib/swimlane.js';

describe('lib/swimlane.js (UT-245, DES-203, REQ-134)', () => {
  it('SWIMLANE_BOX deep-equals REQ-134\'s seven layout constants verbatim', () => {
    expect(SWIMLANE_BOX).toEqual({ PAD: 16, TRIG_W: 112, LANE_W: 216, LANE_GAP: 40, HEAD_H: 48, CELL_H: 74, GAP_Y: 14 });
  });

  it('svgBox over zero cells returns a MINIMUM box, never 0x0', () => {
    const box = svgBox([], 0, SWIMLANE_BOX);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it('svgBox over a 5-lane/9-agent fixture accounts for every lane\'s width', () => {
    const cells = Array.from({ length: 9 }, (_, i) => ({ lane: i % 5, slot: 0 }));
    const box = svgBox(cells, 5, SWIMLANE_BOX);
    expect(box.width).toBeGreaterThanOrEqual(SWIMLANE_BOX.TRIG_W + 5 * SWIMLANE_BOX.LANE_W);
  });

  it('edgePath emits a cubic (a "C" command) from the source right-mid to the target left-mid', () => {
    const from = { x: 0, y: 0, w: 216, h: 74 };
    const to = { x: 300, y: 100, w: 216, h: 74 };
    const path = edgePath(from, to);
    expect(path).toMatch(/^M.*C/);
    expect(path).toContain(`${from.x + from.w},${from.y + from.h / 2}`);
  });

  it('edgePath for a same-lane pair still emits a valid cubic path', () => {
    const from = { x: 0, y: 0, w: 216, h: 74 };
    const to = { x: 0, y: 88, w: 216, h: 74 };
    expect(edgePath(from, to)).toMatch(/^M.*C/);
  });

  it('laneX/cellRect over the fixture join by lane ORDINAL', () => {
    expect(laneX(0, SWIMLANE_BOX)).toBe(SWIMLANE_BOX.PAD + SWIMLANE_BOX.TRIG_W);
    expect(laneX(1, SWIMLANE_BOX)).toBe(SWIMLANE_BOX.PAD + SWIMLANE_BOX.TRIG_W + SWIMLANE_BOX.LANE_W + SWIMLANE_BOX.LANE_GAP);
    const rect = cellRect({ lane: 1, slot: 0 }, SWIMLANE_BOX);
    expect(rect.x).toBe(laneX(1, SWIMLANE_BOX));
    expect(rect.w).toBe(SWIMLANE_BOX.LANE_W);
    expect(rect.h).toBe(SWIMLANE_BOX.CELL_H);
  });

  it('panelSide is total and picks the LEFT slide for the right half (inclusive at exactly width/2)', () => {
    const width = 1000;
    expect(panelSide(0, width)).toBe('right');
    expect(panelSide(width / 2 - 1, width)).toBe('right');
    expect(panelSide(width / 2, width)).toBe('left');
    expect(panelSide(width / 2 + 1, width)).toBe('left');
    expect(panelSide(width, width)).toBe('left');
  });
});
