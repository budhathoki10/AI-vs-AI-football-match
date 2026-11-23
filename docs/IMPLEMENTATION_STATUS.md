# Implementation status (honest accounting)

Legend: ✅ implemented **and** exercised by automated tests · 🟡 implemented, verified only manually/partially or simplified · ⛔ not implemented. Last verified: `npm test` (104 tests passing: 87 sim + 17 server), `npm run typecheck`, `npm run lint`, `npm run build`, and a scripted browser run (`e2e/flow.cjs`) incl. a paced live match through the shootout screen.

## Simulation & physics
- ✅ Rapier fixed-step physics; players/ball per PHYSICS_SPECIFICATION; no teleport/speed-multiplier (bounds tested over a full match)
- ✅ Adaptive virtual clock: six durations all reach 45:00 / 90:00 exactly; physics dt untouched; separate real/actual/virtual durations stored
- 🟡 Duration fidelity: 3–6 min land within ~12% of the selection; **1–2 min overrun (~20–25%)** because dead time/natural play cannot fit; this is reported (results page, `clock.note`) rather than hidden
- 🟡 Active play is worth >1 virtual second per physics second by necessity (see SIMULATION_ENGINE.md)
- 🟡 Action density is modest: a compressed match has only ~1–6 minutes of physics time, so typical matches have a handful of shots and many finish 0–0 (⇒ frequent shootouts)

## Rules (FUTSAL_RULES.md)
- ✅ kick-off, goals, kick-ins, corners, goal clearances, direct/indirect FKs, regulation penalties, accumulated fouls (6th), second penalty mark (approximation), yellow/red, dismissal replacement, substitutions, four-second GK rule, flying GK (basic)
- ⛔ advantage, defensive wall, handball/obstruction, time-outs

## Penalty shootout
- ✅ automatic on a draw; separate dedicated scene; real 1v1 Rapier attempts (strike impulse, acceleration-limited keeper dive, goal/save/miss/post from physics); 5 rounds alternating, early termination (attempts-left aware), sudden death, safety fallback, eligibility/no-repeat, separate stats, per-attempt replay frames, agent failure fallback
- 🟡 Camera/animation are functional but simple (capsule players, no kick animation)

## AI
- ✅ one agent per team; seven architectures behind one interface; strict validation; async scheduling, cooldowns, stale rejection, fallback; decision records with outcome, tokens, latency, cost
- ✅ provider abstraction for OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, custom (mocked-HTTP tests)
- 🟡 **No live provider call was possible** (no credentials) — live behaviour unverified
- ⛔ prompt caching (provider-specific); model catalogue of capabilities is discovery-only (never invented)

## Presentation
- ✅ React Three Fiber arena (court, lines, goals/nets, boards, stands, benches, lighting, shadows), numbered players, 4 live cameras + replay camera + penalty camera, live scoreboard/timeline/stats, framer-motion banners, replay with pause/speed/scrub/jump/follow/trail, heatmaps, shot map
- 🟡 Players are procedural capsules with bob/tilt/dive tilt — **not** skeletal/licensed models; no referee figure; spectators are static tiers; no celebration animations
- 🟡 Pass network, momentum chart, formation diagrams, possession chart: **not built** (pass pairs/momentum are not persisted)
- 🟡 Responsive layout verified at 1280 and 390 px by screenshot; tablet/430 px not separately verified; mobile is not specially optimised beyond a quality setting

## Platform
- ✅ Fastify API, zod validation, scrypt auth, HttpOnly sessions, rate limits, AES-256-GCM BYOK, user isolation, audit log, WebSocket live stream, SQLite persistence with FKs/indexes/transactions, tournaments (single, best-of-3, round robin, knockout with byes, league), benchmarks with fairness/swap/metric docs/sample warnings, analytics
- 🟡 SQLite instead of PostgreSQL; in-memory rate limiter instead of Redis; no automatic backups (documented deviations)
- 🟡 Tournaments/benchmarks run in fast mode only; benchmark UI exposes non-LLM architectures (LLM via API)
- ⛔ email verification / 2FA / password reset; CSRF tokens (SameSite=Lax only)

## Known limitations summary
See above plus: heuristic xG; GK "catch" is a trap; replay for LLM matches uses stored snapshots (non-deterministic agents); E2E script is not part of `npm test` and needs the environment's Playwright; dependency advisories from `npm audit` were not triaged.
