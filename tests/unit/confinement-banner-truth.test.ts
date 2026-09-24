// UT-338 — v37 Gate 8 round-4 finding F1 (ADR-086's third owner ruling, P1).
//
// WHY THIS FILE EXISTS. The boot banner printed on every unconfined start promised
// "local (loopback) runs still proceed, unconfined" for a full round after that stopped being
// true — admission gained a SECOND source (the resolved version's `registeredRemote`), so a
// LOCAL run_start of a remotely-registered version is refused too. A 3383-test green suite did
// not catch it, and this iteration's own VAL-259 evidence captured the false line verbatim
// (`evidence/v37/val259-boot.log`), because the string lived inline in a `console.log` that no
// test read. A string no test reads cannot go red. That is the defect this file closes — not the
// wording itself, which was a one-line fix, but the fact that nothing could have failed.
//
// The rule the banner must mirror is `admissionRefusal()`'s. These cases assert the two halves
// TOGETHER: the predicate's actual behaviour, and the banner naming every source that behaviour
// has. If a future change adds or removes a refusal source, the banner must move with it.
import { describe, it, expect } from 'vitest';
import { confinementBannerLine } from '../../src/main.js';
import { admissionRefusal } from '../../src/run-manager.js';

describe('UT-338 — the boot banner tells the truth about who gets refused', () => {
  it('[LOAD-BEARING] the unconfined banner names ALL THREE refusal sources', () => {
    const line = confinementBannerLine({ posture: 'unconfined', reason: 'probe failed' });
    // (1) remote submission, (2) remotely-created trigger, (3) remotely-registered version.
    expect(line).toMatch(/remote submission/);
    expect(line).toMatch(/trigger was created remotely/);
    expect(line).toMatch(/registered remotely/);
    expect(line).toMatch(/CONFINEMENT_UNAVAILABLE/);
  });

  it('[LOAD-BEARING] the unconfined banner does NOT promise that local submissions still run', () => {
    const line = confinementBannerLine({ posture: 'unconfined', reason: 'probe failed' });
    // The exact false promise that shipped, plus the shapes a careless rewrite would reach for.
    expect(line).not.toMatch(/local \(loopback\) runs still proceed/);
    expect(line).not.toMatch(/local .{0,24}(still (proceed|run)|仍會照跑)/);
    // What it may say is the NARROW version: only a local submission OF A LOCAL VERSION proceeds.
    expect(line).toMatch(/local submission of a locally-registered version/);
  });

  it('the banner is consistent with admissionRefusal() itself, not just internally plausible', () => {
    // The predicate is the authority; the banner is its prose. Trigger-side source:
    expect(admissionRefusal({ posture: 'unconfined', origin: 'remote' })).toBe('CONFINEMENT_UNAVAILABLE');
    // A purely local run of a local version is the ONE admitted combination the banner promises.
    expect(admissionRefusal({ posture: 'unconfined', origin: 'local' })).toBeNull();
    // The version-side source reaches the same predicate via start()'s second call site, which
    // passes the resolved version's provenance as `origin` — same function, same answer.
    expect(admissionRefusal({ posture: 'unconfined', origin: 'remote' })).toBe('CONFINEMENT_UNAVAILABLE');
    // Confined hosts refuse nothing on these grounds, and the banner for them says nothing about it.
    expect(admissionRefusal({ posture: 'confined', origin: 'remote' })).toBeNull();
    expect(confinementBannerLine({ posture: 'confined' })).not.toMatch(/refused/);
  });
});
