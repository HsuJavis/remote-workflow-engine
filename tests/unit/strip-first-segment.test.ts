// UT-235 (DES-195, ARCH-129, ADR-050, TASK-200, REQ-136/094): `stripFirstSegment` — a
// prefix-VERIFIED slice, total over six cases, that fails CLOSED (never returns the composed
// string unstripped) when the prefix it expects is absent.
//
// Tier: unit, pure — no gateway, no store, no clock.
//
// Red reason (measured): `src/params/resolve.ts` exports no `stripFirstSegment` at all
// (`TypeError: stripFirstSegment is not a function`) — only its inverse, `composePrompt`, exists.
import { describe, it, expect } from 'vitest';
import { composePrompt, stripFirstSegment } from '../../src/params/resolve.js';

describe('stripFirstSegment (UT-235, DES-195)', () => {
  it('(1) sys undefined -> {composed, stripped:false}, composed untouched', () => {
    const composed = composePrompt(undefined, 'author', 'script', undefined);
    expect(stripFirstSegment(composed, undefined)).toEqual({ prompt: composed, stripped: false });
  });

  it("(1b) sys '' -> {composed, stripped:false} (empty is 'no segment applied', same as undefined)", () => {
    const composed = composePrompt('', 'author', 'script', undefined);
    expect(stripFirstSegment(composed, '')).toEqual({ prompt: composed, stripped: false });
  });

  it('(2) composed.startsWith(sys + "\\n\\n") -> slice(sys.length + 2), stripped:true', () => {
    const sys = 'You are a researcher.';
    const composed = composePrompt(sys, 'author default', 'script prompt', undefined);
    const result = stripFirstSegment(composed, sys);
    expect(result.stripped).toBe(true);
    expect(result.prompt).toBe(composePrompt(undefined, 'author default', 'script prompt', undefined));
    expect(result.prompt.includes(sys)).toBe(false);
  });

  it('(3) composed === sys (empty-script degenerate) -> {"", stripped:true}', () => {
    const sys = 'only a system prompt';
    expect(stripFirstSegment(sys, sys)).toEqual({ prompt: '', stripped: true });
  });

  it('(4) prefix ABSENT -> fail CLOSED: {"", stripped:false} — never returns composed unstripped', () => {
    const result = stripFirstSegment('a completely different string', 'expected system prompt');
    expect(result).toEqual({ prompt: '', stripped: false });
  });

  it('(5) sys containing internal "\\n\\n" is irrelevant — case (2) still matches the WHOLE sys', () => {
    const sys = 'line one\n\nline two';
    const composed = composePrompt(sys, undefined, 'script', undefined);
    const result = stripFirstSegment(composed, sys);
    expect(result).toEqual({ prompt: 'script', stripped: true });
  });

  it('(6) the slice is by UTF-16 code units — a CJK system prompt is not corrupted', () => {
    const sys = '你是一個研究助理。';
    const composed = composePrompt(sys, undefined, 'script prompt', undefined);
    const result = stripFirstSegment(composed, sys);
    expect(result.prompt).toBe('script prompt');
  });

  it('property: stripFirstSegment(composePrompt(s,a,p,ap), s).prompt === composePrompt(undefined,a,p,ap) over a table including empties', () => {
    const table: Array<[string | undefined, string | undefined, string, string | undefined]> = [
      ['sys', 'author', 'script', 'append'],
      ['sys', undefined, '', undefined],
      ['', undefined, 'script', undefined],
      ['sys', '', 'script', 'append'],
    ];
    for (const [s, a, p, ap] of table) {
      const composed = composePrompt(s, a, p, ap);
      const result = stripFirstSegment(composed, s);
      expect(result.prompt).toBe(composePrompt(undefined, a, p, ap));
    }
  });
});
