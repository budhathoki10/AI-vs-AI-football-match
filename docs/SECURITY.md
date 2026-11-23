# Security

- **Auth:** scrypt password hashes (N=16384), random 256-bit session tokens stored as SHA-256 hashes, 7-day expiry, HttpOnly + SameSite=Lax cookie (`Secure` in production). No email verification / 2FA (limitation).
- **Credentials:** AES-256-GCM at rest, masked in all responses, per-user isolation, audit entries without secrets. Production refuses to start without `CREDENTIAL_KEY`.
- **Input:** zod validation on every body, 256 KB body limit, WebSocket max payload 4 KB, SQL via prepared statements only.
- **Rate limiting:** 600 req/min/IP global, 10 auth attempts/min/IP, 30 matches/hour/user, 20 provider tests/min/user, max concurrent matches.
- **Headers:** `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, `no-store`; CORS only for `WEB_ORIGIN` when set.
- **AI safety:** LLM output is data only — schema validated, ids checked against the roster, never evaluated. Provider failures degrade to the deterministic fallback; errors never leak keys (tested).
- **Authority:** the server simulation decides all results; the client cannot submit scores.
- **Known gaps / review notes:** in-memory rate limiter (single process); no CSRF token (SameSite=Lax + JSON content-type only); custom base URLs allow arbitrary hosts in non-production (SSRF consideration — restrict egress in production); no automatic DB backups; `npm audit` reports advisories in dev tooling that were not triaged.
