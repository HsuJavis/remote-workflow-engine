// UT-172 (DES-174, ARCH-113, TASK-184, v26): `scanAgentCalls`'s `calls[]` gains `allowedTools`
// (the literal array, or 'absent'), `index` (the AGENT_CALL_RE match offset), and `group` (from the
// same string-aware `matchDelimiter`/ternary-or-if-else detection ARCH-113 names). Written test-first
// (Gate 5, RED): today `calls[]` is `Array<{line, label}>` — none of the three new fields exist, so
// every assertion below reads `undefined` (a genuine behavioural red, not a TypeError — the function
// itself is unchanged).
// Mock policy (unit): pure function, no I/O — real scanAgentCalls, hand-written script fixtures.
import { describe, it, expect } from 'vitest';
import { scanAgentCalls } from '../../src/workflow-meta.js';

describe('scanAgentCalls calls[] gains allowedTools / index / group (UT-172, DES-174)', () => {
  it('records the literal allowedTools array when present', () => {
    const script = `agent('a', { prompt: 'p', allowedTools: ['Read', 'Bash'] });`;
    const scan = scanAgentCalls(script);
    expect(scan.calls[0]).toBeDefined();
    expect((scan.calls[0] as any).allowedTools).toEqual(['Read', 'Bash']);
  });

  it('records allowedTools: [] verbatim — not "absent"', () => {
    const script = `agent('a', { prompt: 'p', allowedTools: [] });`;
    const scan = scanAgentCalls(script);
    expect((scan.calls[0] as any).allowedTools).toEqual([]);
  });

  it('records "absent" when the call carries no allowedTools key', () => {
    const script = `agent('a', { prompt: 'p' });`;
    const scan = scanAgentCalls(script);
    expect((scan.calls[0] as any).allowedTools).toBe('absent');
  });

  it('records the AGENT_CALL_RE match character offset as index', () => {
    const script = `const x = 1;\nagent('a', { prompt: 'p' });`;
    const scan = scanAgentCalls(script);
    const expectedIndex = script.indexOf('agent(');
    expect((scan.calls[0] as any).index).toBe(expectedIndex);
  });

  it('two calls in one script get two distinct offsets, even with the same label', () => {
    const script = `agent('a', { prompt: 'p1' });\nagent('a', { prompt: 'p2' });`;
    const scan = scanAgentCalls(script);
    const idx0 = (scan.calls[0] as any).index;
    const idx1 = (scan.calls[1] as any).index;
    expect(idx0).not.toBe(idx1);
  });

  it('groups both arms of one ternary under the same {kind:"alt", id}', () => {
    const script = `(cond ? agent('a', { prompt: 'p' }) : agent('b', { prompt: 'p' }));`;
    const scan = scanAgentCalls(script);
    const g0 = (scan.calls[0] as any).group;
    const g1 = (scan.calls[1] as any).group;
    expect(g0).toEqual({ kind: 'alt', id: expect.any(Number) });
    expect(g1?.kind).toBe('alt');
    expect(g1?.id).toBe(g0?.id);
  });

  it('groups parallel([...]) members under the same {kind:"parallel", id}', () => {
    const script = `parallel([() => agent('a', { prompt: 'p' }), () => agent('b', { prompt: 'p' })]);`;
    const scan = scanAgentCalls(script);
    const g0 = (scan.calls[0] as any).group;
    const g1 = (scan.calls[1] as any).group;
    expect(g0).toEqual({ kind: 'parallel', id: expect.any(Number) });
    expect(g1?.id).toBe(g0?.id);
  });

  it('a sequential (non-grouped) call carries no group field', () => {
    const script = `agent('a', { prompt: 'p' });`;
    const scan = scanAgentCalls(script);
    expect((scan.calls[0] as any).group).toBeUndefined();
  });
});

// UT-209 (DES-174, ARCH-113, TASK-184, v26): the two DEFENSIVE fallbacks of the alt-span scanners
// (`findMatchingColon` -> -1, `findArmEnd` -> end-of-script), which per-function coverage showed no
// test reached. Both exist so a MALFORMED or truncated script — the state the dashboard's own
// `/dag` read path and the registration checker both hit on real author text — degrades to "no alt
// group detected" instead of throwing or fabricating a span that swallows the rest of the file.
// `scanAgentCalls` is TOTAL by design; these pin that it stays total, and that a `?` which is not a
// ternary never groups two independent calls together.
// Mock policy (unit): pure function, no I/O.
describe('scanAgentCalls stays total on malformed ternaries (UT-209, DES-174)', () => {
  it('a `?` whose then-arm closes its enclosing bracket before any `:` groups nothing (findMatchingColon -> -1)', () => {
    const script = `const v = (x ? agent('a', { prompt: 'p' }));\nawait agent('b', { prompt: 'q' });`;
    const scan = scanAgentCalls(script);
    expect(scan.calls).toHaveLength(2);
    expect(scan.calls.map((c) => c.label)).toEqual(['a', 'b']);
    expect((scan.calls[0] as any).group).toBeUndefined();
    expect((scan.calls[1] as any).group).toBeUndefined();
  });

  it('a `?` at the very end of the script groups nothing rather than throwing', () => {
    const scan = scanAgentCalls(`await agent('a', { prompt: 'p' }); const t = cond ?`);
    expect(scan.calls).toHaveLength(1);
    expect((scan.calls[0] as any).group).toBeUndefined();
  });

  it('an else-arm that runs to end-of-script with no `;` still yields a well-formed scan (findArmEnd -> script.length)', () => {
    const script = `const r = cond ? await agent('a', { prompt: 'p' }) : await agent('b', { prompt: 'q' })`;
    const scan = scanAgentCalls(script);
    expect(scan.calls).toHaveLength(2);
    const [a, b] = scan.calls as any[];
    expect(a.group).toBeDefined();
    expect(a.group.kind).toBe('alt');
    expect(b.group).toEqual(a.group);
  });

  it('the unterminated-arm scan does not swallow a LATER call into the same alt group', () => {
    const script = `const r = cond ? await agent('a', { prompt: 'p' }) : await agent('b', { prompt: 'q' });\nawait agent('c', { prompt: 'z' });`;
    const scan = scanAgentCalls(script);
    expect(scan.calls).toHaveLength(3);
    expect((scan.calls[2] as any).group).toBeUndefined();
  });
});
