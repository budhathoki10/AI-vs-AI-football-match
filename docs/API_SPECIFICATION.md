> **Note:** this document describes the earlier multi-page version (accounts, login, database). The current app is a single page without accounts or a database; see README.md and docs/SIMULATION_ENGINE.md for what is built. Parts below that mention those features no longer apply.

# API specification (JSON; session via HttpOnly cookie `sid` + `x-csrf-token`, or `Authorization: Bearer`)

| Method & path | Purpose |
|---|---|
| `GET /api/health` | liveness; lists the six allowed durations and the active database backend |
| `POST /api/auth/register`, `/login`, `/logout`; `GET /api/me`; `PUT /api/me/settings` | accounts (scrypt, 10 auth attempts/min/IP); `register`/`login`/`me` return the session's `csrf` token |
| `POST /api/me/password`, `POST /api/me/sessions/revoke-all`, `GET /api/me/audit` | change password (revokes other sessions), sign out other sessions, recent account activity |
| `GET/PUT /api/providers`, `DELETE /api/providers/:kind`, `POST /api/providers/:kind/test`, `GET /api/providers/:kind/models`, `PUT /api/models/pricing` (input / output / cached-input $ per 1M), `GET /api/usage` | BYOK management |
| `GET/POST /api/teams`, `DELETE /api/teams/:id` | saved team configs |
| `POST /api/matches` | create+start a match (`realDurationMinutes` ∈ 1..6; returns 202 `{id}`) |
| `GET /api/matches?q=&status=`, `GET /api/matches/:id` (includes `analytics`: pass network, momentum, possession timeline), `…/events`, `…/replay`, `…/decisions`, `…/shootout/:idx/replay`, `DELETE /api/matches/:id` | history, results, replay data |
| `WS /ws/matches/:id` | live stream: `hello`, `state` (10 Hz paced), `event`, `full_time`, `shootout_start`, `penalty` (with frames), `done`, `error` |
| `POST/GET /api/tournaments`, `GET /api/tournaments/:id` | `single`, `best_of_three`, `round_robin`, `knockout`, `league`; any decision architecture per team (LLM needs provider + model); policy in response |
| `POST/GET /api/benchmarks`, `GET /api/benchmarks/:id` | model/architecture comparison (≤20 matches; ≤10 with LLMs) |
| `GET /api/analytics` | per-architecture/model aggregates, cost |

Cookie-authenticated `POST/PUT/DELETE` requests need the `x-csrf-token` header (403 otherwise); a cross-origin `Origin` is rejected (403). Validation uses zod; errors are `{error, issues?}` and never include stack traces. Everything is scoped to the authenticated user (other users receive 404).
