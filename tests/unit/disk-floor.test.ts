// Owner decision 2026-10-02 (disk floor): uploads and new run admissions are refused DISK_LOW
// {freeBytes, floorBytes} while the filesystem holding the workRoot/CAS has less free space than
// max(percent of the filesystem, bytes) — defaults 5% / 5 GiB, configurable `diskFloor`. statfs is
// read through a short cache (5 s). Also the human byte-size parser and the two config validators
// composeConfig() uses.
import { describe, it, expect } from 'vitest';
import { DiskFloor } from '../../src/disk-floor.js';
import { parseByteSize, validateCasQuotaConfig, validateDiskFloorConfig, CAS_QUOTA_DEFAULTS, DISK_FLOOR_DEFAULTS } from '../../src/cas-quota.js';

const GiB = 1024 ** 3;
const fs = (totalBytes: number, freeBytes: number) => ({ bsize: 4096, blocks: totalBytes / 4096, bavail: freeBytes / 4096 });

describe('DiskFloor', () => {
  it('floor = max(percent of the filesystem, bytes); ok while free >= floor', () => {
    let t = 0;
    let stat = fs(1000 * GiB, 60 * GiB);
    const d = new DiskFloor({ paths: ['/x'], percent: 5, bytes: 5 * GiB, statfs: () => stat, clock: () => t });
    expect(d.status()).toEqual({ ok: true, freeBytes: 60 * GiB, floorBytes: 50 * GiB });
    stat = fs(1000 * GiB, 40 * GiB); t += 6000;
    expect(d.status()).toEqual({ ok: false, freeBytes: 40 * GiB, floorBytes: 50 * GiB });
    // A small filesystem: the absolute floor dominates.
    const small = new DiskFloor({ paths: ['/x'], percent: 5, bytes: 5 * GiB, statfs: () => fs(20 * GiB, 4 * GiB), clock: () => 0 });
    expect(small.status()).toEqual({ ok: false, freeBytes: 4 * GiB, floorBytes: 5 * GiB });
  });

  it('assert() throws DISK_LOW with {freeBytes, floorBytes} detail', () => {
    const d = new DiskFloor({ paths: ['/x'], percent: 5, bytes: 5 * GiB, statfs: () => fs(20 * GiB, 1 * GiB), clock: () => 0 });
    expect(() => d.assert()).toThrow(expect.objectContaining({ code: 'DISK_LOW', detail: { freeBytes: 1 * GiB, floorBytes: 5 * GiB } }));
  });

  it('statfs is cached for 5 s', () => {
    let t = 0; let calls = 0;
    const d = new DiskFloor({ paths: ['/x'], percent: 5, bytes: 0, statfs: () => { calls++; return fs(100 * GiB, 50 * GiB); }, clock: () => t });
    d.status(); d.status(); t += 4999; d.status();
    expect(calls).toBe(1);
    t += 2; d.status();
    expect(calls).toBe(2);
  });

  it('with several paths (workRoot and a separate casDir) the worst filesystem decides', () => {
    const d = new DiskFloor({ paths: ['/a', '/b'], percent: 0, bytes: 10 * GiB, statfs: (p: string) => (p === '/a' ? fs(100 * GiB, 50 * GiB) : fs(100 * GiB, 3 * GiB)), clock: () => 0 });
    expect(d.status()).toEqual({ ok: false, freeBytes: 3 * GiB, floorBytes: 10 * GiB });
  });

  it('percent 0 and bytes 0 disables the floor (no statfs call)', () => {
    let calls = 0;
    const d = new DiskFloor({ paths: ['/x'], percent: 0, bytes: 0, statfs: () => { calls++; return fs(1, 0); }, clock: () => 0 });
    expect(d.status().ok).toBe(true);
    expect(() => d.assert()).not.toThrow();
    expect(calls).toBe(0);
  });

  it('a path statfs cannot read is skipped, not fatal', () => {
    const d = new DiskFloor({ paths: ['/missing', '/b'], percent: 0, bytes: GiB, statfs: (p: string) => { if (p === '/missing') throw new Error('ENOENT'); return fs(100 * GiB, 50 * GiB); }, clock: () => 0 });
    expect(d.status().ok).toBe(true);
  });
});

describe('byte sizes and config validation', () => {
  it('parseByteSize: integers, binary and decimal units, unlimited; junk is undefined', () => {
    expect(parseByteSize(1024)).toBe(1024);
    expect(parseByteSize('1GiB')).toBe(GiB);
    expect(parseByteSize('1.5 GiB')).toBe(1.5 * GiB);
    expect(parseByteSize('500MB')).toBe(500_000_000);
    expect(parseByteSize('10 KiB')).toBe(10240);
    expect(parseByteSize('2048')).toBe(2048);
    expect(parseByteSize('unlimited')).toBeNull();
    expect(parseByteSize(null)).toBeNull();
    for (const bad of [-1, 1.5, 'lots', '1 GiBs', '', {}, true, Number.NaN]) expect(parseByteSize(bad), String(bad)).toBeUndefined();
  });

  it('casQuota: defaults user 1 GiB / author 5 GiB / admin unlimited; partial values merge; bad values refuse', () => {
    expect(CAS_QUOTA_DEFAULTS).toEqual({ user: GiB, author: 5 * GiB, admin: null });
    expect(validateCasQuotaConfig(undefined)).toEqual({ ok: true, value: CAS_QUOTA_DEFAULTS });
    expect(validateCasQuotaConfig({ user: '2GiB', admin: 100 * GiB })).toEqual({ ok: true, value: { user: 2 * GiB, author: 5 * GiB, admin: 100 * GiB } });
    expect(validateCasQuotaConfig({ user: 'lots' }).ok).toBe(false);
    expect(validateCasQuotaConfig({ owner: 1 }).ok).toBe(false);
    expect(validateCasQuotaConfig([1]).ok).toBe(false);
  });

  it('diskFloor: defaults 5% / 5 GiB; partial merge; out-of-range refuses', () => {
    expect(DISK_FLOOR_DEFAULTS).toEqual({ percent: 5, bytes: 5 * GiB });
    expect(validateDiskFloorConfig(undefined)).toEqual({ ok: true, value: DISK_FLOOR_DEFAULTS });
    expect(validateDiskFloorConfig({ percent: 10 })).toEqual({ ok: true, value: { percent: 10, bytes: 5 * GiB } });
    expect(validateDiskFloorConfig({ bytes: '1GiB', percent: 0 })).toEqual({ ok: true, value: { percent: 0, bytes: GiB } });
    expect(validateDiskFloorConfig({ percent: 101 }).ok).toBe(false);
    expect(validateDiskFloorConfig({ bytes: 'unlimited' }).ok).toBe(false);
    expect(validateDiskFloorConfig({ extra: 1 }).ok).toBe(false);
  });
});
