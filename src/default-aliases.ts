// Single source of truth for the default model-alias table (REQ-004 / ARCH-005 "config, singular").
//
// R-1 (Gate 8 v2 review, quality-dimensions finding): three independently-maintained copies of this
// table had drifted (run-manager.ts / main.ts agreed on real Anthropic model IDs; submission-validator.ts
// carried stale `claude-sonnet`/`claude-haiku`/`claude-opus` placeholders). Every consumer now imports
// THIS const so there is exactly one table to maintain.
//
// Parent-side only (composition root + submission path). NOT imported by the sandbox child
// (src/sandbox/child-entry.ts → guards.ts only), so a shared value import here does not trip the
// sandbox-child .ts-resolution constraint.
import type { AliasMap } from './gateway/client.js';

/** The fallback alias set used whenever no explicit AliasMap is injected — the anthropic-only
 *  defaults REQ-004 documents (sonnet/haiku/opus/default → provider models). */
export const DEFAULT_ALIASES: AliasMap = {
  sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
  opus: { provider: 'anthropic', model: 'claude-opus-4-5' },
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
};
