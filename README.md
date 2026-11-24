# AI Futsal Arena

Pick two coaches, press **Kick off**, and watch them play a physics-simulated 5v5 futsal match in 3D. Each coach is a model: Claude Code, Codex (GPT) or any OpenRouter model. There is no built-in tactical AI, so every tactical decision comes from the models. A 90-minute virtual match is compressed into 1–6 real minutes, and a draw goes to a penalty shootout. It is a single page: no login, no landing page, no database.

> Custom 90-minute virtual format in a futsal environment, not a standard FIFA futsal match. See `docs/FUTSAL_RULES.md`.

## Quick start (Node ≥ 22.5)
```bash
npm install
npm run dev        # API + simulation on :8787 and the web UI on :5173
```
Open http://localhost:5173.

* **Claude Code** and **Codex** use the CLIs installed and signed in on your machine (`claude`, `codex`). The picker shows what each CLI offers.
* **OpenRouter** needs a key: paste it under Settings. It is stored only in your browser and sent with the match request.
* There is no offline or built-in coach: both sides need a working model. If a model fails to answer, its team simply keeps its current tactics and the Thoughts feed says why.

Production: `npm run build`, then serve `apps/web/dist` behind a reverse proxy that forwards `/api` and `/ws` and preserves `Host` (or sets `X-Forwarded-Host`).

## How it works
The model is a **coach**, not a puppeteer: it only chooses tactics (formation, pressing, width, style, player instructions) every few virtual minutes and on events. A deterministic engine turns those tactics into movement, passing, tackling and shooting on a fixed 1/60 s physics step (Rapier), so slow or failing models never stall the match. Details and measured behaviour: `docs/SIMULATION_ENGINE.md`.

## Using it
* Camera: broadcast, tactical, follow ball, goal. Pause, resume and end the match any time.
* **D** key (or the `dbg` button) toggles the simulation debug overlay: ball owner, possession, speeds, actions, best pass options, collisions, step time.
* Penalty results are revealed only after the kick has played out.

## Scripts
`npm run verify` (typecheck + lint + tests + build) · `npm test` · `npm run e2e` (real-browser end-to-end; needs `npx playwright install chromium` once) · `npx tsx scripts/audit.ts 4 3` (football behaviour audit over whole matches).

## Layout
`packages/shared` (types) · `packages/sim` (physics, match engine, agents, rules, shootout) · `apps/server` (Fastify + WebSocket, provider/CLI plumbing) · `apps/web` (Vite + React + react-three-fiber).

## Docs
`docs/SIMULATION_ENGINE.md` (engine, passing, possession, measured numbers, limitations) · `AI_PROVIDER_INTEGRATION` · `FUTSAL_RULES` · `PHYSICS_SPECIFICATION` · `TESTING_STRATEGY` · `IMPLEMENTATION_STATUS`. Some older docs describe the earlier multi-page version (accounts, database); the notes at the top of each say so.
