// v38 (issue #97 item 3): webhook_create's description is the ONLY place a cold MCP client sees the
// full delivery contract (the moment it receives `secret` and never again). This pins the stated
// facts against the REAL constants/behaviour they describe — src/webhook-registry.ts's exported
// WEBHOOK_HEADERS / REPLAY_WINDOW_MS and its deliver() implementation — so a description edit that
// silently drifts from the code (a renamed header, a changed skew window) fails here instead of
// shipping a wrong contract to every remote client.
// Mock policy (unit): pure data assertion over TOOL_SPECS + the real exported constants; no I/O.
import { describe, it, expect } from 'vitest';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { WEBHOOK_HEADERS, REPLAY_WINDOW_MS } from '../../src/webhook-registry.js';
import { ADMISSION_PERMANENT_CODES } from '../../src/run-manager.js';

function webhookCreateDescription(): string {
  const spec = TOOL_SPECS.find((s) => s.name === 'webhook_create');
  if (!spec) throw new Error('webhook_create not found in TOOL_SPECS');
  return spec.description;
}

describe('webhook_create description pins the real delivery contract (issue #97 item 3)', () => {
  it('names the three real header constants — never a hand-typed copy that could drift', () => {
    const d = webhookCreateDescription();
    expect(d).toContain(WEBHOOK_HEADERS.signature);
    expect(d).toContain(WEBHOOK_HEADERS.timestamp);
    expect(d).toContain(WEBHOOK_HEADERS.deliveryId);
  });

  it('states the signature format as sha256=<hex HMAC-SHA256 of the raw body>, and that the timestamp is NOT signed', () => {
    const d = webhookCreateDescription();
    expect(d).toMatch(/sha256=/);
    expect(d).toMatch(/HMAC-SHA256/);
    expect(d.toLowerCase()).toContain('raw body');
    expect(d).toMatch(/timestamp is NOT part of what is signed/);
  });

  it('states the real timestamp skew window, derived from REPLAY_WINDOW_MS (never a hardcoded duplicate)', () => {
    const d = webhookCreateDescription();
    expect(d).toContain(`${REPLAY_WINDOW_MS / 1000}s`);
  });

  it('documents #88 replay semantics: an accepted or permanently-refused delivery replays; a transient failure does not', () => {
    const d = webhookCreateDescription();
    expect(d).toMatch(/issue #88/);
    expect(d).toMatch(/NEW id/);
    expect(d.toLowerCase()).toContain('reprocesses for real');
  });

  it('states x-rwe-delivery is OPTIONAL and that omitting it means no dedup at all', () => {
    const d = webhookCreateDescription();
    expect(d).toMatch(/OPTIONAL/);
    expect(d.toLowerCase()).toContain('no dedup at all');
  });

  it('states the parsed body reaches the started script as args.event', () => {
    const d = webhookCreateDescription();
    expect(d).toContain('args.event');
  });

  it('states the disabled-webhook check precedes signature verification (403 before 401)', () => {
    const d = webhookCreateDescription();
    expect(d).toMatch(/checked BEFORE the signature/);
  });

  it('documents every response code the real POST /hooks/:id route can answer: 202/200/401/403/404/409/500/503', () => {
    const d = webhookCreateDescription();
    for (const code of ['202', '200', '401', '403', '404', '409', '500', '503']) {
      expect(d, `missing response code ${code}`).toContain(code);
    }
    // the two 2xx body shapes specifically
    expect(d).toContain('{runId}');
    expect(d).toMatch(/\{replayed:\s*true/);
  });

  // Webhook B2 (dash-auth-spec.md §B2): the description now states the SIZE of the 409
  // admission-permanent-refusal family — derived from `ADMISSION_PERMANENT_CODES`
  // (run-manager.ts), never a hand-typed number — so a code added to or removed from that table
  // fails HERE instead of shipping a description whose count silently drifted from the code.
  it("states the 409 admission-refusal family's real size, derived from ADMISSION_PERMANENT_CODES (never a hand-typed count)", () => {
    const d = webhookCreateDescription();
    expect(d).toContain(`one of ${ADMISSION_PERMANENT_CODES.length} PERMANENT admission-time refusals`);
  });

  it('distinguishes the TWO distinct 409 families: a claim-state refusal (never recorded, retryable once fixed) vs an admission-time refusal (recorded + replayed, same as 403)', () => {
    const d = webhookCreateDescription();
    expect(d).toMatch(/CLAIM-STATE refusal.*never recorded/);
    expect(d).toMatch(/PERMANENT admission-time refusals/);
  });

  it('documents that 500 is transient and NOT recorded, unlike the 403/409 permanent family', () => {
    const d = webhookCreateDescription();
    expect(d).toMatch(/500 an admission fault.*transient, NOT recorded/);
  });
});
