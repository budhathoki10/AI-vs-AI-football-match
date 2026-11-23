import { FORMATIONS, INSTRUCTIONS, type AttackingStyle, type DefensiveStyle, type Formation, type Instruction, type TeamConfig, type TeamStrategy, type TeamTactics } from './types';

const STRATEGIES: TeamStrategy[] = ['balanced', 'attacking', 'defensive', 'counter', 'park_the_bus', 'all_out_attack'];
const ATT: AttackingStyle[] = ['possession', 'direct', 'counter', 'wing_play', 'pivot_play'];
const DEF: DefensiveStyle[] = ['high_press', 'mid_block', 'low_block', 'man_marking'];

export interface ValidationResult { ok: boolean; tactics?: TeamTactics; errors: string[] }

/**
 * Strict validation of any (LLM-produced or algorithmic) tactics object. Unknown player ids, unsupported enums,
 * out-of-range numbers and substitutions that violate the roster are rejected, never executed. Only data is accepted.
 */
export function validateTactics(raw: unknown, team: TeamConfig, onCourtIds: string[], benchIds: string[]): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['not an object'] };
  const r = raw as Record<string, unknown>;
  const num = (k: string) => {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) { errors.push(`${k} must be a number in [0,1]`); return 0.5; }
    return v;
  };
  const en = <T extends string>(k: string, allowed: readonly T[]): T => {
    const v = r[k];
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) { errors.push(`${k} unsupported: ${String(v)}`); return allowed[0]; }
    return v as T;
  };
  const formation = en<Formation>('formation', FORMATIONS);
  const teamStrategy = en<TeamStrategy>('teamStrategy', STRATEGIES);
  const attackingStyle = en<AttackingStyle>('attackingStyle', ATT);
  const defensiveStyle = en<DefensiveStyle>('defensiveStyle', DEF);
  const pressingIntensity = num('pressingIntensity');
  const riskLevel = num('riskLevel');
  const flyingGoalkeeper = r.flyingGoalkeeper === undefined ? false : r.flyingGoalkeeper === true;
  if (r.flyingGoalkeeper !== undefined && typeof r.flyingGoalkeeper !== 'boolean') errors.push('flyingGoalkeeper must be boolean');
  const playerInstructions: TeamTactics['playerInstructions'] = [];
  const seen = new Set<string>();
  if (!Array.isArray(r.playerInstructions)) errors.push('playerInstructions must be an array');
  else {
    for (const pi of r.playerInstructions) {
      const o = pi as Record<string, unknown>;
      if (!o || typeof o.playerId !== 'string' || !onCourtIds.includes(o.playerId)) { errors.push(`invalid playerId ${String((o as any)?.playerId)}`); continue; }
      if (seen.has(o.playerId)) { errors.push(`duplicate instruction for ${o.playerId}`); continue; }
      if (typeof o.instruction !== 'string' || !(INSTRUCTIONS as readonly string[]).includes(o.instruction)) { errors.push(`unsupported instruction ${String(o.instruction)}`); continue; }
      seen.add(o.playerId); playerInstructions.push({ playerId: o.playerId, instruction: o.instruction as Instruction });
    }
  }
  let substitutions: TeamTactics['substitutions'];
  if (r.substitutions !== undefined) {
    if (!Array.isArray(r.substitutions) || r.substitutions.length > 3) errors.push('substitutions must be an array of at most 3');
    else {
      substitutions = [];
      for (const s of r.substitutions) {
        const o = s as Record<string, unknown>;
        if (typeof o?.out === 'string' && typeof o?.in === 'string' && onCourtIds.includes(o.out) && benchIds.includes(o.in)) substitutions.push({ out: o.out, in: o.in });
        else errors.push('invalid substitution');
      }
    }
  }
  const reasonSummary = typeof r.reasonSummary === 'string' ? r.reasonSummary.slice(0, 280) : '';
  if (typeof r.reasonSummary !== 'string') errors.push('reasonSummary must be a string');
  if (errors.length) return { ok: false, errors };
  void team;
  return { ok: true, errors, tactics: { formation, teamStrategy, attackingStyle, defensiveStyle, pressingIntensity, riskLevel, flyingGoalkeeper, playerInstructions, substitutions, reasonSummary } };
}

export function defaultTactics(team: TeamConfig): TeamTactics {
  return {
    formation: team.formation, teamStrategy: 'balanced', attackingStyle: team.attackingStyle, defensiveStyle: team.defensiveStyle,
    pressingIntensity: team.defensiveStyle === 'high_press' ? 0.75 : team.defensiveStyle === 'low_block' ? 0.25 : 0.5,
    riskLevel: 0.5, flyingGoalkeeper: false, playerInstructions: [], reasonSummary: 'Initial configured tactics.',
  };
}
