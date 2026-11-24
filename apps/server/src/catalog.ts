import type { ModelOption } from '@futsal/shared';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const PER_MILLION = 1_000_000;

interface OpenRouterModel { id: string; name?: string; pricing?: { prompt?: string; completion?: string } }
let cache: { at: number; models: ModelOption[] } | null = null;

function priceHint(m: OpenRouterModel): string | undefined {
  const prompt = Number(m.pricing?.prompt), completion = Number(m.pricing?.completion);
  if (!Number.isFinite(prompt) || prompt < 0) return undefined;
  if (prompt === 0 && (!completion || completion === 0)) return 'Free';
  return `$${(prompt * PER_MILLION).toFixed(2)} / $${((completion || 0) * PER_MILLION).toFixed(2)} per 1M`;
}

/** OpenRouter's public model list (no key needed), cached for ten minutes. Prices come from OpenRouter itself, never guessed. */
export async function getOpenRouterModels(fetchImpl: typeof fetch = fetch): Promise<ModelOption[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models;
  const res = await fetchImpl(MODELS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenRouter responded ${res.status}`);
  const data = ((await res.json()) as { data: OpenRouterModel[] }).data;
  const models = data.map((m) => ({ id: m.id, label: m.name ?? m.id, hint: priceHint(m) }));
  cache = { at: Date.now(), models }; return models;
}
export const _resetCatalogCache = () => { cache = null; };
