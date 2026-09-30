// Unified, normalized, cross-provider model catalog (REQ-039 / REQ-040). Federates a small static
// table of well-known anthropic models with two LIVE sources — Ollama's local `/api/tags`
// and OpenRouter's remote `/api/v1/models`. Every source is injectable (tests fake the fetch
// transport; no live network in the unit/integration tiers) and degrades gracefully: a source that
// throws/times out contributes nothing while the rest still return. NO API key or secret value ever
// appears in any entry (secret-separated by construction — this module reads no credentials at all).
//
// 2026-09-26 (alias mechanism removed): there is no curated alias table to overlay any more — every
// row's `ref` is simply `${provider}/${model}`, the full ref an author pastes into
// `model.default`/a run_start override verbatim.
import type { FourRates } from '../types.js';
import type { ProbeResult } from './model-probe.js';
// Issue #104: `effortAppliedOnTransport` reads the ONE effort-delivery table (`PROVIDER_CAPS.
// effortDelivered`, VAL-186's wire-verified fact). providers.ts imports this module back (for
// STATIC_ANTHROPIC_RATES) — both uses are inside functions, never at module evaluation, so the
// cycle is inert.
import { PROVIDER_CAPS, isProvider } from '../providers.js';
import type { ObservedForRef } from './observed-stats.js';

/** What a row's `observed` says when nothing was measured (or no ObservedStats is wired). */
export const OBSERVED_NONE: ObservedForRef = { window: '30d', source: 'none', prose: null, tools: null };

/** Issue #104: what KIND of model a row is — an embedding model listed as text->text chat was the
 *  reported failure. */
export type ModelType = 'chat' | 'embedding' | 'rerank' | 'image-gen' | 'tts' | 'stt' | 'moderation' | 'unknown';
/** Where `modelType` came from: the provider's own declaration, the static anthropic table, or —
 *  last resort, only when the provider said nothing — a model-id heuristic. */
export type ModelTypeSource = 'ollama-capabilities' | 'openrouter-modalities' | 'static' | 'id-heuristic' | 'unknown';

/** Issue #104: declared capabilities (never probed — see toolUseVerified for that). `null` = the
 *  source said nothing. `toolUse` is added at enrichment from the row's own `toolUse`. */
export interface DeclaredCapabilities {
  toolChoice: boolean | null;
  structuredOutput: boolean | null;
  promptCaching: boolean | null;
  vision: boolean | null;
  reasoning: { supported: boolean | null; efforts: string[] | null; defaultEffort: string | null; mandatory: boolean | null };
}
export interface Capabilities extends DeclaredCapabilities { toolUse: boolean | null }

/** Issue #104: the price components beyond in/out. Token-denominated keys (reasoning, cacheRead,
 *  cacheWrite, cacheWrite1h) are USD per 1M tokens; `request`, `image`, `webSearch` are USD per unit
 *  exactly as OpenRouter publishes them (unscaled). Only keys the source actually gives appear. */
export interface PricingDetail { reasoning?: number; request?: number; image?: number; webSearch?: number; cacheRead?: number; cacheWrite?: number; cacheWrite1h?: number }
export interface LocalDetails { family: string | null; parameterSize: string | null; quantization: string | null }
export interface Lifecycle { releasedAt: string | null; knowledgeCutoff: string | null; expiresAt: string | null }
export interface DesignArenaScore { arena: string; category: string; elo: number | null; winRate: number | null; rank: number | null }
export interface ArtificialAnalysisScores { intelligence: number | null; coding: number | null; agentic: number | null }
/** The catalog-side benchmark data (no provenance yet — `enrichModelEntry` adds source/fetchedAt). */
export interface BenchmarkData { borrowedFrom?: string; artificialAnalysis: ArtificialAnalysisScores | null; designArena: DesignArenaScore[] }
export const BENCHMARK_SOURCE = 'openrouter:artificial_analysis+design_arena' as const;
export interface Benchmarks extends BenchmarkData { source: typeof BENCHMARK_SOURCE; fetchedAt: string | null }
export interface ProbeFailureReason {
  leg: 'prose' | 'tools';
  kind: 'timeout' | 'unreachable' | 'error' | 'empty-reply' | 'no-tool-use' | 'wrong-answer';
  hint: string;
}

