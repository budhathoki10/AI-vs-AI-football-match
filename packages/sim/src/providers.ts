import { ARCHITECTURES, FORMATIONS, INSTRUCTIONS, type Architecture, type TeamConfig } from './types';
import type { AgentDecision, CompactState, PenaltyContext, PenaltyDecision, TeamAgent } from './agents';

export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'openrouter' | 'custom';
export const PROVIDER_KINDS: ProviderKind[] = ['openai', 'anthropic', 'gemini', 'deepseek', 'openrouter', 'custom'];

export const DEFAULT_BASE_URL: Record<ProviderKind, string> = {
  openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/v1', openrouter: 'https://openrouter.ai/api/v1', custom: '',
};

export interface ModelInfo {
  id: string; provider: ProviderKind; name?: string; contextWindow?: number | null; structuredOutput?: boolean | null;
  /** USD per 1M tokens. null = unknown. Never invented: only filled from provider discovery (OpenRouter) or user-entered overrides. */
  inputPricePerM: number | null; outputPricePerM: number | null;
}
export interface ProviderCall { kind: ProviderKind; apiKey: string; model: string; baseUrl?: string; system: string; user: string; maxTokens?: number; timeoutMs?: number; retries?: number; temperature?: number; /** mark the static system prefix cacheable where the provider needs an explicit marker (Anthropic). Default true. */ cacheSystem?: boolean }
/** tokensIn is the TOTAL prompt size for every provider; cachedTokens = part of it served from the provider's prompt cache; cacheWriteTokens = part written to the cache (Anthropic only). */
export interface ProviderResult { text: string; tokensIn: number; tokensOut: number; cachedTokens: number; cacheWriteTokens: number; latencyMs: number; retries: number }

export class ProviderError extends Error { constructor(msg: string, readonly status?: number, readonly retryable = false) { super(msg); } }

const base = (c: { kind: ProviderKind; baseUrl?: string }) => (c.baseUrl && c.baseUrl.trim() ? c.baseUrl : DEFAULT_BASE_URL[c.kind]).replace(/\/+$/, '');

/** Build a provider-specific HTTP request. Keys are only ever placed in headers (never URLs, except Gemini's documented header alternative is used too). */
export function buildRequest(c: ProviderCall): { url: string; headers: Record<string, string>; body: unknown } {
  const maxTokens = c.maxTokens ?? 600;
  switch (c.kind) {
    case 'anthropic':
      return { url: `${base(c)}/messages`, headers: { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: { model: c.model, max_tokens: maxTokens, temperature: c.temperature ?? 0.3, system: c.cacheSystem === false ? c.system : [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: c.user }] } };
    case 'gemini':
      return { url: `${base(c)}/models/${encodeURIComponent(c.model)}:generateContent`, headers: { 'x-goog-api-key': c.apiKey, 'content-type': 'application/json' },
        body: { systemInstruction: { parts: [{ text: c.system }] }, contents: [{ role: 'user', parts: [{ text: c.user }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: c.temperature ?? 0.3, responseMimeType: 'application/json' } } };
    default: // openai, deepseek, openrouter, custom (OpenAI-compatible)
      return { url: `${base(c)}/chat/completions`, headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' },
        body: { model: c.model, max_tokens: maxTokens, temperature: c.temperature ?? 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: c.system }, { role: 'user', content: c.user }] } };
  }
}

export function parseResponse(kind: ProviderKind, j: any): { text: string; tokensIn: number; tokensOut: number; cachedTokens: number; cacheWriteTokens: number } {
  if (kind === 'anthropic') { // Anthropic's input_tokens excludes cache reads/writes: the total prompt is the sum
    const text = (j?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const u = j?.usage ?? {}; const read = u.cache_read_input_tokens ?? 0, write = u.cache_creation_input_tokens ?? 0;
    return { text, tokensIn: (u.input_tokens ?? 0) + read + write, tokensOut: u.output_tokens ?? 0, cachedTokens: read, cacheWriteTokens: write };
  }
  if (kind === 'gemini') {
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join(''); const u = j?.usageMetadata ?? {};
    return { text, tokensIn: u.promptTokenCount ?? 0, tokensOut: u.candidatesTokenCount ?? 0, cachedTokens: u.cachedContentTokenCount ?? 0, cacheWriteTokens: 0 };
  }
  const u = j?.usage ?? {}; // OpenAI reports prompt_tokens_details.cached_tokens, DeepSeek prompt_cache_hit_tokens; both are included in prompt_tokens
  return { text: j?.choices?.[0]?.message?.content ?? '', tokensIn: u.prompt_tokens ?? 0, tokensOut: u.completion_tokens ?? 0, cachedTokens: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0, cacheWriteTokens: 0 };
}

export function extractJson(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t); if (fence) { try { return JSON.parse(fence[1]); } catch { /* */ } }
  const s = t.indexOf('{'), e = t.lastIndexOf('}'); if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { /* */ } }
  throw new ProviderError('response did not contain valid JSON');
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

