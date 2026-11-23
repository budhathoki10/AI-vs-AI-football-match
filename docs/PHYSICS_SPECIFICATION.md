# Physics specification

**Engine:** Rapier 3D (`@dimforge/rapier3d-compat`, WASM). Chosen for stability, CCD for the fast ball, fixed-step support, determinism, and because it runs identically in Node and the browser. Fixed timestep `1/60 s`, never altered by the clock.

| Item | Value |
|---|---|
| Court | 40 × 20 m (FIFA futsal international range 38–42 × 20–25; width at the lower bound), goals 3 × 2 m, penalty mark 6 m, second mark 10 m |
| Ball | r 0.10 m, 0.43 kg, restitution 0.55 (floor combine avg 0.6), friction 0.5, damping 0.08, rolling resistance 0.9 m/s² when on the floor, CCD on, max 30 m/s |
| Players | cylinder r 0.30 m, h 1.7 m, 75 kg, rotations locked (heading is a separate turn-rate-limited state), GK r 0.45 m h 1.9 m (arm span) |
| Movement | impulse = m·a·dt with `a` capped by attribute-derived limits (3.6–7.2 m/s², braking ×1.5), top speed 4.6–7.2 m/s scaled by stamina |
| Goal frame | posts/crossbar as colliders (reported as woodwork), nets as zero-restitution colliders; side/back/top nets 1 m deep |
| Arena | floor, ceiling at 7 m, invisible containment walls 3 m outside the lines |

## Prohibited shortcuts — how they are avoided
No teleporting during play (ball/players are only *placed* by the rules engine at restarts/substitutions/set-up). Passes and shots are impulses on the ball; saves are keeper-collider contacts; goals are ball-centre crossings of the goal line within the posts validated by the rules engine; indirect restarts disallow direct goals.

## Tests (packages/sim/test/physics.test.ts, match.test.ts)
Gradual acceleration, deceleration, collisions with no overlap, rolling to rest, bounce energy loss, crossbar and post contact, net containment, 10-minute stability, determinism, and over a full 3-minute match: max speed < 8.5 m/s, no per-step displacement > 0.16 m, free-running acceleration < 45 m/s², ball ≤ 30 m/s.

## Known simplifications
Ball spin/Magnus effect is not modelled; the net is a set of static colliders (no deformation); player–ball foot contact is a cylinder contact plus an explicit "kick" impulse within 0.62 m reach.
