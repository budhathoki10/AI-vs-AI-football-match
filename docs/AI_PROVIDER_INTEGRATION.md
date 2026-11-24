# AI provider integration

Provider abstraction in `packages/sim/src/providers.ts`; server wiring in `apps/server/src/{runner,app}.ts`.

| Provider | Endpoint | Auth | Structured output | Prompt caching |
|---|---|---|---|---|
| OpenAI / DeepSeek / OpenRouter / custom (OpenAI-compatible) | `{base}/chat/completions` | `Authorization: Bearer` | `response_format: json_object` | automatic prefix caching on the provider side; hits read from `prompt_tokens_details.cached_tokens` (OpenAI) / `prompt_cache_hit_tokens` (DeepSeek) |
| Anthropic | `{base}/messages` | `x-api-key`, `anthropic-version` | JSON-only system prompt, tolerant extractor | explicit `cache_control: ephemeral` breakpoint on the static system prefix; `cache_read_input_tokens` / `cache_creation_input_tokens` parsed (total prompt = input + read + write) |
| Gemini | `{base}/models/{model}:generateContent` | `x-goog-api-key` | `responseMimeType: application/json` | implicit caching; `cachedContentTokenCount` parsed |

Features: request building, response + token parsing, latency, bounded retry (429/5xx/network; default 1), timeout (15 s), JSON extraction from fenced/prose answers, cost estimate, model discovery (`GET /models`; OpenRouter also returns context window, pricing, response_format support; Gemini filters `generateContent` models).

## Cost management
- **Compact payloads:** only the current state summary (score, possession, stats, on-court positions, current tactics) is sent — never the match history.
- **Cacheable prefix:** the system message (rules + schema + the static squad roster with attributes + operator notes) is byte-identical on every call of a match and comes first; only the changing state is in the user message. Whether a provider actually caches depends on its minimum prefix length (e.g. ≈ 1 024 tokens for most OpenAI/Claude models); the roster makes the prefix long enough for many models, and cache usage is *measured* (tokens cached) and shown, never assumed.
- Cadence controls: decision cooldown (120 virtual s) and interval (300 virtual s) plus event triggers; in-flight duplicate prevention; a safe response cache keyed by (team, minute, score, possession, trigger).
- Tracking per match and per team: calls, tokens in / cached / out, latency, retries, failures, estimated cost (Providers → Usage, results → API usage, benchmarks).

**Pricing is never invented.** `estimateCost` returns `null` unless pricing came from discovery (OpenRouter) or user-entered overrides (Providers → Set pricing: input, output and optional cached-input $ per 1M). Cached tokens are billed at the full input price (an upper bound) unless the user entered a cached price. Context window and structured-output flags are shown only when the provider reports them, else "unknown".

## BYOK security
`PUT /api/providers` encrypts the key with AES-256-GCM (`CREDENTIAL_KEY`, 64 hex chars; required in production, a git-ignored dev key file is generated otherwise). Only a masked hint is ever returned. Keys travel in headers only, are never logged, never appear in error messages (tested), are isolated per user (unique `(user_id, kind)`), and can be replaced/removed. Custom base URLs must be HTTPS in production.

## Configuration required to use real providers
Sign in → Providers → add a key → create a match (or benchmark / tournament team) with architecture "LLM team agent", provider and model id. **Verification status:** request building, response/usage parsing (including cache fields), retries, timeouts and the agent flow are tested against mocked HTTP for every wire format; **no live provider call could be made in the build environment (no credentials)**, so live behaviour per provider is unverified. The Providers page has "Test connection" (model discovery or a 20-token completion) to verify your own key in one click.
