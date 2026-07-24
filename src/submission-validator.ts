// SubmissionValidator (DES-012 / ARCH-008 / TASK-017).
// Thin facade at the submission entry points: collapses the meta/parse check (ARCH-003),
// the model-alias resolve check (ARCH-005), and the agentType/workflow-name existence check
// (ARCH-007) into ONE error-reporting shape, so a bad submission fails fast, not mid-run.
import * as vm from 'node:vm';
import { checkMeta } from './sandbox/guards.js';
import type { RunSpec, ErrEnvelope } from './types.js';
import type { AliasMap } from './gateway/client.js';
import type { WorkflowCatalog } from './workflow-catalog.js';
import { DEFAULT_ALIASES } from './default-aliases.js';

// TASK-029/DES-024: narrow duck-typed port (not the full McpRegistry) so this facade doesn't
// couple to the registry's own storage/probe internals — only the by-name existence check.
export interface McpNameLookup {
  get(name: string): unknown;
}

export interface SubmissionValidatorDeps {
  aliases?: AliasMap;
  catalog?: WorkflowCatalog;
  mcpRegistry?: McpNameLookup;
  /** REQ-038 passthrough: when true (the default — the generated LiteLLM config always carries the
   *  `openrouter/*` wildcard route), an `openrouter/<id>`-shaped model string is accepted at
   *  submission WITHOUT a pre-listed alias (it passes through to LiteLLM's native OpenRouter
   *  provider). Set false to require every openrouter model to be a pre-listed alias. */
  openrouterPassthrough?: boolean;
}

/** REQ-038: a passthrough model string of the form `openrouter/<non-empty-id>` — routed natively by
 *  LiteLLM's `openrouter/*` wildcard, so it needs no pre-listed alias. */
const OPENROUTER_PASSTHROUGH = /^openrouter\/.+/;

/** Static scan for `{model: '<alias>'}` occurrences in an inline script's `agent()` calls. */
function extractModelAliases(script: string): string[] {
  const aliases: string[] = [];
  const re = /model\s*:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script))) {
    aliases.push(m[1]);
  }
  return aliases;
}

// TASK-029/DES-024: static scan for `mcp: [...]` occurrences in an inline script's `agent()`
// calls — mirrors extractModelAliases' own static-scan convention (a dynamic script's referenced
// MCP names aren't otherwise visible before it actually runs).
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

export class SubmissionValidator {
  private readonly _aliases: AliasMap;
  private readonly _catalog?: WorkflowCatalog;
  private readonly _mcpRegistry?: McpNameLookup;
  private readonly _openrouterPassthrough: boolean;

  constructor(deps: SubmissionValidatorDeps = {}) {
    this._aliases = deps.aliases ?? DEFAULT_ALIASES;
    this._catalog = deps.catalog;
    this._mcpRegistry = deps.mcpRegistry;
    this._openrouterPassthrough = deps.openrouterPassthrough ?? true;
  }

  async validate(spec: RunSpec): Promise<{ ok: true } | { ok: false; errors: ErrEnvelope[] }> {
    const errors: ErrEnvelope[] = [];

    if (!spec.name && !spec.script) {
      errors.push({ code: 'MISSING_SCRIPT', message: 'Submission requires either a registered workflow "name" or an inline "script".', field: 'script' });
      return { ok: false, errors };
    }

    if (spec.name && !spec.script) {
      // ARCH-007 delegate: registered-workflow existence.
      if (this._catalog) {
        try {
          await this._catalog.get(spec.name);
        } catch {
          errors.push({ code: 'UNKNOWN_WORKFLOW', message: `Unknown workflow: ${spec.name}`, field: 'name' });
        }
      } else {
        errors.push({ code: 'UNKNOWN_WORKFLOW', message: `Unknown workflow: ${spec.name}`, field: 'name' });
      }
    }

    if (spec.script) {
      // ARCH-003 delegate: TS-not-JS parse rejection (same wrapping the sandbox evaluates).
      // Strip the leading `export const meta = {...}` first — a bare `export` is illegal inside the
      // async-function wrapper, exactly as the sandbox's evaluateScript strips it before compiling.
      // Uses the string-aware checkMeta scanner (NOT a `/[^;]*;/` regex, which truncated at the first
      // semicolon inside a meta string value and left a dangling fragment → spurious PARSE_ERROR).
      try {
        const meta = checkMeta(spec.script);
        const body = meta.span !== undefined ? spec.script.replace(meta.span, '') : spec.script;
        new vm.Script(`(async () => {\n${body}\n})`, { filename: 'workflow-script.js' });
      } catch (err) {
        errors.push({ code: 'PARSE_ERROR', message: err instanceof Error ? err.message : String(err), field: 'script' });
      }

      // ARCH-005 delegate: model-alias resolve. REQ-038: an `openrouter/<id>`-shaped passthrough
      // string is NOT a pre-listed alias yet is still a valid model (LiteLLM's `openrouter/*`
      // wildcard routes it natively) — so it's accepted here rather than falsely UNKNOWN_ALIAS.
      for (const alias of extractModelAliases(spec.script)) {
        if (this._aliases[alias]) continue;
        if (this._openrouterPassthrough && OPENROUTER_PASSTHROUGH.test(alias)) continue;
        errors.push({ code: 'UNKNOWN_ALIAS', message: `Unknown model alias: ${alias}`, field: 'model' });
      }

      // DES-024 delegate: a referenced-but-unprovisioned MCP name fails fast at submission
      // (never mid-run, never a silent no-op) — same fail-fast shape as the alias check above.
      if (this._mcpRegistry) {
        for (const name of extractMcpNames(spec.script)) {
          if (!this._mcpRegistry.get(name)) {
            errors.push({ code: 'MCP_NOT_PROVISIONED', message: `Unprovisioned MCP name: ${name}`, field: 'mcp' });
          }
        }
      }
    }

    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }
}
