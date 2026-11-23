# Simulation engine

`Match` (packages/sim/src/match.ts) advances one fixed physics step (`dt = 1/60 s`) per `step()`.

## Step order
decision tick (every 6 ticks per player, staggered) → plan execution (kick/pass/shoot/tackle/dribble) → steering (acceleration-limited impulses) → `physics.step()` → touches from contact events → shot/save bookkeeping → stamina/stats → rules (goal, out-of-play, fouls, GK 4-second rule) → clock → snapshot (5 Hz) → AI scheduling → phase check.

## Adaptive time compression (clock.ts)
The scheduler only decides how many **virtual** seconds one physics step is worth:
`rate(mode) = baseRate × weight(mode)` with weights `active 1`, `important 0.45` (shots in flight, ball near a goal), `inactive 6` (restarts, repositioning, goal/half-time pauses).
`baseRate = remainingVirtual / (0.96 × budget − elapsedPhysics) / E[weight]`, re-solved every step from an EMA of mode occupancy. Virtual time snaps exactly to 45:00 / 90:00.

**Honest consequence:** showing 5400 virtual seconds in `N` real minutes requires an average ≥ `90/N` virtual s per real s, so even active play is worth more than one virtual second per physics second. Movement, ball speed, forces and animation are *not* scaled. If dead time alone exceeds the budget (1–2 minutes), the match overruns slightly; `clock.report()` returns `overrunSeconds` and a note, displayed on the results page. Selected duration, actual real elapsed (physics seconds), and virtual duration are stored separately (`selected_real_duration_seconds`, `actual_real_elapsed_seconds`, `virtual_match_duration_seconds`).

Real elapsed is measured in physics seconds (equal to wall-clock when paced at 1×). Half-time (4 physics s) does not count against the budget.

## Player behaviour
Per-role formation anchors (`formations.ts`) shifted by ball location, phase, pressing, risk, style and per-player instruction. Carrier chooses shoot / pass / dribble / clear from lane-clearance, progress, pressure and attributes (`decisionMaking` adds noise). Passes lead the receiver and use bounded execution error from `passing`/`shooting`/`ballControl` and stamina via the seeded RNG (execution noise, not scripted outcomes). Tackles are contests (`tackling` vs `ballControl`) executed as a real touch. Goalkeepers position on the shot-angle bisector, read incoming trajectories, and dive with an acceleration-limited burst (≤ 32 m/s²).

## Attributes → behaviour
acceleration/maxSpeed/agility/stamina → steering limits and turn rate; passing/shooting/ballControl/dribbling → execution error; tackling/defensiveAwareness → contest and foul thresholds; decisionMaking → decision noise; positioning is expressed through anchors/reaction; goalkeeping → read/dive timing & accuracy.

## Statistics
Collected in-simulation only (shots classified from the ball's projected goal-line crossing at the kick; saves from real keeper contact; passes resolved by the next toucher; possession = team of last touch; distance = integrated velocity). `xG` is a documented heuristic (distance + goal-mouth angle), not a trained model. Rating formula: `6 + 1.0·G + 0.6·A + 0.1·SoT + 0.03·passOK − 0.03·passFail + 0.15·(tackles+interceptions) + 0.3·saves − 0.3·fouls − 0.8·yellow − 2.5·red`, clamped 3–10.

## Determinism
Seeded RNG; Rapier is deterministic for identical inputs on one machine. With algorithmic agents the same seed reproduces the same match (tested). LLM agents are non-deterministic, so replays use stored snapshots rather than re-simulation.
