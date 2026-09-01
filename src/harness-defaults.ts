// HarnessDefaults — shared type and register-time validation.
// DES-099 (ARCH-062, TASK-089): single exported interface consumed by register validation and
// workflow_get output (prevents schema drift). The run-time merge lives in src/params/resolve.ts
// (mergeRunParams/defaultRunParams, DES-102) — this file's own author-side merge helper was
// retired once that path subsumed it (TASK-104).

// v21 adjudication #6 (F-1 widen, TASK-099): `effort`/`appendPrompt` are two of REQ-090's four
// tunable knobs (D12) and must be representable as an author-declared default like `model`/
// `timeoutMs` already are — adjudication #5's "reject a default no rung can apply" is SUPERSEDED.
// EFFORT_RANK is the single ordering table (contract.ts) so KNOWN_KEYS validation never drifts
// from the enum the ceiling/override paths already enforce.
import { EFFORT_RANK, type Effort } from './params/contract.js';

/** Shared harness configuration that can be bound at workflow registration time. */
export interface HarnessDefaults {
  model?: string;
  tools?: string[];
  skills?: string[];
  timeoutMs?: number;
  prompt?: string;
  effort?: Effort;
  appendPrompt?: string;
}

/** Curated static tool allowlist [D-AUTH-5-C] — only names in this set are accepted in
 *  defaults.tools. Extended from the Anthropic SDK built-in core set plus common MCP tool names.
 *  `bash_exec` and other non-standard shell-exec aliases are intentionally absent. */
export const HARNESS_TOOL_ALLOWLIST = new Set<string>([
  // MCP-style snake_case tool names
  'read_file', 'write_file', 'edit_file', 'list_directory', 'create_directory',
  'search_files', 'move_file', 'copy_file', 'delete_file', 'append_to_file', 'get_file_info',
  // Anthropic SDK built-in tools (PascalCase)
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
  // Optional web/agent tools
  'WebFetch', 'WebSearch', 'Task',
]);

// The complete set of recognized HarnessDefaults keys (D-AUTH-5-A)
const KNOWN_KEYS = new Set<string>(['model', 'tools', 'skills', 'timeoutMs', 'prompt', 'effort', 'appendPrompt']);

/** Register-time validation [D-AUTH-5 named assertions — do not simplify].
 *  Returns { ok:true } on success or { ok:false, message } on any violation.
 *  - D-AUTH-5-A: unknown key → reject
 *  - D-AUTH-5-B: model alias not resolvable against aliasNames → reject (skipped when aliasNames is
 *                empty/undefined, preserving backward compat for unconfigured alias tables)
 *  - D-AUTH-5-C: tool not in curated static allowlist → reject
 *  - D-AUTH-5-D: skills existence deferred to run time (NOT checked here)
 *  - D-AUTH-5-E: any violation → reject whole object (no partial write falls out from caller not writing)
 */
export function validateHarnessDefaults(
  defaults: Record<string, unknown>,
  aliasNames?: Set<string>,
): { ok: true } | { ok: false; message: string } {
  // D-AUTH-5-A: no unknown keys
  for (const key of Object.keys(defaults)) {
    if (!KNOWN_KEYS.has(key)) {
      return { ok: false, message: `Unknown harness defaults key: "${key}"` };
    }
  }

  // Shape validation
  if (defaults.model !== undefined && typeof defaults.model !== 'string') {
    return { ok: false, message: 'defaults.model must be a string' };
  }
  if (defaults.timeoutMs !== undefined && typeof defaults.timeoutMs !== 'number') {
    return { ok: false, message: 'defaults.timeoutMs must be a number' };
  }
  if (defaults.prompt !== undefined && typeof defaults.prompt !== 'string') {
    return { ok: false, message: 'defaults.prompt must be a string' };
  }
  if (defaults.tools !== undefined && !Array.isArray(defaults.tools)) {
    return { ok: false, message: 'defaults.tools must be an array' };
  }
  if (defaults.skills !== undefined && !Array.isArray(defaults.skills)) {
    return { ok: false, message: 'defaults.skills must be an array' };
  }
  if (defaults.effort !== undefined && !Object.prototype.hasOwnProperty.call(EFFORT_RANK, defaults.effort as Effort)) {
    return { ok: false, message: `defaults.effort must be one of: ${Object.keys(EFFORT_RANK).join(', ')}` };
  }
  if (defaults.appendPrompt !== undefined && typeof defaults.appendPrompt !== 'string') {
    return { ok: false, message: 'defaults.appendPrompt must be a string' };
  }

  // D-AUTH-5-B: model alias must be resolvable (only when alias table is configured)
  if (typeof defaults.model === 'string' && aliasNames !== undefined && aliasNames.size > 0) {
    if (!aliasNames.has(defaults.model)) {
      return { ok: false, message: `Model alias not resolvable: "${defaults.model}"` };
    }
  }

  // D-AUTH-5-C: every tool name must be in the curated static allowlist
  if (Array.isArray(defaults.tools)) {
    for (const tool of defaults.tools) {
      if (typeof tool !== 'string' || !HARNESS_TOOL_ALLOWLIST.has(tool)) {
        return { ok: false, message: `Tool not in curated allowlist: "${String(tool)}"` };
      }
    }
  }

  // D-AUTH-5-D: skills deferred to run time — no check here

  return { ok: true };
}
