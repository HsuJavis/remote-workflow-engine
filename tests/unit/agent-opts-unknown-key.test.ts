// UT-165 (v25, issue #55, adjudication #9 I-1.4): an unknown key inside an `agent()` options
// literal is REFUSED at registration, naming the key and listing the ones that are accepted.
//
// Why this is the core of #55 rather than a nicety: `meta.params` has refused unknown keys since
// v21 (`PARAM_UNKNOWN`, four sites in `params/contract.ts`), while `agent()`'s options went through
// `scanAgentCalls`, where the code appeared ZERO times — so any key an author misspelled or
// invented was accepted, dropped, and never mentioned again. The v24 tmux cold subject diagnosed
// its small model correctly (a model handed a tool surface emits tool calls instead of prose),
// reached for the only spelling any surface showed it (`tools: []`), got silence, and spent ~15
// minutes and three extra registrations unwrapping tool-call envelopes in script. The capability it
// wanted was already shipped under the name `allowedTools`. A refusal naming the key — with the
// near-miss pointer this file pins — would have ended that in one registration.
//
// Same ruling as adjudication #2 A-2 (a retired `defaults` key must be REFUSED, not ignored) and
// #8's `tool-specs` contradiction: a knob that reads as accepted and does nothing is the failure
// mode, not the missing knob.
//
// Mock policy (unit tier): `scanAgentCalls` is a pure string scan — no mocks, no I/O, nothing to
// fake. The registration-level consequence — the same call refused `SCAN_VIOLATION` by a REAL
// catalog, which is where an author actually meets it — is IT-085's last case in
// `tests/integration/registration-enforcement.test.ts`.
//
// RED before the fix: every case below fails with `violations` = `[]` — the scanner had no notion
// of an unaccepted key at all.
import { describe, it, expect } from 'vitest';
import { scanAgentCalls } from '../../src/scan-agent-calls.js';

