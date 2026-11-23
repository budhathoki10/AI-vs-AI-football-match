# AI provider integration

Provider abstraction in `packages/sim/src/providers.ts`; server wiring in `apps/server/src/{runner,app}.ts`.

| Provider | Endpoint | Auth | Structured output |
|---|---|---|---|
| OpenAI / DeepSeek / OpenRouter / custom (OpenAI-compatible) | `{base}/chat/completions` | `Authorization: Bearer` | `response_format: json_object` |
| Anthropic | `{base}/messages` | `x-api-key`, `anthropic-version` | JSON-only system prompt, tolerant extractor |
| Gemini | `{base}/models/{model}:generateContent` | `x-goog-api-key` | `responseMimeType: application/json` |

Features: request building, response + token parsing, latency, bounded retry (429/5xx/network; default 1), timeout (15 s), JSON extraction from fenced/prose answers, cost estimate, model discovery (`GET /models`; OpenRouter also returns context window, pricing, response_format support; Gemini filters `generateContent` models).

**Pricing is never invented.** `estimateCost` returns `null` unless pricing came from discovery (OpenRouter) or user-entered overrides (`PUT /api/models/pricing`). Context window and structured-output flags are shown only when the provider reports them, else "unknown".

## BYOK security
`PUT /api/providers` encrypts the key with AES-256-GCM (`CREDENTIAL_KEY`, 64 hex chars; required in production, a git-ignored dev key file is generated otherwise). Only a masked hint is ever returned. Keys travel in headers only, are never logged, never appear in error messages (tested), are isolated per user (unique `(user_id, kind)`), and can be replaced/removed. Custom base URLs must be HTTPS in production.

## Configuration required to use real providers
Sign in → Providers → add a key → create a match with architecture "LLM team agent", provider and model id. **Verification status:** request/response handling is tested against mocked HTTP for every wire format; no live provider call could be made in the build environment (no credentials), so live behaviour per provider is unverified.
