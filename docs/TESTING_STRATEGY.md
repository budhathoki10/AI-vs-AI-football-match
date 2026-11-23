# Testing strategy and results

Run: `npm test` (sim + server), `npm run typecheck`, `npm run lint`, `npm run build`. Browser flow: start server (`npm run dev:server`) and web (`npm run dev:web`) then `NODE_PATH=$(npm root -g) node e2e/flow.cjs <outDir>` (uses the environment's Playwright; not part of `npm test`).

| Layer | Coverage (all executed) |
|---|---|
| Unit — clock | six durations reach exactly 45:00/90:00, mode ordering, snapping, overrun reporting, invalid budgets, physics dt untouched |
| Unit — physics | acceleration, braking, collisions, rolling, bounce, crossbar, post, nets, 10-min stability, determinism |
| Unit — rules | goal/own goal/wide, kick-in, corner, goal clearance, fouls, accumulated fouls, penalty kick, yellow→red, replacement, substitutions, indirect-kick goal disallowed |
| Unit — AI | all 6 algorithmic architectures valid & situational; GOAP planner; validator rejects bad ids/enums/numbers/duplicates/subs/non-objects; no code execution |
| Integration — providers | request/response formats ×3, JSON extraction, retry, timeout, discovery, cost (mocked HTTP), LlmAgent dedup/cache/failure |
| Integration — orchestration | invalid/hanging/stale agents, fallback logging, cost/token tracking |
| Simulation | full 90:00 for each of the six durations, natural speed/no-teleport limits, 6-min stability, determinism, stats invariants, snapshot integrity |
| Shootout | real-physics goal/save/miss, alternation, early end, sudden death, safety fallback, eligibility/no repeat, separate stats, agent failure fallback, automatic shootout after a draw |
| Server | crypto, auth, rate limit, BYOK encryption/isolation, LLM-team flow with mocked provider, full match persistence & history, cascade delete, drawn-match shootout persistence + per-attempt replay, WebSocket stream & auth, tournaments (round robin, knockout with byes, best-of-three), benchmarks |
| E2E (manual script) | register → create → live → results → tabs → shootout replay → match replay → history → mobile layout; plus a paced live match through the shootout screen |

**Not tested:** live provider APIs (no credentials); advantage/wall/handball rules (not implemented); pixel-level 3D correctness beyond screenshots; load testing; real mobile devices.
