import type { Architecture, Formation, TeamConfig, TeamId, TeamTactics, Instruction, TeamStrategy, PlayerConfig } from './types';
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

export interface DecisionMeta { source: string; latencyMs?: number; tokensIn?: number; tokensOut?: number; costUsd?: number | null; retries?: number; error?: string }
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

const instr = (team: TeamConfig, strategy: TeamStrategy, onCourt: PlayerConfig[]): TeamTactics['playerInstructions'] => {
  const out: TeamTactics['playerInstructions'] = [];
  for (const p of onCourt) {
    if (p.role === 'GK') continue;
    let i: Instruction = 'hold_position';
    const att = strategy === 'attacking' || strategy === 'all_out_attack';
    if (strategy === 'all_out_attack') i = 'make_forward_run';
    else if (strategy === 'park_the_bus') i = 'drop_deep';
    else if (strategy === 'counter') i = p.role === 'PIVOT' ? 'make_forward_run' : 'drop_deep';
    else if (p.role === 'PIVOT') i = att ? 'pivot_hold_up' : 'support_build_up';
    else if (p.role === 'ALA') i = att ? 'stay_wide' : 'support_build_up';
    else if (p.role === 'FIXO') i = att ? 'support_build_up' : 'protect_central_area';
    else i = 'support_build_up';
    out.push({ playerId: p.id, instruction: i });
  }
  return out;
};

interface Mix { strategy: TeamStrategy; press: number; risk: number; att?: TeamTactics['attackingStyle']; def?: TeamTactics['defensiveStyle']; fly?: boolean; formation?: Formation; why: string }
function build(s: CompactState, team: TeamConfig, m: Mix): TeamTactics {
  const base = s.current;
  const ids = s.onCourt.map((p) => team.players.find((q) => q.id === p.id)!);
  return {
    formation: m.formation ?? base.formation, teamStrategy: m.strategy,
    attackingStyle: m.att ?? base.attackingStyle, defensiveStyle: m.def ?? base.defensiveStyle,
    pressingIntensity: Math.max(0, Math.min(1, m.press)), riskLevel: Math.max(0, Math.min(1, m.risk)),
    flyingGoalkeeper: !!m.fly, playerInstructions: instr(team, m.strategy, ids), substitutions: autoSubs(s), reasonSummary: m.why,
  };
}
/** Stamina-based substitutions shared by all architectures (same tactical interface => fair comparison). */
function autoSubs(s: CompactState): TeamTactics['substitutions'] {
  const tired = s.onCourt.filter((p) => p.role !== 'GK' && p.stamina < 0.4).sort((a, b) => a.stamina - b.stamina)[0];
  const fresh = s.bench.filter((b) => b.role !== 'GK' && b.stamina > 0.7).sort((a, b) => b.stamina - a.stamina)[0];
  return tired && fresh ? [{ out: tired.id, in: fresh.id }] : [];
}

const late = (s: CompactState) => s.minute >= 70;
const diff = (s: CompactState) => s.scoreOwn - s.scoreOpp;
const BAL: Mix = { strategy: 'balanced', press: 0.5, risk: 0.5, why: 'Balanced approach.' };

// ---------- 1. Rule based ----------
class RuleAgent implements TeamAgent {
  architecture: Architecture = 'rule'; cooldownVirtual = 60; intervalVirtual = 240;
  decide(s: CompactState, team: TeamConfig): AgentDecision {
    let m: Mix = { ...BAL, press: s.current.pressingIntensity, risk: s.current.riskLevel };
    if (diff(s) < 0 && late(s)) m = { strategy: 'all_out_attack', press: 0.9, risk: 0.9, fly: s.minutesLeft <= 6 && diff(s) < 0, why: 'Trailing late: commit forward.' };
    else if (diff(s) < 0) m = { strategy: 'attacking', press: 0.7, risk: 0.65, why: 'Trailing: raise tempo and pressing.' };
    else if (diff(s) > 0 && late(s)) m = { strategy: 'park_the_bus', press: 0.2, risk: 0.2, def: 'low_block', why: 'Leading late: protect the lead.' };
    else if (diff(s) > 0) m = { strategy: 'counter', press: 0.4, risk: 0.35, att: 'counter', why: 'Leading: counter with a mid block.' };
    return { tactics: build(s, team, m), meta: { source: 'rule' } };
  }
}

