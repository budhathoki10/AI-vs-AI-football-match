> **Note:** this document describes the earlier multi-page version (accounts, login, database). The current app is a single page without accounts or a database; see README.md and docs/SIMULATION_ENGINE.md for what is built. Parts below that mention those features no longer apply.

# Project requirements — AI Futsal Arena

A web platform where two independently configured AI team agents play a physics-simulated 5v5 futsal match.

## Functional requirements (summary) and status
See `IMPLEMENTATION_STATUS.md` for the authoritative per-requirement status (implemented / tested / partial / pending).

| Area | Requirement |
|---|---|
| Gameplay | 5v5 (GK + 4), formations 2-2, 1-2-1, 3-1, 4-0, 13 player attributes affecting behaviour, roles GK/Fixo/Ala/Pivot/Universal |
| Clock | Six real-time choices (1–6 min). Virtual clock always 00:00→90:00, half-time at 45:00. Physics never accelerated; only the virtual clock is compressed, adaptively |
| Draws | Level at 90:00 ⇒ automatic physics-based 1v1 penalty shootout (5 rounds, early end, sudden death, safety fallback) |
| AI | One team-level agent per team, always a model (Claude Code, Codex or OpenRouter); async, validated; a failed answer keeps the current tactics |
| Providers | OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, custom OpenAI-compatible; BYOK encrypted at rest |
| Presentation | 3D arena (React Three Fiber), live scoreboard/timeline/stats, camera modes, dedicated penalty scene, replay |
| Analysis | Stats from recorded sim data, AI decision review, benchmarking, tournaments |

## Non-functional
Server-authoritative simulation; no secrets in the browser; provider failure never crashes a match; documented deviations (below).

## Deliberate deviations from the master prompt (documented, justified)
- **Database:** PostgreSQL is supported and used in production (`DATABASE_URL`); SQLite (`node:sqlite`) remains as the zero-infrastructure development backend. Both run the same application SQL and the same test-suite (see DATABASE_SCHEMA.md). Redis is intentionally **not** used: with a single API process an in-memory rate limiter and in-process live-match fan-out are sufficient, and the spec says not to add unnecessary infrastructure; the limiter and live-subscriber registry are the two places to move to Redis if the API is scaled horizontally.
- **Backend:** Fastify (TypeScript) rather than FastAPI/NestJS — the simulation (Rapier WASM) is TypeScript, so sharing types/code avoids a cross-language boundary.
- **Match format:** custom 90-minute virtual match; **not** a standard FIFA futsal match (see FUTSAL_RULES.md).
