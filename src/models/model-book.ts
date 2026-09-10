// ModelBook (DES-178 / ARCH-116 / ADR-038 / TASK-178, v26): a TTL'd, single-flight catalog snapshot
// answering price (four rates) and declared capability per (provider, model) — the run-admission pin
// (`runs.price_book`) is built from a `BookSnapshot` this class produces. One fetch per TTL, never
// one per run and certainly not one per agent() call.
//
// Refresh degrades in three steps, cheapest-first: a fresh `source()` call ('live') -> the last
// successful load, kept in memory, when `source()` throws ('last-good') -> the built-in static
// fallback when nothing has ever succeeded ('static'). `lookup()` is TOTAL: an unlisted
// (provider,model) answers `{price:null, caps:{...:'unknown'}}` rather than `undefined` — "we
// looked and found nothing" must stay distinct from "we never looked" (the caller's PRESENCE of the
// key in its own pin is what carries that distinction; lookup() itself never omits an answer).
import type { Clock } from '../clock.js';
import type { RunParams } from '../params/resolve.js';
import type { FourRates, Caps, BookEntry } from '../types.js';
import { ZERO_RATES, STATIC_ANTHROPIC_RATES, ratesFromOpenRouterPricing } from './model-catalog.js';

/** The shape `ModelBook`'s injected `source()` returns one row per (provider,model) as. A
 *  production source (`config.modelCatalog`, i.e. `model-catalog.ts`'s `ModelEntry[]`) already
 *  carries `ratesPerM` — preferred when present (even when explicitly `null`). A raw feed (or a
 *  unit test) may instead carry OpenRouter's own `pricing`/`supported_parameters` shape, parsed via
 *  the SAME `ratesFromOpenRouterPricing` the live catalog fetch uses, so the two can never price one
 *  model two different ways. */
export interface CatalogSourceRow {
  provider: string;
  model: string;
  ratesPerM?: FourRates | null;
  pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown; input_cache_write?: unknown };
  supported_parameters?: string[];
}

export interface BookSnapshot {
  /** When the underlying data behind this snapshot was fetched (or last attempted) — the run's own
   *  admission time is recorded separately by the caller; this is the CATALOG's "as of". */
  fetchedAt: string;
  /** 'live' — this refresh's `source()` call just succeeded. 'last-good' — it threw, serving the
   *  previous successful load. 'static' — nothing has ever succeeded; only the built-in fallback
   *  (anthropic's static table + ollama's fixed zero rate) is priced. */
  source: 'live' | 'last-good' | 'static';
  lookup(provider: string, model: string): BookEntry;
  /** v26 (H-4 send-back repair, ARCH-116): the SAME rows `source()` returned this refresh (or the
   *  last-good/static fallback), for a caller that needs the full catalog — not just a price/caps
   *  lookup — without a second, un-TTL'd fetch of its own (`models_list`, `GET /api/models`).
   *  Typed `CatalogSourceRow[]` (this class's own generic row shape); the one production `source()`
   *  (`server.ts`'s `buildModelCatalog`) really returns `ModelEntry[]`, a superset, so that caller
   *  narrows it back. */
  entries: CatalogSourceRow[];
}

const UNKNOWN_CAPS: Caps = { reasoning: 'unknown', tools: 'unknown', source: 'unknown' };

/** Declared capability from a raw source row — 'upstream' when the row itself said something
 *  (`supported_parameters` present, however that later maps its named dials); a bare anthropic row
 *  (no `supported_parameters` — the static table never sets it) reports 'static'; anything else with
 *  no declaration at all is 'unknown', never guessed. */
function capsFromRow(row: CatalogSourceRow): Caps {
  if (row.supported_parameters) {
    return {
      reasoning: row.supported_parameters.includes('reasoning'),
      tools: row.supported_parameters.includes('tools'),
      source: 'upstream',
    };
  }
  return { reasoning: 'unknown', tools: 'unknown', source: row.provider === 'anthropic' ? 'static' : 'unknown' };
}

/** `ratesPerM` (even explicitly `null`) always wins over parsing raw `pricing` — a production row
 *  already did that parsing once (`model-catalog.ts`'s `buildCatalog`); re-parsing here would be a
 *  second writer of the same fact. */
function priceFromRow(row: CatalogSourceRow): FourRates | null {
  if (row.ratesPerM !== undefined) return row.ratesPerM;
  return ratesFromOpenRouterPricing(row.pricing);
}

interface BookCache {
  index: Map<string, BookEntry>;
  fetchedAt: string;
  source: BookSnapshot['source'];
  entries: CatalogSourceRow[];
}

