# Simulation engine

Package `@futsal/sim` (`packages/sim`). Everything here is deterministic for a given seed and runs on a **fixed 1/60 s physics timestep**, independent of the virtual-clock speed.

## Layers (who decides what)

| Layer | Runs | Decides |
|---|---|---|
| Team agent (Claude Code / Codex / OpenRouter model) | every few virtual minutes and on events (goal, red card, half-time) | **Tactics only**: formation, press, width, style, per-player instructions. Never positions, never frame-by-frame control. |
| Team planner (`planTeam`, `match.ts`) | every decision interval (~0.2 s) | who presses, who covers, who marks whom, where each supporter stands |
| Carrier decision (`decideCarrier`, `play.ts`) | when the owner has the ball | shoot / pass (ranked options) / dribble / clear |
| Steering (`steer`) | every tick | acceleration-limited movement toward the target, turning, avoidance |
| Rapier physics | every tick | all motion, collisions, ball flight |

A slow model never blocks the simulation: its answer is applied when it arrives and discarded if stale (goal/red card since, or more than 120 s of real time).

## Ball and possession

* One state variable, `Match.owner`: the player who controls the ball, or `null` while it is loose or in flight. `possessionTeam()` is the owner's team, else the last toucher's team.
* A player gets control by *trapping* the ball (`tryControl`): success depends on ball control, the ball's speed relative to him, nearby pressure, tiredness and whether it was an intended pass. A failed trap is a heavy touch that sends the ball away. Hard shots are left to the physics.
* The owner keeps the ball only while it stays within 1.6 m of him; dribbling is a series of touches, not attachment. Tackles, passes, shots and long distance all release it.
* Passes leave at the speed that makes them arrive at a controllable 3.4 m/s (4.6 m/s under pressure) (`ballSpeedFor`), they stay on the floor, and the ball is never moved by anything other than Rapier after the kick.

## Passing (`play.ts`, pure functions, unit-tested)

For each teammate two targets are considered (feet, and space ahead of his run). A candidate is rejected if the receiver cannot get there in time or an opponent is likely to reach the lane first (arrival-time model, an opponent standing on the path or within tackle range of the passer counts as certain interception). The rest are scored by forward gain, shot threat at the receiver (fitted xG model), space around the receiver, safety, tactical style, and penalties for tiny passes, passes towards the touchline or the keeper, and returning the ball to the player who just passed it. Kinds: short, long, through, quick, space, back, pressure. Only teammates are ever candidates. The receiver moves to meet the ball at the first point on its path he can reach before it.

## Movement

Players are dynamic bodies driven by acceleration-limited steering (max speed and acceleration from attributes, stamina and fatigue). Heading turns at a limited rate toward the direction of movement. States: `idle, walk, run, sprint, turn, dribble, defend`, with timed action states on top (`pass, shoot, kick, receive, miscontrol, tackle, dive`). Teammates repel each other; players sidestep anyone in their way, so head-on standoffs resolve.

## Teamwork

* **Attacking**: pivot high and central, wingers wide, remaining players give a diagonal option behind the ball; supporters keep at least 3.4 m from each other and from the carrier and step out of a defender's shadow.
* **Defending**: the player who can reach the ball/carrier first presses (arriving goal-side), the second covers between ball and goal, the others mark the nearest unmarked attacker goal-side, blended with the zone position according to the defensive style. Tackles are contests (tackling skill vs control/dribbling, facing, closing speed) with a cooldown.
* Restarts (kick-in, corner, free kick, goal clearance, kick-off, penalty) are handled by the rules engine and are not instant.

## Goalkeepers and shots

Keepers position on the shot line, dive with a reaction delay and reach limited by attributes, hold or parry (rebounds are live) and distribute with a pass or a throw. Shots have an xG estimate, error depending on shooting skill and pressure, and are classified on target / off target from the real ball trajectory.

## Measured behaviour

`npx tsx scripts/audit.ts 4 3` plays four 3-minute matches (two stand-in coaches that keep the default tactics). Before and after the football rebuild:

| | before | after |
|---|---|---|
| Pass completion | 30.9 % | 60.9 % |
| Tackles per match | ~1 | 20.0 |
| Toucher/owner more than 2.5 m from the ball | not measurable (no owner) | 0.0 % |
| Player overlaps (< 0.5 m) | 0.0 % | 0.0 % |
| 3+ teammates crowding the ball | see audit | 4.3 % |
| Ball-out restarts per 3-min match | 25 | 14 |
| Ping-pong passes (A>B>A>B in <4 s) | measured at start | 3.4 % |
| Live play share of ticks | 69 % | 73 % |
| Ball teleports | 0 | 0 |
| Direction reversals / hard accelerations | low | 0.0 % / 0.3 % |

## Known limitations

* Pass completion is 60.9 % (live play about 52–70 % between runs, small samples), still below real futsal. Kick-ins (38–67 % completed between runs) and corners are the weakest: defenders are only 5 m away and there are no designed set plays. `npx tsx scripts/audit-restarts.ts` prints completion by situation.
* On a dead-ball kick the ball may be nudged up to 0.45 m so the foot clears the taker's body. Without it the ball was driven into the taker's own legs and most restart passes were lost.
* Hand-tuned constants (trap probabilities, tackle odds, intercept margins) are plausible, not fitted to real data.
* Animation is procedural (no motion-capture clips); poses follow the simulated state but are stylised.

## Debugging

Press **D** (or the `dbg` button under the pitch) to show tick and step time, the ball owner and possession, ball speed, collisions, the best pass option of each team, and every player's action and speed; a ring marks the owner on the pitch. `scripts/audit.ts` and `scripts/audit-pass2.ts` report aggregate behaviour. Scenario tests are in `packages/sim/test/football.test.ts`.

## Rendering contract

The server streams state at ~20 Hz (paced mode). The browser keeps a short buffer of samples per entity and draws the scene ~90 ms behind the newest sample, interpolating between two real samples (`apps/web/src/scene/track.ts`). Positions are never extrapolated or chased, so what is drawn is what the simulation computed.