export interface ModelEntry {
  provider: string;
  model: string;
  description: string;
  modalities: { in: string[]; out: string[] };
  contextWindow: number | null;
  price: { in: string; out: string } | 'free' | 'unknown';
  toolUse: boolean | 'unknown';
  location: 'local' | 'remote';
  /** issue #28 (2026-09-26: no aliases any more — every row is directly usable). The agent-ready
   *  model string — pass it straight to `agent({model})`/`model.default`/a run_start override
   *  verbatim: always `${provider}/${model}`, the exact string this row's own two fields spell. */
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
  /** v26 integration (DES-178/DES-179, ARCH-116/117, REQ-126, clarification 14): OpenRouter's OWN
   *  `supported_parameters` array, carried through UNINTERPRETED. `ModelBook` is constructed over
   *  this very type (`server.ts:725`, `source: () => Promise<ModelEntry[]>` structurally satisfying
   *  `CatalogSourceRow[]`) and its `capsFromRow` reads exactly this field to decide
   *  `caps.reasoning`/`caps.tools`. Without it every real OpenRouter pin came back
   *  `caps.reasoning:'unknown'`, and since `wireEffort` reads capability off the pin (INV-V26-4),
   *  effort was never applied to any OpenRouter model in a real deployment — REQ-126 inert, with
   *  every unit test green because the tests feed `ModelBook` raw rows that DO carry the field.
   *  Dropped again at `enrichModelEntry` (below): `toolUseDeclared`/`effortDeclared` are the named
   *  projection of this same signal, and the output surface must not carry it twice. */
  supported_parameters?: string[];
  /** Issue #104 selection data — all optional on the SOURCE row (a hand-built fixture, a raw
   *  ModelBook feed) and normalised to always-present values by `enrichModelEntry`. */
  modelType?: ModelType;
  modelTypeSource?: ModelTypeSource;
  maxOutputTokens?: number | null;
  capabilities?: DeclaredCapabilities;
  pricingDetail?: PricingDetail | null;
  local?: LocalDetails | null;
  lifecycle?: Lifecycle;
  benchmarks?: BenchmarkData | null;
  /** Refs of the same underlying model on OTHER providers (anthropic <-> openrouter/anthropic/…). */
  sameModelAs?: string[];
  /** The openrouter ref this row borrowed benchmarks/knowledgeCutoff/releasedAt/reasoning/
   *  maxOutputTokens from (anthropic-direct rows only), or null. */
  borrowedFrom?: string | null;
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
 *  Prices displayed as "$5/1M" etc. below are exactly `rates × 1e6`, checked by `displayPrice`.
 *
 *  v26 Gate 7.5 round 1 (defects D3 + D4), re-derived against the claude-api skill's cached model
 *  table (2026-06-24) — the same source VAL-187 cross-checked the haiku figure against:
 *  - D3: `claude-sonnet-5` was carried at $3/$15. That is SONNET 4.6's price; Sonnet 5 is $2/$10.
 *    Opus 4.8 ($5/$25) and Haiku 4.5 ($1/$5) were already right and are unchanged.
 *  - D4: both cache columns were priced at the `in` rate, justified by "no published per-TTL
 *    cache-tier breakdown exists for these models yet". That is no longer true. The published
 *    multipliers are ~0.1x input for a cache READ and 1.25x (5m TTL) / 2x (1h TTL) for a cache
 *    WRITE, so the old flat rate over-charged a read ~10x and under-charged a write.
 *    WHICH WRITE MULTIPLIER: 2x, the 1h TTL. LiteLLM's usage reports ONE
 *    `cache_creation_input_tokens` figure with no TTL split, so the engine cannot tell the two
 *    apart and must pick one; 2x is the upper bound of the two, which is the same "conservative for
 *    a spend limit, never invented" convention `ratesFromOpenRouterPricing` below already applies —
 *    a budget that stops slightly early is safe, one that stops late is not. It is also the TTL
 *    VAL-187 actually observed on the wire: the CLI's own `total_cost_usd` cross-check
 *    (`cache_creation 7940` tokens) reconciled at 2x input, not 1.25x. */
export const STATIC_ANTHROPIC_RATES: Record<string, FourRates> = {
  // v26 Gate 7.5 round 4 (defect D12, REQ-127): `claude-fable-5` had NO row here while this
  // deployment's alias table names it twice (`fable`, `claude-fable-5`), so every run through that
  // alias recorded `unpriced:true` and `budgetEnforceable.usd:false` — the owner's Q5 COST budget
  // rests on the catalogue carrying the price, so a missing row makes REQ-127 inert for that model.
  // $10/1M in, $50/1M out from the SAME source the rows below use (the claude-api skill's cached
  // model table, 2026-06-24); the cache columns follow this table's own multipliers (0.1x input for
  // a READ, 2x for a WRITE at the 1h TTL) — no new rule, and the 0.25$/MTok cache read published
  // for Claude Fable 5.1 is a DIFFERENT model and is deliberately not applied here.
  'claude-fable-5': { in: 0.00001, out: 0.00005, cacheRead: 0.000001, cacheWrite: 0.00002 },
  'claude-opus-4-8': { in: 0.000005, out: 0.000025, cacheRead: 0.0000005, cacheWrite: 0.00001 },
  'claude-sonnet-5': { in: 0.000002, out: 0.00001, cacheRead: 0.0000002, cacheWrite: 0.000004 },
  'claude-haiku-4-5-20251001': { in: 0.000001, out: 0.000005, cacheRead: 0.0000001, cacheWrite: 0.000002 },
};

/** Static table of the well-known current Anthropic models (REQ-039). Values I'm confident about
 *  are filled; anything uncertain is 'unknown' rather than guessed. Prices/context are current
 *  (claude-api skill, 2026-06 cache). v26 (DES-173, TASK-174): the sibling `STATIC_OPENAI` table is
 *  RETIRED with the `openai` provider (REQ-123) — anthropic is the only static table now. */
// v26 (DES-179, ARCH-117, TASK-179): `effortDeclared:'unknown', declaredSource:'static'` on every
// static-table row mirrors `model-book.ts`'s own `capsFromRow` exactly for a bare anthropic row (no
// `supported_parameters` — the static table never sets it) — the SAME fact, computed the same way.
const STATIC_ANTHROPIC_BASE: ModelEntry[] = [
  { provider: 'anthropic', model: 'claude-fable-5', description: 'Claude Fable 5 — most capable, long-horizon agentic tier', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 1_000_000, price: { in: '$10/1M', out: '$50/1M' }, toolUse: true, location: 'remote', ratesPerM: STATIC_ANTHROPIC_RATES['claude-fable-5'], effortDeclared: 'unknown', declaredSource: 'static' },
  { provider: 'anthropic', model: 'claude-opus-4-8', description: 'Claude Opus 4.8 — most capable Opus-tier model', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 1_000_000, price: { in: '$5/1M', out: '$25/1M' }, toolUse: true, location: 'remote', ratesPerM: STATIC_ANTHROPIC_RATES['claude-opus-4-8'], effortDeclared: 'unknown', declaredSource: 'static' },
  { provider: 'anthropic', model: 'claude-sonnet-5', description: 'Claude Sonnet 5 — balanced speed/intelligence', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 1_000_000, price: { in: '$2/1M', out: '$10/1M' }, toolUse: true, location: 'remote', ratesPerM: STATIC_ANTHROPIC_RATES['claude-sonnet-5'], effortDeclared: 'unknown', declaredSource: 'static' },
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', description: 'Claude Haiku 4.5 — fastest, most cost-effective', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 200_000, price: { in: '$1/1M', out: '$5/1M' }, toolUse: true, location: 'remote', ratesPerM: STATIC_ANTHROPIC_RATES['claude-haiku-4-5-20251001'], effortDeclared: 'unknown', declaredSource: 'static' },
];

/** Issue #104: what the static anthropic table knows for certain about every row — a chat model
 *  with tool use, tool_choice, vision and prompt caching (the table prices cache reads/writes).
 *  Structured output, reasoning levels, max output, benchmarks and dates are NOT asserted here —
 *  they stay null unless `annotate` borrows them from the matching OpenRouter listing. */
const perMillion = (n: number): number => Number((n * 1_000_000).toFixed(6));
const STATIC_ANTHROPIC: ModelEntry[] = STATIC_ANTHROPIC_BASE.map((e) => ({
  ...e,
  modelType: 'chat',
  modelTypeSource: 'static',
  maxOutputTokens: null,
  capabilities: { toolChoice: true, structuredOutput: null, promptCaching: true, vision: true, reasoning: { supported: null, efforts: null, defaultEffort: null, mandatory: null } },
  pricingDetail: e.ratesPerM ? { cacheRead: perMillion(e.ratesPerM.cacheRead), cacheWrite: perMillion(e.ratesPerM.cacheWrite) } : null,
  local: null,
  lifecycle: { releasedAt: null, knowledgeCutoff: null, expiresAt: null },
  benchmarks: null,
}));

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

/** Issue #104: last-resort model-type guess from the id, used ONLY when the provider declared
 *  nothing (marked `modelTypeSource:'id-heuristic'`). `null` = no confident guess. */
function modelTypeFromId(id: string): ModelType | null {
  const s = id.toLowerCase();
  if (/rerank/.test(s)) return 'rerank';
  if (/embed|(^|[/:-])bge-|(^|[/:-])e5-|minilm/.test(s)) return 'embedding';
  if (/moderation/.test(s)) return 'moderation';
  if (/whisper|transcri/.test(s)) return 'stt';
  if (/(^|[/:-])tts/.test(s)) return 'tts';
  return null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const NO_REASONING: DeclaredCapabilities['reasoning'] = { supported: null, efforts: null, defaultEffort: null, mandatory: null };

interface OllamaTagRow { name?: string; capabilities?: unknown; details?: { family?: string; parameter_size?: string; quantization_level?: string; context_length?: number } }
interface OllamaShow { capabilities?: unknown; details?: { family?: string; parameter_size?: string; quantization_level?: string }; model_info?: Record<string, unknown> }

/** Issue #104: `POST /api/show {model}` — capabilities, details and `<arch>.context_length`. Only
 *  called for a row whose `/api/tags` entry lacks them (newer Ollama puts both on /api/tags). Never
 *  throws: any failure (or a body without those keys) is just "no extra data". Runs inside the
 *  catalog build, so ModelBook's TTL/single-flight bounds it like every other catalog fetch. */
async function fetchOllamaShow(fetchImpl: typeof fetch, baseUrl: string, name: string, timeoutMs: number): Promise<OllamaShow | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/api/show`, { method: 'POST', body: JSON.stringify({ model: name }), headers: { 'Content-Type': 'application/json' }, signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as OllamaShow;
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOllama(fetchImpl: typeof fetch, baseUrl: string, timeoutMs: number): Promise<ModelEntry[]> {
  const res = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/tags`, timeoutMs);
  if (!res.ok) return [];
  const data = (await res.json()) as { models?: OllamaTagRow[] };
  const models = (Array.isArray(data?.models) ? data.models : []).filter((m): m is OllamaTagRow & { name: string } => typeof m?.name === 'string');
  return Promise.all(models.map(async (m): Promise<ModelEntry> => {
    const tagCaps = Array.isArray(m.capabilities) ? (m.capabilities as unknown[]).filter((c): c is string => typeof c === 'string') : null;
    const tagCtx = num(m.details?.context_length);
    const show = tagCaps === null || tagCtx === null ? await fetchOllamaShow(fetchImpl, baseUrl, m.name, timeoutMs) : null;
    const caps = tagCaps ?? (Array.isArray(show?.capabilities) ? (show!.capabilities as unknown[]).filter((c): c is string => typeof c === 'string') : null);
    const arch = str(show?.model_info?.['general.architecture']);
    const contextWindow = tagCtx ?? (arch ? num(show?.model_info?.[`${arch}.context_length`]) : null);
    const details = { ...(show?.details ?? {}), ...(m.details ?? {}) };
    const desc = [details.family, details.parameter_size].filter(Boolean).join(' ') || m.name;
    let modelType: ModelType = 'unknown';
    let modelTypeSource: ModelTypeSource = 'unknown';
    if (caps) {
      modelTypeSource = 'ollama-capabilities';
      modelType = caps.includes('embedding') ? 'embedding' : caps.includes('completion') ? 'chat' : 'unknown';
    } else {
      const guess = modelTypeFromId(m.name);
      if (guess) { modelType = guess; modelTypeSource = 'id-heuristic'; }
    }
    const vision = caps ? caps.includes('vision') : null;
    // v26 (DES-179): with no declaration, `declaredSource:'static'`/`toolUse:'unknown'` exactly as
    // before (mirrors `ModelBook.lookup`'s unconditional ollama override). Issue #104: when Ollama
    // itself declares capabilities, they are an upstream declaration like OpenRouter's.
    return {
      provider: 'ollama', model: m.name, description: desc,
      modalities: { in: vision ? ['text', 'image'] : ['text'], out: modelType === 'embedding' ? ['embedding'] : ['text'] },
      contextWindow, price: 'free', toolUse: caps ? caps.includes('tools') : 'unknown', location: 'local', ratesPerM: ZERO_RATES,
      effortDeclared: caps ? caps.includes('thinking') : 'unknown', declaredSource: caps ? 'upstream' : 'static',
      modelType, modelTypeSource, maxOutputTokens: null,
      capabilities: {
        toolChoice: null, structuredOutput: null, promptCaching: null, vision,
        reasoning: caps ? { ...NO_REASONING, supported: caps.includes('thinking') } : NO_REASONING,
      },
      pricingDetail: null,
      local: { family: str(details.family), parameterSize: str(details.parameter_size), quantization: str(details.quantization_level) },
      lifecycle: { releasedAt: null, knowledgeCutoff: null, expiresAt: null },
      benchmarks: null,
    };
  }));
}