export class ModelBook {
  private readonly _source: () => Promise<CatalogSourceRow[]>;
  private readonly _ttlMs: number;
  private readonly _clock: Clock;
  private _cache: BookCache | null = null;
  private _lastFetchMs: number | null = null;
  private _lastGoodEntries: CatalogSourceRow[] | null = null;
  private _inFlight: Promise<BookSnapshot> | null = null;

  constructor(source: () => Promise<CatalogSourceRow[]>, opts: { ttlMs?: number; clock: Clock }) {
    this._source = source;
    this._ttlMs = opts.ttlMs ?? 3_600_000;
    this._clock = opts.clock;
  }

  async snapshot(): Promise<BookSnapshot> {
    const now = this._clock.now();
    if (this._cache && this._lastFetchMs !== null && now - this._lastFetchMs < this._ttlMs) {
      return this._toSnapshot(this._cache);
    }
    if (this._inFlight) return this._inFlight;
    // Single-flight: assign BEFORE awaiting anything, so every concurrent caller this tick sees the
    // same in-flight promise and `_source()` is invoked exactly once for the whole burst.
    this._inFlight = this._refresh().finally(() => { this._inFlight = null; });
    return this._inFlight;
  }

  private async _refresh(): Promise<BookSnapshot> {
    const fetchedAt = this._clock.isoNow();
    let entries: CatalogSourceRow[];
    let source: BookSnapshot['source'];
    try {
      entries = await this._source();
      this._lastGoodEntries = entries;
      source = 'live';
    } catch {
      if (this._lastGoodEntries !== null) {
        entries = this._lastGoodEntries;
        source = 'last-good';
      } else {
        entries = [];
        source = 'static';
      }
    }
    const index = new Map<string, BookEntry>();
    // v26 Gate 7.5 round 3 (defect D9, REQ-127): several rows can carry the SAME provider/model key.
    // A curated alias table with TWO aliases on one model — the shape every Anthropic model has on
    // the real deployment (`haiku` and `claude-haiku-4-5` both -> claude-haiku-4-5-20251001) — makes
    // `overlayAliases` append a second, `ratesPerM:null` row for it. A bare `index.set` let that
    // later unpriced row OVERWRITE the priced static one, and `lookup()` then answered `price:null`
    // (the anthropic static fallback below is unreachable — the key WAS found), so every real
    // Anthropic call recorded `costUSD 0 / unpriced:true` and a USD budget could never bind.
    // RESOLUTION ORDER, stated: a PRICED row wins over an unpriced one; otherwise the FIRST row in
    // source order wins. "We have no price for this" must never displace a price already known.
    for (const row of entries) {
      const key = `${row.provider}/${row.model}`;
      const entry = { price: priceFromRow(row), caps: capsFromRow(row) };
      const incumbent = index.get(key);
      if (incumbent === undefined || (incumbent.price === null && entry.price !== null)) index.set(key, entry);
    }
    this._cache = { index, fetchedAt, source, entries };
    this._lastFetchMs = this._clock.now();
    return this._toSnapshot(this._cache);
  }

  private _toSnapshot(cache: BookCache): BookSnapshot {
    const { index, fetchedAt, source, entries } = cache;
    return {
      fetchedAt,
      source,
      entries,
      lookup(provider: string, model: string): BookEntry {
        // ADR-038 / DES-178 boundary: ollama is priced all-zero UNCONDITIONALLY (a KNOWN fact, not
        // an absence of one) — never dependent on whatever the source did or didn't return.
        if (provider === 'ollama') {
          return { price: ZERO_RATES, caps: { reasoning: 'unknown', tools: 'unknown', source: 'static' } };
        }
        const found = index.get(`${provider}/${model}`);
        if (found) return found;
        // Anthropic is never live-fetched (no such endpoint exists) — the static table is the last-
        // resort fallback even outside strict 'static' snapshot mode (e.g. a raw feed that omits it).
        if (provider === 'anthropic') {
          const rates = STATIC_ANTHROPIC_RATES[model];
          if (rates) return { price: rates, caps: { reasoning: 'unknown', tools: 'unknown', source: 'static' } };
        }
        return { price: null, caps: UNKNOWN_CAPS };
      },
    };
  }
}

/** v26 (DES-178, ARCH-116, TASK-178): the `modelsToCheck` expression `run-manager.ts` used to build
 *  inline, extracted so the admission UNKNOWN_ALIAS check and the price-book pin derive the SAME
 *  reachable set from ONE place (INV-V26-4 is only as strong as the set it pins over). Deduplicated
 *  — a run-wide default plus per-agent overrides frequently repeat the same alias. */
export function reachableModels(params: RunParams): string[] {
  const raw = [params.model, ...Object.values(params.agents ?? {}).map((a) => a.model)];
  return [...new Set(raw.filter((m): m is string => m !== undefined))];
}
