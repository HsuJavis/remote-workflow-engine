// HarnessDefaults — shared type, pure per-param merge, and register-time validation.
// DES-099 (ARCH-062, TASK-089): single exported interface consumed by register validation,
// workflow_get output, and run-time merge (prevents schema drift).

/** Shared harness configuration that can be bound at workflow registration time. */
export interface HarnessDefaults {
  model?: string;
  tools?: string[];
  skills?: string[];
  timeoutMs?: number;
  prompt?: string;
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
const KNOWN_KEYS = new Set<string>(['model', 'tools', 'skills', 'timeoutMs', 'prompt']);

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

/** Pure per-param merge: override value wins for each key; absent override keys fall back to
 *  the registered default. No spread (to avoid forcing explicit undefined to win). */
export function resolveHarnessParams(
  registered: HarnessDefaults | undefined,
  overrides: Partial<HarnessDefaults>,
): HarnessDefaults {
  return {
    model: overrides.model !== undefined ? overrides.model : registered?.model,
    tools: overrides.tools !== undefined ? overrides.tools : registered?.tools,
    skills: overrides.skills !== undefined ? overrides.skills : registered?.skills,
    timeoutMs: overrides.timeoutMs !== undefined ? overrides.timeoutMs : registered?.timeoutMs,
    prompt: overrides.prompt !== undefined ? overrides.prompt : registered?.prompt,
  };
}