// ---------- 2. Finite state machine ----------
type FsmState = 'BUILD' | 'ATTACK' | 'DEFEND' | 'DESPERATE' | 'PROTECT';
class FsmAgent implements TeamAgent {
  architecture: Architecture = 'fsm'; cooldownVirtual = 60; intervalVirtual = 240;
  private st: FsmState = 'BUILD';
  private next(s: CompactState): FsmState {
    const d = diff(s);
    switch (this.st) {
      case 'BUILD': return d < 0 && late(s) ? 'DESPERATE' : d > 0 && late(s) ? 'PROTECT' : s.possession === 'own' && s.ballU > 4 ? 'ATTACK' : s.possession === 'opp' && s.ballU < -4 ? 'DEFEND' : 'BUILD';
      case 'ATTACK': return d < 0 && late(s) ? 'DESPERATE' : d > 0 && late(s) ? 'PROTECT' : s.possession !== 'own' ? 'BUILD' : 'ATTACK';
      case 'DEFEND': return d < 0 && late(s) ? 'DESPERATE' : d > 0 && late(s) ? 'PROTECT' : s.possession === 'own' ? 'BUILD' : 'DEFEND';
      case 'DESPERATE': return d >= 0 ? 'BUILD' : 'DESPERATE';
      case 'PROTECT': return d <= 0 ? 'BUILD' : 'PROTECT';
    }
  }
  decide(s: CompactState, team: TeamConfig): AgentDecision {
    this.st = this.next(s);
    const table: Record<FsmState, Mix> = {
      BUILD: { ...BAL, att: 'possession', why: 'FSM BUILD: patient possession.' },
      ATTACK: { strategy: 'attacking', press: 0.65, risk: 0.65, att: 'pivot_play', why: 'FSM ATTACK: feed the pivot, shoot early.' },
      DEFEND: { strategy: 'defensive', press: 0.35, risk: 0.3, def: 'mid_block', why: 'FSM DEFEND: compact mid block.' },
      DESPERATE: { strategy: 'all_out_attack', press: 0.9, risk: 0.95, fly: s.minutesLeft <= 5, why: 'FSM DESPERATE: everything forward.' },
      PROTECT: { strategy: 'park_the_bus', press: 0.15, risk: 0.15, def: 'low_block', why: 'FSM PROTECT: hold the lead.' },
    };
    return { tactics: build(s, team, table[this.st]), meta: { source: 'fsm' } };
  }
}

// ---------- 3. Behavior tree ----------
type BT = { run(s: CompactState): Mix | null };
const cond = (f: (s: CompactState) => boolean, child: BT): BT => ({ run: (s) => (f(s) ? child.run(s) : null) });
const act = (m: Mix | ((s: CompactState) => Mix)): BT => ({ run: (s) => (typeof m === 'function' ? m(s) : m) });
const selector = (...c: BT[]): BT => ({ run: (s) => { for (const x of c) { const r = x.run(s); if (r) return r; } return null; } });
class BehaviorTreeAgent implements TeamAgent {
  architecture: Architecture = 'behavior_tree'; cooldownVirtual = 60; intervalVirtual = 240;
  private tree = selector(
    cond((s) => diff(s) < 0 && late(s), act((s) => ({ strategy: 'all_out_attack', press: 0.88, risk: 0.9, fly: s.minutesLeft <= 5, why: 'BT: trailing late -> all out attack.' }))),
    cond((s) => diff(s) > 0 && late(s), act({ strategy: 'park_the_bus', press: 0.2, risk: 0.2, def: 'low_block', why: 'BT: leading late -> low block.' })),
    cond((s) => s.redOwn > s.redOpp, act({ strategy: 'defensive', press: 0.3, risk: 0.3, def: 'low_block', why: 'BT: a player down -> stay compact.' })),
    cond((s) => s.redOpp > s.redOwn, act({ strategy: 'attacking', press: 0.7, risk: 0.6, why: 'BT: extra player -> pressure.' })),
    cond((s) => s.avgStamina < 0.45, act({ strategy: 'balanced', press: 0.3, risk: 0.4, why: 'BT: tired legs -> lower pressing.' })),
    cond((s) => s.possession === 'opp' && s.ballU < -6, act({ strategy: 'defensive', press: 0.4, risk: 0.3, why: 'BT: opponent in our third -> block.' })),
    cond((s) => s.possession === 'own' && s.ballU > 5, act({ strategy: 'attacking', press: 0.7, risk: 0.65, why: 'BT: attacking third -> commit.' })),
    act(BAL),
  );
  decide(s: CompactState, team: TeamConfig): AgentDecision {
    return { tactics: build(s, team, this.tree.run(s) ?? BAL), meta: { source: 'behavior_tree' } };
  }
}

