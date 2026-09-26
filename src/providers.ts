// providers.ts (DES-172, ARCH-112, ADR-041, ADR-045, TASK-171, REQ-123, v26; alias mechanism
// removed 2026-09-26 owner decisions): the closed three-member `Provider` union, one
// `PROVIDER_CAPS` capability table, and `parseModelRef` — the ONE normalizer for a model reference.
//
// Every model is now a full `<provider>/<model-id>` string (no alias table, no 'default', no bare
// name of any kind — a bare name is refused UNKNOWN_MODEL wherever it is checked). Split at the
// FIRST `/` only: an openrouter id can itself carry a `/` (`openrouter/openai/gpt-4.1`), and an
// ollama id can carry a `:` (`ollama/qwen2.5:7b`) or a `.` — none of those characters are special to
// this parser, only the first `/` is.
//
// Pure — no SDK import, no `fetch`, no `process.env` — so both gateways, `composeConfig`,
// `models_list` and the guide builder can import it freely without pulling in transport weight.
// `checkModelRef`'s catalog-existence arm takes an already-fetched `ModelCatalogSnapshot` (data, not
// a promise) — the live/last-good/static fetch itself happens elsewhere (ModelBook), keeping this
// file itself I/O-free.
import { STATIC_ANTHROPIC_RATES } from './models/model-catalog.js';

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
  {
    tools: 'all';
    effort: EffortProfile | null;
    thinking: 'sdk-default' | 'budget-when-declared' | 'disabled';
    /** v26 Gate 7.5 round 1 (REQ-126, VAL-186): whether a mapped effort directive actually REACHES
     *  the provider on this deployment's dispatch path, which is not the same question as whether
     *  the provider has a dial. `effort` above stays the routing fact (what the gateway maps, owner's
     *  call to change); this is the OBSERVED fact, captured against the real API. The guide's provider
     *  table renders THIS one, so the manual stops promising something the wire never carries. */
    effortDelivered: boolean;
  }
> = {
  anthropic: { tools: 'all', effort: { param: 'effort', restPath: ['output_config', 'effort'] }, thinking: 'sdk-default', effortDelivered: true },
  // VAL-186: the SDK maps the budget to `--max-thinking-tokens`, the Claude CLI collapses that to
  // `thinking:{type:'adaptive'}` (budget and the low/high distinction gone at hop 1), and LiteLLM
  // drops the parameter for openrouter — low and high are byte-identical on the wire.
  openrouter: { tools: 'all', effort: { param: 'thinking', restPath: ['thinking', 'budget_tokens'] }, thinking: 'budget-when-declared', effortDelivered: false },
  ollama: { tools: 'all', effort: null, thinking: 'disabled', effortDelivered: false },
};

export interface ModelRef {
  provider: Provider;
  model: string;
}

/** The ONE model-reference normalizer (owner decision 1). Splits at the FIRST `/` only — an
 *  openrouter id can itself carry further `/`s (`openrouter/openai/gpt-4.1` -> model
 *  `openai/gpt-4.1`, matching the price-book key `${provider}/${model}`) — and refuses a bare name
 *  (no slash at all, including the literal `'default'`), an unknown provider prefix, a non-string
 *  input, or an empty model id. Pure syntax only; existence is `checkModelRef`'s job below. */
export function parseModelRef(ref: unknown): ModelRef | undefined {
  if (typeof ref !== 'string') return undefined;
  const i = ref.indexOf('/');
  if (i <= 0) return undefined; // no '/' at all, or a leading '/' (empty provider segment)
  const provider = ref.slice(0, i);
  const model = ref.slice(i + 1);
  if (!isProvider(provider) || model.length === 0) return undefined;
  return { provider, model };
}

/** The pure data `checkModelRef`'s existence arm consults for openrouter/ollama — an
 *  already-fetched snapshot (never a live fetch itself, keeping this module I/O-free). Built from
 *  `ModelBook.snapshot()`'s own `entries`/`source` (see `models/model-book.ts`'s
 *  `toModelCatalogSnapshot` adapter) — anthropic is deliberately never expected in `entries` (it has
 *  no live listing; see the static-table arm below). */
export interface ModelCatalogSnapshot {
  entries: ReadonlyArray<{ provider: string; model: string }>;
  /** ModelBook's own provenance for `entries`: `'static'` means the live source has never once
   *  succeeded (nothing was actually looked up), so an empty `entries` for THAT reason must be
   *  treated as "unavailable", the same as a genuinely-empty live listing for a provider with no
   *  configured models. Omitted (a caller with no snapshot at all) behaves like `'static'`. */
  source?: 'live' | 'last-good' | 'static';
}

/** The empty snapshot — every openrouter/ollama ref is accepted with a warning (catalog
 *  "unavailable"), matching a caller that never wired a real one in (e.g. a unit test's direct
 *  `RunManager`/`WorkflowCatalog` construction). */
export const EMPTY_MODEL_CATALOG: ModelCatalogSnapshot = { entries: [] };

export type ModelRefVerdict =
  | { ok: true; provider: Provider; model: string; warning?: string }
  | { ok: false; message: string };

/** Owner decision 6 — model existence: openrouter/ollama ids are checked against `catalog` when its
 *  listing for that provider is available (refuse `UNKNOWN_MODEL` if the id is absent from it); when
 *  the listing is unavailable (no rows for that provider, or `catalog.source === 'static'` — the
 *  live source has never once succeeded), the ref is ACCEPTED with a warning rather than refused —
 *  "we could not check" must never become "we assume it doesn't exist". Anthropic ids are checked
 *  against the deployment's static price table (`STATIC_ANTHROPIC_RATES`) the SAME way regardless of
 *  `catalog` — anthropic has no live listing at all — and an unknown anthropic id is likewise
 *  ACCEPTED with a warning, never refused: a new Anthropic model must not be blocked by a stale
 *  table. A malformed ref (no provider / unknown provider / empty id) is refused regardless of the
 *  catalog, with a message naming the expected shape and the three providers. */
export function checkModelRef(ref: unknown, catalog: ModelCatalogSnapshot = EMPTY_MODEL_CATALOG): ModelRefVerdict {
  const parsed = parseModelRef(ref);
  if (!parsed) {
    return {
      ok: false,
      message:
        `"${String(ref)}" is not a valid model reference — expected <provider>/<model-id> where provider is one of ` +
        `${PROVIDERS.join(', ')} (e.g. "anthropic/claude-haiku-4-5-20251001", "openrouter/openai/gpt-4.1", "ollama/qwen2.5:7b")`,
    };
  }
  const { provider, model } = parsed;
  if (provider === 'anthropic') {
    if (Object.hasOwn(STATIC_ANTHROPIC_RATES, model)) return { ok: true, provider, model };
    return {
      ok: true,
      provider,
      model,
      warning: `anthropic model "${model}" is not in this deployment's static price table; accepted (a new Anthropic model must never be blocked), but it will price as unknown until the table is updated`,
    };
  }
  const unavailable = catalog.source === 'static' || !catalog.entries.some((e) => e.provider === provider);
  if (unavailable) {
    return {
      ok: true,
      provider,
      model,
      warning: `the ${provider} catalog listing was unavailable when this was checked; accepted without existence verification`,
    };
  }
  const found = catalog.entries.some((e) => e.provider === provider && e.model === model);
  if (!found) {
    return {
      ok: false,
      message: `"${provider}/${model}" was not found in the ${provider} catalog listing — check models_list({provider:"${provider}"}) for the exact id string to copy`,
    };
  }
  return { ok: true, provider, model };
}
