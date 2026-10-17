// UT-367 — KNOWN-DEFECT LOCK (status red; NOT fixed in the UT-366 checkMeta fix — needs an owner
// decision, see 05-tests.md UT-367). workflow-meta.ts's hand scanners (`matchDelimiter`,
// `splitTopLevel`, `findMatchingColon`, `findArmEnd`, `altSpans`) are comment-blind exactly as
// checkMeta was: a quote inside a `//` comment desyncs them. Each `it.fails` below asserts the
// CORRECT behaviour and is EXPECTED to fail today; vitest reports it as passing only while it fails.
// When the scanners are fixed these flip to failing — turn `it.fails` into `it` at that point.
import { describe, it, expect } from 'vitest';
import { scanAgentCalls } from '../../src/workflow-meta.js';

const META = "export const meta = { description: 'd', phases: [{ title: 'a' }] };\nphase('a');\n";
const strip = (o: unknown): string => JSON.stringify(o, (k, v) => (k === 'index' || k === 'line' || k === 'hint' ? undefined : v));

describe('workflow-meta scanners — comments in the script body (UT-367, known defect)', () => {
  it.fails("an apostrophe in a comment inside agent() options does not make the call vanish from the scan", () => {
    const s = scanAgentCalls(META + "await agent('r', {\n  // don't widen\n  prompt: 'x', allowedTools: [] });\nreturn 1;");
    expect(s.labels).toEqual(['r']);
  });

  it.fails('a comment inside agent() options is not read as part of the next key (no PARAM_UNKNOWN)', () => {
    const s = scanAgentCalls(META + "await agent('r', {\n  // keep it read-only\n  prompt: 'x', allowedTools: [] });\nreturn 1;");
    expect(s.violations).toEqual([]);
  });

  it.fails('an apostrophe in a comment inside an if-arm keeps the alt group', () => {
    const body = (c: string): string =>
      META + `if (args.x) {\n  // ${c}\n  await agent('r', { prompt: 'x' });\n} else {\n  await agent('s', { prompt: 'y' });\n}\nreturn 1;`;
    expect(strip(scanAgentCalls(body("it's the then arm")))).toBe(strip(scanAgentCalls(body('the then arm'))));
  });

  it.fails('an apostrophe in a comment inside parallel([...]) keeps the parallel group', () => {
    const body = (c: string): string =>
      META + `await parallel([\n  // ${c}\n  () => agent('r', { prompt: 'x' }),\n  () => agent('s', { prompt: 'y' }),\n]);\nreturn 1;`;
    expect(strip(scanAgentCalls(body("it's parallel")))).toBe(strip(scanAgentCalls(body('parallel'))));
  });
});
