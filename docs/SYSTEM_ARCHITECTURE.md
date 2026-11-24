> **Note:** this document describes the earlier multi-page version (accounts, login, database). The current app is a single page without accounts or a database; see README.md and docs/SIMULATION_ENGINE.md for what is built. Parts below that mention those features no longer apply.

# System architecture

```
Browser (React + R3F)  <--REST/WebSocket-->  Fastify API  --> Runner --> @futsal/sim (Match, Rapier, agents)
                                               |                              |
                                    PostgreSQL (or SQLite dev)        Provider HTTP (LLM) – server side only
```

## Monorepo
- `packages/sim` — authoritative simulation: physics, clock, rules, behaviour, AI architectures, shootout, provider clients, xG model. Pure TypeScript, runs headless.
- `apps/server` — Fastify REST + WebSocket, auth + CSRF, encrypted credentials, persistence (PostgreSQL / SQLite), match runner, tournaments, benchmarks, backups.
- `apps/web` — React/Vite client with React Three Fiber scenes (articulated procedural players, referee, instanced crowd, benches), charts in SVG. It only renders what the server streams; it never decides results.
- `e2e/run.mjs` — real-browser verification (Playwright); `scripts/` — `measure`, `fit-xg`, `backup`, `penalty-stats`.

## Why these choices
- **Fastify (TypeScript) over FastAPI/NestJS:** the simulation (Rapier WASM) is TypeScript, so the API shares types and runs the physics in-process without a cross-language boundary; Fastify has first-class WebSocket and schema tooling and is far lighter than NestJS for this size.
- **Rapier:** stable fixed-step rigid-body engine with continuous collision detection, deterministic for identical inputs, WASM so it runs in Node without native builds.
- **PostgreSQL + SQLite adapter:** PostgreSQL for production; the same SQL on SQLite keeps the development loop infrastructure-free and gives a second backend to test against.
- **No Redis:** one API process owns live matches, so an in-memory rate limiter and subscriber registry are enough; adding Redis now would be unnecessary infrastructure. Both are isolated (`Limiter`, `Runner.live`) for a future move.

## Layering (spec §6.2)
Model-driven **team agent** → **tactics** (validated `TeamTactics`) → **player behaviour engine** (targets, passes, shots, marking) → **Rapier physics**. The agent never touches physics; the rules engine validates every event.

## Authority & liveness
The match is simulated on the server in a background task (`Runner.execute`). Browser tabs only subscribe (`/ws/matches/:id`). Closing the tab does not stop the match; the result is persisted at the end in one transaction. Paced mode runs physics at 1× real time; fast mode runs the identical simulation unpaced (used by tournaments, benchmarks and tests).

## Concurrency & limits
At most `MAX_CONCURRENT_MATCHES` (default 4) active matches; per-user creation limit; in-memory rate limiter.
