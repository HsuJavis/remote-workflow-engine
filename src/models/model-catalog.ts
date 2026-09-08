// Unified, normalized, cross-provider model catalog (REQ-039 / REQ-040). Federates a small static
// table of well-known anthropic models with two LIVE sources — Ollama's local `/api/tags`
// and OpenRouter's remote `/api/v1/models` — and overlays the curated alias table. Every source is
// injectable (tests fake the fetch transport; no live network in the unit/integration tiers) and
// degrades gracefully: a source that throws/times out contributes nothing while the rest still
// return. NO API key or secret value ever appears in any entry (secret-separated by construction —
// this module reads no credentials at all).
import type { AliasMap } from '../gateway/client.js';
import type { FourRates } from '../types.js';

export interface ModelEntry {
  provider: string;
  model: string;
  /** Set when a curated alias points at this exact provider+model (or on an alias-only entry). */
  alias?: string;
  description: string;
  modalities: { in: string[]; out: string[] };
  contextWindow: number | null;
  price: { in: string; out: string } | 'free' | 'unknown';
  toolUse: boolean | 'unknown';
  location: 'local' | 'remote';
  /** issue #28: the agent-ready model string — pass it straight to `agent({model})`. Present only
   *  when the entry is directly usable: a curated `alias`, or an openrouter passthrough id
   *  (`openrouter/<model>`). ABSENT for entries that need a configured alias to resolve (non-aliased
   *  anthropic/ollama) — so its presence means "callable as-is", not just "listed". */
  ref?: string;
  /** issue #28: best-effort tier (OpenRouter `:free` variants). These queue / 429 / cold-start and can
   *  hang at 0 tokens — `toolUse:true` is a capability claim, NOT a liveness/reliability guarantee.
   *  Bound them with `agent({timeoutMs})` and null-harden. Absent = a normal (paid/local/static) tier. */
  besteffort?: boolean;
  /** v26 (DES-178, ARCH-116, TASK-178): the numeric USD-per-token rates `price` is now DERIVED
   *  from (`displayPrice`) — the source of truth for `maxPricePerMOf`/`ModelBook`'s pin. Optional
   *  (never required) so a literal `ModelEntry` fixture built before v26 still type-checks; absent
   *  is treated as `null` (unpriced) everywhere it's read, which is fail-SAFE, never fail-open. */
  ratesPerM?: FourRates | null;
  /** v26 (DES-179, ARCH-117, TASK-179): declared (never probed) reasoning capability, computed the
   *  SAME way `model-book.ts`'s `capsFromRow` computes `caps.reasoning` from a row (openrouter's own
   *  `supported_parameters`) — kept as a duplicate-by-precedent computation here (no import: this
   *  file is `model-book.ts`'s OWN dependency, so the reverse import would cycle) rather than a
   *  third opinion invented independently. Absent -> 'unknown' at enrichment (fail-safe). */
  effortDeclared?: boolean | 'unknown';
  /** v26 (DES-179, ARCH-117, TASK-179): where `effortDeclared` (and `toolUse`) came from — mirrors
   *  `capsFromRow`'s own source values ('upstream' — the row declared it; 'static' — the built-in
   *  anthropic/ollama fallback; 'unknown' — no declaration at all). Absent -> 'unknown'. */
  declaredSource?: 'upstream' | 'static' | 'unknown';
}

export interface CatalogFilter {
  provider?: string;
  query?: string;
  modalityIn?: string;
  modalityOut?: string;
  maxPricePerM?: number;
  minContext?: number;
  /** v26 (DES-179, ARCH-117, TASK-179): renamed from `toolUse` — no alias window (the standing v24
   *  ruling) — matching the renamed `EnrichedModelEntry.toolUseDeclared` output field it filters. */
  toolUseDeclared?: boolean;
  location?: 'local' | 'remote';
  limit?: number;
}