// ---------- 4. Utility AI ----------
interface Cand { name: string; mix: Mix; score(s: CompactState): number }
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const timePressure = (s: CompactState) => clamp01((s.minute - 55) / 35);
const CANDS: Cand[] = [
  { name: 'balanced', mix: { ...BAL, why: 'Utility: balanced best.' }, score: (s) => 0.5 - Math.abs(diff(s)) * 0.2 },
  { name: 'attacking', mix: { strategy: 'attacking', press: 0.72, risk: 0.65, why: 'Utility: attacking best.' }, score: (s) => 0.3 + clamp01(-diff(s) / 2) * 0.6 * (0.5 + timePressure(s)) + (s.possession === 'own' ? 0.1 : 0) - (1 - s.avgStamina) * 0.3 },
  { name: 'defensive', mix: { strategy: 'defensive', press: 0.3, risk: 0.3, def: 'mid_block', why: 'Utility: defensive best.' }, score: (s) => 0.2 + clamp01(diff(s) / 2) * 0.6 + (s.shotsOpp > s.shotsOwn + 3 ? 0.2 : 0) },
  { name: 'counter', mix: { strategy: 'counter', press: 0.4, risk: 0.45, att: 'counter', why: 'Utility: counter best.' }, score: (s) => 0.25 + (diff(s) > 0 ? 0.25 : 0) + (s.possessionPct < 45 ? 0.2 : 0) },
  { name: 'park', mix: { strategy: 'park_the_bus', press: 0.15, risk: 0.15, def: 'low_block', why: 'Utility: protect lead.' }, score: (s) => (diff(s) > 0 ? clamp01(diff(s) / 2) * timePressure(s) * 1.4 : 0) },
  { name: 'all_out', mix: { strategy: 'all_out_attack', press: 0.9, risk: 0.92, why: 'Utility: all-out attack.' }, score: (s) => (diff(s) < 0 ? clamp01(-diff(s) / 1.5) * timePressure(s) * 1.5 : 0) },
];
class UtilityAgent implements TeamAgent {
  architecture: Architecture = 'utility'; cooldownVirtual = 60; intervalVirtual = 240;
  decide(s: CompactState, team: TeamConfig): AgentDecision {
    let best = CANDS[0], bs = -1;
    for (const c of CANDS) { const v = c.score(s); if (v > bs) { bs = v; best = c; } }
    const mix = { ...best.mix, fly: best.name === 'all_out' && s.minutesLeft <= 5 };
    return { tactics: build(s, team, mix), meta: { source: 'utility' } };
  }
}

// ---------- 5. GOAP (A* over tactical actions) ----------
type Facts = Record<string, boolean>;
interface GAction { name: string; pre: Facts; eff: Facts; cost: number; mix: Mix }
const GACTIONS: GAction[] = [
  { name: 'rest_squad', pre: { tired: true }, eff: { tired: false }, cost: 1, mix: { strategy: 'balanced', press: 0.3, risk: 0.35, why: 'GOAP: recover stamina.' } },
  { name: 'press_high', pre: { tired: false }, eff: { regained: true }, cost: 2, mix: { strategy: 'attacking', press: 0.85, risk: 0.65, def: 'high_press', why: 'GOAP: press to win the ball.' } },
  { name: 'build_possession', pre: {}, eff: { control: true }, cost: 1, mix: { strategy: 'balanced', press: 0.5, risk: 0.4, att: 'possession', why: 'GOAP: control the ball.' } },
  { name: 'create_chance', pre: { control: true }, eff: { chance: true }, cost: 1, mix: { strategy: 'attacking', press: 0.65, risk: 0.7, att: 'pivot_play', why: 'GOAP: control then create chances.' } },
  { name: 'regain_then_chance', pre: { regained: true }, eff: { chance: true }, cost: 1, mix: { strategy: 'attacking', press: 0.8, risk: 0.75, att: 'direct', why: 'GOAP: regain then strike.' } },
  { name: 'all_out', pre: { late: true, trailing: true }, eff: { chance: true }, cost: 1, mix: { strategy: 'all_out_attack', press: 0.9, risk: 0.95, why: 'GOAP: desperate times.' } },
  { name: 'protect_lead', pre: { leading: true }, eff: { safe: true }, cost: 1, mix: { strategy: 'park_the_bus', press: 0.15, risk: 0.15, def: 'low_block', why: 'GOAP: protect the lead.' } },
  { name: 'compact_counter', pre: { leading: true }, eff: { safe: true, chance: true }, cost: 2, mix: { strategy: 'counter', press: 0.4, risk: 0.4, att: 'counter', why: 'GOAP: stay compact, counter.' } },
];
function plan(start: Facts, goal: Facts): GAction[] | null {
  const key = (f: Facts) => Object.keys(f).sort().map((k) => `${k}${f[k] ? 1 : 0}`).join('');
  const ok = (f: Facts, g: Facts) => Object.entries(g).every(([k, v]) => !!f[k] === v);
  const open: { f: Facts; g: number; path: GAction[] }[] = [{ f: start, g: 0, path: [] }];
  const seen = new Map<string, number>();
  while (open.length) {
    open.sort((a, b) => a.g - b.g); const n = open.shift()!;
    if (ok(n.f, goal)) return n.path;
    for (const a of GACTIONS) {
      if (!ok(n.f, a.pre)) continue;
      const f = { ...n.f, ...a.eff }; const g = n.g + a.cost; const k = key(f);
      if ((seen.get(k) ?? Infinity) <= g || n.path.length > 3) continue;
      seen.set(k, g); open.push({ f, g, path: [...n.path, a] });
    }
  }
  return null;
}
class GoapAgent implements TeamAgent {
  architecture: Architecture = 'goap'; cooldownVirtual = 60; intervalVirtual = 240;
  decide(s: CompactState, team: TeamConfig): AgentDecision {
    const facts: Facts = { tired: s.avgStamina < 0.45, late: late(s), trailing: diff(s) < 0, leading: diff(s) > 0, control: false, regained: false, chance: false, safe: false };
    const goal: Facts = diff(s) > 0 && late(s) ? { safe: true } : { chance: true };
    const p = plan(facts, goal);
    const first = p?.[0];
    const mix = first ? { ...first.mix, why: `${first.mix.why} (plan: ${p!.map((a) => a.name).join(' > ')})`, fly: first.name === 'all_out' && s.minutesLeft <= 5 } : BAL;
    return { tactics: build(s, team, mix), meta: { source: 'goap' } };
  }
}

