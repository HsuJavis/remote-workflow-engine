// Owner decision 2026-10-02: per-principal CAS upload quota + disk floor — the config half.
// Pure: byte-size parsing and the two rwe.config.json validators composeConfig() runs (boot REFUSES
// a malformed value, ADR-028 fail-closed — never a silent default for a value clearly meant to be
// something else). Enforcement lives in CasStore (quota) and DiskFloor (disk floor).

/** A byte limit: a non-negative integer, or null = unlimited. */
export type ByteLimit = number | null;

/** Per-role CAS quota (bytes; null = unlimited). A pending ('none') principal is always 0. */
export interface CasQuotaConfig { user: ByteLimit; author: ByteLimit; admin: ByteLimit }
/** Disk floor: refuse uploads/admissions while free < max(percent% of the filesystem, bytes).
 *  percent 0 AND bytes 0 disables it. */
export interface DiskFloorConfig { percent: number; bytes: number }

const GiB = 1024 ** 3;
export const CAS_QUOTA_DEFAULTS: CasQuotaConfig = { user: GiB, author: 5 * GiB, admin: null };
export const DISK_FLOOR_DEFAULTS: DiskFloorConfig = { percent: 5, bytes: 5 * GiB };

const UNITS: Record<string, number> = {
  b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
};

/** A byte size from config/tool input: a non-negative integer, a numeric string with an optional
 *  unit (B, KB/MB/GB/TB decimal, KiB/MiB/GiB/TiB binary; case-insensitive), or `'unlimited'`/null
 *  (→ null). Anything else → undefined (the caller refuses it). Fractions are allowed with a unit
 *  and rounded down to whole bytes. */
export function parseByteSize(v: unknown): ByteLimit | undefined {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (s.toLowerCase() === 'unlimited') return null;
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(s);
  if (!m) return undefined;
  const unit = m[2]!.toLowerCase();
  const mult = unit === '' ? 1 : UNITS[unit];
  if (mult === undefined) return undefined;
  if (unit === '' && m[1]!.includes('.')) return undefined;
  const n = Math.floor(Number(m[1]) * mult);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Human rendering for messages: `1.5 GiB`, `512 MiB`, `800 B`, `unlimited`. */
export function formatBytes(n: ByteLimit): string {
  if (n === null) return 'unlimited';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : Number(v.toFixed(2))} ${units[i]}`;
}

type Validated<T> = { ok: true; value: T } | { ok: false; message: string };
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateCasQuotaConfig(raw: unknown): Validated<CasQuotaConfig> {
  if (raw === undefined) return { ok: true, value: { ...CAS_QUOTA_DEFAULTS } };
  if (!isPlainObject(raw)) return { ok: false, message: 'casQuota must be an object {user?, author?, admin?}' };
  const value: CasQuotaConfig = { ...CAS_QUOTA_DEFAULTS };
  for (const [k, v] of Object.entries(raw)) {
    if (k !== 'user' && k !== 'author' && k !== 'admin') return { ok: false, message: `casQuota.${k} is not a role (user | author | admin)` };
    const n = parseByteSize(v);
    if (n === undefined) return { ok: false, message: `casQuota.${k} must be a byte count, a size like "5GiB", or "unlimited"/null (got ${JSON.stringify(v)})` };
    value[k] = n;
  }
  return { ok: true, value };
}

export function validateDiskFloorConfig(raw: unknown): Validated<DiskFloorConfig> {
  if (raw === undefined) return { ok: true, value: { ...DISK_FLOOR_DEFAULTS } };
  if (!isPlainObject(raw)) return { ok: false, message: 'diskFloor must be an object {percent?, bytes?}' };
  const value: DiskFloorConfig = { ...DISK_FLOOR_DEFAULTS };
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'percent') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) return { ok: false, message: `diskFloor.percent must be a number 0..100 (got ${JSON.stringify(v)})` };
      value.percent = v;
    } else if (k === 'bytes') {
      const n = parseByteSize(v);
      if (n === undefined || n === null) return { ok: false, message: `diskFloor.bytes must be a byte count or a size like "5GiB" (got ${JSON.stringify(v)})` };
      value.bytes = n;
    } else {
      return { ok: false, message: `diskFloor.${k} is not a known key (percent | bytes)` };
    }
  }
  return { ok: true, value };
}
