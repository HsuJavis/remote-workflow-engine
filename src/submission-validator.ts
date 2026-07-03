// SubmissionValidator (DES-012 / ARCH-008 / TASK-017).
// Thin facade at the submission entry points: collapses the meta/parse check (ARCH-003),
// the model-alias resolve check (ARCH-005), and the agentType/workflow-name existence check
// (ARCH-007) into ONE error-reporting shape, so a bad submission fails fast, not mid-run.
import * as vm from 'node:vm';
import type { RunSpec, ErrEnvelope } from './types.js';
import type { AliasMap } from './gateway/client.js';
import type { WorkflowCatalog } from './workflow-catalog.js';

// Default alias set (REQ-004: sonnet/haiku/opus/default → provider models) — used when no
// explicit AliasMap is injected (matches the server's default gateway config).
const DEFAULT_ALIASES: AliasMap = {
  sonnet: { provider: 'anthropic', model: 'claude-sonnet' },
  haiku: { provider: 'anthropic', model: 'claude-haiku' },
  opus: { provider: 'anthropic', model: 'claude-opus' },
  default: { provider: 'anthropic', model: 'claude-sonnet' },
};

export interface SubmissionValidatorDeps {
  aliases?: AliasMap;
  catalog?: WorkflowCatalog;
}

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

export class SubmissionValidator {
  private readonly _aliases: AliasMap;
  private readonly _catalog?: WorkflowCatalog;

  constructor(deps: SubmissionValidatorDeps = {}) {
    this._aliases = deps.aliases ?? DEFAULT_ALIASES;
    this._catalog = deps.catalog;
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
      try {
        new vm.Script(`(async () => {\n${spec.script}\n})`, { filename: 'workflow-script.js' });
      } catch (err) {
        errors.push({ code: 'PARSE_ERROR', message: err instanceof Error ? err.message : String(err), field: 'script' });
      }

      // ARCH-005 delegate: model-alias resolve.
      for (const alias of extractModelAliases(spec.script)) {
        if (!this._aliases[alias]) {
          errors.push({ code: 'UNKNOWN_ALIAS', message: `Unknown model alias: ${alias}`, field: 'model' });
        }
      }
    }

    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }
}