describe('unknown agent() option keys are refused at scan time (UT-165, #55)', () => {
  it('an invented key ⇒ PARAM_UNKNOWN naming that key', () => {
    const { violations } = scanAgentCalls('agent("plan", { prompt: "hi", nosuchknob: 1 });');
    const v = violations.find((x) => x.code === 'PARAM_UNKNOWN');
    expect(v).toBeDefined();
    expect(v?.key).toBe('nosuchknob');
    expect(v?.hint).toContain('nosuchknob');
    expect(v?.line).toBe(1);
  });

  it('the hint LISTS the accepted keys — a refusal that does not say what IS accepted just moves the guessing', () => {
    const { violations } = scanAgentCalls('agent("plan", { nosuchknob: 1 });');
    const hint = violations.find((x) => x.code === 'PARAM_UNKNOWN')?.hint ?? '';
    for (const accepted of ['prompt', 'label', 'phase', 'schema', 'isolation', 'mcp', 'allowedTools']) {
      expect(hint, `accepted key ${accepted} not listed`).toContain(accepted);
    }
  });

  // THE incident, reduced to one assertion. `tools` is the name the cold subject wrote.
  it('`tools` ⇒ PARAM_UNKNOWN whose hint points at `allowedTools`', () => {
    const { violations } = scanAgentCalls('agent("plan", { prompt: "p", tools: [] });');
    const v = violations.find((x) => x.code === 'PARAM_UNKNOWN');
    expect(v?.key).toBe('tools');
    expect(v?.hint).toMatch(/allowedTools/);
  });

  it('`allowedTools` itself is accepted — the capability was always there, only its name was undiscoverable', () => {
    const { violations } = scanAgentCalls('agent("plan", { prompt: "p", allowedTools: [] });');
    expect(violations).toEqual([]);
  });

  it('every other declared AgentOpts key is accepted (no false refusal of the documented surface)', () => {
    const src = 'agent("plan", { prompt: "p", label: "plan", phase: "one", schema: { type: "object" }, isolation: "worktree", mcp: ["fs"], allowedTools: ["Read"] });';
    expect(scanAgentCalls(src).violations).toEqual([]);
  });

  // The three engine-owned tunables keep their MORE SPECIFIC refusal: PARAM_IN_SCRIPT already tells
  // the author exactly where the value belongs, which a generic "unknown key" would throw away.
  it('model/effort/timeoutMs still answer PARAM_IN_SCRIPT, not PARAM_UNKNOWN', () => {
    const { violations } = scanAgentCalls('agent("plan", { model: "x", effort: "low", timeoutMs: 1000 });');
    expect(violations.map((v) => v.code)).toEqual(['PARAM_IN_SCRIPT', 'PARAM_IN_SCRIPT', 'PARAM_IN_SCRIPT']);
  });

  // `appendPrompt` is the FOURTH member of TUNABLE_KEYS and `scanAgentCalls` knew only three of
  // them — so an author who wrote it in the script got the same silence #55 is about. It is not an
  // unknown key (the contract declares it), it is a tunable in the wrong place: same refusal as its
  // three siblings, naming the declaration site that does work.
  it('appendPrompt ⇒ PARAM_IN_SCRIPT pointing at meta.params.agents.<label>.appendPrompt.default', () => {
    const { violations } = scanAgentCalls('agent("plan", { appendPrompt: "note" });');
    const v = violations.find((x) => x.code === 'PARAM_IN_SCRIPT');
    expect(v?.key).toBe('appendPrompt');
    expect(v?.hint).toContain('meta.params.agents.plan.appendPrompt.default');
  });

  // Conservative boundaries — a scan that refuses what it cannot read would break working scripts.
  it('a spread entry carries no key and is left alone', () => {
    expect(scanAgentCalls('agent("plan", { ...base, prompt: "p" });').violations).toEqual([]);
  });

  it('shorthand ({ prompt }) carries no colon and is left alone', () => {
    expect(scanAgentCalls('agent("plan", { prompt });').violations).toEqual([]);
  });

  it('a quoted key is unquoted before the check ("nosuchknob" refuses the same as nosuchknob)', () => {
    const { violations } = scanAgentCalls('agent("plan", { "nosuchknob": 1 });');
    expect(violations.find((x) => x.code === 'PARAM_UNKNOWN')?.key).toBe('nosuchknob');
  });

  it('a nested object value does not leak its inner keys into the check', () => {
    expect(scanAgentCalls('agent("plan", { schema: { type: "object", nosuchknob: 1 } });').violations).toEqual([]);
  });

  // KNOWN BOUNDARY, pinned so it is a documented limit rather than a surprise. DES-143 accepted
  // comment-blindness from the start (a commented-out `agent(` IS matched — cheaper than a comment
  // stripper), but before v25 that only misfired on a comment containing `model:`/`effort:`/
  // `timeoutMs:`; the closed check widens it to ANY colon in a comment inside the options literal.
  // The remedy is a shared `splitTopLevel` that skips comments, which is a change to the scanner's
  // one string-splitting primitive and does not belong in this fix.
  it('KNOWN LIMIT: a `//` comment carrying a colon inside the options literal reads as a key', () => {
    const src = "agent('a', {\n  prompt: 'x', // TODO: tune this\n  label: 'y',\n});";
    const { violations } = scanAgentCalls(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: 'PARAM_UNKNOWN', key: '// TODO' });
  });

  it('the near-miss hint reads as one sentence (this message is the entire point of the item)', () => {
    const hint = scanAgentCalls('agent("plan", { tools: [] });').violations[0]?.hint ?? '';
    expect(hint).toContain("did you mean 'allowedTools'? Accepted:");
    expect(hint, 'a stray "?." would make the one message #55 exists for read like a typo').not.toContain('?.');
  });

  it('`skills` — advertised in LOCKED_KEYS, never an agent() option — points at where it IS declared', () => {
    const hint = scanAgentCalls('agent("plan", { skills: ["x"] });').violations[0]?.hint ?? '';
    expect(hint).toContain('meta.params.agents.<label>.skills');
  });
});
