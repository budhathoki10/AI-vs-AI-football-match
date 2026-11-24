> **Note:** this document describes the earlier multi-page version (accounts, login, database). The current app is a single page without accounts or a database; see README.md and docs/SIMULATION_ENGINE.md for what is built. Parts below that mention those features no longer apply.

# Implementation status (honest accounting)

Legend: ✅ implemented **and** exercised by automated tests · 🟡 implemented, verified only manually/partially or simplified · ⛔ not implemented.
Last verified: `npm run verify` (typecheck, lint, 99 simulation + 49 server tests on SQLite and PostgreSQL, production build), `npm audit` = 0 vulnerabilities, and `npm run e2e` = 30/30 real-browser checks including a real-time live match through the shootout screen.

## Simulation & physics
- ✅ Rapier fixed-step physics; players/ball per PHYSICS_SPECIFICATION; no teleport/speed-multiplier (bounds tested over a full match)
- ✅ Adaptive virtual clock: six durations all reach 45:00 / 90:00 exactly; physics dt untouched; separate real/actual/virtual durations stored
- ✅ **Duration fidelity:** real (physics) time lands at ≈ 97 % of the selected duration for all six options (tested −15 %/+5 %). Previously 1–2 minute matches overran by 13–26 %
- ✅ Dead-ball deadlock regression fixed and guarded
- 🟡 Active play is worth >1 virtual second per physics second by necessity (documented in SIMULATION_ENGINE.md)
- 🟡 Action density: a compressed match has only 1–6 minutes of physics, so typical matches have ≈ 8–15 shots, 1–2 goals and a regulation draw in roughly half of matches (⇒ frequent shootouts). Improved from ≈ 3–6 shots and 0–1 goals, but this is a property of the format, not something that can be tuned away without speeding up play

## Rules (FUTSAL_RULES.md)
- ✅ kick-off, goals, kick-ins, corners, goal clearances, direct/indirect FKs, regulation penalties, accumulated fouls (6th), second penalty mark (approximation), yellow/red, dismissal replacement, substitutions, four-second GK rule, flying GK (basic)
- ✅ **advantage** and **defensive wall** (new)
- ⛔ handball/obstruction (not in the spec's list), time-outs (not required)

## Penalty shootout
- ✅ automatic on a draw; separate dedicated scene; real 1v1 Rapier attempts; 5 rounds alternating, early termination, sudden death, safety fallback, eligibility/no-repeat, separate stats, per-attempt replay, agent failure fallback
- ✅ execution error now produces genuine misses/woodwork (≈ 60 % goals / 35 % saves / 5 % off-target with the fallback policy; statistically tested)
- ✅ articulated taker/keeper models with run-up, kick swing and dive

## AI
- ✅ one agent per team; seven architectures behind one interface; strict validation; async scheduling, cooldowns, stale rejection, fallback; decision records with outcome, tokens, latency, cost
- ✅ provider abstraction for OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, custom (mocked-HTTP tests)
- ✅ **prompt caching:** Anthropic cache breakpoint, cache-usage parsing for every provider, static cacheable prefix (rules + squad roster), cached-token tracking and user-priced cache billing
- ✅ benchmarks and tournaments accept **any** architecture including LLM (provider + model) from the UI
- 🟡 **No live provider call was possible** (no credentials) — live behaviour per provider is unverified
- 🟡 whether a provider actually serves a cache hit depends on its minimum prefix length; hits are measured and displayed, not assumed

## Presentation
- ✅ React Three Fiber arena (court, lines, goals/nets, boards, lighting, shadows); **articulated procedural players** (gait from real speed, kick swing, goalkeeper dive); **referee**; **instanced animated crowd**; **benches with substitutes**; **goal celebrations / dejection** live and in replay; 4 live cameras + replay camera + penalty camera; live scoreboard/timeline/stats; framer-motion banners; replay with pause/speed/scrub/jump/follow/trail; heatmaps, shot map
- ✅ **pass network, momentum chart, possession-over-time chart, average-formation diagrams** from persisted data (new)
- ✅ responsive: no horizontal scrolling on 12 pages at 375, 390, 430, 768, 1280 and 1920 px (browser-verified); scoreboard restructures on narrow screens
- 🟡 players are procedural (no skeletal/licensed assets or motion capture): animation is convincing but stylised; ball spin is cosmetic

## Platform
- ✅ Fastify API, zod 4 validation, scrypt auth, HttpOnly sessions, **CSRF token + Origin checks**, rate limits, AES-256-GCM BYOK, user isolation, audit log, **password change / session revocation**, WebSocket live stream
- ✅ **PostgreSQL** support (same SQL, same tests on a real PostgreSQL) with SQLite for development; migrations; FKs/indexes/transactions
- ✅ **scheduled backups** (SQLite consistent copies; `pg_dump` for PostgreSQL) — tested for SQLite; the `pg_dump` path is implemented but not executed in tests (needs the binary)
- ✅ `npm audit`: 0 vulnerabilities after triage (zod 4, react-router 7, vite 8, vitest 5)
- ✅ **xG fitted from 1 177 simulated shots** (see SIMULATION_ENGINE.md)
- 🟡 in-memory rate limiter and live-subscriber registry instead of Redis (single-process; documented)
- 🟡 tournaments/benchmarks run in fast mode (same simulation, unpaced)
- ⛔ email verification / 2FA / password reset by email

## Known limitations summary
Everything marked 🟡/⛔ above, plus: GK "catch" is a trap (no hand animation); replay for LLM matches uses stored snapshots (non-deterministic agents); the browser e2e is a separate command (`npm run e2e`), not part of `npm test`; headless screenshots use software WebGL.