/** Call a provider with timeout and bounded retry (429/5xx/network). Error messages never include the key. */
export async function callProvider(c: ProviderCall, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<ProviderResult> {
  const req = buildRequest(c); const retries = c.retries ?? 1; let last: unknown; const t0 = Date.now(); let used = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), c.timeoutMs ?? 15000);
    try {
      const res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: ctl.signal });
      if (!res.ok) { const retryable = res.status === 429 || res.status >= 500; throw new ProviderError(`provider HTTP ${res.status}`, res.status, retryable); }
      const j = await res.json(); const p = parseResponse(c.kind, j);
      if (!p.text) throw new ProviderError('empty provider response');
      return { ...p, latencyMs: Date.now() - t0, retries: used };
    } catch (e) {
      last = e instanceof ProviderError ? e : new ProviderError(ctl.signal.aborted ? 'provider timeout' : `provider request failed`, undefined, true);
      if (!(last as ProviderError).retryable) break; used++;
    } finally { clearTimeout(timer); }
  }
  throw last;
}

/** Model discovery where the provider exposes it. Returns only data the provider returns; pricing is only known for OpenRouter. */
export async function discoverModels(kind: ProviderKind, apiKey: string, baseUrl?: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<ModelInfo[]> {
  const b = base({ kind, baseUrl });
  const headers: Record<string, string> = kind === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : kind === 'gemini' ? { 'x-goog-api-key': apiKey } : { authorization: `Bearer ${apiKey}` };
  const url = kind === 'gemini' ? `${b}/models` : `${b}/models`;
  const res = await fetchImpl(url, { method: 'GET', headers });
  if (!res.ok) throw new ProviderError(`model discovery failed: HTTP ${res.status}`, res.status);
  const j = await res.json();
  if (kind === 'gemini') return (j.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), provider: kind, name: m.displayName, contextWindow: m.inputTokenLimit ?? null, structuredOutput: true, inputPricePerM: null, outputPricePerM: null }));
  if (kind === 'anthropic') return (j.data ?? []).map((m: any) => ({ id: m.id, provider: kind, name: m.display_name, contextWindow: null, structuredOutput: null, inputPricePerM: null, outputPricePerM: null }));
  if (kind === 'openrouter') return (j.data ?? []).map((m: any) => ({ id: m.id, provider: kind, name: m.name, contextWindow: m.context_length ?? null, structuredOutput: (m.supported_parameters ?? []).includes('response_format') || null, inputPricePerM: m.pricing?.prompt != null ? Number(m.pricing.prompt) * 1e6 : null, outputPricePerM: m.pricing?.completion != null ? Number(m.pricing.completion) * 1e6 : null }));
  return (j.data ?? []).map((m: any) => ({ id: m.id, provider: kind, contextWindow: null, structuredOutput: null, inputPricePerM: null, outputPricePerM: null }));
}

export interface Price { inputPricePerM: number | null; outputPricePerM: number | null; /** user-entered price of cached prompt tokens; when absent cached tokens are billed at the full input price (an upper bound, never a guess of a discount) */ cachedInputPricePerM?: number | null }
export function estimateCost(tokensIn: number, tokensOut: number, price?: Price | null, cachedTokens = 0): number | null {
  if (!price || price.inputPricePerM == null || price.outputPricePerM == null) return null; // unknown pricing is reported as unknown, never guessed
  const cached = Math.min(cachedTokens, tokensIn); const cachedPrice = price.cachedInputPricePerM ?? price.inputPricePerM;
  return ((tokensIn - cached) * price.inputPricePerM + cached * cachedPrice + tokensOut * price.outputPricePerM) / 1e6;
}

const SYSTEM = `You are the head coach of a 5-a-side futsal team in a simulation. You control the whole team collectively, not individual physics.
Reply with ONE JSON object only (no prose, no markdown). Never include hidden reasoning; "reasonSummary" is at most two short sentences.
Schema: {"formation": one of ${JSON.stringify(FORMATIONS)}, "teamStrategy": "balanced"|"attacking"|"defensive"|"counter"|"park_the_bus"|"all_out_attack", "attackingStyle": "possession"|"direct"|"counter"|"wing_play"|"pivot_play", "defensiveStyle": "high_press"|"mid_block"|"low_block"|"man_marking", "pressingIntensity": 0..1, "riskLevel": 0..1, "flyingGoalkeeper": boolean, "playerInstructions": [{"playerId": id from onCourt, "instruction": one of ${JSON.stringify(INSTRUCTIONS)}}], "substitutions": [{"out": onCourt id, "in": bench id}] (optional, max 3), "reasonSummary": string}.
Only use player ids given in the state. The simulation rules engine validates everything; illegal output is discarded.`;

