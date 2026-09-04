// UT-103 (DES-110, ARCH-071, TASK-105): `resolveVersionRequest` — the total, pure resolution truth
// table (no DB). One case per table row + the 4 declared collision cases (DES-110's own words).
//
// Mock policy (unit, DES-119): pure function, zero I/O — `known` is a plain ReadonlySet<string>.
//
// Red reason: `resolveVersionRequest` is not exported from `src/workflow-catalog.js` today (the
// catalog has no version-resolution concept at all) → MODULE export missing, "not a function" at
// call time. Correct red for unimplemented behaviour.
import { describe, it, expect } from 'vitest';
// Value import — DES-110's last bullet: "Exported pure function in workflow-catalog.ts; not a
// separate module (one caller)."
import { resolveVersionRequest } from '../../src/workflow-catalog.js';

const KNOWN = new Set(['v1', 'v2', 'v3']);

describe('resolveVersionRequest truth table (DES-110, UT-103)', () => {
  // Row 1
  it('row 1: an invalid channel token is refused INVALID_CHANNEL, regardless of version', () => {
    const r = resolveVersionRequest({ channel: 'nightly' as never }, { release: 'v1', beta: null }, KNOWN);
    expect(r).toMatchObject({ ok: false, code: 'INVALID_CHANNEL', channel: 'nightly' });
  });

  // Row 2
  it('row 2: an explicit known version wins over any channel (REQ-097 "regardless of any channel")', () => {
    const r = resolveVersionRequest({ version: 'v2', channel: 'beta' }, { release: 'v1', beta: 'v3' }, KNOWN);
    expect(r).toMatchObject({ ok: true, version: 'v2', requested: { kind: 'version', version: 'v2' } });
  });

  // Row 3
  it('row 3: an unknown explicit version is refused UNKNOWN_VERSION', () => {
    const r = resolveVersionRequest({ version: 'v99' }, { release: 'v1', beta: null }, KNOWN);
    expect(r).toMatchObject({ ok: false, code: 'UNKNOWN_VERSION', version: 'v99' });
  });

  // Row 4
  it('row 4: a channel with a NULL pointer is refused CHANNEL_UNPUBLISHED, never a fallback to newest', () => {
    const r = resolveVersionRequest({ channel: 'beta' }, { release: 'v1', beta: null }, KNOWN);
    expect(r).toMatchObject({ ok: false, code: 'CHANNEL_UNPUBLISHED', channel: 'beta' });
  });

  // Row 5 — unreachable invariant (no per-version delete exists to produce it), asserted structurally.
  it('row 5: a channel pointer aimed at a version absent from `known` is DANGLING_CHANNEL (unreachable invariant)', () => {
    const r = resolveVersionRequest({ channel: 'release' }, { release: 'v7-gone', beta: null }, KNOWN);
    expect(r).toMatchObject({ ok: false, code: 'DANGLING_CHANNEL' });
  });

  // Row 6
  it('row 6: no selector, release unpublished → CHANNEL_UNPUBLISHED naming "release"', () => {
    const r = resolveVersionRequest({}, { release: null, beta: 'v2' }, KNOWN);
    expect(r).toMatchObject({ ok: false, code: 'CHANNEL_UNPUBLISHED', channel: 'release' });
  });

  // Row 7 — the default path every plain run_start({name}) takes.
  it('row 7: no selector, release published → resolves to the release pointer, requested:{kind:default-release}', () => {
    const r = resolveVersionRequest({}, { release: 'v2', beta: null }, KNOWN);
    expect(r).toMatchObject({ ok: true, version: 'v2', requested: { kind: 'default-release' } });
  });

  it('an explicit {channel} selector (no version) echoes requested:{kind:channel,channel}', () => {
    const r = resolveVersionRequest({ channel: 'beta' }, { release: 'v1', beta: 'v3' }, KNOWN);
    expect(r).toMatchObject({ ok: true, version: 'v3', requested: { kind: 'channel', channel: 'beta' } });
  });

  describe('declared collision cases (DES-110)', () => {
    it('unknown version + invalid channel ⇒ INVALID_CHANNEL (channel guard runs first)', () => {
      const r = resolveVersionRequest({ version: 'v99', channel: 'nightly' as never }, { release: 'v1', beta: null }, KNOWN);
      expect(r).toMatchObject({ ok: false, code: 'INVALID_CHANNEL' });
    });

    it('known version + invalid channel ⇒ INVALID_CHANNEL (channel guard runs before the version win)', () => {
      const r = resolveVersionRequest({ version: 'v2', channel: 'nightly' as never }, { release: 'v1', beta: null }, KNOWN);
      expect(r).toMatchObject({ ok: false, code: 'INVALID_CHANNEL' });
    });

    it('known version + unpublished channel ⇒ the version wins, no CHANNEL_UNPUBLISHED', () => {
      const r = resolveVersionRequest({ version: 'v2', channel: 'beta' }, { release: 'v1', beta: null }, KNOWN);
      expect(r).toMatchObject({ ok: true, version: 'v2' });
    });

    it('unknown version + valid channel ⇒ UNKNOWN_VERSION (version is checked before channel is consulted)', () => {
      const r = resolveVersionRequest({ version: 'v99', channel: 'beta' }, { release: 'v1', beta: 'v2' }, KNOWN);
      expect(r).toMatchObject({ ok: false, code: 'UNKNOWN_VERSION' });
    });
  });
});