export interface BuildCatalogOptions {
  /** The curated alias table overlaid onto (or added to) the federated entries. */
  aliases?: AliasMap;
  /** Injectable transports (tests) — default the global fetch. A source with no reachable transport
   *  (throws/times out/non-ok) simply contributes no entries. */
  ollamaFetch?: typeof fetch;
  openrouterFetch?: typeof fetch;
  /** Ollama base (default OLLAMA_BASE_URL env, else http://127.0.0.1:11434). */
  ollamaBaseUrl?: string;
  /** Per-source fetch budget; a slow source times out and degrades rather than blocking the catalog. */
  timeoutMs?: number;
  /** Include the static anthropic table (default true). */
  includeStatic?: boolean;
}

const DEFAULT_LIMIT = 100;
const HARD_CAP = 500;
const DEFAULT_TIMEOUT_MS = 8000;

/** v26 (DES-178, ARCH-116, TASK-178): an all-zero, KNOWN rate (never `null`) — ollama's fixed rate
 *  and a genuinely free openrouter route both mean "this costs $0", which is a fact, not an absence
 *  of one. Reused by `ModelBook`'s ollama special-case (`model-book.ts`) so the two never drift. */
export const ZERO_RATES: FourRates = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };

/** v26 (DES-178, ARCH-116, TASK-178): numeric per-token rates for the static anthropic table —
 *  the ONE source of truth `STATIC_ANTHROPIC`'s display price is derived from AND `ModelBook`'s
 *  own last-resort fallback (`model-book.ts`) reads directly, so the two can never disagree.
 *  No published per-TTL cache-tier breakdown exists for these models yet, so cache read/write are
 *  priced at the `in` rate — the same "missing cache rate → prompt rate, an upper bound" convention
 *  `ratesFromOpenRouterPricing` uses below. Reviewed 2026-09-08 against the claude-api skill.
 *  Prices displayed as "$5/1M" etc. below are exactly `rates × 1e6`, checked by `displayPrice`. */
export const STATIC_ANTHROPIC_RATES: Record<string, FourRates> = {
  'claude-opus-4-8': { in: 0.000005, out: 0.000025, cacheRead: 0.000005, cacheWrite: 0.000005 },
  'claude-sonnet-5': { in: 0.000003, out: 0.000015, cacheRead: 0.000003, cacheWrite: 0.000003 },
  'claude-haiku-4-5-20251001': { in: 0.000001, out: 0.000005, cacheRead: 0.000001, cacheWrite: 0.000001 },
};

/** Static table of the well-known current Anthropic models (REQ-039). Values I'm confident about
 *  are filled; anything uncertain is 'unknown' rather than guessed. Prices/context are current
 *  (claude-api skill, 2026-06 cache). v26 (DES-173, TASK-174): the sibling `STATIC_OPENAI` table is
 *  RETIRED with the `openai` provider (REQ-123) — anthropic is the only static table now. */
// v26 (DES-179, ARCH-117, TASK-179): `effortDeclared:'unknown', declaredSource:'static'` on every
// static-table row mirrors `model-book.ts`'s own `capsFromRow` exactly for a bare anthropic row (no
// `supported_parameters` — the static table never sets it) — the SAME fact, computed the same way.
const STATIC_ANTHROPIC: ModelEntry[] = [
  { provider: 'anthropic', model: 'claude-opus-4-8', description: 'Claude Opus 4.8 — most capable Opus-tier model', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 1_000_000, price: { in: '$5/1M', out: '$25/1M' }, toolUse: true, location: 'remote', ratesPerM: STATIC_ANTHROPIC_RATES['claude-opus-4-8'], effortDeclared: 'unknown', declaredSource: 'static' },
  { provider: 'anthropic', model: 'claude-sonnet-5', description: 'Claude Sonnet 5 — balanced speed/intelligence', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 1_000_000, price: { in: '$3/1M', out: '$15/1M' }, toolUse: true, location: 'remote', ratesPerM: STATIC_ANTHROPIC_RATES['claude-sonnet-5'], effortDeclared: 'unknown', declaredSource: 'static' },
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', description: 'Claude Haiku 4.5 — fastest, most cost-effective', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 200_000, price: { in: '$1/1M', out: '$5/1M' }, toolUse: true, location: 'remote', ratesPerM: STATIC_ANTHROPIC_RATES['claude-haiku-4-5-20251001'], effortDeclared: 'unknown', declaredSource: 'static' },
];

