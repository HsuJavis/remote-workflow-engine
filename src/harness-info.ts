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
    // issue #150: effortApplied is per-MODEL now, not blanket-true for every openrouter call — a
    // model the pinned catalog says has no reasoning dial (capabilities.reasoning.supported:false,
    // e.g. openrouter/openai/gpt-4.1) gets NO reasoning field on the wire at all and reports
    // effortApplied:false ("model does not support reasoning"), never a claim this harness cannot
    // back up.
    effort: 'mapped to pi\'s thinkingLevel; effortApplied is true only for a verified outbound request to a model whose catalog row supports reasoning (OpenRouter\'s reasoning.effort — see DEPLOY.md), false otherwise; ollama has no reasoning dial.',
    // issue #152: made explicit that partial:true on abort/timeout is unconditional (even a known
    // figure of exactly 0 — pi's child->parent protocol only GUARANTEES usage on a COMPLETE
    // message_end/error event).
    // issue #160 BUG-4: the in-progress turn itself may still contribute a real, non-estimated
    // figure — when the provider populates `usage` on an intermediate stream chunk (some do; most
    // don't), that figure is forwarded and folded in as a lower bound at abort/timeout time, same as
    // every completed turn's own exact figure.
    // issue #160 BUG-4 reopen (2026-10-10 owner decision): #152's original "this engine deliberately
    // never estimates the missing figure client-side" is REVERSED — a provider that reports nothing
    // at all before an abort/timeout (OpenRouter is the common case under this harness) no longer
    // yields a bare 0; `AgentExecutor.applyAbortEstimate` (agent-executor.ts) now charges a
    // deterministic `ceil(chars/4)` floor over the exact text that attempt dispatched, marked
    // `estimated:true` beside `partial:true` — the "schema slot marking it not exact" #152 said this
    // engine did not have now exists and is populated.
    usage: 'summed over every assistant message_end (pi has no stable per-message id), PLUS whatever the provider itself already reported for a turn still in flight at abort/timeout time (forwarded verbatim); partial:true on abort/timeout, ALWAYS. When NEITHER source has anything for the in-flight turn, the engine charges a deterministic ceil(chars/4) floor over the exact text that attempt dispatched (input only, never output) and marks it estimated:true beside partial:true — distinct from a real, if incomplete, provider/harness figure (partial:true with no estimated field); this estimate is charged against budget exactly like real usage. pi\'s own advisory cost figure is ignored — the engine prices by provider/model.',
  };
}
