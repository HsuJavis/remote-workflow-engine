// src/dashboard/lib/swimlane.js
// DES-203, ARCH-124/120, TASK-207, REQ-134/135 — the swimlane geometry (REQ-134's seven layout
// constants, in ONE place — the server needs none of them) and the panel slide side (REQ-135).
// Pure and total: no DOM, no fetch.

export const SWIMLANE_BOX = { PAD: 16, TRIG_W: 112, LANE_W: 216, LANE_GAP: 40, HEAD_H: 48, CELL_H: 74, GAP_Y: 14 };

// Lanes sit right of the trigger column, joined by ORDINAL (the same integer `layoutGraph` lays
// out) rather than by re-matching a title string.
export function laneX(index, box) {
  return box.PAD + box.TRIG_W + index * (box.LANE_W + box.LANE_GAP);
}

export function cellRect(cell, box) {
  return {
    x: laneX(cell.lane, box),
    y: box.PAD + box.HEAD_H + cell.slot * (box.CELL_H + box.GAP_Y),
    w: box.LANE_W,
    h: box.CELL_H,
  };
}

// A cubic bézier from the source's right-mid to the target's left-mid.
export function edgePath(from, to) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const midX = (x1 + x2) / 2;
  return `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
}

// The viewBox for the whole graph — the swimlane's successor to `dagBox`. Never `0x0` over zero
// cells/lanes, or the SVG vanishes.
export function svgBox(cells, laneCount, box) {
  const lanesWidth = laneCount > 0 ? laneCount * box.LANE_W + (laneCount - 1) * box.LANE_GAP : 0;
  const width = box.PAD * 2 + box.TRIG_W + lanesWidth;
  const maxSlot = cells.reduce((max, c) => Math.max(max, c.slot ?? 0), -1);
  const rows = Math.max(maxSlot + 1, 1);
  const height = box.PAD * 2 + box.HEAD_H + rows * box.CELL_H + (rows - 1) * box.GAP_Y;
  return { width, height };
}

// REQ-135's slide direction is a comparison, and total at exactly graphWidth/2: the right half
// (inclusive of the midpoint) slides the panel in from the LEFT.
export function panelSide(nodeCenterX, graphWidth) {
  return nodeCenterX >= graphWidth / 2 ? 'left' : 'right';
}
