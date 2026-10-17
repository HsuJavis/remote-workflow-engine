// UT-367 / UT-368 — workflow-meta.ts's hand scanners (`matchDelimiter`, `splitTopLevel`,
// `findMatchingColon`, `findArmEnd`, `altSpans`) used to be comment-blind: a quote inside a `//`
// comment opened a phantom string and desynced them (UT-367's four shapes, owner ruling 2026-10-17:
// fixed in v40). They now read the script through `scanText` — comment text, regex bodies and the
// meta block blanked by `blankSpans`, every offset and newline kept (DES-237 D12).
import { describe, it, expect } from 'vitest';
import { scanAgentCalls, parseWorkflowSkeleton, scanPrimitiveCalls } from '../../src/workflow-meta.js';
import { nonCodeSpans, blankSpans } from '../../src/script-spans.js';

const META = "export const meta = { description: 'd', phases: [{ title: 'a' }] };\nphase('a');\n";
const strip = (o: unknown): string => JSON.stringify(o, (k, v) => (k === 'index' || k === 'line' || k === 'hint' ? undefined : v));

describe('workflow-meta scanners — comments in the script body (UT-367)', () => {
  it("an apostrophe in a comment inside agent() options does not make the call vanish from the scan", () => {
    const s = scanAgentCalls(META + "await agent('r', {\n  // don't widen\n  prompt: 'x', allowedTools: [] });\nreturn 1;");
    expect(s.labels).toEqual(['r']);
  });

  it('a comment inside agent() options is not read as part of the next key (no PARAM_UNKNOWN)', () => {
    const s = scanAgentCalls(META + "await agent('r', {\n  // keep it read-only\n  prompt: 'x', allowedTools: [] });\nreturn 1;");
    expect(s.violations).toEqual([]);
  });

  it('an apostrophe in a comment inside an if-arm keeps the alt group', () => {
    const body = (c: string): string =>
      META + `if (args.x) {\n  // ${c}\n  await agent('r', { prompt: 'x' });\n} else {\n  await agent('s', { prompt: 'y' });\n}\nreturn 1;`;
    expect(strip(scanAgentCalls(body("it's the then arm")))).toBe(strip(scanAgentCalls(body('the then arm'))));
  });

  it('an apostrophe in a comment inside parallel([...]) keeps the parallel group', () => {
    const body = (c: string): string =>
      META + `await parallel([\n  // ${c}\n  () => agent('r', { prompt: 'x' }),\n  () => agent('s', { prompt: 'y' }),\n]);\nreturn 1;`;
    expect(strip(scanAgentCalls(body("it's parallel")))).toBe(strip(scanAgentCalls(body('parallel'))));
  });
});

