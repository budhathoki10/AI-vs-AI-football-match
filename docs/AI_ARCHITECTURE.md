# AI architecture

One `TeamAgent` per team (never per player, never per physics frame). All architectures share `decide(CompactState, TeamConfig) → TeamTactics` so comparisons are fair.

## Tactics schema (`TeamTactics`, validated by `validateTactics`)
`formation` (2-2|1-2-1|3-1|4-0), `teamStrategy`, `attackingStyle`, `defensiveStyle`, `pressingIntensity` 0..1, `riskLevel` 0..1, `flyingGoalkeeper`, `playerInstructions[{playerId, instruction}]` (9 supported instructions), `substitutions[{out,in}]` (≤3), `reasonSummary` (≤280 chars; no chain-of-thought stored). Invalid ids, unsupported enums, out-of-range/NaN numbers, duplicates and illegal substitutions are rejected; unknown fields are dropped; nothing is ever executed as code.

## Architectures (all working, tested for validity and situational behaviour)
`rule`, `fsm` (BUILD/ATTACK/DEFEND/DESPERATE/PROTECT), `behavior_tree` (selector/sequence/condition/action), `utility` (scored candidates), `goap` (A* over actions with preconditions/effects), `hybrid` (utility + rule guard rails in critical situations), `llm` (provider call; falls back to `hybrid`).

## Scheduling
`scheduleAgents()` every 0.5 physics s: decision on an interval (240 s virtual; LLM 300 s), on triggers (goal, red card, half-time, 75'/85') subject to cooldown (60 s; LLM 120 s). Async agents never block: the match keeps using the cached tactics. Responses are **rejected as stale** if the match state version changed (goal / red card) or > 15 virtual minutes passed. Invalid or failed responses use the deterministic hybrid fallback and are logged with the rejection reason (`AiDecisionRecord`). Every decision stores virtual time, trigger, compact state, tactics, objective, acceptance, tokens, latency, cost, and a computed outcome (goal difference over the next 5 virtual minutes).

## Cost control
Compact JSON state (positions rounded, no history), per-trigger cooldowns, duplicate in-flight request prevention and a response cache keyed by (team, minute, score, possession, trigger), `max_tokens` 500, per-team token/latency/retry/failure/cost tracking, benchmarks with LLMs limited to 10 matches. Prompt caching is **not** implemented (provider-specific); cost is `null` ("unknown") unless pricing is known.

## Penalty shootout decisions
`decidePenalty(ctx)`: shoot role picks the taker (from eligible, un-used players), side/height/power; defend role picks dive direction and reaction delay. The result is *not* decided by dice: the taker's strike (with execution error from `shooting`) and the keeper's acceleration-limited dive are simulated in Rapier. Agents without custom logic use the documented default policy (best remaining shooter, low corner, varying sides; keeper commits to a side as the ball is struck). Failing/invalid agent output uses the same default and is flagged `usedFallback`.
