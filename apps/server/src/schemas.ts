import { z } from 'zod';
import { ARCHITECTURES, FORMATIONS, ATTRIBUTE_KEYS, makeTeam, type MatchConfig, type TeamConfig, type TeamId, type PlayerConfig, type Role } from '@futsal/sim';

const attr = z.number().int().min(0).max(100);
const attributes = z.object(Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, attr])) as Record<string, typeof attr>);
const player = z.object({ number: z.number().int().min(1).max(99), name: z.string().min(1).max(40), role: z.enum(['GK', 'FIXO', 'ALA', 'PIVOT', 'UNIVERSAL']), attributes });
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const teamInput = z.object({
  name: z.string().trim().min(1).max(40), badge: z.string().max(4).optional(), primaryColor: color.optional(), secondaryColor: color.optional(),
  formation: z.enum(FORMATIONS as [string, ...string[]]).default('2-2'),
  attackingStyle: z.enum(['possession', 'direct', 'counter', 'wing_play', 'pivot_play']).default('possession'),
  defensiveStyle: z.enum(['high_press', 'mid_block', 'low_block', 'man_marking']).default('mid_block'),
  architecture: z.enum(ARCHITECTURES as [string, ...string[]]).default('hybrid'),
  provider: z.enum(['openai', 'anthropic', 'gemini', 'deepseek', 'openrouter', 'custom']).optional(), model: z.string().max(120).optional(),
  tacticalInstructions: z.string().max(500).optional(),
  players: z.array(player).length(8).optional(),
});
export type TeamInput = z.infer<typeof teamInput>;

export const matchInput = z.object({
  teamA: teamInput, teamB: teamInput,
  realDurationMinutes: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  seed: z.number().int().min(0).max(2 ** 31).optional(), swapSides: z.boolean().optional(),
  shootoutOnDraw: z.boolean().default(true), paced: z.boolean().default(true),
});
export type MatchInput = z.infer<typeof matchInput>;

/** Turn validated user input into a simulation config. Identical squad attributes for both sides unless the user supplies custom players. */
export function toMatchConfig(i: MatchInput, squadSeed?: number): MatchConfig {
  const seed = i.seed ?? Math.floor(Math.random() * 2 ** 31);
  const mk = (id: TeamId, t: TeamInput): TeamConfig => {
    const base = makeTeam(id, t.name, { architecture: t.architecture as TeamConfig['architecture'], formation: t.formation as TeamConfig['formation'], seed: squadSeed ?? seed + 1, provider: t.provider, model: t.model, primary: t.primaryColor, secondary: t.secondaryColor });
    const players: PlayerConfig[] = t.players ? t.players.map((p, k) => ({ id: `${id}${k + 1}`, number: p.number, name: p.name, role: p.role as Role, attributes: p.attributes as unknown as PlayerConfig['attributes'] })) : base.players;
    if (players[0].role !== 'GK') throw new Error('first player must be the goalkeeper');
    return { ...base, badge: t.badge ?? base.badge, attackingStyle: t.attackingStyle, defensiveStyle: t.defensiveStyle, tacticalInstructions: t.tacticalInstructions, players };
  };
  return { teamA: mk('A', i.teamA), teamB: mk('B', i.teamB), realDurationMinutes: i.realDurationMinutes, seed, shootoutOnDraw: i.shootoutOnDraw, swapSides: i.swapSides };
}

export const registerInput = z.object({ username: z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,32}$/), password: z.string().min(8).max(200) });
export const providerInput = z.object({ kind: z.enum(['openai', 'anthropic', 'gemini', 'deepseek', 'openrouter', 'custom']), apiKey: z.string().min(8).max(500), baseUrl: z.string().url().max(300).optional(), label: z.string().max(60).optional() });
export const pricingInput = z.object({ kind: z.string(), model: z.string().max(120), inputPerM: z.number().min(0).max(100000).nullable(), outputPerM: z.number().min(0).max(100000).nullable() });
export const tournamentInput = z.object({
  name: z.string().trim().min(1).max(60), format: z.enum(['single', 'best_of_three', 'round_robin', 'knockout', 'league']),
  teams: z.array(teamInput).min(2).max(8), realDurationMinutes: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), seed: z.number().int().min(0).max(2 ** 31).optional(),
});
export const benchmarkInput = z.object({ teamA: teamInput, teamB: teamInput, matches: z.number().int().min(1).max(20), realDurationMinutes: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), swapSides: z.boolean().default(true), seed: z.number().int().min(0).max(2 ** 31).optional() });