interface OpenRouterRow {
  id?: string; name?: string; description?: string; context_length?: number; created?: number;
  pricing?: Record<string, unknown> & { prompt?: unknown; completion?: unknown; input_cache_read?: unknown; input_cache_write?: unknown };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  top_provider?: { max_completion_tokens?: unknown };
  supported_parameters?: string[];
  reasoning?: { mandatory?: unknown; supported_efforts?: unknown; default_effort?: unknown };
  knowledge_cutoff?: unknown; expiration_date?: unknown;
  benchmarks?: { artificial_analysis?: Record<string, unknown>; design_arena?: unknown };
}

/** Issue #104: OpenRouter's own output modalities decide the type — any text output is a chat
 *  model (image/audio-capable chat models stay chat; `modalities.out` says what else comes out). */
function openRouterModelType(m: OpenRouterRow): { modelType: ModelType; modelTypeSource: ModelTypeSource } {
  const out = m.architecture?.output_modalities;
  if (Array.isArray(out) && out.length > 0) {
    if (out.includes('text')) return { modelType: 'chat', modelTypeSource: 'openrouter-modalities' };
    if (out.includes('embeddings') || out.includes('embedding')) return { modelType: 'embedding', modelTypeSource: 'openrouter-modalities' };
    if (out.length === 1 && out[0] === 'image') return { modelType: 'image-gen', modelTypeSource: 'openrouter-modalities' };
    if (out.length === 1 && out[0] === 'audio') return { modelType: 'tts', modelTypeSource: 'openrouter-modalities' };
  }
  const guess = modelTypeFromId(m.id ?? '');
  return guess ? { modelType: guess, modelTypeSource: 'id-heuristic' } : { modelType: 'unknown', modelTypeSource: 'unknown' };
}

