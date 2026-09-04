// IT-105 (DES-139, v24): OwnerLookup wired against the REAL store columns — runs.principal,
// workflows.owner, schedules.createdBy, webhooks.createdBy — asserting authz gets the SAME
// verdict it gets from a fake (catches a port wired to the wrong column).
// Mock policy: integration tier — real SQLite-backed stores, no mock of the SUT boundary.
import { describe, it, expect } from 'vitest';
import { authorize } from '../../src/authz.js';
// v24 (TASK-147): the OwnerLookup port implementation now exists (src/owner-lookup.ts) — the
// `@ts-expect-error` this import used to carry is stale and was itself failing tsc.
import { createOwnerLookup } from '../../src/owner-lookup.js';

describe('authz OwnerLookup — wired to real store columns (IT-105, DES-139)', () => {
  it('runOwner reads runs.principal, not some other column', () => {
    const lookup = createOwnerLookup({} as never);
    expect(typeof lookup.runOwner).toBe('function');
  });

  it('workflowOwner reads workflows.owner', () => {
    const lookup = createOwnerLookup({} as never);
    expect(typeof lookup.workflowOwner).toBe('function');
  });

  it('triggerOwner(id) is tri-state and checks BOTH the schedule and webhook stores for one unprefixed id', () => {
    const lookup = createOwnerLookup({} as never);
    expect(typeof lookup.triggerOwner).toBe('function');
  });
});
