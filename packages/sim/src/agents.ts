import type { Architecture, TeamConfig, TeamId, TeamTactics } from './types';
import { defaultTactics } from './tactics';

/** Compact structured match state sent to every decision architecture (and to LLMs). Intentionally small. */
export interface CompactState {
  team: TeamId; trigger: string; vt: number; minute: number; half: 1 | 2; minutesLeft: number;
  scoreOwn: number; scoreOpp: number; possession: 'own' | 'opp' | 'none';
  ballU: number; ballV: number; // team frame
  possessionPct: number; shotsOwn: number; shotsOpp: number; onTargetOwn: number; onTargetOpp: number;
  foulsOwnHalf: number; redOwn: number; redOpp: number; avgStamina: number;
  onCourt: { id: string; role: string; u: number; v: number; stamina: number; yellow: boolean }[];
  bench: { id: string; role: string; stamina: number }[];
  opponent: { u: number; v: number }[];
  current: TeamTactics;
}

export interface DecisionMeta { source: string; latencyMs?: number; tokensIn?: number; tokensOut?: number; /** part of tokensIn served from the provider's prompt cache */ tokensCached?: number; costUsd?: number | null; retries?: number; error?: string }
export interface AgentDecision { tactics: unknown; meta: DecisionMeta }
export interface TeamAgent {
  readonly architecture: Architecture;
  /** Minimum virtual seconds between decisions (cost / cadence control). */
  readonly cooldownVirtual: number;
  readonly intervalVirtual: number;
  decide(state: CompactState, team: TeamConfig): AgentDecision | Promise<AgentDecision>;
  decidePenalty?(ctx: PenaltyContext): PenaltyDecision | Promise<PenaltyDecision>;
}

export interface PenaltyContext {
  role: 'shoot' | 'defend'; round: number; suddenDeath: boolean; ownScore: number; oppScore: number;
  history: { team: TeamId; takerId: string; result: string; side: number }[];
  eligible: { id: string; shooting: number; role: string }[]; // shoot role
  keepers: { id: string; goalkeeping: number }[];
}
export interface PenaltyDecision {
  takerId?: string; side?: number; height?: number; power?: number; // shoot: side -1..1 (negative = left from taker view), height 0..1, power 0..1
  dive?: -1 | 0 | 1; reactDelay?: number; // defend
  reason: string;
}

/**
 * The coach used when no model is attached (unit tests, scripts). It never decides anything: the team keeps the neutral default tactics.
 * There is deliberately no built-in tactical AI: in the app every tactical decision comes from a Claude, Codex or OpenRouter model.
 */
export class HoldAgent implements TeamAgent {
  readonly architecture: Architecture = 'none'; readonly cooldownVirtual = 1e9; readonly intervalVirtual = 1e9;
  decide(s: CompactState): AgentDecision { return { tactics: { ...s.current, reasonSummary: 'No model attached: keeping the default tactics.' }, meta: { source: 'none' } }; }
}

/** Neutral penalty choice, used only when a model fails to answer a shootout kick in time (so a shootout can never hang). */
export function fallbackPenaltyDecision(ctx: PenaltyContext, rngVal: number): PenaltyDecision {
  if (ctx.role === 'shoot') {
    const used = new Set(ctx.history.filter((h) => ctx.eligible.some((e) => e.id === h.takerId)).map((h) => h.takerId));
    const pool = ctx.eligible.filter((e) => !used.has(e.id));
    const list = (pool.length ? pool : ctx.eligible).slice().sort((a, b) => b.shooting - a.shooting);
    const lastSides = ctx.history.filter((h) => h.result !== 'goal').slice(-1);
    const side = (rngVal < 0.5 ? -1 : 1) * 0.75 * (lastSides.length && lastSides[0].side * (rngVal < 0.5 ? -1 : 1) > 0 ? -1 : 1);
    return { takerId: list[0]?.id, side, height: 0.25, power: ctx.suddenDeath ? 0.8 : 0.85, reason: 'No answer from the model: best remaining shooter, low corner, varied side.' };
  }
  return { dive: rngVal < 0.4 ? -1 : rngVal < 0.8 ? 1 : 0, reactDelay: 0.05, reason: 'No answer from the model: commit to a side as the ball is struck.' };
}

export { defaultTactics };
