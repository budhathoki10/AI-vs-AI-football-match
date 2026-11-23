import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
// loaded via require so bundlers/test runners treat node:sqlite as a plain Node built-in
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Persistence: SQLite (node:sqlite, zero extra infrastructure). The schema is plain relational SQL with
 * FKs, unique constraints and indexes and ports directly to PostgreSQL (see docs/DATABASE_SCHEMA.md).
 */
export const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL, settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS provider_credentials (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, label TEXT, base_url TEXT, enc_key TEXT NOT NULL, key_hint TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, kind));
CREATE TABLE IF NOT EXISTS ai_models (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, model TEXT NOT NULL, name TEXT, context_window INTEGER, structured_output INTEGER, input_per_m REAL, output_per_m REAL, price_source TEXT, PRIMARY KEY(user_id, kind, model));
CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, config_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, name));
CREATE TABLE IF NOT EXISTS tournaments (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, format TEXT NOT NULL, status TEXT NOT NULL, config_json TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS tournament_participants (tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, slot INTEGER NOT NULL, team_name TEXT NOT NULL, config_json TEXT NOT NULL, PRIMARY KEY(tournament_id, slot));
CREATE TABLE IF NOT EXISTS benchmark_runs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, config_json TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, config_json TEXT NOT NULL, seed INTEGER NOT NULL,
  selected_real_duration_seconds INTEGER NOT NULL, actual_real_elapsed_seconds REAL, virtual_match_duration_seconds REAL, reg_score_a INTEGER, reg_score_b INTEGER, winner TEXT, decided_by TEXT,
  clock_report_json TEXT, error TEXT, tournament_id INTEGER REFERENCES tournaments(id) ON DELETE SET NULL, benchmark_id INTEGER REFERENCES benchmark_runs(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT);
CREATE INDEX IF NOT EXISTS idx_matches_user ON matches(user_id, id DESC);
CREATE TABLE IF NOT EXISTS match_participants (match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, team TEXT NOT NULL CHECK(team IN ('A','B')), name TEXT NOT NULL, architecture TEXT NOT NULL, provider TEXT, model TEXT, formation TEXT NOT NULL, PRIMARY KEY(match_id, team));
CREATE TABLE IF NOT EXISTS match_events (id INTEGER PRIMARY KEY, match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, seq INTEGER NOT NULL, type TEXT NOT NULL, vt REAL NOT NULL, half INTEGER NOT NULL, team TEXT, player_id TEXT, data_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_match ON match_events(match_id, vt);
CREATE TABLE IF NOT EXISTS simulation_snapshots (match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(match_id, seq));
CREATE TABLE IF NOT EXISTS ai_decisions (id INTEGER PRIMARY KEY, match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, team TEXT NOT NULL, vt REAL NOT NULL, trigger TEXT, architecture TEXT, accepted INTEGER NOT NULL, reject_reason TEXT, tactics_json TEXT, state_json TEXT, objective TEXT, outcome TEXT, source TEXT, tokens_in INTEGER, tokens_out INTEGER, latency_ms INTEGER, cost_usd REAL);
CREATE INDEX IF NOT EXISTS idx_decisions_match ON ai_decisions(match_id, vt);
CREATE TABLE IF NOT EXISTS team_stats (match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, team TEXT NOT NULL, stats_json TEXT NOT NULL, PRIMARY KEY(match_id, team));
CREATE TABLE IF NOT EXISTS player_stats (match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, player_id TEXT NOT NULL, team TEXT NOT NULL, stats_json TEXT NOT NULL, PRIMARY KEY(match_id, player_id));
CREATE TABLE IF NOT EXISTS penalty_shootouts (match_id INTEGER PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE, winner TEXT NOT NULL, score_a INTEGER NOT NULL, score_b INTEGER NOT NULL, first_team TEXT NOT NULL, decided_by TEXT NOT NULL, rounds INTEGER NOT NULL, sudden_death_rounds INTEGER NOT NULL, stats_json TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS penalty_attempts (id INTEGER PRIMARY KEY, match_id INTEGER NOT NULL REFERENCES penalty_shootouts(match_id) ON DELETE CASCADE, idx INTEGER NOT NULL, round INTEGER NOT NULL, team TEXT NOT NULL, sudden_death INTEGER NOT NULL, taker_id TEXT NOT NULL, keeper_id TEXT NOT NULL, result TEXT NOT NULL, shot_json TEXT NOT NULL, keeper_json TEXT NOT NULL, frames BLOB NOT NULL, UNIQUE(match_id, idx));
CREATE TABLE IF NOT EXISTS benchmark_results (id INTEGER PRIMARY KEY, benchmark_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE, match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, sides_swapped INTEGER NOT NULL, label_a TEXT NOT NULL, label_b TEXT NOT NULL, UNIQUE(benchmark_id, match_id));
CREATE TABLE IF NOT EXISTS api_usage (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL, team TEXT, provider TEXT, model TEXT, calls INTEGER, tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL, cost_known INTEGER, latency_ms INTEGER, retries INTEGER, failures INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_usage_user ON api_usage(user_id);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, detail TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

export type DB = DatabaseSyncT;
export function openDb(path = process.env.DATABASE_PATH ?? 'data/futsal.sqlite'): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec(SCHEMA); return db;
}
export function tx<T>(db: DB, f: () => T): T {
  db.exec('BEGIN');
  try { const r = f(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function audit(db: DB, userId: number | null, action: string, detail = '', ip = '') {
  db.prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?,?,?,?)').run(userId, action, detail.slice(0, 500), ip);
}
