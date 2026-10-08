// Issue #154 B2: a spread element (`...extra`) or a shorthand property (`{ allowedTools }`) inside
// an otherwise-literal `agent()` options object is invisible to `scanAgentCalls` — the entry has no
// top-level `:`, so the scan loop's `if (colonIdx === -1) continue;` skips it silently. Confirmed to
// smuggle `allowedTools` past the engine's only confinement check: `agent-executor.ts` applies
// `opts.allowedTools` from the caller-supplied options verbatim at dispatch with no re-validation
// against the statically-scanned contract, so a key the scanner never saw reaches the real agent.
//
// RED before the fix: every case below reports zero violations and `allowedTools: 'absent'`, even
// though a spread/shorthand entry sits right next to (or inside) an otherwise-literal object — the
// scanner doesn't merely fail to validate the hidden entry's value, it never sees that the key was
// declared at all.
//
// Mock policy (unit): pure string scan, no I/O, no mocks — same tier as agent-opts-unknown-key.test.ts.
import { describe, it, expect } from 'vitest';
import { scanAgentCalls } from '../../src/workflow-meta.js';

describe('agent() options spread / shorthand entries are refused, not silently skipped (#154 B2)', () => {
  it('a bare spread as the whole options body ⇒ a violation, not zero', () => {
    const script = `const extra = { allowedTools: ['Bash'] }; agent('a', { ...extra });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SPREAD')).toBe(true);
  });

  it('a spread ALONGSIDE literal keys is still caught — the literal keys do not make it "literal enough"', () => {
    const script = `const extra = { timeoutMs: 1, retries: 9 }; agent('a', { prompt: 'p', allowedTools: [], ...extra });`;
    const { violations, calls } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SPREAD')).toBe(true);
    // the declared allowedTools: [] must still be read correctly alongside the flagged spread
    expect(calls[0]?.allowedTools).toEqual([]);
  });

  it('the exact #154 repro: spread smuggling allowedTools past the scan ⇒ caught, not "absent" with zero violations', () => {
    const script = `const extra={allowedTools:["Bash"],timeoutMs:1,retries:9}; phase("p1"); return await agent("a",{prompt:"Reply OK", ...extra})`;
    const { violations } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SPREAD')).toBe(true);
  });

  it('a shorthand property ({ allowedTools }) is also refused — the key is visible but its value is a variable', () => {
    const script = `const allowedTools = ['Bash']; agent('a', { prompt: 'p', allowedTools });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SHORTHAND')).toBe(true);
  });

  it('the hint for a spread names the construct, not a generic message', () => {
    const script = `agent('a', { ...extra });`;
    const { violations } = scanAgentCalls(script);
    const v = violations.find((x) => x.code === 'AGENT_OPTS_SPREAD');
    expect(v?.hint).toMatch(/spread/i);
  });

  it('a fully literal options object is unaffected (no false positive)', () => {
    const script = `agent('a', { prompt: 'p', allowedTools: ['Read'], label: 'x' });`;
    const { violations } = scanAgentCalls(script);
    expect(violations).toEqual([]);
  });
});

