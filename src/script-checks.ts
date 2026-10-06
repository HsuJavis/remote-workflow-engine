// script-checks.ts (DES-112, ARCH-074, TASK-106).
// Pure lift of submission-validator.ts:92-124's `if (spec.script)` block. No I/O, no clock, no
// registry import.
//
// 2026-09-26 (alias mechanism removed): the model-alias static scan (`extractModelAliases` /
// UNKNOWN_MODEL here) is DROPPED, not ported — it regex-scanned `model: '<literal>'` over the WHOLE
// script text, which under the v24 contract can only ever match an agent() call's `model` OPT
// (already refused PARAM_IN_SCRIPT elsewhere, `workflow-meta.ts`'s ARCH-096 scan) or a `model.enum`
// entry inside `meta.params` (checked properly, with catalog existence, by `contract.ts`'s
// `validateOneAgentSpec`).
//
// issue #103(a): the MCP_NOT_PROVISIONED check (a raw regex scan for `mcp: [...]` over the script
// TEXT, checked against an injected `mcpLookup` predicate) is RETIRED from here, not narrowed —
// it was never wired to a real catalog in production (server.ts's WorkflowCatalog construction
// left `mcpLookup` unbound, defaulting to accept-all), so a declared-but-unprovisioned mcp/skill
// name registered fine regardless. The owner-decided replacement lives one layer up
// (mcp-facade.ts's `workflowRegister`, via `AssetSyncService.resolveDeclaredAssets` — the SAME
// resolver dispatch uses, `resolveMcp` + the skill-tree existence check) and is a WARNING, not a
// registration refusal; the refusal moved to admission (run-manager.ts's `start()`), where it can
// act BEFORE any side effect and is checked against the real, workflow-scoped catalog rather than a
// script-text regex. This module now checks only PARSE_ERROR.
import * as vm from 'node:vm';
import { parse } from 'acorn';
import { checkMeta } from './sandbox/guards.js';
export { FRAME_CLOSE_FORGERY } from './params/contract.js';
import { FRAME_CLOSE_FORGERY } from './params/contract.js';
import type { ErrorCode } from './errors.js';

// v24 (TASK-155, B-7/adjudication #3): constrained to ERROR_CATALOG's own keys via `Extract` —
// DES-137's type-level net (every codedError(literal) is a catalog key) had exactly one hole
// left: this bare literal union could drift from the catalog with no compiler signal. A future
// value added here without a matching catalog entry now fails `tsc`, not a runtime grep.
// Issue #154 B1: gains SCRIPT_INVALID — already a full ERROR_CATALOG entry and already advertised
// in tool-specs.ts's workflow_register `errors:` list ("the sandbox structural refusal
// validateScriptEntry raises"), reserved for exactly this but never actually emitted until now (the
// new AST-based alias scan below). PARSE_ERROR separately gains a real, enforced "top-level function
// declaration" refusal (previously promised by the authoring guide but never actually checked — see
// `checkTopLevelFunctionWrapper` below).
export type ScriptCheckCode = Extract<ErrorCode, 'PARSE_ERROR' | 'SCRIPT_INVALID'>;

export interface ScriptCheckError {
  code: ScriptCheckCode;
  message: string;
  detail: Record<string, unknown>;
}

/** v26 Gate 7.5 round 1 (defect D6): same line count, no content — see the call site. */
function blankLines(span: string): string {
  return '\n'.repeat((span.match(/\n/g) ?? []).length);
}

/** v26 Gate 7.5 round 1 (defect D6): the constructs an author reaches for when they mistake the
 *  script body for a MODULE. The round-1 cold subject wrote `export default async function () {…}`
 *  and got back `Unexpected token 'export'` — true, and useless: it named neither the line nor what
 *  about it was wrong, so the subject's next guess (strip `export` off `meta` too) made things
 *  worse. Order matters: `export default` before the bare `export` catch-all. */
const OFFENDING_CONSTRUCTS: ReadonlyArray<{ re: RegExp; name: string; why: string }> = [
  { re: /^\s*export\s+default\b/, name: 'export default', why: 'the body is not a module, so it has nothing to default-export' },
  { re: /^\s*export\b/, name: 'export', why: '`export const meta = {…}` is the ONE export a script may carry' },
  { re: /^\s*import\b/, name: 'import', why: 'there is no module loader in the sandbox — the globals listed in the guide are all there is' },
  { re: /^\s*(?:async\s+)?function\b/, name: 'function', why: 'the body IS the function — do not declare another one around it' },
];

/** v26 Gate 7.5 round 1 (defect D6): V8 puts the location in `err.stack`'s first line
 *  (`workflow-script.js:<n>`), never in `err.message`. `n` counts the `(async () => {` wrapper line
 *  this checker prepends, so the author's own line is `n - 1`. */