function openRouterPricingDetail(p: OpenRouterRow['pricing']): PricingDetail | null {
  if (!p) return null;
  const out: PricingDetail = {};
  const put = (key: keyof PricingDetail, raw: unknown, scale: boolean): void => {
    if (raw === undefined || raw === null || raw === '') return;
    const n = Number(raw);
    if (Number.isFinite(n)) out[key] = scale ? perMillion(n) : n;
  };
  put('reasoning', p['internal_reasoning'], true);
  put('request', p['request'], false);
  put('image', p['image'], false);
  put('webSearch', p['web_search'], false);
  put('cacheRead', p['input_cache_read'], true);
  put('cacheWrite', p['input_cache_write'], true);
  put('cacheWrite1h', p['input_cache_write_1h'], true);
  return out;
}

function openRouterBenchmarks(b: OpenRouterRow['benchmarks']): BenchmarkData | null {
  if (!b || typeof b !== 'object') return null;
  const aa = b.artificial_analysis && typeof b.artificial_analysis === 'object' ? b.artificial_analysis : null;
  const artificialAnalysis = aa ? { intelligence: num(aa['intelligence_index']), coding: num(aa['coding_index']), agentic: num(aa['agentic_index']) } : null;
  const designArena = (Array.isArray(b.design_arena) ? b.design_arena : [])
    .filter((d): d is Record<string, unknown> => d !== null && typeof d === 'object')
    .map((d) => ({ arena: String(d['arena'] ?? ''), category: String(d['category'] ?? ''), elo: num(d['elo']), winRate: num(d['win_rate']), rank: num(d['rank']) }));
  if (!artificialAnalysis && designArena.length === 0) return null;
  return { artificialAnalysis, designArena };
}

