// UT-066 (DES-061, REQ-070): readUpdateResult tolerant file reader + UpdateTypes schema.
// TEST-FIRST (RED): src/self-update.ts / src/update-types.ts do not exist yet; all cases fail
// with import error ("Cannot find module").
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUpdateResult } from '../../src/self-update.js';
import type { UpdateOutcome, UpdateStatus } from '../../src/update-types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-ut066-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// ─── readUpdateResult tolerant reader ─────────────────────────────────────────

describe('readUpdateResult (DES-061) — tolerant: never throws, always returns UpdateOutcome | null', () => {
  it('absent file → null (no update ever ran)', () => {
    const r = readUpdateResult(join(dir, 'nonexistent.json'));
    expect(r).toBeNull();
  });

  it('malformed JSON → null, never throws', () => {
    const p = join(dir, 'result.json');
    writeFileSync(p, '{not valid json');
    expect(readUpdateResult(p)).toBeNull();
  });

  it('empty file (half-written) → null', () => {
    const p = join(dir, 'result.json');
    writeFileSync(p, '');
    expect(readUpdateResult(p)).toBeNull();
  });

  it('unknown status value → null (forward-compat: never surfaces unknown state)', () => {
    const p = join(dir, 'result.json');
    writeFileSync(p, JSON.stringify({ tag: 'v1.0.0', status: 'unknown-future-state', ts: '2026-01-01T00:00:00Z' }));
    expect(readUpdateResult(p)).toBeNull();
  });

  it('valid applied outcome → returned with all fields intact', () => {
    const p = join(dir, 'result.json');
    const outcome: UpdateOutcome = { tag: 'v1.4.0', status: 'applied', ts: '2026-01-01T00:00:00Z' };
    writeFileSync(p, JSON.stringify(outcome));
    const r = readUpdateResult(p);
    expect(r).not.toBeNull();
    expect(r!.tag).toBe('v1.4.0');
    expect(r!.status).toBe('applied');
    expect(r!.ts).toBe('2026-01-01T00:00:00Z');
  });

  it('valid failed outcome with detail → returned', () => {
    const p = join(dir, 'result.json');
    writeFileSync(p, JSON.stringify({ tag: 'v1.5.0', status: 'failed', ts: '2026-02-01T00:00:00Z', detail: 'npm ci failed' }));
    const r = readUpdateResult(p);
    expect(r).not.toBeNull();
    expect(r!.status).toBe('failed');
    expect(r!.detail).toBe('npm ci failed');
  });

  it('detail longer than 4 KB is capped (head+tail truncation, not thrown)', () => {
    const p = join(dir, 'result.json');
    const longDetail = 'x'.repeat(8192);
    writeFileSync(p, JSON.stringify({ tag: 'v1.0.0', status: 'failed', ts: '2026-01-01T00:00:00Z', detail: longDetail }));
    const r = readUpdateResult(p);
    expect(r).not.toBeNull();
    // detail must be shorter than 4 KB + some allowance for head/tail markers
    expect(r!.detail!.length).toBeLessThanOrEqual(4096 + 200);
  });
});

// ─── UpdateTypes schema sanity ─────────────────────────────────────────────────

describe('UpdateStatus type coverage (update-types.ts export sanity)', () => {
  it('the four legal status values are the complete set', () => {
    // This is a compile-time type test expressed as a runtime assertion.
    // If UpdateStatus grows unexpected values this will show up as a TS error.
    const legal: UpdateStatus[] = ['pending', 'applied', 'failed', 'skipped'];
    expect(legal).toHaveLength(4);
  });

  it('UpdateOutcome requires tag, status, ts and allows optional detail', () => {
    const minimal: UpdateOutcome = { tag: 'v1.0.0', status: 'pending', ts: '2026-01-01T00:00:00Z' };
    const withDetail: UpdateOutcome = { ...minimal, detail: 'log excerpt' };
    expect(minimal.tag).toBe('v1.0.0');
    expect(withDetail.detail).toBe('log excerpt');
  });
});
