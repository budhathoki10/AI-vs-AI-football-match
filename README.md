# AI Futsal Arena

Two independently configured AI team agents play a physics-simulated 5v5 futsal match. A full virtual **00:00 → 90:00** match is shown in a real-time duration you choose (**1–6 minutes**); level matches go to a real 1v1 penalty shootout.

> Custom 90-minute virtual format in a futsal environment — not a standard FIFA futsal match. See `docs/FUTSAL_RULES.md`.

## Quick start (Node ≥ 22.5)
```bash
npm install
npm run dev:server        # API + simulation on :8787  (dev credential key is generated in data/, git-ignored)
npm run dev:web           # UI on :5173 (proxies /api and /ws)
```
Open http://localhost:5173, create an account, then **New match**. Production: `npm run build`, serve `apps/web/dist`, run the server with `NODE_ENV=production CREDENTIAL_KEY=<64 hex chars> DATABASE_PATH=... WEB_ORIGIN=...`.

LLM agents need a provider key (Providers page). Without one, all seven decision architectures except "LLM team agent" work offline.

## Scripts
`npm test` · `npm run typecheck` · `npm run lint` · `npm run build` — see `docs/TESTING_STRATEGY.md`.

## Docs
`docs/IMPLEMENTATION_STATUS.md` (what is done, tested, partial, pending) · `SYSTEM_ARCHITECTURE` · `SIMULATION_ENGINE` · `PHYSICS_SPECIFICATION` · `FUTSAL_RULES` · `AI_ARCHITECTURE` · `AI_PROVIDER_INTEGRATION` · `DATABASE_SCHEMA` · `API_SPECIFICATION` · `DESIGN_SYSTEM` · `SECURITY` · `TESTING_STRATEGY` · `PROJECT_REQUIREMENTS`.