async function fetchOpenRouter(fetchImpl: typeof fetch, timeoutMs: number): Promise<ModelEntry[]> {
  const res = await fetchWithTimeout(fetchImpl, 'https://openrouter.ai/api/v1/models', timeoutMs);
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: OpenRouterRow[] };
  const models = Array.isArray(data?.data) ? data.data : [];
  const out: ModelEntry[] = [];
  for (const m of models) {
    if (typeof m?.id !== 'string') continue;
    const supported = Array.isArray(m.supported_parameters) ? m.supported_parameters : undefined;
    const ratesPerM = ratesFromOpenRouterPricing(m.pricing);
    const inMods = Array.isArray(m.architecture?.input_modalities) ? m.architecture!.input_modalities! : null;
    const r = m.reasoning && typeof m.reasoning === 'object' ? m.reasoning : null;
    out.push({
      provider: 'openrouter',
      model: m.id,
      description: m.description ?? m.name ?? m.id,
      modalities: {
        in: inMods ?? ['text'],
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
      // v26 integration (clarification 14): the raw array travels on too, so `ModelBook.capsFromRow`
      // sees the SAME declaration these two derived fields were computed from.
      ...(supported ? { supported_parameters: supported } : {}),
      // Issue #104: selection data, all straight from this same listing row.
      ...openRouterModelType(m),
      maxOutputTokens: num(m.top_provider?.max_completion_tokens),
      capabilities: {
        toolChoice: supported ? supported.includes('tool_choice') : null,
        structuredOutput: supported ? supported.includes('structured_outputs') || supported.includes('response_format') : null,
        promptCaching: m.pricing ? m.pricing.input_cache_read !== undefined || m.pricing.input_cache_write !== undefined : null,
        vision: inMods ? inMods.includes('image') : null,
        reasoning: {
          supported: supported ? supported.includes('reasoning') : null,
          efforts: r && Array.isArray(r.supported_efforts) ? (r.supported_efforts as unknown[]).filter((x): x is string => typeof x === 'string') : null,
          defaultEffort: r ? str(r.default_effort) : null,
          mandatory: r && typeof r.mandatory === 'boolean' ? r.mandatory : null,
        },
      },
      pricingDetail: openRouterPricingDetail(m.pricing),
      local: null,
      lifecycle: {
        releasedAt: typeof m.created === 'number' && Number.isFinite(m.created) ? new Date(m.created * 1000).toISOString() : null,
        knowledgeCutoff: str(m.knowledge_cutoff),
        expiresAt: str(m.expiration_date),
      },
      benchmarks: openRouterBenchmarks(m.benchmarks),
    });
  }
  return out;
}

/** Builds the federated catalog. Each live source is guarded independently — a throw/timeout/non-ok
 *  from Ollama or OpenRouter degrades to zero entries for that source while the static table still
 *  returns. NEVER includes any secret (this module reads no credentials). */
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

  return annotate(entries);
}

/** issue #28 (2026-09-26: no aliases any more) — derive the two actionability fields:
 *  - `ref` (agent-ready id): ALWAYS `${provider}/${model}` — every row is directly usable, no
 *    curated alias to resolve through.
 *  - `besteffort`: OpenRouter's own `:free` variant marker — an exact suffix check, not a price
 *    inference (a $0-formatted paid route must not be misflagged). */
function annotate(entries: ModelEntry[]): ModelEntry[] {
  const annotated = entries.map((e) => {
    const ref = `${e.provider}/${e.model}`;
    const besteffort = e.model.endsWith(':free') ? true : undefined;
    return { ...e, ref, ...(besteffort !== undefined ? { besteffort } : {}) };
  });
  return linkSameModels(annotated);
}

const CLAUDE_FAMILIES = new Set(['fable', 'opus', 'sonnet', 'haiku']);

/** Issue #104: the canonical identity of a Claude model across the two spellings this catalog sees
 *  — Anthropic's own ids (`claude-haiku-4-5-20251001`, `claude-sonnet-5`) and OpenRouter's
 *  (`anthropic/claude-haiku-4.5`, `…:batch`, canonical slugs like `anthropic/claude-4.5-haiku-
 *  20251001`). Rule: drop an `anthropic/` prefix and any `:variant` suffix, require `claude-`, drop a
 *  trailing `-YYYYMMDD` date, then the remaining `-`-separated tokens must be exactly one family
 *  word (fable|opus|sonnet|haiku) plus numeric version tokens, which are joined with '.'
 *  (`4-5` and `4.5` both -> `4.5`). Result `<family>-<version>` (e.g. `haiku-4.5`); `null` for
 *  anything else — a non-Claude id, or a token this rule does not understand (never a guess). */
