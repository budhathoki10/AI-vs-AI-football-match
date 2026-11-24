# Testing strategy and results

Run everything: `npm run verify` (typecheck → lint → tests → production build). Real-browser flow: `npx playwright install chromium` once, then `npm run e2e` (starts its own API with a temporary database and the web dev server; `-- --skip-live` skips the real-time 70-second live match). Server tests run on **SQLite and a real PostgreSQL** (embedded-postgres, started and stopped by the test-suite; `SKIP_PG=1` skips PostgreSQL).

| Layer | Coverage (all executed) |
|---|---|
| Unit — clock | six durations reach exactly 45:00/90:00, mode ordering, snapping, deadline pressure, linear finish, invalid budgets, physics dt untouched |
| Unit — physics | acceleration, braking, collisions, rolling, bounce, crossbar, post, nets, 10-min stability, determinism |
| Unit — rules | goal/own goal/wide, kick-in, corner, goal clearance, fouls, accumulated fouls, penalty kick, yellow→red, replacement, substitutions, indirect-kick goal disallowed, **advantage played / lost / not applied**, **wall formed physically before the kick**, no wall for accumulated fouls |
| Unit — AI | no built-in coach (a team without a model keeps the default tactics); failed/invalid/stale/hanging model answers keep the current tactics; validator rejects bad ids/enums/numbers/duplicates/subs/non-objects; no code execution |
| Unit — xG | probability range, monotonic in distance, provenance recorded |
| Integration — providers | request/response formats ×3, JSON extraction, retry, timeout, discovery, cost (mocked HTTP); **prompt-cache breakpoint and cache-usage parsing for every provider, no invented cached-token discounts, static cacheable prompt prefix**; LlmAgent dedup/cache/failure |
| Integration — orchestration | invalid/hanging/stale agents, fallback logging, cost/token tracking |
| Simulation | full 90:00 for each of the six durations **with real time within −15 %/+5 % of the selection for every duration**, **no restart deadlock (longest dead-ball phase < 20 s)**, natural speed/no-teleport limits, 6-min stability, determinism, stats invariants, snapshot integrity |
| Shootout | real-physics goal/save/miss, alternation, early end, sudden death, safety fallback, eligibility/no repeat, separate stats, agent failure fallback, automatic shootout after a draw, **statistical realism over 160 attempts (goals 40–85 %, saves > 10 %, real misses/woodwork)** |
| Server (×2 databases) | crypto, auth, rate limit, BYOK encryption/isolation, LLM-team flow with mocked provider, full match persistence & history, **persisted analytics (pass network totals equal completed passes)**, cascade delete, drawn-match shootout persistence + per-attempt replay, WebSocket stream & auth, tournaments, benchmarks, **CSRF, cross-origin rejection, password change + session revocation + audit, revoke-all, backup/restore (SQLite), schema migration** |
| E2E (real Chromium) | register through the UI → exactly six durations → find drawn and decisive matches → decisive results (no shootout tab, 90:00, fitted-xG label) → tactical charts (momentum, possession, passing network, average formation) → drawn match shootout results + 3D attempt replay → 3D replay → **real-time live match: virtual clock advances, 3D canvas, four camera modes, automatic transition to the shootout screen, results page** → password change with the CSRF cookie session → **no horizontal scrolling on 12 pages at 375/390/430/768/1280/1920 px** → no console/page errors |

## Latest results (this build)
- Simulation: 99 tests passed. Server: 49 tests passed (24 on SQLite, 24 on PostgreSQL, 1 migration).
- Typecheck (3 workspaces) clean · ESLint clean · production build OK · `npm audit`: 0 vulnerabilities.
- Browser e2e: 30/30 checks.

## Bugs the verification found (and that are fixed)
- A restart taker and an opponent walking head-on froze a kick-in for 100 s (only the running clock ended the match). Fix: opponent side-stepping + a deadlock regression assertion in every full-match test.
- The clock tail decayed asymptotically and never reached 90:00 on time (1-minute matches overran by up to 26 %). Fix: deadline pressure + finishing rate.
- Goalkeeper restarts could stall for ~11 s because the approach distance exceeded the readiness distance.
- The new CSRF Origin check rejected valid requests that came through the dev proxy (found by the browser run). Fix: honour `X-Forwarded-Host`, forwarded by the dev proxy.

## Not tested
Live provider APIs (no credentials); a real GPU / mobile device (screenshots use software WebGL); load testing; long-running multi-day soak.
