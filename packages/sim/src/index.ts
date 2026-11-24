import { Match } from './match';
import { runShootout } from './shootout';
import type { MatchConfig, TeamId } from './types';
import type { TeamAgent } from './agents';

export * from './types';
export * from './config';
export * from './clock';
export * from './rng';
export * from './tactics';
export * from './agents';
export * from './teams';
export * from './formations';
export * from './xg';
export { Match, playerRating } from './match';
export type { MatchResult, TeamStats, PlayerStats, AiDecisionRecord, RunControl } from './match';
export { runShootout, simulateAttempt } from './shootout';
export type { ShootoutResult, PenaltyAttempt, ReplayFrame, PenaltyResult } from './shootout';
export { PhysicsWorld, initPhysics } from './physics';
export * from './providers';

/** Regulation (compressed 90:00) followed by an automatic shootout if level and `shootoutOnDraw`. */
export async function playMatch(cfg: MatchConfig, agents?: Partial<Record<TeamId, TeamAgent>>, opts?: { realtime?: boolean; onStep?: (m: Match) => void }) {
  const m = await Match.create(cfg, agents);
  await m.runRegulation({ realtime: opts?.realtime, onStep: opts?.onStep });
  if (m.score[0] === m.score[1] && cfg.shootoutOnDraw) await runShootout(m);
  else m.phase = 'finished';
  return m;
}
