// UT-145 (DES-143, v24): scanAgentCalls(script) — what "literal" means, and the line number on
// every violation. Gate 5 wrote this RED at 10 cases; the dod calls for ≥25 (one case per
// violation code with its expected line, nested workflow() exclusion, GUIDE_EXAMPLES scan-clean).
// Filled to the dod's own count per adjudication v24 #2 A-6/B-5 (test count is this iteration's
// stated defence — an implementer owning this file fills a short test file rather than sending it
// back). The `@ts-expect-error` above the import is removed: scanAgentCalls now exists (Gate 6).
import { describe, it, expect } from 'vitest';
import { scanAgentCalls } from '../../src/scan-agent-calls.js';
import { GUIDE_EXAMPLES } from '../../src/authoring-guide.js';

describe('scanAgentCalls (UT-145, DES-143)', () => {
  it('agent(prompt) with no label ⇒ AGENT_LABEL_REQUIRED at the call\'s line', () => {
    const src = 'workflow(() => {\n  agent("do the thing");\n});';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ line: 2, code: 'AGENT_LABEL_REQUIRED' }));
  });

  it('AGENT_LABEL_REQUIRED still records a call entry (empty label) so callers can report the line', () => {
    const src = 'agent("only-arg");';
    const { calls, violations } = scanAgentCalls(src);
    // v26 (DES-174, TASK-184): `AgentCallScan.calls[]` deliberately gained `index`/`allowedTools`/
    // `group` — the skeleton<->scan join key and the data `deriveExpectedGraph` needs. The property
    // this case pins is unchanged (exactly ONE call entry, at this line, with this label), so the
    // oracle names the two fields it is about instead of the whole widened row.
    expect(calls).toEqual([expect.objectContaining({ line: 1, label: '' })]);
    expect(violations).toContainEqual(expect.objectContaining({ line: 1, code: 'AGENT_LABEL_REQUIRED' }));
  });

  it('a template-string label ⇒ AGENT_LABEL_NOT_LITERAL', () => {
    const src = 'agent(`step-${i}`, {});';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_LABEL_NOT_LITERAL' }));
  });

  it('a variable label ⇒ AGENT_LABEL_NOT_LITERAL, with its line', () => {
    const src = '\nagent(myLabel, {});';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ line: 2, code: 'AGENT_LABEL_NOT_LITERAL' }));
  });

  it('a non-literal options object ⇒ AGENT_OPTS_NOT_LITERAL', () => {
    const src = 'agent("plan", myOpts);';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_OPTS_NOT_LITERAL' }));
  });

  it('a non-literal options object ⇒ AGENT_OPTS_NOT_LITERAL, with its line', () => {
    const src = '\n\nagent("plan", buildOpts());';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ line: 3, code: 'AGENT_OPTS_NOT_LITERAL' }));
  });

  it('a model key inside the options literal ⇒ PARAM_IN_SCRIPT{key:"model"}', () => {
    const src = 'agent("plan", { model: "sonnet-5" });';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ line: 1, code: 'PARAM_IN_SCRIPT', key: 'model' }));
  });

  it('an effort key inside the options literal ⇒ PARAM_IN_SCRIPT{key:"effort"}', () => {
    const src = 'agent("plan", { effort: "high" });';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'PARAM_IN_SCRIPT', key: 'effort' }));
  });

  it('a timeoutMs key inside the options literal ⇒ PARAM_IN_SCRIPT{key:"timeoutMs"}', () => {
    const src = 'agent("plan", { timeoutMs: 30000 });';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'PARAM_IN_SCRIPT', key: 'timeoutMs' }));
  });

  it('all three locked keys in one call ⇒ three separate PARAM_IN_SCRIPT violations', () => {
    const src = 'agent("plan", { model: "x", effort: "low", timeoutMs: 1000 });';
    const { violations } = scanAgentCalls(src);
    const codes = violations.filter((v) => v.code === 'PARAM_IN_SCRIPT').map((v) => v.key).sort();
    expect(codes).toEqual(['effort', 'model', 'timeoutMs']);
  });

  // v25 (#55, adjudication #9 I-1.4) REWRITES this case rather than deleting it — the same
  // discipline adjudication #8 H-1 required when it overturned ADJ-A1. It used to read "an
  // unrelated key (e.g. appendPrompt) inside the options literal is NOT a violation", and that
  // sentence WAS the defect: an options object that accepts anything and honours only what it
  // recognises tells an author nothing. `appendPrompt` in particular is the fourth member of
  // TUNABLE_KEYS, which the scanner's own hard-coded triple did not know about, so it took the
  // "unrelated" branch while its three siblings were refused. Both halves are fixed: a tunable
  // answers PARAM_IN_SCRIPT, a genuinely unrecognised key answers PARAM_UNKNOWN (UT-165), and
  // nothing is accepted-and-dropped.
  it('appendPrompt inside the options literal ⇒ PARAM_IN_SCRIPT (a tunable in the wrong place, not an "unrelated key")', () => {
    const src = 'agent("plan", { appendPrompt: "note" });';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'PARAM_IN_SCRIPT', key: 'appendPrompt' }));
  });

  it('a key that is neither an AgentOpts field nor a tunable ⇒ PARAM_UNKNOWN, never silently accepted', () => {
    const src = 'agent("plan", { unrelatedKey: "note" });';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'PARAM_UNKNOWN', key: 'unrelatedKey' }));
  });

  it('a label failing the format regex ⇒ AGENT_LABEL_FORMAT at scan time', () => {
    const src = 'agent("bad label!", {});';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_LABEL_FORMAT' }));
  });

  it('a label starting with a digit ⇒ AGENT_LABEL_FORMAT, with its line', () => {
    const src = '\nagent("1plan", {});';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ line: 2, code: 'AGENT_LABEL_FORMAT' }));
  });

  it('AGENT_LABEL_FORMAT is scanned BEFORE the diagram check ever sees the label (no label added to `labels`)', () => {
    const src = 'agent("bad label!", {});';
    const { labels } = scanAgentCalls(src);
    expect(labels).toEqual([]);
  });

  it('a well-formed literal call has no violations and its label is collected', () => {
    const src = 'agent("plan", {});';
    const { violations, labels } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(labels).toEqual(['plan']);
  });

  it('a bad label AND a non-literal options object on the same call ⇒ BOTH violations reported', () => {
    const src = 'agent("bad label!", myOpts);';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_LABEL_FORMAT' }));
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_OPTS_NOT_LITERAL' }));
  });

  it('calls inside a nested workflow(...) argument list (no real agent() call) are NOT scanned', () => {
    const src = 'workflow("child", { agent: "x" });\nagent("outer", {});';
    const { labels } = scanAgentCalls(src);
    expect(labels).toEqual(['outer']);
  });

  it('a REAL agent() call inside a nested workflow("name", () => {...}) sub-workflow composition is excluded — only the top-level label is collected', () => {
    const src = 'workflow("child", () => { agent("inner", {}); });\nagent("outer", {});';
    const { labels, calls } = scanAgentCalls(src);
    expect(labels).toEqual(['outer']);
    // v26 (DES-174, TASK-184): `AgentCallScan.calls[]` deliberately gained `index`/`allowedTools`/
    // `group` — the skeleton<->scan join key and the data `deriveExpectedGraph` needs. The property
    // this case pins is unchanged (exactly ONE call entry, at this line, with this label), so the
    // oracle names the two fields it is about instead of the whole widened row.
    expect(calls).toEqual([expect.objectContaining({ line: 2, label: 'outer' })]);
  });

  it('the top-level bootstrap wrapper workflow(() => {...}) (no string first arg) is NOT excluded — its agent() calls ARE scanned', () => {
    const src = 'workflow(() => {\n  agent("plan", {});\n  agent("write", {});\n});';
    const { labels } = scanAgentCalls(src);
    expect(labels).toEqual(['plan', 'write']);
  });

  it('x.agent(...) and agentFoo(...) are not matched as calls', () => {
    const src = 'x.agent("nope", {});\nagentFoo("nope2", {});';
    const { calls } = scanAgentCalls(src);
    expect(calls).toEqual([]);
  });

  it('a commented-out agent( IS matched (accepted: the refusal names the line, cheaper than a comment stripper)', () => {
    const src = '// agent("ghost", {});';
    const { calls } = scanAgentCalls(src);
    // v26 (DES-174, TASK-184): `AgentCallScan.calls[]` deliberately gained `index`/`allowedTools`/
    // `group` — the skeleton<->scan join key and the data `deriveExpectedGraph` needs. The property
    // this case pins is unchanged (exactly ONE call entry, at this line, with this label), so the
    // oracle names the two fields it is about instead of the whole widened row.
    expect(calls).toEqual([expect.objectContaining({ line: 1, label: 'ghost' })]);
  });

  it('duplicate labels are legal — labels de-duplicated, calls are not', () => {
    const src = 'agent("plan", {});\nagent("plan", {});';
    const { labels, calls } = scanAgentCalls(src);
    expect(labels).toEqual(['plan']);
    expect(calls.length).toBe(2);
  });

  it('duplicate labels preserve first-seen source order in `labels`', () => {
    const src = 'agent("b", {});\nagent("a", {});\nagent("b", {});';
    const { labels } = scanAgentCalls(src);
    expect(labels).toEqual(['b', 'a']);
  });

  it('an empty script has no labels, calls, or violations', () => {
    const { labels, calls, violations } = scanAgentCalls('');
    expect(labels).toEqual([]);
    expect(calls).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('a script with only phase()/parallel()/workflow() calls (no agent()) is clean', () => {
    const src = 'phase("setup");\nworkflow(() => { parallel([]); });';
    const { labels, calls, violations } = scanAgentCalls(src);
    expect(labels).toEqual([]);
    expect(calls).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('every GUIDE_EXAMPLES[].script scans clean — zero violations and every scripted label collected [T2/T4]', () => {
    expect(GUIDE_EXAMPLES.length).toBeGreaterThan(0);
    for (const ex of GUIDE_EXAMPLES as Array<{ title: string; script: string }>) {
      const { violations } = scanAgentCalls(ex.script);
      expect(violations, `example "${ex.title}" should scan clean`).toEqual([]);
    }
  });
});
