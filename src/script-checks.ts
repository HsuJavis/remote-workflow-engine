// script-checks.ts (DES-112, ARCH-074, TASK-106).
// Pure, injected-ports lift of submission-validator.ts:92-124's `if (spec.script)` block: the same
// three checks (PARSE_ERROR / UNKNOWN_ALIAS / MCP_NOT_PROVISIONED), same codes, so no caller learns a
// new vocabulary. No I/O, no clock, no registry import — `mcpLookup` is a `(name) => boolean`
// predicate, never the registry object itself (a predicate can't silently grow a dependency).
import * as vm from 'node:vm';
import { checkMeta } from './sandbox/guards.js';
export { FRAME_CLOSE_FORGERY } from './params/contract.js';
import { FRAME_CLOSE_FORGERY } from './params/contract.js';

export interface ScriptCheckPorts {
  aliases: ReadonlySet<string>;
  openrouterPassthrough: boolean;
  mcpLookup: (name: string) => boolean;
}

export type ScriptCheckCode = 'PARSE_ERROR' | 'UNKNOWN_ALIAS' | 'MCP_NOT_PROVISIONED';

export interface ScriptCheckError {
  code: ScriptCheckCode;
  message: string;
  detail: Record<string, unknown>;
}

// REQ-038: an `openrouter/<id>`-shaped passthrough string is not a pre-listed alias yet is still a
// valid model (LiteLLM's `openrouter/*` wildcard routes it natively) — accepted unchanged.
const OPENROUTER_PASSTHROUGH = /^openrouter\/.+/;

/** Static scan for `{model: '<alias>'}` occurrences in an inline script's `agent()` calls. */
function extractModelAliases(script: string): string[] {
  const aliases: string[] = [];
  const re = /model\s*:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script))) {
    aliases.push(m[1]!);
  }
  return aliases;
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
    const body = meta.span !== undefined ? script.replace(meta.span, '') : script;
    new vm.Script(`(async () => {\n${body}\n})`, { filename: 'workflow-script.js' });
  } catch (err) {
    errors.push({
      code: 'PARSE_ERROR',
      message: err instanceof Error ? err.message : String(err),
      detail: { field: 'script' },
    });
  }

  // ARCH-005 delegate: model-alias resolve.
  for (const alias of extractModelAliases(script)) {
    if (ports.aliases.has(alias)) continue;
    if (ports.openrouterPassthrough && OPENROUTER_PASSTHROUGH.test(alias)) continue;
    errors.push({
      code: 'UNKNOWN_ALIAS',
      message: `Unknown model alias: ${alias}`,
      detail: { field: 'model', alias },
    });
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
