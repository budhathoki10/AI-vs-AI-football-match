/** Court, physics and match constants. Court: x = length, z = width, y = up. Units: metres, seconds, kg. */
export const COURT = {
  length: 40, // FIFA futsal international range: 38–42 m
  width: 20, // 20–25 m (documented adaptation: 20 m)
  halfL: 20,
  halfW: 10,
  goalWidth: 3,
  goalHeight: 2,
  goalDepth: 1,
  postRadius: 0.04,
  penaltyAreaRadius: 6,
  penaltyMark: 6,
  secondPenaltyMark: 10,
  cornerArc: 0.25,
  ceiling: 7,
  margin: 3, // invisible containment walls around court
} as const;

export const PHYS = {
  dt: 1 / 60, // fixed physics timestep (never changed by time compression)
  ballRadius: 0.1,
  ballMass: 0.43,
  ballRestitution: 0.55,
  ballFriction: 0.5,
  ballLinearDamping: 0.08,
  ballAngularDamping: 0.6,
  rollingDecel: 0.9, // m/s^2 rolling resistance when on the floor
  playerRadius: 0.3,
  playerHeight: 1.7,
  playerMass: 75,
  kickReach: 0.62, // player centre -> ball centre distance within which a kick/touch is possible
  gravity: -9.81,
  maxBallSpeed: 30,
} as const;

export const MATCH = {
  virtualMatchSeconds: 5400,
  halfSeconds: 2700,
  allowedRealDurationsMin: [1, 2, 3, 4, 5, 6] as const,
  halftimePhysicsSeconds: 4,
  decisionEveryTicks: 6,
  foulsBeforePenaltyFK: 5, // 6th and later accumulated foul in a half -> direct FK without wall
  dismissalVirtualSeconds: 120,
  gkHoldLimitSeconds: 4, // four-second rule (physics seconds)
  restartTimeoutSeconds: 4, // 4-second restart rule (physics seconds, then taker is forced)
  snapshotEveryTicks: 12, // 5 Hz replay snapshots
  squadSize: 8,
} as const;

export const SHOOTOUT = {
  regularRounds: 5,
  suddenDeathMaxRounds: 20, // configurable safety limit
  attemptMaxSeconds: 6,
} as const;