/** Wraps a fetch in a bounded-timeout race (D-G discipline: a source never hangs the whole build). */
async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** v26 (DES-178, ARCH-116, TASK-178): OpenRouter prices are per-TOKEN strings/numbers
 *  (e.g. "0.0000007"); parse straight to `FourRates`. A missing cache rate prices at the `prompt`
 *  (`in`) rate — an upper bound, conservative for a spend limit, never invented. A parse failure on
 *  `prompt`/`completion` (malformed/absent) yields `null`, never `0` — "we don't know" must never
 *  collapse into "this is free". This is the ONLY parser for raw OpenRouter pricing rows — reused
 *  by `ModelBook` (`model-book.ts`) so a live-fetch row and a `ModelBook` unit-test row price
 *  identically. */
export function ratesFromOpenRouterPricing(
  pricing: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown; input_cache_write?: unknown } | undefined,
): FourRates | null {
  if (!pricing) return null;
  const inRate = Number(pricing.prompt);
  const outRate = Number(pricing.completion);
  if (!Number.isFinite(inRate) || !Number.isFinite(outRate)) return null;
  const cacheReadRaw = Number(pricing.input_cache_read);
  const cacheWriteRaw = Number(pricing.input_cache_write);
  const cacheRead = pricing.input_cache_read !== undefined && Number.isFinite(cacheReadRaw) ? cacheReadRaw : inRate;
  const cacheWrite = pricing.input_cache_write !== undefined && Number.isFinite(cacheWriteRaw) ? cacheWriteRaw : inRate;
  return { in: inRate, out: outRate, cacheRead, cacheWrite };
}

/** v26 (DES-178, ARCH-116, TASK-178): the "$5/1M" display shape is now DERIVED from the numeric
 *  rates (human-facing only) — replaces the old `formatOpenRouterPrice`, which parsed raw pricing
 *  directly and was the second writer of this exact string. Byte-identical output to the retired
 *  function: same `perM` formatter (`toFixed(4)` then re-`Number()`, which strips trailing zeros). */
export function displayPrice(rates: FourRates | null): ModelEntry['price'] {
  if (rates === null) return 'unknown';
  if (rates.in === 0 && rates.out === 0) return 'free';
  const perM = (n: number): string => `$${Number((n * 1_000_000).toFixed(4))}/1M`;
  return { in: perM(rates.in), out: perM(rates.out) };
}