function parseErrorFor(script: string, err: unknown): ScriptCheckError {
  const raw = err instanceof Error ? err.message : String(err);
  const wrapped = Number(/workflow-script\.js:(\d+)/.exec(err instanceof Error ? (err.stack ?? '') : '')?.[1]);
  const line = Number.isFinite(wrapped) ? wrapped - 1 : undefined;
  const source = line !== undefined ? script.split('\n')[line - 1]?.trim() : undefined;
  const hit = source !== undefined ? OFFENDING_CONSTRUCTS.find((c) => c.re.test(source)) : undefined;
  const where = line !== undefined && source !== undefined ? ` at line ${line}: \`${source}\`` : '';
  const named = hit ? ` — \`${hit.name}\` is not accepted here: ${hit.why}.` : '';
  return {
    code: 'PARSE_ERROR',
    message:
      `${raw}${where}.${named} A workflow script body is a BARE async function body — statements and a ` +
      '`return`, with no `export default`, no `function` wrapper and no top-level `import`; ' +
      '`export const meta = {…}` is the one exception and it must be written exactly that way.',
    detail: {
      field: 'script',
      ...(line !== undefined ? { line } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(hit ? { construct: hit.name } : {}),
    },
  };
}

// Issue #154 B1: the four sandbox API entry points `scanAgentCalls`/`checkMetaPhases`
// (workflow-meta.ts) statically track by matching literal call-site TEXT — `pipeline` included for
// the same reason `parallel` is (both fan out thunks the scanner cannot see inside without this
// check). A reference to one of these names in anything OTHER than its own direct call position
// hides whatever that reference goes on to do from every one of those text-matching scanners —
// `const P = phase; P(...)`, `agent.call(...)`, `take(agent)` are all the SAME blind spot.
const CALLABLE_API_NAMES = new Set(['agent', 'phase', 'parallel', 'pipeline', 'workflow']);

/** Minimal estree walk that also hands the visitor the PARENT node and the property key the current
 *  node was reached through (e.g. `'callee'`, `'params'`, `'id'`) — `script-spans.ts`'s own walker
 *  (reused in spirit, not imported — that one is parent-blind, which this check needs) explains why
 *  this file writes its own rather than depending on `acorn-walk` (a dev-only transitive package;
 *  `acorn` itself is the only production dependency either file needs). */
function walkWithParent(
  node: unknown,
  parent: Record<string, unknown> | null,
  key: string | null,
  visit: (n: Record<string, unknown>, parent: Record<string, unknown> | null, key: string | null) => void,
): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkWithParent(item, parent, key, visit);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec['type'] === 'string') visit(rec, parent, key);
  for (const k of Object.keys(rec)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
    const val = rec[k];
    if (val && typeof val === 'object') walkWithParent(val, rec, k, visit);
  }
}

/** Issue #154 B1a: a `function`/`async function` DECLARATION at the TOP LEVEL of the script body —
 *  the authoring guide's literal promise ("a function wrapper of any kind is refused PARSE_ERROR")
 *  names exactly this construct, not an arrow function assigned to a `const` (a documented, accepted
 *  pattern for `parallel()`/`pipeline()` thunks: `const thunk = () => agent(...)`). Declared but
 *  never invoked is the dangerous case (any agent()/phase() call inside it is DEAD code the scanner
 *  nonetheless counted as live top-level code), but this refuses the construct outright regardless
 *  of whether it happens to also be called — matching the guide's unconditional wording, and far
 *  simpler than a real reachability analysis (an uncalled HELPER with no agent()/phase() call inside
 *  it is harmless dead code anyway; an author who wants a called helper should write it as a `const`
 *  arrow function, already accepted). */
