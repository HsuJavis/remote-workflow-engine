// providers.ts (DES-172, ARCH-112, ADR-041, ADR-045, TASK-171, REQ-123, v26): the closed
// three-member `Provider` union, one `PROVIDER_CAPS` capability table, `validateAliases` (names
// EVERY offending row — the consumer is a human editing bad rows during a release, so partial
// enumeration wastes a release cycle) and `resolveAlias`.
//
// Pure — no SDK import, no `fetch`, no `process.env` — so both gateways, `composeConfig`,
// `models_list` and the guide builder can import it freely without pulling in transport weight.

export const PROVIDERS = ['anthropic', 'openrouter', 'ollama'] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(v: unknown): v is Provider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

/** `param` is the flat Agent SDK Options field; `restPath` is the (possibly nested) REST-body
 *  path a direct-fetch (non-SDK) transport writes the same value at. */
export type EffortProfile = { param: string; restPath: string[] };

export const PROVIDER_CAPS: Record<
  Provider,
  { tools: 'all'; effort: EffortProfile | null; thinking: 'sdk-default' | 'budget-when-declared' | 'disabled' }
> = {
  anthropic: { tools: 'all', effort: { param: 'effort', restPath: ['output_config', 'effort'] }, thinking: 'sdk-default' },
  openrouter: { tools: 'all', effort: { param: 'thinking', restPath: ['thinking', 'budget_tokens'] }, thinking: 'budget-when-declared' },
  ollama: { tools: 'all', effort: null, thinking: 'disabled' },
};

type AliasEntry = { provider: string; model: string; proxyModel?: string };

/** Names EVERY offending row plus the remedy — the deliberate opposite of a first-offender rule
 *  (DES-170's `validateSeedSpec`): the consumer here is a human editing several bad rows at once. */
export function validateAliases(
  aliases: Record<string, AliasEntry>,
): { ok: true } | { ok: false; offenders: Array<{ alias: string; provider: string }>; allowed: readonly Provider[] } {
  const offenders = Object.entries(aliases)
    .filter(([, entry]) => !isProvider(entry.provider))
    .map(([alias, entry]) => ({ alias, provider: entry.provider }));
  if (offenders.length === 0) return { ok: true };
  return { ok: false, offenders, allowed: PROVIDERS };
}

export function resolveAlias(
  aliases: Record<string, AliasEntry>,
  modelOrAlias: string,
): { provider: Provider; model: string; proxyModel?: string } | undefined {
  const entry = aliases[modelOrAlias];
  if (entry === undefined || !isProvider(entry.provider)) return undefined;
  return entry.proxyModel !== undefined
    ? { provider: entry.provider, model: entry.model, proxyModel: entry.proxyModel }
    : { provider: entry.provider, model: entry.model };
}