/** Anything that can turn (system, user) into text: an HTTP provider, or a local CLI such as `claude -p` / `codex exec`. */
export type Transport = (system: string, user: string) => Promise<{ text: string; tokensIn?: number; tokensOut?: number }>;
export interface LlmAgentOptions { /** when set, replaces the HTTP call; `kind`/`apiKey` are then only labels */ transport?: Transport; label?: string; kind: ProviderKind; apiKey: string; model: string; baseUrl?: string; price?: Price | null; fetchImpl?: FetchLike; timeoutMs?: number; retries?: number; maxTokens?: number; cooldownVirtual?: number; intervalVirtual?: number }

/** Team-level LLM agent: one async call per decision for the whole team. Failures never throw into the simulation: they return tactics=null and the engine's documented fallback applies. */
export class LlmAgent implements TeamAgent {
  readonly architecture: Architecture = 'llm';
  readonly cooldownVirtual: number; readonly intervalVirtual: number;
  private inflight = new Map<string, Promise<AgentDecision>>(); private cache = new Map<string, AgentDecision>();
  constructor(private o: LlmAgentOptions) { this.cooldownVirtual = o.cooldownVirtual ?? 120; this.intervalVirtual = o.intervalVirtual ?? 300; }

  private async ask(system: string, user: string): Promise<{ r: ProviderResult; costUsd: number | null }> {
    if (this.o.transport) {
      const t0 = Date.now(); const out = await this.o.transport(system, user);
      return { r: { text: out.text, tokensIn: out.tokensIn ?? 0, tokensOut: out.tokensOut ?? 0, cachedTokens: 0, cacheWriteTokens: 0, latencyMs: Date.now() - t0, retries: 0 }, costUsd: null };
    }
    const r = await callProvider({ kind: this.o.kind, apiKey: this.o.apiKey, model: this.o.model, baseUrl: this.o.baseUrl, system, user, maxTokens: this.o.maxTokens ?? 500, timeoutMs: this.o.timeoutMs ?? 15000, retries: this.o.retries ?? 1 }, this.o.fetchImpl);
    return { r, costUsd: estimateCost(r.tokensIn, r.tokensOut, this.o.price, r.cachedTokens) };
  }

  /** Static, deterministic per-match context (identical on every call, so it forms a cacheable prompt prefix). */
  private systemFor(team: TeamConfig): string {
    const roster = team.players.map((p) => `${p.id} ${p.role} #${p.number} ${p.name}: ${Object.entries(p.attributes).map(([k, v]) => `${k.slice(0, 4)}${v}`).join(' ')}`).join('\n');
    return `${SYSTEM}\n\nYour squad (static for this match; attributes 0-100; first player is the goalkeeper, the last three are substitutes):\n${roster}\nOperator tactical notes: ${(team.tacticalInstructions ?? 'none').slice(0, 300)}`;
  }

  decide(state: CompactState, team: TeamConfig): Promise<AgentDecision> {
    const slim = { ...state, current: { ...state.current, playerInstructions: state.current.playerInstructions.slice(0, 5) } };
    const user = `Team: ${team.name}.\nMatch state (JSON): ${JSON.stringify(slim)}\nTrigger: ${state.trigger}. Return the new tactics JSON.`;
    const key = JSON.stringify([state.team, state.minute, state.scoreOwn, state.scoreOpp, state.possession, state.trigger]);
    const cached = this.cache.get(key); if (cached) return Promise.resolve({ tactics: cached.tactics, meta: { ...cached.meta, source: 'llm(cache)', tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0 } });
    const dup = this.inflight.get(key); if (dup) return dup; // duplicate-request prevention
    const p = (async (): Promise<AgentDecision> => {
      try { const { r, costUsd } = await this.ask(this.systemFor(team), user); const tactics = extractJson(r.text);
        const d: AgentDecision = { tactics, meta: { source: `llm:${this.o.label ?? this.o.kind}:${this.o.model}`, latencyMs: r.latencyMs, tokensIn: r.tokensIn, tokensOut: r.tokensOut, tokensCached: r.cachedTokens, costUsd, retries: r.retries } };
        this.cache.set(key, d); return d;
      } catch (e) { return { tactics: null, meta: { source: `llm:${this.o.label ?? this.o.kind}:${this.o.model}`, error: e instanceof Error ? e.message : 'unknown error' } }; }
      finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, p); return p;
  }

  async decidePenalty(ctx: PenaltyContext): Promise<PenaltyDecision> {
    const sys = 'You coach a futsal team in a penalty shootout. Reply with ONE JSON object only, no hidden reasoning, reason at most one sentence. ' +
      'Shoot role: {"takerId": id from eligible, "side": -1..1 (world z sign: negative = one post, positive = other), "height": 0..1, "power": 0.3..1, "reason": string}. ' +
      'Defend role: {"dive": -1|0|1 (world z sign direction), "reactDelay": -0.3..0.5 seconds (negative = anticipate before the kick), "reason": string}.';
    const { r } = await this.ask(sys, JSON.stringify(ctx)); // errors propagate: the shootout engine catches them and uses its documented fallback
    return extractJson(r.text) as PenaltyDecision;
  }
}
export { ARCHITECTURES };
