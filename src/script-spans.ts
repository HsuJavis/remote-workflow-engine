// src/script-spans.ts (DES-236, ARCH-148, ADR-068, TASK-232, REQ-208): the span oracle —
// `nonCodeSpans` finds every non-code byte range in a script (string literals, regex literals,
// template quasis, both comment forms) so a caller (`scanAgentCalls`, TASK-233) can tell a real
// `agent(` call apart from one that only appears inside a string/comment/regex. Returns SPANS, not
// masked text — masking would blank a label literal too and break every real call.
//
// `sourceType:'script'`, not `'module'` — `guards.ts` executes the body through `new vm.Script`,
// a classic script, so module mode (which rejects `var let = 1;` / legacy octal `010`) would be a
// strict-mode subset that disagrees with what actually runs. Pure, no I/O, one parse per call.
import { parse } from 'acorn';

/** `comments`/`regexBodies` (v40, UT-367) are subsets of `spans`, kept apart so `blankSpans` can
 *  erase exactly the text no hand scanner may read as code (a comment's apostrophe, a regex's quote)
 *  while string literals — which carry labels and `allowedTools` values — stay intact. */
export type NonCodeSpansResult =
  | { ok: true; spans: Array<[number, number]>; comments: Array<[number, number]>; regexBodies: Array<[number, number]> }
  | { ok: false; reason: string };

/** Minimal estree walk — visits every node reachable from `node`'s own properties (arrays and
 *  nested nodes), skipping the position/location fields. No dependency on acorn-walk (a dev-only
 *  transitive package) — acorn is the only production dependency this module needs. */
function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec['type'] === 'string') visit(rec);
  for (const key of Object.keys(rec)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const val = rec[key];
    if (val && typeof val === 'object') walk(val, visit);
  }
}

export function nonCodeSpans(script: string): NonCodeSpansResult {
  const spans: Array<[number, number]> = [];
  const comments: Array<[number, number]> = [];
  const regexBodies: Array<[number, number]> = [];
  let ast: unknown;
  try {
    ast = parse(script, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      onComment: (_isBlock, _text, start, end) => { spans.push([start, end]); comments.push([start, end]); },
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  walk(ast, (n) => {
    const start = n['start'];
    const end = n['end'];
    if (typeof start !== 'number' || typeof end !== 'number') return;
    if (n['type'] === 'TemplateElement') {
      spans.push([start, end]);
    } else if (n['type'] === 'Literal' && (typeof n['value'] === 'string' || n['regex'] !== undefined)) {
      spans.push([start, end]);
      // the body only (between the two slashes): the delimiters stay, so `[/Bash/]` still reads as
      // a non-string element and is still refused, never collapsed to an empty `[ ]`.
      if (n['regex'] !== undefined) regexBodies.push([start + 1, script.lastIndexOf('/', end - 1)]);
    }
  });
  return { ok: true, spans, comments, regexBodies };
}

/** Replaces every character inside `ranges` with a space, keeping each newline, so every offset and
 *  line number in the result is identical to `script`'s. The one blanker the workflow-meta.ts hand
 *  scanners read through (DES-237 D12: all of them must see byte-identical text). */
export function blankSpans(script: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return script;
  const chars = script.split('');
  for (const [s, e] of ranges) for (let i = s; i < e; i++) if (chars[i] !== '\n') chars[i] = ' ';
  return chars.join('');
}