describe('workflow-meta scanners — block comments, strings, regex literals, D12 lockstep (UT-368)', () => {
  it("a /* */ comment with an apostrophe inside agent() options keeps the call", () => {
    const s = scanAgentCalls(META + "await agent('r', {\n  /* don't\n     widen */\n  prompt: 'x', allowedTools: [] });\nreturn 1;");
    expect(s.labels).toEqual(['r']);
    expect(s.calls[0]!.allowedTools).toEqual([]);
  });

  it('a /* */ comment inside agent() options is not read into the next key', () => {
    const s = scanAgentCalls(META + "await agent('r', { /* keep it read-only */ prompt: 'x', allowedTools: [] });\nreturn 1;");
    expect(s.violations).toEqual([]);
  });

  it("a /* */ comment with an apostrophe inside an if-arm keeps the alt group", () => {
    const body = (c: string): string =>
      META + `if (args.x) {\n  /* ${c} */\n  await agent('r', { prompt: 'x' });\n} else {\n  await agent('s', { prompt: 'y' });\n}\nreturn 1;`;
    expect(strip(scanAgentCalls(body("it's the then arm")))).toBe(strip(scanAgentCalls(body('the then arm'))));
    expect(scanAgentCalls(body("it's")).calls.map((c) => c.group?.kind)).toEqual(['alt', 'alt']);
  });

  it("a /* */ comment with an apostrophe inside parallel([...]) keeps the parallel group", () => {
    const body = (c: string): string =>
      META + `await parallel([\n  /* ${c} */\n  () => agent('r', { prompt: 'x' }),\n  () => agent('s', { prompt: 'y' }),\n]);\nreturn 1;`;
    expect(strip(scanAgentCalls(body("it's parallel")))).toBe(strip(scanAgentCalls(body('parallel'))));
    expect(scanAgentCalls(body("it's")).calls.map((c) => c.group?.kind)).toEqual(['parallel', 'parallel']);
  });

  it('a comment carrying a backtick and `...` is neither a template nor a spread', () => {
    const s = scanAgentCalls(META + "await agent('r', {\n  // use `x` ... later\n  /* or `y` ...z */\n  prompt: 'x', allowedTools: ['Read'] });\nreturn 1;");
    expect(s.violations).toEqual([]);
    expect(s.calls[0]!.allowedTools).toEqual(['Read']);
  });

  it("'https://x' and \"//\" inside strings stay string text (not blanked as comments)", () => {
    const s = scanAgentCalls(META + "await agent('r', { prompt: 'see https://x' });\nawait agent('s', { prompt: \"//\", allowedTools: ['Read', \"//\"] });\nreturn 1;");
    expect(s.labels).toEqual(['r', 's']);
    expect(s.violations).toEqual([]);
    expect(s.calls[1]!.allowedTools).toEqual(['Read', '//']);
  });

  it("a regex literal containing a quote (/'/, /\"/.test(x)) does not desync the scan", () => {
    const body = (pre: string): string =>
      META + `if (args.x) {\n  ${pre}\n  await agent('r', { prompt: 'x' });\n} else {\n  await agent('s', { prompt: 'y' });\n}\nreturn 1;`;
    const clean = strip(scanAgentCalls(body('const q = 1;')));
    expect(strip(scanAgentCalls(body("const q = /'/;")))).toBe(clean);
    expect(strip(scanAgentCalls(body('const q = /"/.test(args.y);')))).toBe(clean);
  });

  it('a regex element in allowedTools is still refused (regex delimiters survive the blanking)', () => {
    const s = scanAgentCalls(META + "await agent('r', { prompt: 'x', allowedTools: [/Bash/] });\nreturn 1;");
    expect(s.violations.map((v) => v.code)).toEqual(['AGENT_OPTS_VALUE_NOT_LITERAL']);
  });

  it("an apostrophe in a comment inside the meta literal does not drop a ternary's alt group", () => {
    const body = (c: string): string =>
      `export const meta = { description: 'd', // ${c}\n phases: [{ title: 'a' }] };\nphase('a');\n` +
      "const t = args.y ? await agent('r', { prompt: 'x' }) : await agent('s', { prompt: 'y' });\nreturn 1;";
    expect(strip(scanAgentCalls(body("don't")))).toBe(strip(scanAgentCalls(body('dont'))));
    expect(scanAgentCalls(body("don't")).calls.map((c) => c.group?.kind)).toEqual(['alt', 'alt']);
  });

  it('a commented-out agent() call (either form) is still not a call', () => {
    const s = scanAgentCalls(META + "// await agent('ghost1', {});\n/* await agent('ghost2', {}); */\nawait agent('r', { prompt: 'x' });\nreturn 1;");
    expect(s.labels).toEqual(['r']);
  });

  it('blankSpans keeps length and every newline, and blanks only comment text', () => {
    const src = "a(); // it's\n/* x\n'y' */ b('//');";
    const r = nonCodeSpans(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = blankSpans(src, r.comments);
    expect(out.length).toBe(src.length);
    expect([...out].map((c, i) => (c === '\n' ? i : -1)).filter((i) => i >= 0)).toEqual(
      [...src].map((c, i) => (c === '\n' ? i : -1)).filter((i) => i >= 0),
    );
    expect(out).toBe(`a();${' '.repeat(8)}\n${' '.repeat(4)}\n${' '.repeat(7)}b('//');`);
  });

  it('D12: all three scanners stay in lockstep through quote-bearing comments and regex literals', () => {
    const s =
      META +
      "// it's the first one\nawait agent('a1', { prompt: 'x' /* don't */ });\n" +
      "const re = /'/;\nawait parallel([\n  // isn't\n  () => agent('a2', { prompt: 'y' }),\n  () => agent('a3', { prompt: 'z' }),\n]);\n" +
      "/* `tick` ... */\nconst d = await decide('d1', { state: {}, questions: [] });\n" +
      "if (args.x) {\n  // can't\n  await agent('a4', { prompt: 'p' });\n} else {\n  await agent('a5', { prompt: 'q' });\n}\nreturn 1;";
    const scan = scanAgentCalls(s);
    const skeletonAgents = parseWorkflowSkeleton(s).filter((n) => n.kind === 'agent');
    expect(scan.violations).toEqual([]);
    expect(scan.calls.map((c) => c.label)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(skeletonAgents.length).toBe(scan.calls.length);
    expect(skeletonAgents.map((n) => n.parallel !== undefined)).toEqual(scan.calls.map((c) => c.group?.kind === 'parallel'));
    // offsets are the ORIGINAL script's: each recorded index points at the real `agent(` text.
    for (const c of scan.calls) expect(s.slice(c.index, c.index + 6)).toBe('agent(');
    const prim = scanPrimitiveCalls(s);
    expect(prim.decide).toEqual(['d1']);
    expect(prim.violations).toEqual([]);
  });
});
