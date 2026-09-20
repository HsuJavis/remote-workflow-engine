// UT (DES-237, ARCH-149, TASK-233, REQ-208): `scanAgentCalls` filters match offsets through the
// `nonCodeSpans` oracle — a literal `agent (` inside a string/comment/regex no longer produces a
// false `AGENT_LABEL_REQUIRED`, fails CLOSED (one `SCRIPT_UNSCANNABLE` violation +
// `unscannable:true`) on an oracle parse failure, and the extractor/`index`/line numbers stay
// byte-identical for real calls. Written test-first (Gate 5, RED) — `scanAgentCalls` does not
// consult any oracle today, so every prose-`agent(`-in-a-string case below currently produces a
// spurious `AGENT_LABEL_REQUIRED`/`AGENT_OPTS_NOT_LITERAL` violation.
//
// Mock policy (unit): pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { scanAgentCalls } from '../../src/workflow-meta.js';

describe('scanAgentCalls — the six REQ-208 non-code cases must NOT produce a violation (DES-237)', () => {
  it('1. a regex literal containing "agent(" text is not scanned as a call', () => {
    const src = `const re = /agent\\(/;\nagent("real", {});`;
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.filter((c) => c.label === 'real').length).toBe(1);
  });

  it('2. a template-literal ${…} substitution around a real agent() call is unaffected (still scanned as code)', () => {
    const src = 'const msg = `result: ${await agent("real", {})}`;';
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.some((c) => c.label === 'real')).toBe(true);
  });

  it('3. an escaped quote inside a string does not confuse the scanner into reading past it', () => {
    const src = String.raw`const s = "he said \"agent (mode A)\"";` + '\nagent("real", {});';
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.filter((c) => c.label === 'real').length).toBe(1);
  });

  it('4. a comment apostrophe near "agent (" text does not confuse the scanner', () => {
    const src = `// the author's agent (informal note)\nagent("real", {});`;
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
  });

  it('5. the real-world case: a prompt string embedding "...verifier agent (mode A)..." registers clean', () => {
    const src = 'agent("verifier", { prompt: "...sdlc-verifier agent (mode A)..." });';
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.length).toBe(1);
    expect(calls[0]?.label).toBe('verifier');
  });

  it('6. a sloppy-mode-only script (var let = 1;) does not fail the oracle and scans normally', () => {
    const src = `var let = 1;\nagent("real", {});`;
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.some((c) => c.label === 'real')).toBe(true);
  });
});

describe('scanAgentCalls — existing SCAN_VIOLATION detection must not regress (DES-237)', () => {
  it('a genuinely unlabeled agent( call after a literal-heavy prelude still reports its OWN real line', () => {
    const src = `const a = "agent (fake, not a call)";\nconst b = /agent\\(/;\nagent("only-one-arg");`;
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_LABEL_REQUIRED', line: 3 }));
  });

  it('AgentCallScan.index for a real call is unaffected by the oracle (DES-174 join key preserved)', () => {
    const src = 'agent("plan", {});';
    const { calls } = scanAgentCalls(src);
    expect(calls[0]?.index).toBe(src.indexOf('agent('));
  });
});

describe('scanAgentCalls — fail-closed on an oracle parse failure (DES-236/237)', () => {
  it('an unparseable script yields exactly one SCRIPT_UNSCANNABLE violation and unscannable:true', () => {
    // NOTE: `checkMeta` requires an `export const meta = {…}` span before the oracle is even
    // invoked (D11 ordering) — an unparseable meta LITERAL would trip a DIFFERENT, pre-existing
    // refusal, not the oracle. This body has valid-looking meta but unparseable code AFTER it.
    const src = `export const meta = {};\nconst x = ((((;`;
    const result = scanAgentCalls(src) as ReturnType<typeof scanAgentCalls> & { unscannable?: true };
    expect(result.violations).toEqual([{ code: 'SCRIPT_UNSCANNABLE', line: 1, hint: expect.any(String) }]);
    expect(result.unscannable).toBe(true);
  });
});

describe('scanAgentCalls — ordering (D11): no meta span means the oracle is never invoked (DES-237)', () => {
  it('a script with no `export const meta` block keeps scanning normally (oracle not invoked)', () => {
    const src = `agent("real", {});`;
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.some((c) => c.label === 'real')).toBe(true);
  });
});
