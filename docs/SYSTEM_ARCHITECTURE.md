# System architecture

```
Browser (React + R3F)  <--REST/WebSocket-->  Fastify API  --> Runner --> @futsal/sim (Match, Rapier, agents)
                                               |                              |
                                           SQLite (node:sqlite)        Provider HTTP (LLM) – server side only
```

## Monorepo
- `packages/sim` — authoritative simulation: physics, clock, rules, behaviour, AI architectures, shootout, provider clients. Pure TypeScript, runs headless.
- `apps/server` — Fastify REST + WebSocket, auth, encrypted credentials, persistence, match runner, tournaments, benchmarks.
- `apps/web` — React/Vite client with React Three Fiber scenes. It only renders what the server streams; it never decides results.

## Layering (spec §6.2)
LLM/algorithmic **team agent** → **tactics** (validated `TeamTactics`) → **player behaviour engine** (targets, passes, shots, marking) → **Rapier physics**. The agent never touches physics; the rules engine validates every event.

## Authority & liveness
The match is simulated on the server in a background task (`Runner.execute`). Browser tabs only subscribe (`/ws/matches/:id`). Closing the tab does not stop the match; the result is persisted at the end in one transaction. Paced mode runs physics at 1× real time; fast mode runs the identical simulation unpaced (used by tournaments/benchmarks/tests).

## Concurrency & limits
At most `MAX_CONCURRENT_MATCHES` (default 4) active matches; per-user creation limit; in-memory rate limiter (swap for Redis if horizontally scaled).
