import { ATTRIBUTE_KEYS, type Attributes, type Architecture, type Formation, type MatchConfig, type PlayerConfig, type Role, type TeamConfig, type TeamId } from './types';
import { Rng } from './rng';

/** Identical attribute sets for both teams (fair benchmarking): derived from the seed only, not from the team. */
export function makeAttributes(rng: Rng, role: Role, base = 62): Attributes {
  const a = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) a[k] = Math.round(Math.max(30, Math.min(92, base + rng.gauss() * 8)));
  if (role === 'GK') { a.goalkeeping = Math.round(Math.max(60, Math.min(92, base + 10 + rng.gauss() * 4))); a.shooting = 30; a.dribbling = 35; }
  else a.goalkeeping = 20;
  if (role === 'PIVOT') { a.shooting += 6; a.ballControl += 5; }
  if (role === 'FIXO') { a.tackling += 6; a.defensiveAwareness += 6; }
  if (role === 'ALA') { a.acceleration += 5; a.dribbling += 5; }
  for (const k of ATTRIBUTE_KEYS) a[k] = Math.min(95, a[k]);
  return a;
}

const ROLES: Role[] = ['GK', 'FIXO', 'ALA', 'ALA', 'PIVOT', 'GK', 'UNIVERSAL', 'FIXO'];
export function makeTeam(id: TeamId, name: string, opts: { architecture?: Architecture; formation?: Formation; seed?: number; base?: number; provider?: string; model?: string; primary?: string; secondary?: string } = {}): TeamConfig {
  const rng = new Rng(opts.seed ?? 1); // same seed => same squad for A and B => fair comparison
  const players: PlayerConfig[] = ROLES.map((role, i) => ({ id: `${id}${i + 1}`, number: i === 0 ? 1 : i === 5 ? 12 : i + 1, name: `${name} ${i + 1}`, role, attributes: makeAttributes(rng, role, opts.base ?? 62) }));
  return {
    id, name, badge: name.slice(0, 3).toUpperCase(), primaryColor: opts.primary ?? (id === 'A' ? '#10b981' : '#f59e0b'), secondaryColor: opts.secondary ?? '#0b1220',
    formation: opts.formation ?? '2-2', attackingStyle: 'possession', defensiveStyle: 'mid_block', architecture: opts.architecture ?? 'none',
    provider: opts.provider, model: opts.model, players,
  };
}

export function makeMatchConfig(o: { seed?: number; minutes?: 1 | 2 | 3 | 4 | 5 | 6; fa?: Formation; fb?: Formation } = {}): MatchConfig {
  const seed = o.seed ?? 7;
  return { teamA: makeTeam('A', 'Arena FC', { formation: o.fa, seed: seed + 1 }), teamB: makeTeam('B', 'Rival United', { formation: o.fb, seed: seed + 1 }), realDurationMinutes: o.minutes ?? 3, seed, shootoutOnDraw: true };
}
