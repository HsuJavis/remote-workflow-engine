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
// What this file IS, stated honestly (round 5 corrected an overstatement here): cases 1-2 are a
// WORDING lock on the banner — they fail if the text drops a source or re-adds the false promise.
// They do NOT detect a deleted refusal in the code, because `admissionRefusal()` is a pure function
// of {posture, origin} and has no notion of the three sources. Case 4 covers that half by counting
// the predicate's call sites. Together they force a change to the admission surface to come back
// and re-read the banner; neither half alone would have.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('the confined banner promises nothing about refusals', () => {
    expect(admissionRefusal({ posture: 'confined', origin: 'remote' })).toBeNull();
    expect(confinementBannerLine({ posture: 'confined' })).not.toMatch(/refused/);
  });

  it('[LOAD-BEARING] deleting an admission CALL SITE must not leave this banner silently over-promising', () => {
    // v37 Gate 8 round-5 finding R5-F6. The first two cases above are a WORDING lock: they fail if
    // someone edits the banner, and pass if someone deletes a refusal from the code. That is the
    // weaker half, and round 5 was right to say so — `admissionRefusal()` is a pure function of
    // {posture, origin} with no notion of the three sources, so asserting it cannot detect a
    // deleted call site. The three sources are three CALL SITES, so the drift this case detects is
    // a change in their number: delete the version-side check in `start()`, or `runNested()`'s, or
    // `resume()`'s legacy-substitution one, and the count moves and this fails. It is a coarse lock
    // and deliberately so — its job is to force whoever changes the admission surface to come back
    // and re-read the banner, which is exactly what did not happen in round 4.
    const src = readFileSync(new URL('../../src/run-manager.ts', import.meta.url), 'utf8');
    const callSites = src.split('\n').filter((l) => /admissionRefusal\(\{/.test(l)).length;
    expect(callSites).toBe(4); // start() trigger-origin, start() version-origin, runNested(), resume() legacy substitution
    // …and the banner must still name one source per admission FACT (submission/trigger, version).
    const line = confinementBannerLine({ posture: 'unconfined', reason: 'x' });
    expect(line).toMatch(/remote submission/);
    expect(line).toMatch(/registered remotely/);
  });
});
