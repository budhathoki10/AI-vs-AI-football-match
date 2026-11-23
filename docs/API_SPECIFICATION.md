# API specification (JSON; session via HttpOnly cookie `sid` or `Authorization: Bearer`)

| Method & path | Purpose |
|---|---|
| `GET /api/health` | liveness; lists the six allowed durations |
| `POST /api/auth/register`, `/login`, `/logout`; `GET /api/me`; `PUT /api/me/settings` | accounts (scrypt, 10 auth attempts/min/IP) |
| `GET/PUT /api/providers`, `DELETE /api/providers/:kind`, `POST /api/providers/:kind/test`, `GET /api/providers/:kind/models`, `PUT /api/models/pricing`, `GET /api/usage` | BYOK management |
| `GET/POST /api/teams`, `DELETE /api/teams/:id` | saved team configs |
| `POST /api/matches` | create+start a match (`realDurationMinutes` ∈ 1..6; returns 202 `{id}`) |
| `GET /api/matches?q=&status=` , `GET /api/matches/:id`, `…/events`, `…/replay`, `…/decisions`, `…/shootout/:idx/replay`, `DELETE /api/matches/:id` | history, results, replay data |
| `WS /ws/matches/:id` | live stream: `hello`, `state` (10 Hz paced), `event`, `full_time`, `shootout_start`, `penalty` (with frames), `done`, `error` |
| `POST/GET /api/tournaments`, `GET /api/tournaments/:id` | `single`, `best_of_three`, `round_robin`, `knockout`, `league`; policy in response |
| `POST/GET /api/benchmarks`, `GET /api/benchmarks/:id` | model/architecture comparison (≤20 matches; ≤10 with LLMs) |
| `GET /api/analytics` | per-architecture/model aggregates, cost |

Validation uses zod; errors are `{error, issues?}` and never include stack traces. All match/tournament/benchmark/credential endpoints are scoped to the authenticated user (other users receive 404).
