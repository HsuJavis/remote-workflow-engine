// src/harness-info.ts (pi harness v1, spec "Disclosure"). Pure — the one place system_info / the
// authoring guide / DEPLOY.md all read the SAME facts from, so the three surfaces can never drift.
import type { Provider } from './providers.js';

/** Pinned exactly as package.json pins `@earendil-works/pi-coding-agent` — kept here as a literal
 *  (not re-read from package.json at runtime) so this module stays pure/import-free, matching the
 *  rest of this file's dual-purpose-as-disclosure-source role. Update BOTH places together. */
export const PI_HARNESS_VERSION = '1.0.0';

/** spec "Tool mapping": every engine tool name with no pi mapping — refused at dispatch with
 *  TOOL_UNSUPPORTED_BY_HARNESS, never silently dropped. Kept here, not re-derived from
 *  pi-gateway-client.ts's own TOOL_NAME_MAP, because the exhaustive "what's NOT supported" list is a
 *  disclosure fact, not a routing table — the two are allowed to be reviewed independently. */
export const PI_UNSUPPORTED_TOOLS = ['WebFetch', 'WebSearch', 'Task', 'NotebookEdit'] as const;

export interface HarnessAnnounce {
  name: 'sdk' | 'pi';
  version?: string;
  providers: readonly string[];
  unsupportedTools?: readonly string[];
  /** spec "Disclosure": effort and usage semantics, in prose — read verbatim by system_info and the
   *  authoring guide. */
  effort?: string;
  usage?: string;
}

const SDK_PROVIDERS: readonly Provider[] = ['anthropic', 'openrouter', 'ollama'];

/** `harnessProviders` is `ServerConfig.harnessProviders` — present (always `['openrouter',
 *  'ollama']` today) only under `gateway:"pi"`. Absent -> the sdk gateway's own announce (all three
 *  providers, no tool/effort/usage caveats — nothing pi-specific to disclose). */
export function buildHarnessAnnounce(harnessProviders?: readonly Provider[]): HarnessAnnounce {
  if (harnessProviders === undefined) {
    return { name: 'sdk', providers: SDK_PROVIDERS };
  }
  return {
    name: 'pi',
    version: PI_HARNESS_VERSION,
    providers: harnessProviders,
    unsupportedTools: PI_UNSUPPORTED_TOOLS,
    effort: 'mapped to pi\'s thinkingLevel; effortApplied is only ever true for a verified outbound request (OpenRouter\'s reasoning.effort — see DEPLOY.md); ollama has no reasoning dial.',
    usage: 'summed over every assistant message_end (pi has no stable per-message id); partial:true on abort/timeout; pi\'s own advisory cost figure is ignored — the engine prices by provider/model.',
  };
}
