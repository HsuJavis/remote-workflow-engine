// UT-199 (DES-186, ARCH-120, ADR-044, TASK-191, v26, REQ-129): `dagBox(cells, box) → {width,
// height}` — pure, exported from dashboard.ts, the box math the client interpolates into `viewBox`.
// Written test-first (Gate 5, RED): `dagBox` does not exist yet.
// Mock policy (unit): pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { dagBox } from '../../src/dashboard.js';

describe('dagBox — pure box math for the run DAG viewBox (UT-199, DES-186)', () => {
  it('empty cells still yield a non-zero minimum box (never 0x0, which would vanish)', () => {
    const { width, height } = dagBox([]);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('a 9-agent 5-phase layout yields a box wide enough for 5 columns', () => {
    const cells = Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, kind: 'agent' as const, col: (i % 5) + 1, row: Math.floor(i / 5), laneSpan: 1 }));
    const box = dagBox(cells, { cellW: 140, cellH: 44, gap: 14 });
    expect(box.width).toBeGreaterThanOrEqual(5 * 140);
  });

  it('the default box dims are used when none supplied', () => {
    const cells = [{ id: 'a', kind: 'agent' as const, col: 1, row: 0, laneSpan: 1 }];
    const box = dagBox(cells);
    expect(box.width).toBeGreaterThan(0);
  });
});