export function anthropicCanonicalKey(id: string): string | null {
  let s = id.toLowerCase();
  if (s.startsWith('anthropic/')) s = s.slice('anthropic/'.length);
  const colon = s.indexOf(':');
  if (colon >= 0) s = s.slice(0, colon);
  if (!s.startsWith('claude-')) return null;
  s = s.slice('claude-'.length).replace(/-\d{8}$/, '');
  let family: string | null = null;
  const version: string[] = [];
  for (const tok of s.split('-')) {
    if (CLAUDE_FAMILIES.has(tok)) {
      if (family) return null;
      family = tok;
    } else if (/^\d+(\.\d+)*$/.test(tok)) {
      version.push(tok);
    } else {
      return null;
    }
  }
  if (!family || version.length === 0) return null;
  return `${family}-${version.join('.')}`;
}

/** Issue #104: cross-provider identity. Every anthropic-direct row whose canonical key matches an
 *  `openrouter/anthropic/…` row gets `sameModelAs` (all matching openrouter refs, `:batch` variants
 *  included) and BORROWS from the un-suffixed match (the `:batch` tier is never the lender):
 *  `benchmarks` (tagged `borrowedFrom`), `lifecycle.knowledgeCutoff`/`releasedAt`,
 *  `capabilities.reasoning`, and `maxOutputTokens` when its own is null. Price is never borrowed.
 *  The openrouter rows get the reverse `sameModelAs`. With OpenRouter down nothing is borrowed. */