// Issue #154 NEW (HIGH, 2026-10-07 reverify): `allowedTools: <non-literal>` — a literal key WITH a
// top-level `:` (so neither AGENT_OPTS_SPREAD's no-colon branch nor AGENT_OPTS_SHORTHAND's applies),
// but whose VALUE is a variable/expression rather than a `[...]` literal. `parseStringArrayLiteral`
// correctly returns `null` for this, but the `key === 'allowedTools'` handler silently left
// `allowedTools` at its 'absent' default instead of raising a violation — asymmetric with the
// sibling spread/shorthand checks, which DO refuse. Confirmed live: the real array still reaches
// agent-executor.ts's dispatch unexamined (runtime opts, never the static scan), while
// workflow_describe's toolSurface and the mermaid checker both read 'absent' as "nothing to verify".
//
// RED before the fix: reports zero violations and `allowedTools: 'absent'` even though the call
// site plainly grants real tools.
describe('agent() allowedTools given via a variable is refused, not read as absent (#154 NEW HIGH)', () => {
  it('the exact repro: `allowedTools: tools` (an identifier) ⇒ a violation, not zero', () => {
    const script = `const tools=['Bash','Write']; agent('a',{prompt:'x', allowedTools: tools})`;
    const { violations, calls } = scanAgentCalls(script);
    expect(violations.length).toBeGreaterThan(0);
    expect(calls[0]?.allowedTools).toBe('absent');
  });

  it('a member-expression value (`cfg.tools`) is also refused', () => {
    const script = `agent('a', { prompt: 'p', allowedTools: cfg.tools });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('a call-expression value (`getTools()`) is also refused', () => {
    const script = `agent('a', { prompt: 'p', allowedTools: getTools() });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('the hint names the hazard, not a generic message', () => {
    const script = `const tools=['Bash']; agent('a', { prompt: 'p', allowedTools: tools });`;
    const { violations } = scanAgentCalls(script);
    const v = violations.find((x) => x.key === 'allowedTools');
    expect(v?.hint).toMatch(/literal array/i);
  });

  it('a genuine literal array is unaffected (no false positive)', () => {
    const script = `agent('a', { prompt: 'p', allowedTools: ['Read', 'Bash'] });`;
    const { violations, calls } = scanAgentCalls(script);
    expect(violations).toEqual([]);
    expect(calls[0]?.allowedTools).toEqual(['Read', 'Bash']);
  });

  it('an empty literal array `[]` is still recorded as `[]`, not flagged', () => {
    const script = `agent('a', { prompt: 'p', allowedTools: [] });`;
    const { violations, calls } = scanAgentCalls(script);
    expect(violations).toEqual([]);
    expect(calls[0]?.allowedTools).toEqual([]);
  });
});

// Issue #154 NEW HIGH variant (major, 2026-10-07 reverify): an options argument that is an
// EXPRESSION starting with '{' and ending with '}' — not actually a `{...}` object literal at the
// top level — hides `allowedTools` from the scan entirely. `workflow-meta.ts:707` (pre-fix) only
// checked `optsText.startsWith('{') && optsText.endsWith('}')`, which `{prompt:'x'} ? o : {}` and
// `{prompt:'x'} && o || {}` both satisfy while actually being a ternary/logical expression that
// EVALUATES to whatever `o` is at runtime — invisible to every downstream reader
// (`scanAgentCalls().calls[].allowedTools`, `toolSurfaceWarnings`, `deriveExpectedGraph`'s
// `tools:` check).
//
// RED before the fix: both report ZERO violations and `allowedTools: 'absent'` even though the
// real runtime value (`o`) can carry anything.
describe('agent() options that merely START/END with braces but are not an object literal are refused (#154 NEW HIGH variant, ObjectExpression gate)', () => {
  it('a ternary whose arms are braces ⇒ a violation, not zero', () => {
    const script = `const o = { prompt: 'p', allowedTools: ['Bash', 'Write'] }; agent('a', {prompt:'x'} ? o : {});`;
    const { violations, calls } = scanAgentCalls(script);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_NOT_LITERAL')).toBe(true);
    expect(calls[0]?.allowedTools).toBe('absent');
  });

  it('a logical-OR/AND chain whose arms are braces ⇒ a violation, not zero', () => {
    const script = `const o = { prompt: 'p', allowedTools: ['Bash', 'Write'] }; agent('a', {prompt:'x'} && o || {});`;
    const { violations, calls } = scanAgentCalls(script);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_NOT_LITERAL')).toBe(true);
    expect(calls[0]?.allowedTools).toBe('absent');
  });

  it('a genuinely literal object is still accepted (no false positive from the new gate)', () => {
    const script = `agent('a', { prompt: 'p', allowedTools: ['Read'] });`;
    const { violations, calls } = scanAgentCalls(script);
    expect(violations).toEqual([]);
    expect(calls[0]?.allowedTools).toEqual(['Read']);
  });

  it('a literal object with trailing whitespace/newlines around it is still accepted', () => {
    const script = `agent('a',\n  {\n    prompt: 'p',\n    allowedTools: ['Read', 'Grep'],\n  }\n);`;
    const { violations, calls } = scanAgentCalls(script);
    expect(violations).toEqual([]);
    expect(calls[0]?.allowedTools).toEqual(['Read', 'Grep']);
  });
});