function checkTopLevelFunctionWrapper(body: string, program: { body?: unknown[] }): ScriptCheckError | null {
  const topLevel = Array.isArray(program.body) ? (program.body as Array<Record<string, unknown>>) : [];
  const offender = topLevel.find((stmt) => stmt['type'] === 'FunctionDeclaration');
  if (!offender) return null;
  const start = typeof offender['start'] === 'number' ? (offender['start'] as number) : 0;
  const line = body.slice(0, start).split('\n').length;
  const source = body.split('\n')[line - 1]?.trim();
  return {
    code: 'PARSE_ERROR',
    message:
      `a top-level \`function\` declaration at line ${line}${source ? `: \`${source}\`` : ''} is not accepted — the script body IS the function; ` +
      'do not declare another one around it. A `const` arrow function used as a thunk (e.g. for parallel()/pipeline()) is fine; a top-level `function`/`async function` ' +
      'STATEMENT is not, because any agent()/phase() call written inside one is never invoked unless the script also calls it back out, which this scan cannot verify — ' +
      'see workflow_authoring_guide.',
    detail: { field: 'script', line, ...(source ? { source } : {}), construct: 'function' },
  };
}

/** Issue #154 B1 (phase-alias dup, #157's own note — same root cause, fixed here not separately):
 *  a non-call reference to one of `CALLABLE_API_NAMES`. Excludes BINDING positions (a declaration,
 *  not a use: `const agent = …`'s own `id`, a function parameter, a catch param) and NON-VALUE
 *  positions (an object-literal key, a non-computed member-expression property — `{agent: 1}`,
 *  `x.agent` never touch the sandbox global at all) — anything else reaching this point that is not
 *  itself the `callee` of the call it appears in is a reference the registration-time text scanners
 *  cannot see through (an assignment, an argument, a `.call`/`.bind` property access, a bare
 *  expression statement). Over-flags only an extremely unlikely intentional shadow of one of these
 *  five names for an unrelated purpose — the same fail-closed bias this codebase's other scanners
 *  already take (e.g. issue #154 B2's spread/shorthand refusal) over silently accepting a bypass. */
function checkSandboxApiAliasing(body: string, root: Record<string, unknown>): ScriptCheckError | null {
  let found: { name: string; line: number; source?: string } | null = null;
  walkWithParent(root, null, null, (n, parent, key) => {
    if (found || n['type'] !== 'Identifier' || typeof n['name'] !== 'string' || !CALLABLE_API_NAMES.has(n['name'] as string)) return;
    if (!parent) return;
    const pType = parent['type'];
    // Binding / non-value positions — not a reference to the sandbox global at all.
    if (pType === 'VariableDeclarator' && key === 'id') return;
    if ((pType === 'FunctionDeclaration' || pType === 'FunctionExpression' || pType === 'ArrowFunctionExpression') && (key === 'params' || key === 'id')) return;
    if (pType === 'AssignmentPattern' && key === 'left') return;
    if (pType === 'CatchClause' && key === 'param') return;
    if (pType === 'Property' && key === 'key' && parent['computed'] !== true) return;
    if (pType === 'MemberExpression' && key === 'property' && parent['computed'] !== true) return;
    // The one ALLOWED value-reference shape: the direct callee of its own call.
    if ((pType === 'CallExpression' || pType === 'NewExpression') && key === 'callee') return;
    const start = typeof n['start'] === 'number' ? (n['start'] as number) : 0;
    const line = body.slice(0, start).split('\n').length;
    found = { name: n['name'] as string, line, source: body.split('\n')[line - 1]?.trim() };
  });
  if (!found) return null;
  const f = found as { name: string; line: number; source?: string };
  return {
    code: 'SCRIPT_INVALID',
    message:
      `\`${f.name}\` is referenced at line ${f.line}${f.source ? `: \`${f.source}\`` : ''} without being called directly — assigning it to a variable, passing it as a value, ` +
      `or reaching it through \`.call\`/\`.bind\`/\`.apply\` hides the call from registration-time scanning (the scan looks for \`${f.name}(\`, not every alias that could ` +
      `reach it). Call \`${f.name}(...)\` directly — see workflow_authoring_guide.`,
    detail: { field: 'script', line: f.line, ...(f.source ? { source: f.source } : {}), api: f.name },
  };
}

export function validateScriptEntry(
  script: string,
): { ok: true } | { ok: false; errors: ScriptCheckError[] } {
  const errors: ScriptCheckError[] = [];

  // ARCH-003 delegate: TS-not-JS parse rejection (same wrapping the sandbox evaluates). Strip the
  // leading `export const meta = {...}` first — a bare `export` is illegal inside the async-function
  // wrapper, exactly as the sandbox's evaluateScript strips it before compiling.
  const meta = checkMeta(script);
  // v26 Gate 7.5 round 1 (defect D6): the meta span is blanked to its OWN line count rather than
  // deleted, so every line below it keeps the number it has in the author's file — the line V8
  // reports is then the line the author can actually look at.
  const body = meta.span !== undefined ? script.replace(meta.span, blankLines(meta.span)) : script;
  try {
    new vm.Script(`(async () => {\n${body}\n})`, { filename: 'workflow-script.js' });
  } catch (err) {
    errors.push(parseErrorFor(script, err));
  }

  // Issue #154 B1: only runs when the script ALREADY parsed as valid JS above — a genuine syntax
  // error is reported once, by the check above, not duplicated here. acorn parses the SAME
  // meta-blanked body with the same options `script-spans.ts`'s `nonCodeSpans` oracle uses, for the
  // same reason (`sourceType:'script'`, not `'module'` — a classic script is what `vm.Script`
  // actually runs).
  if (errors.length === 0) {
    try {
      const ast = parse(body, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
      const wrapperErr = checkTopLevelFunctionWrapper(body, ast as unknown as { body?: unknown[] });
      if (wrapperErr) errors.push(wrapperErr);
      const aliasErr = checkSandboxApiAliasing(body, ast as unknown as Record<string, unknown>);
      if (aliasErr) errors.push(aliasErr);
    } catch {
      // acorn disagreeing with V8 on a script V8 already accepted is not expected in practice; fail
      // OPEN here specifically (not closed) — the vm.Script check above is the authoritative parse
      // gate, already passed, and this scan is a strictly-additive refinement of what it means for
      // code to be "accepted", not a second parse gate of its own.
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** P6-2 registration half: the SAME predicate the dispatch site uses to forge-detect a closing
 *  `</user-instructions>` frame delimiter in a caller-supplied `appendPrompt`. Re-exported from
 *  `params/contract.ts`'s `FRAME_CLOSE_FORGERY`, never re-implemented (v21 QD-REP-1 precedent). */
export function violatesFrameDelimiter(appendPrompt: string | undefined): boolean {
  if (appendPrompt === undefined) return false;
  return FRAME_CLOSE_FORGERY.test(appendPrompt);
}
