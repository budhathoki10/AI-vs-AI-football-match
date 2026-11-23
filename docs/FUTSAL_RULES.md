# Futsal rules engine

Reference: FIFA Futsal Laws of the Game. **This is a custom 90-minute virtual match format presented in a futsal environment — not a standard regulation-length futsal match** (real futsal is 2×20 min stopped time).

## Implemented (deterministic, tested in `rules.test.ts`)
- Kick-off (also after goals and at the second half; other team after a goal / second half starts with the opposite team)
- Goals (ball fully inside goal line between posts and under the bar), own goals credited to the opponent
- **Kick-ins** (not throw-ins) for the opponent of the last toucher; **indirect** (no direct goal)
- **Goal clearance** when the attackers last touch the ball over the goal line (GK distributes; modelled as a pass/kick; indirect)
- **Corner kicks** when the defenders last touch it over their goal line
- Direct free kicks from fouls (physics-detected: closing speed on the ball carrier from a defender who did not play the ball first)
- **Penalty kick** (regulation) for fouls inside the penalty area; **separate** from the post-match shootout
- Accumulated fouls per half: from the 6th foul the free kick is direct with no wall; if committed between the penalty-area edge and the second penalty mark it is taken from the **second penalty mark**
- Yellow/red cards (second yellow = red); dismissed player removed; team plays one short for 2 virtual minutes (or until it concedes) and then a replacement enters
- Substitutions (queued by the agent, executed at stoppages; invalid ids rejected); stamina-based auto-suggestions
- Goalkeeper **four-second** rule (holding the ball in the area > 4 s ⇒ indirect free kick)
- Restart positioning (5 m for the defending side; penalty-kick encroachment)
- Flying goalkeeper (agent flag): the keeper plays as an outfield player, leaving the goal empty
- Ball out of play, restart timeouts (taker forced after a timeout)

## Not implemented / simplified (honest list)
- Advantage is **not** implemented (play stops at every foul)
- No defensive wall modelling; only distance clearance
- Four-second restart rule is a timeout, not a yellow-card sanction
- Goalkeeper throws are kicks/passes; GK "catching" is a controlled trap, no hand animation
- Second penalty mark rule uses an approximation of the Law's wording
- No time-outs, no referee decision latency, no injuries
- Fouls are generated only from physical contact (no handball, no obstruction)

## Shootout (spec §5) — see AI_ARCHITECTURE.md and SIMULATION_ENGINE.md
Five alternating rounds, early termination when unassailable (attempts-left aware), sudden death in same-round pairs, configurable safety limit (20 rounds) with a documented deterministic fallback (aggregate squad skill, then a seeded coin recorded in the result). Dismissed players are excluded; squads equalised to the smaller eligible set; no repeat taker until all eligible have kicked. Shootout statistics are stored separately and never added to regulation statistics.
