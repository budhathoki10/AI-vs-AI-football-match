/**
 * Expected-goals (xG) model: a logistic regression on two shot features measured when the ball is struck —
 * the distance to the centre of the goal (m) and the angle the goal mouth subtends at the ball (rad).
 * The coefficients are fitted from simulated shots by `npm run fit-xg` (scripts/fit-xg.ts) and committed here together with
 * the size of the training set, so the figure is a measured shot-quality estimate and not a guess (see docs/SIMULATION_ENGINE.md).
 */
export interface XgModel { intercept: number; distance: number; angle: number }

export const XG_MODEL = {
  intercept: -1.8335,
  distance: -0.0805,
  angle: 0.0000,
  trainedOn: { matches: 80, shots: 1177, goals: 85, note: 'logistic regression (IRLS) on simulated shots, 5-6 min matches, seeds 5000+17i' },
} as const;

/** Angle (rad) subtended by the goal mouth at (dx, z): dx = metres from the goal line, z = lateral offset from the goal centre. */
export function goalMouthAngle(dx: number, z: number, goalWidth: number): number {
  const x = Math.max(dx, 0.3);
  return Math.abs(Math.atan2(z + goalWidth / 2, x) - Math.atan2(z - goalWidth / 2, x));
}

export function xgOf(dx: number, z: number, goalWidth: number, model: XgModel = XG_MODEL): number {
  const d = Math.hypot(dx, z); const a = goalMouthAngle(dx, z, goalWidth);
  return 1 / (1 + Math.exp(-(model.intercept + model.distance * d + model.angle * a)));
}