function linkSameModels(entries: ModelEntry[]): ModelEntry[] {
  const orByKey = new Map<string, ModelEntry[]>();
  const directByKey = new Map<string, ModelEntry[]>();
  for (const e of entries) {
    if (e.provider === 'openrouter' && e.model.startsWith('anthropic/')) {
      const k = anthropicCanonicalKey(e.model);
      if (k) orByKey.set(k, [...(orByKey.get(k) ?? []), e]);
    } else if (e.provider === 'anthropic') {
      const k = anthropicCanonicalKey(e.model);
      if (k) directByKey.set(k, [...(directByKey.get(k) ?? []), e]);
    }
  }
  return entries.map((e) => {
    const k = e.provider === 'anthropic' || (e.provider === 'openrouter' && e.model.startsWith('anthropic/')) ? anthropicCanonicalKey(e.model) : null;
    if (!k) return e;
    if (e.provider === 'openrouter') {
      const peers = directByKey.get(k) ?? [];
      return peers.length ? { ...e, sameModelAs: peers.map((p) => p.ref!) } : e;
    }
    const peers = orByKey.get(k) ?? [];
    if (peers.length === 0) return e;
    const lender = peers.find((p) => !p.model.includes(':'));
    const linked: ModelEntry = { ...e, sameModelAs: peers.map((p) => p.ref!) };
    if (!lender) return linked;
    const caps = e.capabilities;
    return {
      ...linked,
      borrowedFrom: lender.ref!,
      benchmarks: lender.benchmarks ? { ...lender.benchmarks, borrowedFrom: lender.model } : (e.benchmarks ?? null),
      lifecycle: {
        releasedAt: e.lifecycle?.releasedAt ?? lender.lifecycle?.releasedAt ?? null,
        knowledgeCutoff: e.lifecycle?.knowledgeCutoff ?? lender.lifecycle?.knowledgeCutoff ?? null,
        expiresAt: e.lifecycle?.expiresAt ?? null,
      },
      maxOutputTokens: e.maxOutputTokens ?? lender.maxOutputTokens ?? null,
      ...(caps && lender.capabilities ? { capabilities: { ...caps, reasoning: lender.capabilities.reasoning } } : {}),
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// v12 (REQ-078): enriched models_list — capability / stability / costLevel (DES-075)
// ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Stability tier for a model entry. Extension point: to add a level, add the literal here,
 *  update `classifyStability`, and extend the drift-lock (DES-075). */
export type Stability = 'stable' | 'variable' | 'best-effort' | 'degraded' | 'unavailable';

/** A ModelEntry enriched with the three additive capability/cost fields (DES-075), plus v26's
 *  declared-not-probed capability fields (DES-179, ARCH-117, TASK-179). `toolUse` is RENAMED to
 *  `toolUseDeclared` on this OUTPUT shape — no alias window (the standing v24 ruling) — so
 *  `Omit<ModelEntry, 'toolUse' | 'effortDeclared' | 'declaredSource'>`: the base's raw `toolUse` and
 *  the (optional, absence-prone) raw `effortDeclared`/`declaredSource` never leak through under two
 *  names at once. All fields are computed at call time from the base entry; never persisted. */
export interface EnrichedModelEntry extends Omit<ModelEntry,
  'toolUse' | 'effortDeclared' | 'declaredSource' | 'supported_parameters' | 'modelType' | 'modelTypeSource' | 'maxOutputTokens'
  | 'capabilities' | 'pricingDetail' | 'local' | 'lifecycle' | 'benchmarks' | 'sameModelAs' | 'borrowedFrom'> {
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
  /** Issue #73: OBSERVED by the engine's own probe (model-probe.ts) through the real gateway —
   *  `null` = never probed. `toolUseVerified` is true only when the model ran a real Read tool call
   *  (issue #93 item 4: was Bash) AND reported the unguessable value it read. */
  toolUseVerified: boolean | null;
  proseVerified: boolean | null;
  lastProbedAt: string | null;
  probeDetail: string | null;
  /** Issue #73: where `stability` came from. `'probe'` (a probe result exists): prose failed ->
   *  `unavailable`; prose ok but tools failed -> `degraded`; both passed -> the rule's own tier (a
   *  probe proves liveness, not an SLA, so it never promotes a local/free model to `stable`).
   *  `'rule'` (never probed): `classifyStability`. */
  stabilitySource: 'probe' | 'rule';
  /** Issue #104: why the last probe failed (first failing leg), with a diagnostic hint; null when
   *  never probed or both legs passed. */
  probeFailureReason: ProbeFailureReason | null;
  // ---- Issue #104: selection data (always present; null = the source said nothing) ----
  modelType: ModelType;
  modelTypeSource: ModelTypeSource;
  /** `contextWindow` duplicates the top-level field (kept for compatibility). */
  limits: { contextWindow: number | null; maxOutputTokens: number | null };
  capabilities: Capabilities;
  /** Whether THIS engine's dispatch path for the provider actually carries an `effort` setting to
   *  the model (`PROVIDER_CAPS.effortDelivered`): anthropic true; openrouter false (the CLI + LiteLLM
   *  hops drop it — VAL-186); ollama false (no dial). Supersedes reading `effortDeclared`, which is
   *  only the upstream catalog's declaration. */
  effortAppliedOnTransport: boolean;
  pricingDetail: PricingDetail | null;
  /** Ollama rows only; null elsewhere. */
  local: LocalDetails | null;
  lifecycle: Lifecycle;
  benchmarks: Benchmarks | null;
  sameModelAs: string[];
  borrowedFrom: string | null;
  /** Engine-measured on THIS host (ObservedStats); `source:'none'` when nothing was measured. */
  observed: ObservedForRef;
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

/** issue #89 item 6: the band lookup half of `computeCostLevel`, pulled out so a caller that
 *  already has a comparable $/1M scalar in hand (`ModelBook.lookup()`'s `price`, via
 *  `maxPricePerMOf`) can get the SAME 0–10 tier without going through a `ModelEntry` — one band
 *  table (`COST_LEVEL_BANDS`), never a second copy of it. `null` (unpriced) stays `null`. */
export function costLevelFromPrice(price: number | null): number | null {
  if (price === null) return null;
  if (price === 0) return 0;
  for (let i = 1; i < COST_LEVEL_BANDS.length; i++) {
    if (price < COST_LEVEL_BANDS[i]!) return i;
  }
  return 10; // clamped
}

/** Compute the 0–10 integer cost tier for a model entry (DES-075).
 *  'free'/all-zero rates → 0; unpriced (`ratesPerM` null/absent) → null (never guessed); above the
 *  top band → clamp 10. Uses COST_LEVEL_BANDS with maxPricePerMOf as the single comparable scalar
 *  (ARCH-050 D-v12-C) — v26 (DES-178): reads `e.ratesPerM`, not the derived display string. */
export function computeCostLevel(e: ModelEntry): number | null {
  return costLevelFromPrice(maxPricePerMOf(e.ratesPerM ?? null));
}

/** Enrich a ModelEntry with capability/stability/costLevel (DES-075, ARCH-050).
 *  Pure — no I/O, no side effects. Called after filterCatalog (insertion point DES-075). */
/** `catalogFetchedAt` (v26 H-4 send-back repair, ARCH-116): the snapshot's own "as of" timestamp
 *  (`BookSnapshot.fetchedAt`) when a caller has one in hand (`models_list`, `GET /api/models`, both
 *  wired through `ModelBook.snapshot()`) — optional and defaulting to `null` so a direct call with
 *  no catalog context (a unit test, or `check-mermaid.ts`-style internal use) keeps DES-179's
 *  original honest "we never looked" default unchanged. */
export function enrichModelEntry(e: ModelEntry, catalogFetchedAt: string | null = null, probe?: ProbeResult, observed?: ObservedForRef): EnrichedModelEntry {
  // capability: truncate at 200 chars (199 + '…'); empty/null → fallback "${provider} model"
  let capability = e.description?.trim() ?? '';
  if (!capability) capability = `${e.provider} model`;
  if (capability.length > 200) capability = capability.slice(0, 199) + '…';

  // v26 (DES-179): `toolUse`/`effortDeclared`/`declaredSource` are dropped from the base spread and
  // re-emitted under their v26 names below — no alias window, `toolUse` never reaches the output.
  // v26 integration: `supported_parameters` is dropped for the same reason — it is the RAW signal
  // the two `*Declared` fields below project, and the output must carry one name per fact.
  const {
    toolUse, effortDeclared, declaredSource, supported_parameters: _supported,
    modelType, modelTypeSource, maxOutputTokens, capabilities, pricingDetail, local, lifecycle, benchmarks, sameModelAs, borrowedFrom,
    ...rest
  } = e;
  const ruleStability = classifyStability(e);
  const stability: Stability = !probe ? ruleStability : !probe.proseVerified ? 'unavailable' : !probe.toolUseVerified ? 'degraded' : ruleStability;
  return {
    ...rest,
    capability,
    stability,
    costLevel: computeCostLevel(e),
    toolUseDeclared: toolUse,
    effortDeclared: effortDeclared ?? 'unknown',
    declaredSource: declaredSource ?? 'unknown',
    // v26 (DES-179's own boundary): per-row, never a top-level wrapper — `null` when the caller has
    // no catalog snapshot timestamp to attach (the parameter's own default).
    catalogFetchedAt,
    toolUseVerified: probe ? probe.toolUseVerified : null,
    proseVerified: probe ? probe.proseVerified : null,
    lastProbedAt: probe ? probe.probedAt : null,
    probeDetail: probe ? (probe.detail.length > 200 ? probe.detail.slice(0, 199) + '…' : probe.detail) : null,
    stabilitySource: probe ? 'probe' : 'rule',
    probeFailureReason: probe ? probeFailureReason(probe, e) : null,
    modelType: modelType ?? 'unknown',
    modelTypeSource: modelTypeSource ?? 'unknown',
    limits: { contextWindow: e.contextWindow, maxOutputTokens: maxOutputTokens ?? null },
    capabilities: {
      toolUse: toolUse === 'unknown' ? null : toolUse,
      toolChoice: capabilities?.toolChoice ?? null,
      structuredOutput: capabilities?.structuredOutput ?? null,
      promptCaching: capabilities?.promptCaching ?? null,
      vision: capabilities?.vision ?? null,
      reasoning: capabilities?.reasoning ?? { supported: null, efforts: null, defaultEffort: null, mandatory: null },
    },
    effortAppliedOnTransport: isProvider(e.provider) ? PROVIDER_CAPS[e.provider].effortDelivered : false,
    pricingDetail: pricingDetail ?? null,
    local: e.provider === 'ollama' ? (local ?? null) : null,
    lifecycle: lifecycle ?? { releasedAt: null, knowledgeCutoff: null, expiresAt: null },
    benchmarks: benchmarks ? { source: BENCHMARK_SOURCE, fetchedAt: catalogFetchedAt, ...benchmarks } : null,
    sameModelAs: sameModelAs ?? [],
    borrowedFrom: borrowedFrom ?? null,
    observed: observed ?? OBSERVED_NONE,
  };
}

/** Issue #104: a structured reading of a failed probe's `detail`. The detail string is written by
 *  `model-probe.ts`'s `classifyProbe` in exactly the form `prose: <x>; tools: <y>`, where a failed
 *  gateway leg reads `<timeout|unreachable|terminal>[ (<provider detail>)]`. The FIRST failing leg
 *  is reported (a dead prose leg usually explains the tools leg too). */
export function probeFailureReason(probe: ProbeResult, e: Pick<ModelEntry, 'provider' | 'model' | 'besteffort'>): ProbeFailureReason | null {
  if (probe.proseVerified && probe.toolUseVerified) return null;
  const m = /^prose: (.*?); tools: (.*)$/s.exec(probe.detail);
  const leg: ProbeFailureReason['leg'] = probe.proseVerified ? 'tools' : 'prose';
  const text = m ? (leg === 'prose' ? m[1]! : m[2]!) : probe.detail;
  let kind: ProbeFailureReason['kind'];
  if (text.startsWith('timeout')) kind = 'timeout';
  else if (text.startsWith('unreachable')) kind = 'unreachable';
  else if (text.startsWith('empty reply')) kind = 'empty-reply';
  else if (text.startsWith('no Read tool_use')) kind = 'no-tool-use';
  else if (text.startsWith('Read ran but')) kind = 'wrong-answer';
  else kind = 'error';
  const freeTier = e.besteffort === true || e.model.endsWith(':free');
  const hint =
    kind === 'timeout'
      ? e.provider === 'ollama'
        ? 'No reply within the probe timeout. For a local Ollama model this is usually a cold load (the weights are read into memory on the first call after idle — `ollama ps` shows what is loaded) or a host too slow for this model size; re-probe once warm, or raise models_probe timeoutMs.'
        : freeTier
          ? 'No reply within the probe timeout. Free-tier routes queue and cold-start under load; a timeout here is common and not proof the model is broken — but it will behave the same inside a run.'
          : 'No reply within the probe timeout — the provider was slow or overloaded; re-probe, or raise models_probe timeoutMs.'
      : kind === 'unreachable'
        ? 'The provider endpoint could not be reached (network, proxy, or the local server is down).'
        : kind === 'empty-reply'
          ? 'The model answered with nothing.'
          : kind === 'no-tool-use'
            ? 'The model did not emit a real tool call (it may have written the call out as text) — do not give it tools.'
            : kind === 'wrong-answer'
              ? 'The tool ran but the model did not report what it read.'
              : 'The call failed — probeDetail carries the provider message (e.g. auth, unknown model, rate limit).';
  return { leg, kind, hint };
}

/** AND-filters the catalog and caps by limit (default 100, hard cap 500). An empty match returns []
 *  (never an error). */
export function filterCatalog(entries: ModelEntry[], filter: CatalogFilter = {}): ModelEntry[] {
  const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_LIMIT), HARD_CAP);
  return entries.filter((e) => matchesCatalogFilter(e, filter)).slice(0, limit);
}

/** The AND of the catalog-level filters for one row (`limit` is not a match criterion). Shared by
 *  `filterCatalog` and issue #104's `models_list` query (which pages instead of capping). */
export function matchesCatalogFilter(e: ModelEntry, filter: CatalogFilter): boolean {
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
    const hay = `${e.model} ${e.description}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
