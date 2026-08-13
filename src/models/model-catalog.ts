// Unified, normalized, cross-provider model catalog (REQ-039 / REQ-040). Federates a small static
// table of well-known openai/anthropic models with two LIVE sources — Ollama's local `/api/tags`
// and OpenRouter's remote `/api/v1/models` — and overlays the curated alias table. Every source is
// injectable (tests fake the fetch transport; no live network in the unit/integration tiers) and
// degrades gracefully: a source that throws/times out contributes nothing while the rest still
// return. NO API key or secret value ever appears in any entry (secret-separated by construction —
// this module reads no credentials at all).
import type { AliasMap } from '../gateway/client.js';

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
   *  anthropic/openai/ollama) — so its presence means "callable as-is", not just "listed". */
  ref?: string;
  /** issue #28: best-effort tier (OpenRouter `:free` variants). These queue / 429 / cold-start and can
   *  hang at 0 tokens — `toolUse:true` is a capability claim, NOT a liveness/reliability guarantee.
   *  Bound them with `agent({timeoutMs})` and null-harden. Absent = a normal (paid/local/static) tier. */
  besteffort?: boolean;
}

export interface CatalogFilter {
  provider?: string;
  query?: string;
  modalityIn?: string;
  modalityOut?: string;
  maxPricePerM?: number;
  minContext?: number;
  toolUse?: boolean;
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
  /** Include the static openai/anthropic table (default true). */
  includeStatic?: boolean;
}

const DEFAULT_LIMIT = 100;
const HARD_CAP = 500;
const DEFAULT_TIMEOUT_MS = 8000;

/** Static table of the well-known current models (REQ-039). Values I'm confident about are filled;
 *  anything uncertain is 'unknown' rather than guessed. Anthropic prices/context are current
 *  (claude-api skill, 2026-06 cache); OpenAI prices are left 'unknown' (context/modalities filled). */
const STATIC_ANTHROPIC: ModelEntry[] = [
  { provider: 'anthropic', model: 'claude-opus-4-8', description: 'Claude Opus 4.8 — most capable Opus-tier model', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 1_000_000, price: { in: '$5/1M', out: '$25/1M' }, toolUse: true, location: 'remote' },
  { provider: 'anthropic', model: 'claude-sonnet-5', description: 'Claude Sonnet 5 — balanced speed/intelligence', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 1_000_000, price: { in: '$3/1M', out: '$15/1M' }, toolUse: true, location: 'remote' },
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', description: 'Claude Haiku 4.5 — fastest, most cost-effective', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 200_000, price: { in: '$1/1M', out: '$5/1M' }, toolUse: true, location: 'remote' },
];

const STATIC_OPENAI: ModelEntry[] = [
  { provider: 'openai', model: 'gpt-4.1', description: 'OpenAI GPT-4.1', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 1_047_576, price: 'unknown', toolUse: true, location: 'remote' },
  { provider: 'openai', model: 'gpt-4o', description: 'OpenAI GPT-4o (omni)', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 128_000, price: 'unknown', toolUse: true, location: 'remote' },
  { provider: 'openai', model: 'gpt-4o-mini', description: 'OpenAI GPT-4o mini', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 128_000, price: 'unknown', toolUse: true, location: 'remote' },
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

/** OpenRouter prices are per-TOKEN strings (e.g. "0.0000007"); normalize to the "$X/1M" display
 *  shape. Both-zero -> 'free'; malformed/absent -> 'unknown'. */
function formatOpenRouterPrice(pricing: { prompt?: unknown; completion?: unknown } | undefined): ModelEntry['price'] {
  if (!pricing) return 'unknown';
  const pn = Number(pricing.prompt);
  const cn = Number(pricing.completion);
  if (!Number.isFinite(pn) || !Number.isFinite(cn)) return 'unknown';
  if (pn === 0 && cn === 0) return 'free';
  const perM = (n: number): string => `$${Number((n * 1_000_000).toFixed(4))}/1M`;
  return { in: perM(pn), out: perM(cn) };
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
    out.push({ provider: 'ollama', model: m.name, description: desc, modalities: { in: ['text'], out: ['text'] }, contextWindow: null, price: 'free', toolUse: 'unknown', location: 'local' });
  }
  return out;
}

async function fetchOpenRouter(fetchImpl: typeof fetch, timeoutMs: number): Promise<ModelEntry[]> {
  const res = await fetchWithTimeout(fetchImpl, 'https://openrouter.ai/api/v1/models', timeoutMs);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    data?: Array<{
      id?: string; name?: string; description?: string; context_length?: number;
      pricing?: { prompt?: unknown; completion?: unknown };
      architecture?: { input_modalities?: string[]; output_modalities?: string[] };
      supported_parameters?: string[];
    }>;
  };
  const models = Array.isArray(data?.data) ? data.data : [];
  const out: ModelEntry[] = [];
  for (const m of models) {
    if (typeof m?.id !== 'string') continue;
    const supported = Array.isArray(m.supported_parameters) ? m.supported_parameters : undefined;
    out.push({
      provider: 'openrouter',
      model: m.id,
      description: m.description ?? m.name ?? m.id,
      modalities: {
        in: Array.isArray(m.architecture?.input_modalities) ? m.architecture!.input_modalities! : ['text'],
        out: Array.isArray(m.architecture?.output_modalities) ? m.architecture!.output_modalities! : ['text'],
      },
      contextWindow: typeof m.context_length === 'number' ? m.context_length : null,
      price: formatOpenRouterPrice(m.pricing),
      toolUse: supported ? supported.includes('tools') : 'unknown',
      location: 'remote',
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
    entries.push(...STATIC_ANTHROPIC, ...STATIC_OPENAI);
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

/** The representative numeric price-per-million for a filter comparison: 0 for free, null (i.e.
 *  can't confirm -> excluded when maxPricePerM is set) for unknown, else the higher of in/out. */
function maxPricePerMOf(price: ModelEntry['price']): number | null {
  if (price === 'free') return 0;
  if (price === 'unknown') return null;
  const parse = (s: string): number | null => {
    const m = /\$([0-9.]+)\/1M/.exec(s);
    return m ? Number(m[1]) : null;
  };
  const vals = [parse(price.in), parse(price.out)].filter((v): v is number => v !== null);
  return vals.length ? Math.max(...vals) : null;
}

/** AND-filters the catalog and caps by limit (default 100, hard cap 500). An empty match returns []
 *  (never an error). */
export function filterCatalog(entries: ModelEntry[], filter: CatalogFilter = {}): ModelEntry[] {
  const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_LIMIT), HARD_CAP);
  const matched = entries.filter((e) => {
    if (filter.provider !== undefined && e.provider !== filter.provider) return false;
    if (filter.location !== undefined && e.location !== filter.location) return false;
    if (filter.toolUse !== undefined && e.toolUse !== filter.toolUse) return false;
    if (filter.modalityIn !== undefined && !e.modalities.in.includes(filter.modalityIn)) return false;
    if (filter.modalityOut !== undefined && !e.modalities.out.includes(filter.modalityOut)) return false;
    if (filter.minContext !== undefined && (e.contextWindow === null || e.contextWindow < filter.minContext)) return false;
    if (filter.maxPricePerM !== undefined) {
      const p = maxPricePerMOf(e.price);
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
