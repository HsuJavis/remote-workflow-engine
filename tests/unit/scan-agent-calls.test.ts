// UT-145 (DES-143, v24): scanAgentCalls(script) — what "literal" means, and the line number on
// every violation. Written test-first (Gate 5, RED) — scanAgentCalls does not exist yet.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — scanAgentCalls does not exist yet (v24 DES-143/TASK-135)
import { scanAgentCalls } from '../../src/scan-agent-calls.js';

describe('scanAgentCalls (UT-145, DES-143)', () => {
  it('agent(prompt) with no label ⇒ AGENT_LABEL_REQUIRED at the call\'s line', () => {
    const src = 'workflow(() => {\n  agent("do the thing");\n});';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ line: 2, code: 'AGENT_LABEL_REQUIRED' }));
  });

  it('a template-string label ⇒ AGENT_LABEL_NOT_LITERAL', () => {
    const src = 'agent(`step-${i}`, {});';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_LABEL_NOT_LITERAL' }));
  });

  it('a variable label ⇒ AGENT_LABEL_NOT_LITERAL', () => {
    const src = 'agent(myLabel, {});';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_LABEL_NOT_LITERAL' }));
  });

  it('a non-literal options object ⇒ AGENT_OPTS_NOT_LITERAL', () => {
    const src = 'agent("plan", myOpts);';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_OPTS_NOT_LITERAL' }));
  });

  it('a model/effort/timeoutMs key inside the options literal ⇒ PARAM_IN_SCRIPT{key}', () => {
    const src = 'agent("plan", { model: "sonnet-5" });';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'PARAM_IN_SCRIPT', key: 'model' }));
  });

  it('a label failing the format regex ⇒ AGENT_LABEL_FORMAT at scan time', () => {
    const src = 'agent("bad label!", {});';
    const { violations } = scanAgentCalls(src);
    expect(violations).toContainEqual(expect.objectContaining({ code: 'AGENT_LABEL_FORMAT' }));
  });

  it('a well-formed literal call has no violations and its label is collected', () => {
    const src = 'agent("plan", {});';
    const { violations, labels } = scanAgentCalls(src);
    expect(violations).toEqual([]);
    expect(labels).toEqual(['plan']);
  });

  it('calls inside a nested workflow(...) argument list are NOT scanned', () => {
    const src = 'workflow("child", { agent: "x" });\nagent("outer", {});';
    const { labels } = scanAgentCalls(src);
    expect(labels).toEqual(['outer']);
  });

  it('x.agent(...) and agentFoo(...) are not matched as calls', () => {
    const src = 'x.agent("nope", {});\nagentFoo("nope2", {});';
    const { calls } = scanAgentCalls(src);
    expect(calls).toEqual([]);
  });

  it('duplicate labels are legal — labels de-duplicated, calls are not', () => {
    const src = 'agent("plan", {});\nagent("plan", {});';
    const { labels, calls } = scanAgentCalls(src);
    expect(labels).toEqual(['plan']);
    expect(calls.length).toBe(2);
  });
});
