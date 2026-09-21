// UT-300 (DES-244, ARCH-157/158/161, TASK-242, REQ-212/REQ-114): `Actor` replaces the overloaded
// `principal: string|null`; `canMutate(owner, actor)` is a pure exported predicate
// (`!owner || actor.bypass || owner === actor.id` — TRUTHINESS on `owner`, not `owner === null`,
// because a pre-v15 row can carry `owner === ''`); `actorFor(principal, args, gate)` mints the
// `Actor` PER CALL SITE (`'attribution'` for register/insertVersion, `'bypass'` for
// deregister/publish) so an admin registering over someone else's name is STILL refused
// `NOT_WORKFLOW_OWNER` (R-1 — the highest-severity finding: a single kind-keyed mapping would have
// granted admins an unrequested ownership-bypass on the one path that writes script bytes).
//
// Seam note for the implementer: `canMutate` is exported from `src/workflow-catalog.ts` (per
// DES-244's signature); `actorFor` is exported from `src/mcp-facade.ts` beside the existing
// (unexported) `bypassPrincipal`/`attributionPrincipal`/`bypassWithArg`/`attributionWithArg` — this
// test imports it directly, which is the seam Gate 5 asserts against.
//
// Red reason: neither `canMutate` nor `actorFor` exists yet — both imports fail module resolution
// (suite-level red).
//
// Mock policy (unit): pure functions, no I/O.
import { describe, it, expect } from 'vitest';
import { canMutate, type Actor } from '../../src/workflow-catalog.js';
import { actorFor } from '../../src/mcp-facade.js';
import type { Principal } from '../../src/authz.js';

/** The pre-v36 legacy predicate, reproduced exactly (not imported — it never had a name of its
 *  own): `owner && legacyId !== null && owner !== legacyId` gated the refusal, so "may mutate" is
 *  its negation. `legacyId` is `bypassPrincipal`/`bypassWithArg`'s answer for the 'bypass' gate,
 *  `attributionPrincipal`/`attributionWithArg`'s for the 'attribution' gate — reproduced inline so
 *  this test does not depend on either being exported. */
function legacyId(p: Principal, a: { principal?: string } | undefined, gate: 'bypass' | 'attribution'): string | null {
  const supplied = a?.principal;
  if (p.kind === 'auth-disabled' && typeof supplied === 'string' && supplied !== '') return supplied;
  if (gate === 'bypass') return p.kind === 'admin' || p.kind === 'auth-disabled' || p.kind === 'loopback-exempt' ? null : p.id;
  return p.kind === 'auth-disabled' || p.kind === 'loopback-exempt' ? null : p.id;
}
function legacyCanMutate(owner: string | null, legacy: string | null): boolean {
  return !(owner && legacy !== null && owner !== legacy);
}

const PRINCIPALS: Array<{ label: string; p: Principal; suppliedArg?: string }> = [
  { label: 'user', p: { kind: 'user', id: 'alice' } },
  { label: 'admin', p: { kind: 'admin', id: 'root-admin' } },
  { label: 'auth-disabled no arg', p: { kind: 'auth-disabled' } },
  { label: 'auth-disabled with args.principal', p: { kind: 'auth-disabled' }, suppliedArg: 'claimed-bob' },
  { label: 'loopback-exempt', p: { kind: 'loopback-exempt' } },
];
const OWNERS: Array<string | null> = [null, '', 'alice'];
const GATES: Array<'bypass' | 'attribution'> = ['bypass', 'attribution'];

describe('UT-300: canMutate/actorFor — one truthy predicate, minted per call site', () => {
  it('canMutate is exported and pure: !owner || actor.bypass || owner === actor.id', () => {
    expect(canMutate(null, { id: null, bypass: false, idSource: 'none' })).toBe(true);
    expect(canMutate('', { id: null, bypass: false, idSource: 'none' })).toBe(true); // !owner, NOT owner===null
    expect(canMutate('alice', { id: 'bob', bypass: true, idSource: 'authenticated' })).toBe(true);
    expect(canMutate('alice', { id: 'bob', bypass: false, idSource: 'authenticated' })).toBe(false);
    expect(canMutate('alice', { id: 'alice', bypass: false, idSource: 'authenticated' })).toBe(true);
  });

  it('the FULL cross-product table equals the legacy expression on every input', () => {
    for (const { p, suppliedArg } of PRINCIPALS) {
      for (const gate of GATES) {
        for (const owner of OWNERS) {
          const actor: Actor = actorFor(p, suppliedArg !== undefined ? { principal: suppliedArg } : {}, gate);
          const got = canMutate(owner, actor);
          const want = legacyCanMutate(owner, legacyId(p, suppliedArg !== undefined ? { principal: suppliedArg } : undefined, gate));
          expect(got).toBe(want);
        }
      }
    }
  });

  it("R-1: an admin registering (gate='attribution') over ANOTHER owner's name is STILL refused — the mint is per call site, not per Principal", () => {
    const admin: Principal = { kind: 'admin', id: 'root-admin' };
    const actor = actorFor(admin, {}, 'attribution');
    expect(canMutate('someone-else', actor)).toBe(false);
  });

  it("the SAME admin's deregister/publish (gate='bypass') still bypasses ownership, unchanged", () => {
    const admin: Principal = { kind: 'admin', id: 'root-admin' };
    const actor = actorFor(admin, {}, 'bypass');
    expect(canMutate('someone-else', actor)).toBe(true);
  });

  it('Actor has exactly three fields — id is ALWAYS the attribution answer, even while bypassing', () => {
    const admin: Principal = { kind: 'admin', id: 'root-admin' };
    const actor = actorFor(admin, {}, 'bypass');
    expect(actor).toEqual({ id: 'root-admin', bypass: true, idSource: 'authenticated' });
    expect((actor as unknown as { kind?: unknown }).kind).toBeUndefined();
  });

  it("an auth-disabled caller's args.principal is idSource:'claimed', never 'authenticated'", () => {
    const actor = actorFor({ kind: 'auth-disabled' }, { principal: 'self-declared-bob' }, 'bypass');
    expect(actor.id).toBe('self-declared-bob');
    expect(actor.idSource).toBe('claimed');
  });
});
