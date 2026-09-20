// UT (DES-236, ARCH-148, ADR-068, TASK-232, REQ-208): `nonCodeSpans` — the acorn span oracle.
// Fail-closed, no masking (returns spans, not masked text — masking would blank a label literal
// too). Written test-first (Gate 5, RED) — `src/script-spans.ts` does not exist yet.
//
// Mock policy (unit): pure function, no I/O — acorn is a production dependency (TASK-232), not a
// mock here.
import { describe, it, expect } from 'vitest';
import { nonCodeSpans } from '../../src/script-spans.js';

function textIn(script: string, span: [number, number]): string {
  return script.slice(span[0], span[1]);
}

describe('nonCodeSpans (DES-236)', () => {
  it('a string literal is one span, and the offsets are in the INPUT coordinate system', () => {
    const script = `const x = "agent (fake)";`;
    const r = nonCodeSpans(script);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const idx = script.indexOf('"agent (fake)"');
    expect(r.spans.some(([s, e]: [number, number]) => s === idx && e === idx + '"agent (fake)"'.length)).toBe(true);
  });

  it('a template literal\'s ${…} expression is CODE and must NOT be spanned, only the quasis', () => {
    const script = 'const y = `before ${agent(1)} after`;';
    const r = nonCodeSpans(script);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const exprStart = script.indexOf('agent(1)');
    expect(r.spans.some(([s, e]: [number, number]) => exprStart >= s && exprStart < e)).toBe(false);
    // the quasis themselves ("before ${" ... "} after`") ARE non-code
    const beforeIdx = script.indexOf('before ');
    expect(r.spans.some(([s, e]: [number, number]) => beforeIdx >= s && beforeIdx < e)).toBe(true);
  });

  it('an escaped quote inside a string literal does not end the span early', () => {
    const script = String.raw`const z = "agent (\"quoted\")";`;
    const r = nonCodeSpans(script);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const litStart = script.indexOf('"agent');
    const litEnd = script.lastIndexOf('"') + 1;
    expect(r.spans.some(([s, e]: [number, number]) => s === litStart && e === litEnd)).toBe(true);
  });

  it('both comment forms (// and /* */) are spanned, including a comment carrying an apostrophe', () => {
    const script = `// agent's call (mode A)\nconst a = 1; /* agent (block) */`;
    const r = nonCodeSpans(script);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lineStart = 0;
    const blockStart = script.indexOf('/* agent');
    expect(r.spans.some(([s, e]: [number, number]) => lineStart >= s && lineStart < e)).toBe(true);
    expect(r.spans.some(([s, e]: [number, number]) => blockStart >= s && blockStart < e)).toBe(true);
  });

  it('a regex literal (containing a quote character) is spanned', () => {
    const script = `const re = /["']/;`;
    const r = nonCodeSpans(script);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const idx = script.indexOf('/["\']/');
    expect(r.spans.some(([s, e]: [number, number]) => idx >= s && idx < e)).toBe(true);
  });

  it('a sloppy-mode-only body (var let = 1; legacy octal 010) parses ok:true under sourceType:"script"', () => {
    const script = 'var let = 1;\nconst n = 010;';
    const r = nonCodeSpans(script);
    expect(r.ok).toBe(true);
  });

  it('an unparseable body returns {ok:false, reason} and NEVER a partial span set', () => {
    const r = nonCodeSpans('const x = ((((;');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(typeof r.reason).toBe('string');
    expect((r as { spans?: unknown }).spans).toBeUndefined();
  });

  it('a real-world case: a prompt string literal containing "agent (" does not confuse the parser', () => {
    const script = `agent("verifier", { prompt: "...sdlc-verifier agent (mode A)..." });`;
    const r = nonCodeSpans(script);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const idx = script.indexOf('"...sdlc-verifier');
    const agentInStringIdx = script.indexOf('agent (mode A)');
    expect(r.spans.some(([s, e]: [number, number]) => s <= idx && agentInStringIdx < e)).toBe(true);
    // the OUTER agent( call itself is NOT inside any span (still code)
    expect(textIn(script, [0, 6])).toBe('agent(');
    expect(r.spans.some(([s, e]: [number, number]) => 0 >= s && 0 < e)).toBe(false);
  });
});
