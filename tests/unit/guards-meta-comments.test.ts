// UT-366 (v40 Gate 7.5 defect, VAL-277): checkMeta's string-aware brace scan must also be
// COMMENT-aware. A `//` or `/* */` comment inside `export const meta = {…}` is ordinary JS; its text
// (an apostrophe, a quote, a backtick, `...`, a brace) must never be read as code — otherwise the
// scanner desyncs, `span` is lost, and registration answers a misattributed PARSE_ERROR on `export`.
import { describe, it, expect } from 'vitest';
import { checkMeta, evaluateScript } from '../../src/sandbox/guards.js';
import type { SandboxApi } from '../../src/sandbox/guards.js';
import type { Budget } from '../../src/types.js';
import { validateScriptEntry } from '../../src/script-checks.js';

const NEVER_BUDGET: Budget = { total: null, spent: () => 0, remaining: () => Infinity };
const FAKE_API: SandboxApi = { async agent() { return null; }, args: undefined, budget: NEVER_BUDGET };

/** Asserts a clean pure-literal parse whose stripped body is exactly `return 1;`. */
function expectClean(script: string): ReturnType<typeof checkMeta> {
  const r = checkMeta(script);
  expect(r.found).toBe(true);
  expect(r.pureLiteral).toBe(true);
  expect(r.span).toBeDefined();
  expect(script.replace(r.span!, '').trim()).toBe('return 1;');
  return r;
}

describe('checkMeta — comments inside the meta literal (UT-366)', () => {
  it("an apostrophe in a // comment is not a string quote", () => {
    expectClean("export const meta = {\n  // the guide's rule\n  phases: [],\n};\nreturn 1;");
  });

  it('quote characters in a /* */ block comment are not string quotes', () => {
    expectClean("export const meta = {\n  /* it's \"quoted\" */\n  phases: [],\n};\nreturn 1;");
  });

  it('a backtick and `...` in a // comment are not a template literal / spread', () => {
    expectClean("export const meta = {\n  // `history` is NOT declared... see the guide\n  phases: [],\n};\nreturn 1;");
  });

  it("a // inside a string literal is NOT a comment ('https://x')", () => {
    const r = expectClean("export const meta = { name: 'x', description: 'see https://x.example/a' };\nreturn 1;");
    expect(r.objectText).toContain("'see https://x.example/a'");
  });

  it('a } or { inside a comment does not move the brace depth', () => {
    const r = expectClean("export const meta = {\n  a: 1, // close } here\n  /* open { there */\n  b: 2,\n};\nreturn 1;");
    expect(r.objectText!.trim().endsWith('b: 2,\n}')).toBe(true);
  });

  it('a comment on the last line before the closing brace', () => {
    expectClean("export const meta = {\n  phases: [],\n  // that's all\n};\nreturn 1;");
  });

  it('an unterminated /* block comment fails closed (not a pure literal)', () => {
    const r = checkMeta('export const meta = { a: 1 /* never closed }\nreturn 1;');
    expect(r.found).toBe(true);
    expect(r.pureLiteral).not.toBe(true);
    expect(r.span).toBeUndefined();
  });

  it('a real template literal / spread is still rejected after a comment', () => {
    expect(checkMeta('export const meta = { // ok\n  name: `x${1}` };\nreturn 1;').pureLiteral).toBe(false);
    expect(checkMeta('export const meta = { /* ok */ ...base };\nreturn 1;').pureLiteral).toBe(false);
  });
});

describe('registration + run paths accept a commented meta (UT-366)', () => {
  // The VAL-277 cold-client shape: apostrophe, double quote, backticks and `...` all in // comments.
  const script =
    "export const meta = {\n" +
    "  description: 'demo',\n" +
    "  phases: [{ title: 'a' }],\n" +
    "  params: {\n" +
    "    args: {\n" +
    "      // `history` (string[]) is NOT declared: per the authoring\n" +
    "      // guide's \"Declaring the parameter contract\" section. A workflow that declares\n" +
    "      // NO args at all...\" paragraph), so it is read defensively below.\n" +
    "      message: { type: 'string', max: 4000 },\n" +
    "    },\n" +
    "  },\n" +
    "};\n" +
    "return 1;";

  it('validateScriptEntry (workflow_register) accepts it — no PARSE_ERROR on export', () => {
    expect(validateScriptEntry(script)).toEqual({ ok: true });
  });

  it('evaluateScript (checkMetaLiteral) runs it — no INVALID_META', async () => {
    const r = await evaluateScript(script, FAKE_API);
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ kind: 'done', value: 1 });
  });
});
