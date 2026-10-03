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

/** review M3: the base tool names pi DOES support (the positive side of `PI_UNSUPPORTED_TOOLS`'
 *  negative list) — kept here, independently of `pi-gateway-client.ts`'s own `TOOL_NAME_MAP`, for the
 *  SAME reason `PI_UNSUPPORTED_TOOLS` is: this is the registration-time disclosure/validation fact,
 *  not the dispatch-time routing table. `tests/unit/harness-info.test.ts` cross-checks the two stay
 *  in sync. */
const PI_SUPPORTED_BASE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'LS'] as const;

/** review M3: pi harness v1's spec says an unsupported tool is "refused at registration AND
 *  dispatch" — before this, only dispatch refused (`PiGatewayClient.invoke`'s own `mapTools`), so a
 *  workflow declaring `allowedTools:['Read','WebFetch']` registered cleanly and only failed once a
 *  run actually tried to dispatch that agent. Pure (no gateway import — see `PI_UNSUPPORTED_TOOLS`'s
 *  own doc on why these two files stay independent): an `mcp__<server>__<tool>` entry (review M2) is
 *  always accepted, matching `pi-gateway-client.ts`'s own `isMcpToolName` carve-out exactly. Returns
 *  every unsupported name found (never just the first), so the registration error can name them all
 *  at once. */
export function piUnsupportedToolNames(allowedTools: readonly string[]): string[] {
  return allowedTools.filter((t) => !t.startsWith('mcp__') && !(PI_SUPPORTED_BASE_TOOLS as readonly string[]).includes(t));
}

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