async function fetchOllama(fetchImpl: typeof fetch, baseUrl: string, timeoutMs: number): Promise<ModelEntry[]> {
  const res = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/tags`, timeoutMs);
  if (!res.ok) return [];
  const data = (await res.json()) as { models?: Array<{ name?: string; details?: { family?: string; parameter_size?: string } }> };
  const models = Array.isArray(data?.models) ? data.models : [];
  const out: ModelEntry[] = [];
  for (const m of models) {
    if (typeof m?.name !== 'string') continue;
    const desc = [m.details?.family, m.details?.parameter_size].filter(Boolean).join(' ') || m.name;
    // v26 (DES-179, ARCH-117, TASK-179): mirrors `ModelBook.lookup`'s own unconditional ollama
    // override (`model-book.ts`) — `declaredSource:'static'` for the SAME reason: a known, fixed
    // fact about this deployment's local provider, not a probe result.
    out.push({ provider: 'ollama', model: m.name, description: desc, modalities: { in: ['text'], out: ['text'] }, contextWindow: null, price: 'free', toolUse: 'unknown', location: 'local', ratesPerM: ZERO_RATES, effortDeclared: 'unknown', declaredSource: 'static' });
  }
  return out;
}

async function fetchOpenRouter(fetchImpl: typeof fetch, timeoutMs: number): Promise<ModelEntry[]> {
  const res = await fetchWithTimeout(fetchImpl, 'https://openrouter.ai/api/v1/models', timeoutMs);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    data?: Array<{
      id?: string; name?: string; description?: string; context_length?: number;
      pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown; input_cache_write?: unknown };
      architecture?: { input_modalities?: string[]; output_modalities?: string[] };
      supported_parameters?: string[];
    }>;
  };
  const models = Array.isArray(data?.data) ? data.data : [];
  const out: ModelEntry[] = [];
  for (const m of models) {
    if (typeof m?.id !== 'string') continue;
    const supported = Array.isArray(m.supported_parameters) ? m.supported_parameters : undefined;
    const ratesPerM = ratesFromOpenRouterPricing(m.pricing);
    out.push({
      provider: 'openrouter',
      model: m.id,
      description: m.description ?? m.name ?? m.id,
      modalities: {
        in: Array.isArray(m.architecture?.input_modalities) ? m.architecture!.input_modalities! : ['text'],
        out: Array.isArray(m.architecture?.output_modalities) ? m.architecture!.output_modalities! : ['text'],
      },
      contextWindow: typeof m.context_length === 'number' ? m.context_length : null,
      price: displayPrice(ratesPerM),
      toolUse: supported ? supported.includes('tools') : 'unknown',
      location: 'remote',
      ratesPerM,
      // v26 (DES-179, ARCH-117, TASK-179): mirrors `model-book.ts`'s `capsFromRow` exactly — a row
      // with `supported_parameters` declares BOTH capabilities from the SAME array ('upstream'); no
      // second interpretation of the one signal `toolUse` above already reads.
      effortDeclared: supported ? supported.includes('reasoning') : 'unknown',
      declaredSource: supported ? 'upstream' : 'unknown',
    });
  }
  return out;
}

/** Overlays the curated alias table: sets `alias` on the first entry matching provider+model, or
 *  adds an alias-only entry when the aliased model isn't otherwise in the catalog. */
function overlayAliases(entries: ModelEntry[], aliases: AliasMap): ModelEntry[] {
  const out = entries.map((e) => ({ ...e }));
  for (const [alias, target] of Object.entries(aliases)) {
    const match = out.find((e) => e.provider === target.provider && e.model === target.model && e.alias === undefined);
    if (match) {
      match.alias = alias;
    } else {
      out.push({
        provider: target.provider,
        model: target.model,
        alias,
        description: `Curated alias '${alias}' -> ${target.provider}/${target.model}`,
        modalities: { in: ['text'], out: ['text'] },
        contextWindow: null,
        price: 'unknown',
        toolUse: 'unknown',
        location: target.provider === 'ollama' ? 'local' : 'remote',
        ratesPerM: null,
      });
    }
  }
  return out;
}

/** Builds the federated catalog. Each live source is guarded independently — a throw/timeout/non-ok
 *  from Ollama or OpenRouter degrades to zero entries for that source while the static table and the
 *  curated aliases still return. NEVER includes any secret (this module reads no credentials). */
export async function buildCatalog(opts: BuildCatalogOptions = {}): Promise<ModelEntry[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ollamaBaseUrl = opts.ollamaBaseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
  const ollamaFetch = opts.ollamaFetch ?? fetch;
  const openrouterFetch = opts.openrouterFetch ?? fetch;

  let entries: ModelEntry[] = [];
  if (opts.includeStatic ?? true) {
    entries.push(...STATIC_ANTHROPIC);
  }

  const [ollama, openrouter] = await Promise.all([
    fetchOllama(ollamaFetch, ollamaBaseUrl, timeoutMs).catch(() => []),
    fetchOpenRouter(openrouterFetch, timeoutMs).catch(() => []),
  ]);
  entries.push(...ollama, ...openrouter);

  if (opts.aliases) entries = overlayAliases(entries, opts.aliases);
  return annotate(entries);
}

/** issue #28: derive the two actionability fields AFTER alias overlay (so `alias` is known):
 *  - `ref` (agent-ready id): the alias if any; else an openrouter passthrough id; else omitted (the
 *    entry needs a configured alias to resolve — advertising `anthropic/<model>` would not work).
 *  - `besteffort`: OpenRouter's own `:free` variant marker — an exact suffix check, not a price
 *    inference (a $0-formatted paid route must not be misflagged). */
function annotate(entries: ModelEntry[]): ModelEntry[] {
  return entries.map((e) => {
    const ref = e.alias ?? (e.provider === 'openrouter' ? `openrouter/${e.model}` : undefined);
    const besteffort = e.model.endsWith(':free') ? true : undefined;
    return { ...e, ...(ref !== undefined ? { ref } : {}), ...(besteffort !== undefined ? { besteffort } : {}) };
  });
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// v12 (REQ-078): enriched models_list — capability / stability / costLevel (DES-075)
// ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Stability tier for a model entry. Extension point: to add a level, add the literal here,
 *  update `classifyStability`, and extend the drift-lock (DES-075). */
export type Stability = 'stable' | 'variable' | 'best-effort';

/** A ModelEntry enriched with the three additive capability/cost fields (DES-075), plus v26's
 *  declared-not-probed capability fields (DES-179, ARCH-117, TASK-179). `toolUse` is RENAMED to
 *  `toolUseDeclared` on this OUTPUT shape — no alias window (the standing v24 ruling) — so
 *  `Omit<ModelEntry, 'toolUse' | 'effortDeclared' | 'declaredSource'>`: the base's raw `toolUse` and
 *  the (optional, absence-prone) raw `effortDeclared`/`declaredSource` never leak through under two
 *  names at once. All fields are computed at call time from the base entry; never persisted. */
export interface EnrichedModelEntry extends Omit<ModelEntry, 'toolUse' | 'effortDeclared' | 'declaredSource'> {
  /** Short capability description (max 200 chars, truncated with '…' if longer; never null). */
  capability: string;
  /** Reliability/SLA tier: stable = paid/curated; variable = local Ollama; best-effort = free-tier. */
  stability: Stability;
  /** Cost tier 0–10 (integer|null). 0 = free/local; 10 = top-dearest (clamped). null = unknown price,
   *  do NOT infer cheapness. Scale: 0=free/local … 10=dearest. */
  costLevel: number | null;
  /** v26 (DES-179): renamed from `toolUse` — declared, never probed. */
  toolUseDeclared: boolean | 'unknown';
  /** v26 (DES-179): declared reasoning/effort capability — 'unknown' when the catalog said nothing. */
  effortDeclared: boolean | 'unknown';
  /** v26 (DES-179): where the two declared fields above came from. */
  declaredSource: 'upstream' | 'static' | 'unknown';
  /** v26 (DES-179): per-ROW catalog provenance ("as of" this model's own declaration), not a
   *  top-level wrapper (`models_list` returns a bare array — a wrapper would be a breaking MCP
   *  shape change to save ~24 bytes/row, DES-179's own boundary). `null` when the caller has no
   *  catalog snapshot timestamp to attach (e.g. a direct `enrichModelEntry` call in a unit test). */
  catalogFetchedAt: string | null;
}

/** Ascending price bands ($/1M) for mapping a scalar price to an integer cost level 0–10.
 *  Monotonicity holds by construction: each band boundary is strictly increasing.
 *  Last reviewed: 2026-08-14. Unlisted models fall back to their band by scalar price. */
const COST_LEVEL_BANDS: number[] = [
  0,      // level 0: free
  0.1,    // level 1: very cheap  (<$0.1/1M)
  0.5,    // level 2             (<$0.5/1M)
  1.5,    // level 3             (<$1.5/1M)
  3.0,    // level 4             (<$3/1M)
  5.0,    // level 5             (<$5/1M)
  10.0,   // level 6             (<$10/1M)
  20.0,   // level 7             (<$20/1M)
  40.0,   // level 8             (<$40/1M)
  80.0,   // level 9             (<$80/1M)
          // level 10: everything above (clamped)
];

/** v26 (DES-178, ARCH-116, TASK-178): the representative numeric price-per-million for a filter
 *  comparison — reads `FourRates` (the numeric source of truth) directly, never the derived "$X/1M"
 *  display string; ignores the two cache rates by design (stated in DES-178's own boundary: cache
 *  pricing is not part of this scalar). `null` rates (unknown/unpriced) -> `null`; an all-zero
 *  object (ollama, a genuinely free route) -> `0`, never `null` — those are DIFFERENT facts. */
export function maxPricePerMOf(rates: FourRates | null): number | null {
  if (rates === null) return null;
  return Math.max(rates.in, rates.out) * 1_000_000;
}

/** Classify the reliability/SLA tier of a model entry (DES-075).
 *  Order: besteffort/free-tier first → local Ollama → else stable. */
export function classifyStability(e: ModelEntry): Stability {
  if (e.besteffort === true || e.model.endsWith(':free')) return 'best-effort';
  if (e.location === 'local') return 'variable';
  return 'stable';
}

/** Compute the 0–10 integer cost tier for a model entry (DES-075).
 *  'free'/all-zero rates → 0; unpriced (`ratesPerM` null/absent) → null (never guessed); above the
 *  top band → clamp 10. Uses COST_LEVEL_BANDS with maxPricePerMOf as the single comparable scalar
 *  (ARCH-050 D-v12-C) — v26 (DES-178): reads `e.ratesPerM`, not the derived display string. */
export function computeCostLevel(e: ModelEntry): number | null {
  const price = maxPricePerMOf(e.ratesPerM ?? null);
  if (price === null) return null;
  if (price === 0) return 0;
  // Find the first band boundary the scalar exceeds
  for (let i = 1; i < COST_LEVEL_BANDS.length; i++) {
    if (price < COST_LEVEL_BANDS[i]!) return i;
  }
  return 10; // clamped
}

/** Enrich a ModelEntry with capability/stability/costLevel (DES-075, ARCH-050).
 *  Pure — no I/O, no side effects. Called after filterCatalog (insertion point DES-075). */
export function enrichModelEntry(e: ModelEntry): EnrichedModelEntry {
  // capability: truncate at 200 chars (199 + '…'); empty/null → fallback "${provider} model"
  let capability = e.description?.trim() ?? '';
  if (!capability) capability = `${e.provider} model`;
  if (capability.length > 200) capability = capability.slice(0, 199) + '…';

  // v26 (DES-179): `toolUse`/`effortDeclared`/`declaredSource` are dropped from the base spread and
  // re-emitted under their v26 names below — no alias window, `toolUse` never reaches the output.
  const { toolUse, effortDeclared, declaredSource, ...rest } = e;
  return {
    ...rest,
    capability,
    stability: classifyStability(e),
    costLevel: computeCostLevel(e),
    toolUseDeclared: toolUse,
    effortDeclared: effortDeclared ?? 'unknown',
    declaredSource: declaredSource ?? 'unknown',
    // v26 (DES-179's own boundary): per-row, never a top-level wrapper — `null` here (no catalog
    // snapshot threaded to this call) is the honest "we never looked" until a caller with a
    // `ModelBook`/`BookSnapshot.fetchedAt` in hand is wired (no v26 task wires that call site).
    catalogFetchedAt: null,
  };
}

/** AND-filters the catalog and caps by limit (default 100, hard cap 500). An empty match returns []
 *  (never an error). */
export function filterCatalog(entries: ModelEntry[], filter: CatalogFilter = {}): ModelEntry[] {
  const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_LIMIT), HARD_CAP);
  const matched = entries.filter((e) => {
    if (filter.provider !== undefined && e.provider !== filter.provider) return false;
    if (filter.location !== undefined && e.location !== filter.location) return false;
    if (filter.toolUseDeclared !== undefined && e.toolUse !== filter.toolUseDeclared) return false;
    if (filter.modalityIn !== undefined && !e.modalities.in.includes(filter.modalityIn)) return false;
    if (filter.modalityOut !== undefined && !e.modalities.out.includes(filter.modalityOut)) return false;
    if (filter.minContext !== undefined && (e.contextWindow === null || e.contextWindow < filter.minContext)) return false;
    if (filter.maxPricePerM !== undefined) {
      const p = maxPricePerMOf(e.ratesPerM ?? null);
      if (p === null || p > filter.maxPricePerM) return false;
    }
    if (filter.query !== undefined && filter.query !== '') {
      const q = filter.query.toLowerCase();
      const hay = `${e.model} ${e.description} ${e.alias ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return matched.slice(0, limit);
}