// ---------- 6. Hybrid: utility for strategy + rule guard rails ----------
class HybridAgent implements TeamAgent {
  architecture: Architecture = 'hybrid'; cooldownVirtual = 60; intervalVirtual = 240;
  private u = new UtilityAgent(); private r = new RuleAgent();
  decide(s: CompactState, team: TeamConfig): AgentDecision {
    const base = (this.u.decide(s, team) as AgentDecision).tactics as TeamTactics;
    const guard = (this.r.decide(s, team) as AgentDecision).tactics as TeamTactics;
    const critical = (late(s) && diff(s) !== 0) || s.redOwn !== s.redOpp;
    const t = critical ? { ...guard, reasonSummary: `Hybrid guard rail: ${guard.reasonSummary}` } : { ...base, reasonSummary: `Hybrid utility: ${base.reasonSummary}` };
    return { tactics: t, meta: { source: 'hybrid' } };
  }
}

/** Static agent used as a deterministic fallback for LLM failures and as the shootout fallback. */
export class FallbackAgent extends HybridAgent {}

export function makeAlgorithmicAgent(a: Architecture): TeamAgent {
  switch (a) {
    case 'rule': return new RuleAgent();
    case 'fsm': return new FsmAgent();
    case 'behavior_tree': return new BehaviorTreeAgent();
    case 'utility': return new UtilityAgent();
    case 'goap': return new GoapAgent();
    case 'hybrid': case 'llm': return new HybridAgent();
  }
}

/** Documented deterministic fallback penalty decisions (also used by all non-LLM architectures). */
export function fallbackPenaltyDecision(ctx: PenaltyContext, rngVal: number): PenaltyDecision {
  if (ctx.role === 'shoot') {
    const used = new Set(ctx.history.filter((h) => ctx.eligible.some((e) => e.id === h.takerId)).map((h) => h.takerId));
    const pool = ctx.eligible.filter((e) => !used.has(e.id));
    const list = (pool.length ? pool : ctx.eligible).slice().sort((a, b) => b.shooting - a.shooting);
    const lastSides = ctx.history.filter((h) => h.result !== 'goal').slice(-1);
    const side = (rngVal < 0.5 ? -1 : 1) * 0.75 * (lastSides.length && lastSides[0].side * (rngVal < 0.5 ? -1 : 1) > 0 ? -1 : 1);
    return { takerId: list[0]?.id, side, height: 0.25, power: ctx.suddenDeath ? 0.8 : 0.85, reason: 'Fallback: best remaining shooter, low corner, varied side.' };
  }
  return { dive: rngVal < 0.4 ? -1 : rngVal < 0.8 ? 1 : 0, reactDelay: 0.05, reason: 'Fallback: commit to a side as the ball is struck.' };
}

export { defaultTactics };
export const _internal = { plan, GACTIONS };
void ({} as TeamId);
