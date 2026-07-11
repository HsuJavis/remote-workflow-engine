// UT-052 (compat defect fix): checkMeta must accept a pure-literal `meta` whose string VALUES contain
// semicolons / braces (the sdlc-run.js repro), and still reject genuine template-literal / spread
// meta — replacing the /[^;]*;/ regex that truncated at the first in-string semicolon.
import { describe, it, expect } from 'vitest';
import { checkMeta } from '../../src/sandbox/guards.js';

describe('checkMeta (compat-spec §1 meta literal, string-aware)', () => {
  it('accepts a pure-literal meta whose description contains semicolons and braces, and strips the WHOLE decl', () => {
    const script =
      "export const meta = { name: 'x', description: 'does a; then b; ends {ok}', phases: [{title:'A'}] };\n" +
      "return await agent('go');";
    const r = checkMeta(script);
    expect(r.found).toBe(true);
    expect(r.pureLiteral).toBe(true);
    expect(r.objectText).toContain("phases");
    // the span covers the full object incl. the in-string semicolons + trailing ; — stripping leaves clean body
    const body = script.replace(r.span!, '');
    expect(body.trim()).toBe("return await agent('go');");
    expect(body).not.toContain('description'); // no dangling meta fragment left behind
  });

  it('accepts meta with NO trailing semicolon (balanced-brace end, not ;-terminated)', () => {
    const script = "export const meta = {\n  name: 'x',\n  description: 'a; b; c'\n}\nconst y = 1;\nreturn y;";
    const r = checkMeta(script);
    expect(r.pureLiteral).toBe(true);
    const body = script.replace(r.span!, '');
    expect(body).toContain('const y = 1;');
    expect(body).not.toContain('description');
  });

  it('rejects a meta that uses a template literal value (outside strings)', () => {
    const r = checkMeta('export const meta = { name: `x${1}` };\nreturn 1;');
    expect(r.found).toBe(true);
    expect(r.pureLiteral).toBe(false);
  });

  it('rejects a meta that uses a spread', () => {
    const r = checkMeta('export const meta = { ...base, name: "x" };\nreturn 1;');
    expect(r.pureLiteral).toBe(false);
  });

  it('does NOT flag a ... that appears INSIDE a string value', () => {
    const r = checkMeta("export const meta = { name: 'x', description: 'to be continued...' };\nreturn 1;");
    expect(r.pureLiteral).toBe(true);
  });

  it('reports found:false when there is no meta declaration', () => {
    expect(checkMeta('return await agent("go");').found).toBe(false);
  });
});
