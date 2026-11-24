import { z } from 'zod';
import { EFFORT_LEVELS, MATCH_MINUTES, MODEL_ID_PATTERN, PROVIDER_IDS, type TeamId } from '@futsal/shared';
import { makeTeam, type MatchConfig, type TeamConfig } from '@futsal/sim';

const player = z.object({ provider: z.enum(PROVIDER_IDS), model: z.string().regex(MODEL_ID_PATTERN), effort: z.enum(EFFORT_LEVELS).default('default') });
const minutes = z.union(MATCH_MINUTES.map((m) => z.literal(m)) as unknown as [z.ZodLiteral<1>, z.ZodLiteral<2>, ...z.ZodLiteral<number>[]]);

export const startMatchInput = z.object({
  home: player, away: player, minutes,
  seed: z.number().int().min(0).max(2 ** 31).optional(),
  names: z.object({ A: z.string().trim().min(1).max(40), B: z.string().trim().min(1).max(40) }),
  openRouterKey: z.string().trim().max(300).optional(),
});
export type StartMatchInput = z.infer<typeof startMatchInput>;

const KITS: Record<TeamId, { primary: string; secondary: string }> = { A: { primary: '#f5f0e6', secondary: '#14151a' }, B: { primary: '#1b1c22', secondary: '#e9b44c' } };
export const teamColors = KITS;

/** Both sides get the same squad (identical attributes, formation and positions) so the comparison between models is fair. */
export function toMatchConfig(input: StartMatchInput, architectures: Record<TeamId, string>): MatchConfig {
  const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
  const mk = (id: TeamId): TeamConfig => ({ ...makeTeam(id, input.names[id], { architecture: architectures[id] as TeamConfig['architecture'], seed: seed + 1, primary: KITS[id].primary, secondary: KITS[id].secondary }), badge: input.names[id].slice(0, 3).toUpperCase() });
  return { teamA: mk('A'), teamB: mk('B'), realDurationMinutes: input.minutes as MatchConfig['realDurationMinutes'], seed, shootoutOnDraw: true };
}
