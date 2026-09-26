// script-checks.ts (DES-112, ARCH-074, TASK-106).
// Pure, injected-ports lift of submission-validator.ts:92-124's `if (spec.script)` block. No I/O,
// no clock, no registry import — `mcpLookup` is a `(name) => boolean` predicate, never the registry
// object itself (a predicate can't silently grow a dependency).
//
// 2026-09-26 (alias mechanism removed): the model-alias static scan (`extractModelAliases` /
// UNKNOWN_MODEL here) is DROPPED, not ported — it regex-scanned `model: '<literal>'` over the WHOLE
// script text, which under the v24 contract can only ever match an agent() call's `model` OPT
// (already refused PARAM_IN_SCRIPT elsewhere, `workflow-meta.ts`'s ARCH-096 scan) or a `model.enum`
// entry inside `meta.params` (checked properly, with catalog existence, by `contract.ts`'s
// `validateOneAgentSpec`). This module now checks only PARSE_ERROR / MCP_NOT_PROVISIONED.
import * as vm from 'node:vm';
import { checkMeta } from './sandbox/guards.js';
export { FRAME_CLOSE_FORGERY } from './params/contract.js';
import { FRAME_CLOSE_FORGERY } from './params/contract.js';
import type { ErrorCode } from './errors.js';

export interface ScriptCheckPorts {
  mcpLookup: (name: string) => boolean;
}

// v24 (TASK-155, B-7/adjudication #3): constrained to ERROR_CATALOG's own keys via `Extract` —
// DES-137's type-level net (every codedError(literal) is a catalog key) had exactly one hole
// left: this bare literal union could drift from the catalog with no compiler signal. A future
// value added here without a matching catalog entry now fails `tsc`, not a runtime grep.
export type ScriptCheckCode = Extract<ErrorCode, 'PARSE_ERROR' | 'MCP_NOT_PROVISIONED'>;

export interface ScriptCheckError {
  code: ScriptCheckCode;
  message: string;
  detail: Record<string, unknown>;
}

/** Static scan for `mcp: [...]` occurrences in an inline script's `agent()` calls. */
function extractMcpNames(script: string): string[] {
  const names: string[] = [];
  const arrays = script.matchAll(/mcp\s*:\s*\[([^\]]*)\]/g);
  for (const arr of arrays) {
    for (const m of arr[1]!.matchAll(/['"]([^'"]+)['"]/g)) {
      names.push(m[1]!);
    }
  }
  return names;
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

export function validateScriptEntry(
  script: string,
  ports: ScriptCheckPorts,
): { ok: true } | { ok: false; errors: ScriptCheckError[] } {
  const errors: ScriptCheckError[] = [];

  // ARCH-003 delegate: TS-not-JS parse rejection (same wrapping the sandbox evaluates). Strip the
  // leading `export const meta = {...}` first — a bare `export` is illegal inside the async-function
  // wrapper, exactly as the sandbox's evaluateScript strips it before compiling.
  try {
    const meta = checkMeta(script);
    // v26 Gate 7.5 round 1 (defect D6): the meta span is blanked to its OWN line count rather than
    // deleted, so every line below it keeps the number it has in the author's file — the line V8
    // reports is then the line the author can actually look at.
    const body = meta.span !== undefined ? script.replace(meta.span, blankLines(meta.span)) : script;
    new vm.Script(`(async () => {\n${body}\n})`, { filename: 'workflow-script.js' });
  } catch (err) {
    errors.push(parseErrorFor(script, err));
  }

  // DES-024 delegate: a referenced-but-unprovisioned MCP name fails fast.
  for (const name of extractMcpNames(script)) {
    if (!ports.mcpLookup(name)) {
      errors.push({
        code: 'MCP_NOT_PROVISIONED',
        message: `Unprovisioned MCP name: ${name}`,
        detail: { field: 'mcp', name },
      });
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
