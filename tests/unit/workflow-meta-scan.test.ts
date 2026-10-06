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
import { scanAgentCalls, parseWorkflowSkeleton } from '../../src/workflow-meta.js';

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

// v35 GREEN-phase regression guard: a NO-meta script whose classic-script parse the oracle itself
// cannot complete (a malformed/truncated ternary — DES-174/UT-209's pre-v35 "TOTAL by design"
// guarantee) must fail OPEN — scan unfiltered, exactly as before v35 — never collapse to an empty
// `calls`/`labels` scan. A regression here previously made `scanAgentCalls` return `calls: []` for
// scripts with real `agent()` calls, which silently disabled every registration guard downstream
// (AGENT_UNDECLARED, AGENT_BEFORE_PHASE, the diagram contract) because none of them had anything
// left to check against. This must stay red if that ever recurs.
describe('scanAgentCalls — a no-meta oracle parse failure fails OPEN, not blind (v35 GREEN-phase regression guard)', () => {
  it('a malformed ternary with no meta still finds every real agent() call, and never reports SCRIPT_UNSCANNABLE', () => {
    const src = `const v = (x ? agent('a', { prompt: 'p' }));\nawait agent('b', { prompt: 'q' });`;
    const result = scanAgentCalls(src) as ReturnType<typeof scanAgentCalls> & { unscannable?: true };
    expect(result.calls.map((c) => c.label)).toEqual(['a', 'b']);
    expect(result.violations).toEqual([]);
    expect(result.unscannable).toBeUndefined();
  });
});

// Issue #140: `export const meta = {…}` is blanked to spaces before the `nonCodeSpans` oracle runs
// (D11 ordering, avoids `export` tripping the classic-script parse) — but the blanked copy is only
// used to FIND other non-code spans; the meta span's own range was never itself added back as a
// non-code span. So a literal "agent (" sitting inside a `meta.description` string (or any other
// meta field) was scanned against the ORIGINAL, unblanked script text and produced a spurious
// AGENT_LABEL_REQUIRED/AGENT_OPTS_NOT_LITERAL — regardless of which quote style wrapped it, because
// the oracle never got a chance to see it as a string literal at all. Fix: the whole meta span is
// itself always non-code.
describe('scanAgentCalls — a literal "agent (" inside `export const meta` must never be scanned (issue #140)', () => {
  it('the exact issue repro: meta.description mentions "trial agent (set …)" and the real call is untouched', () => {
    const src =
      'export const meta = {\n' +
      "  description: 'run it for real on the trial agent (set overrides.agents.trial.model ...)',\n" +
      '  phases: [{ title: \'P\' }],\n' +
      '};\n\n' +
      "phase('P');\n" +
      'return await agent(\'trial\', { prompt: \'p\' });';
    const { violations, calls, labels } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(labels).toEqual(['trial']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.label).toBe('trial');
  });

  it('single-quoted meta.description containing "agent (" text', () => {
    const src =
      "export const meta = { description: 'the trial agent (informal)', phases: [] };\n" +
      "agent('real', {});";
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.filter((c) => c.label === 'real')).toHaveLength(1);
  });

  it('double-quoted meta.description containing "agent (" text', () => {
    const src =
      'export const meta = { description: "the trial agent (informal)", phases: [] };\n' +
      "agent('real', {});";
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.filter((c) => c.label === 'real')).toHaveLength(1);
  });

  it('template-literal meta.description containing "agent (" text (meta stays non-code even when impure)', () => {
    const src =
      'export const meta = { description: `the trial agent (informal)`, phases: [] };\n' +
      "agent('real', {});";
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.filter((c) => c.label === 'real')).toHaveLength(1);
  });

  it('nested quotes/escapes inside meta.description around "agent (" text', () => {
    const src =
      String.raw`export const meta = { description: "she said \"the trial agent (mode A)\" twice", phases: [] };` +
      "\nagent('real', {});";
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.filter((c) => c.label === 'real')).toHaveLength(1);
  });

  it('a comment and a regex literal AFTER a meta block are still excluded as before (no regression)', () => {
    const src =
      "export const meta = { description: 'd', phases: [] };\n" +
      "// the author's agent (informal note)\n" +
      'const re = /agent\\(/;\n' +
      "agent('real', {});";
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.filter((c) => c.label === 'real')).toHaveLength(1);
  });

  it('a real agent() call inside a `${}` template interpolation in the body is still detected (meta present)', () => {
    const src =
      "export const meta = { description: 'd', phases: [] };\n" +
      'const msg = `result: ${await agent("real", {})}`;';
    const { violations, calls } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(calls.some((c) => c.label === 'real')).toBe(true);
  });

  it('a genuinely unlabeled agent() call in the body still reports its own real line (meta present, not blind)', () => {
    const src =
      "export const meta = { description: 'the trial agent (set x)', phases: [] };\n" +
      "agent('only-one-arg');";
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_LABEL_REQUIRED', line: 2 }));
  });

  it('parseWorkflowSkeleton agrees: exactly one agent node, for the positional join with scanAgentCalls', () => {
    const src =
      'export const meta = {\n' +
      "  description: 'run it for real on the trial agent (set overrides.agents.trial.model ...)',\n" +
      '  phases: [{ title: \'P\' }],\n' +
      '};\n\n' +
      "phase('P');\n" +
      'return await agent(\'trial\', { prompt: \'p\' });';
    const nodes = parseWorkflowSkeleton(src);
    expect(nodes.filter((n) => n.kind === 'agent')).toHaveLength(1);
  });
});
