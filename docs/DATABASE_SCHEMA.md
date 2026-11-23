# Database schema

SQLite (`node:sqlite`), `PRAGMA foreign_keys = ON`, defined in `apps/server/src/db.ts` as portable SQL (types/`datetime('now')` map directly to PostgreSQL `TIMESTAMPTZ DEFAULT now()`; BLOB → `bytea`).

Entities: `users`, `sessions` (hashed tokens), `provider_credentials` (encrypted, `UNIQUE(user_id,kind)`), `ai_models` (price/context overrides), `teams`, `matches` (stores **selected_real_duration_seconds**, **actual_real_elapsed_seconds**, **virtual_match_duration_seconds**, regulation score, winner, decided_by, clock report), `match_participants`, `match_events` (virtual timestamps, indexed `(match_id, vt)`), `simulation_snapshots` (gzip chunks of 200 snapshots at 5 Hz), `ai_decisions`, `team_stats`, `player_stats`, `penalty_shootouts` (separate from regulation result), `penalty_attempts` (gzip frames for per-attempt replay), `tournaments`, `tournament_participants`, `benchmark_runs`, `benchmark_results`, `api_usage`, `audit_log`.

Deletion: user → everything cascades; match → events/snapshots/decisions/stats/shootout cascade; tournament/benchmark deletion sets `matches.*_id` to NULL. Match persistence is a single transaction (`Runner.persist`). Backups: use `sqlite3 data/futsal.sqlite ".backup backup.sqlite"` (or `node:sqlite` `backup()`); automated scheduling is **not** included.
