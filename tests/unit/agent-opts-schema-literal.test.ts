// issue #162 item C (2026-10-09 reverify): a literal, OBVIOUSLY non-object/non-boolean agent()
// `schema` (e.g. `schema: 'not-a-schema'`) still passed `scanAgentCalls` clean and registered a
// runnable version — the actual rejection (ajv's "schema must be object or boolean") only fired at
// DISPATCH time (agent-executor.ts), after the run had already started, 20 phases deep, burning
// budget. The static scan can already tell a string/number/array/null/undefined LITERAL can never
// be a valid JSON Schema without running ajv at all, so this refuses it at `workflow_register`
// (via the same SCAN_VIOLATION path every other agent()-options defect in this file already uses).
// A non-literal schema (an identifier, a spread variable, a computed expression) is NOT flagged
// here — this scan cannot evaluate it statically, so it is left to the existing runtime ajv.compile
// guard (agent-executor.ts, issue #162 item C's OTHER half, already fixed) exactly as before.
// Mock policy (unit): pure function, no I/O — real scanAgentCalls, hand-written script fixtures.
import { describe, it, expect } from 'vitest';
import { scanAgentCalls } from '../../src/workflow-meta.js';

describe('scanAgentCalls refuses an obviously non-object/non-boolean literal `schema` (issue #162 item C)', () => {
  it('the exact repro: schema: \'not-a-schema\' (a string literal) is a violation', () => {
    const script = `agent('a', { prompt: 'p', schema: 'not-a-schema' });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SCHEMA_INVALID' && v.key === 'schema')).toBe(true);
  });

  it('a number literal schema is a violation', () => {
    const script = `agent('a', { prompt: 'p', schema: 42 });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SCHEMA_INVALID')).toBe(true);
  });

  it('an array literal schema is a violation', () => {
    const script = `agent('a', { prompt: 'p', schema: ['x'] });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SCHEMA_INVALID')).toBe(true);
  });

  it('a null literal schema is a violation', () => {
    const script = `agent('a', { prompt: 'p', schema: null });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SCHEMA_INVALID')).toBe(true);
  });

  it('a template-literal schema is a violation', () => {
    const script = 'agent(\'a\', { prompt: \'p\', schema: `not-a-schema` });';
    const { violations } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SCHEMA_INVALID')).toBe(true);
  });

  it('a genuine object-literal schema is NOT flagged (no false positive)', () => {
    const script = `agent('a', { prompt: 'p', schema: { type: 'object', properties: {} } });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SCHEMA_INVALID')).toBe(false);
  });

  it('a boolean literal schema (true/false — valid per JSON Schema) is NOT flagged', () => {
    expect(scanAgentCalls(`agent('a', { prompt: 'p', schema: true });`).violations.some((v) => v.code === 'AGENT_OPTS_SCHEMA_INVALID')).toBe(false);
    expect(scanAgentCalls(`agent('a', { prompt: 'p', schema: false });`).violations.some((v) => v.code === 'AGENT_OPTS_SCHEMA_INVALID')).toBe(false);
  });

  it('a non-literal schema (identifier — not statically checkable) is NOT flagged here; left to the runtime ajv guard', () => {
    const script = `const s = computeSchema(); agent('a', { prompt: 'p', schema: s });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SCHEMA_INVALID')).toBe(false);
  });

  it('no schema key at all is NOT flagged', () => {
    const script = `agent('a', { prompt: 'p' });`;
    const { violations } = scanAgentCalls(script);
    expect(violations.some((v) => v.code === 'AGENT_OPTS_SCHEMA_INVALID')).toBe(false);
  });
});
