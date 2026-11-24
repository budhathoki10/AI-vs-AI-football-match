> **Note:** this document describes the earlier multi-page version (accounts, login, database). The current app is a single page without accounts or a database; see README.md and docs/SIMULATION_ENGINE.md for what is built. Parts below that mention those features no longer apply.

# Database schema

Two interchangeable backends behind one async `Db` interface (`apps/server/src/db.ts`):

| Backend | Selected by | Use |
|---|---|---|
| **PostgreSQL** | `DATABASE_URL=postgres://…` | production (`docker-compose.yml` provides one) |
| SQLite (`node:sqlite`) | `DATABASE_PATH` (default `data/futsal.sqlite`) or `:memory:` | zero-infrastructure development / tests |

All application SQL is written once with `?` placeholders in the common subset of both dialects (the PostgreSQL adapter rewrites them to `$n`, `INSERT … RETURNING id` replaces `lastInsertRowid`, and `BIGINT`/`NUMERIC` results are parsed to numbers). Only the DDL differs (`schema(dialect)`: `BIGSERIAL` vs `INTEGER PRIMARY KEY`, `BYTEA` vs `BLOB`, `DOUBLE PRECISION` vs `REAL`, UTC text timestamps). SQLite work is serialised so an open transaction never absorbs unrelated statements. Additive migrations (`migrate()`) bring older databases up to date. The **entire server test-suite runs against both backends** — the PostgreSQL run uses a real, throw-away PostgreSQL server (`embedded-postgres`), not an emulator.

## Entities
`users`; `sessions` (SHA-256 token hash, expiry, per-session CSRF token); `provider_credentials` (AES-256-GCM ciphertext + masked hint, `UNIQUE(user_id,kind)`); `ai_models` (user-entered input / output / **cached-input** prices); `teams`; `matches` (stores **selected_real_duration_seconds**, **actual_real_elapsed_seconds**, **virtual_match_duration_seconds**, regulation score, winner, decided_by, clock report); `match_participants`; `match_events` (virtual timestamps, indexed `(match_id, vt)`); `simulation_snapshots` (gzip chunks of 200 snapshots at 5 Hz); `match_analytics` (pass network pairs, momentum, possession timeline); `ai_decisions`; `team_stats`; `player_stats`; `penalty_shootouts` (separate from the regulation result); `penalty_attempts` (gzip frames for per-attempt replay); `tournaments`; `tournament_participants`; `benchmark_runs`; `benchmark_results`; `api_usage` (calls, tokens in / **cached** / out, cost, latency, retries, failures); `audit_log`.

Integrity: primary keys everywhere, foreign keys with `ON DELETE CASCADE` (user → everything; match → events/snapshots/analytics/decisions/stats/shootout) or `SET NULL` (tournament/benchmark → matches), unique constraints (`users.username`, `teams(user_id,name)`, `provider_credentials(user_id,kind)`, `penalty_attempts(match_id,idx)`, …), `CHECK(team IN ('A','B'))`, indexes on the hot lookups. Match persistence is a single transaction (`Runner.persist`).

## Backups
SQLite: scheduled consistent `VACUUM INTO` copies (see SECURITY.md). PostgreSQL: `npm run backup` runs `pg_dump`; production deployments should also use managed point-in-time backups.
