> **Note:** this document describes the earlier multi-page version (accounts, login, database). The current app is a single page without accounts or a database; see README.md and docs/SIMULATION_ENGINE.md for what is built. Parts below that mention those features no longer apply.

# Security

- **Authentication:** scrypt password hashes (N=16384), random 256-bit session tokens stored only as SHA-256 hashes, 7-day expiry (expired sessions are swept hourly), HttpOnly + SameSite=Lax cookie (`Secure` in production). Users can change their password (current password required, all *other* sessions are revoked) and sign out every other session; both are audited and visible under Settings → recent account activity. No email verification / 2FA / password-reset-by-email (needs an outbound mail service; out of scope).
- **CSRF:** cookie-authenticated state-changing requests must carry the per-session `x-csrf-token` (returned by login/register/`/api/me`, kept in memory by the SPA, compared in constant time). Bearer-token requests are exempt because browsers do not attach them automatically. Additionally any browser-sent `Origin` on a non-GET request must equal the request host, the proxy's `X-Forwarded-Host`, or `WEB_ORIGIN`; the WebSocket upgrade applies the same check.
- **Credentials (BYOK):** AES-256-GCM at rest, masked in all responses, per-user isolation, audit entries without secrets. Production refuses to start without `CREDENTIAL_KEY`. Custom provider URLs must be HTTPS in production.
- **Input:** zod 4 validation on every body, 256 KB body limit, WebSocket max payload 4 KB, SQL via bound parameters only (both database backends).
- **Rate limiting:** 600 req/min/IP global, 10 auth attempts/min/IP, 5 password attempts/min/user, 30 matches/hour/user, 20 provider tests/min/user, max concurrent matches. The limiter is in-process (see below).
- **Headers:** `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, `no-store`; CORS only for `WEB_ORIGIN` when set.
- **AI safety:** LLM output is data only — schema validated, ids checked against the roster, never evaluated. Provider failures degrade to the deterministic fallback; errors never leak keys (tested).
- **Authority:** the server simulation decides all results; the client cannot submit scores.
- **Audit log:** registrations, logins (and failures), key set/removed, password changes, session revocations, match deletions.
- **Backups:** SQLite — consistent `VACUUM INTO` copies written every `BACKUP_INTERVAL_HOURS` (default 24, `0` disables) into `BACKUP_DIR` (default `data/backups`), newest `BACKUP_KEEP` (default 14) kept; `npm run backup` takes one on demand (tested: the copy reopens and contains the data). PostgreSQL — `npm run backup` shells out to `pg_dump --format=custom` (must be installed; restore with `pg_restore`); for production prefer your platform's managed point-in-time backups. Backups contain encrypted provider keys: protect them like the database and keep `CREDENTIAL_KEY` separate.
- **Dependencies:** `npm audit` reports **0 vulnerabilities** (zod 4, react-router 7, vite 8, vitest 5 after triage; each upgrade re-ran the full test-suite, lint and build).

## Known gaps / review notes
- The rate limiter is in memory (single process). Behind several instances use a shared store (Redis) — deliberately not added until there is more than one instance.
- Custom base URLs allow arbitrary hosts outside production (SSRF consideration — restrict server egress in production).
- No email verification, 2FA or account recovery.
- Secrets in the dev environment: a git-ignored dev credential key file is generated when `CREDENTIAL_KEY` is unset (never in production).
