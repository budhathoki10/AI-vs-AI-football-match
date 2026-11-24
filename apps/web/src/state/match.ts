import { DEFAULT_PLAYERS, type MatchEventMsg, type MatchSummary, type PenaltyKickMsg, type PenaltyResultMsg, type PlayerConfig, type RosterEntry, type ServerMsg, type TeamId, type TeamStatsLite, type ThoughtMsg } from '@futsal/shared';

export type Status = 'setup' | 'connecting' | 'live' | 'shootout' | 'over';
export const ZERO_STATS: TeamStatsLite = { goals: 0, shots: 0, onTarget: 0, passes: 0, passesOk: 0, saves: 0, fouls: 0, corners: 0, recoveries: 0, possessionSeconds: 0, xg: 0 };

export interface ShootoutView {
  /** every kick that has started; its outcome is only known once `results[index]` exists */
  kicks: PenaltyKickMsg[];
  results: Record<number, PenaltyResultMsg>;
  /** running score, advanced ONLY by revealed results */
  score: [number, number];
}
export interface GoalFlash { n: number; team: TeamId; playerId?: string; assistId?: string; vt: number }

export interface MatchView {
  status: Status; paused: boolean; matchId: string | null; error: string | null;
  players: Record<TeamId, PlayerConfig>; names: Record<TeamId, string>; roster: Record<TeamId, RosterEntry[]> | null; minutes: number;
  vt: number; half: 1 | 2; playPhase: string; score: [number, number]; possession: [number, number]; holder: TeamId | null;
  stats: Record<TeamId, TeamStatsLite>; thinking: Record<TeamId, boolean>;
  events: MatchEventMsg[]; thoughts: ThoughtMsg[]; fullTime: boolean;
  shootout: ShootoutView | null; summary: MatchSummary | null; goal: GoalFlash | null;
}

export const initialMatch = (players: Record<TeamId, PlayerConfig> = DEFAULT_PLAYERS): MatchView => ({
  status: 'setup', paused: false, matchId: null, error: null, players, names: { A: 'Home', B: 'Away' }, roster: null, minutes: 3,
  vt: 0, half: 1, playPhase: 'pre', score: [0, 0], possession: [50, 50], holder: null, stats: { A: ZERO_STATS, B: ZERO_STATS }, thinking: { A: false, B: false },
  events: [], thoughts: [], fullTime: false, shootout: null, summary: null, goal: null,
});

export type MatchAction =
  | { type: 'configure'; team: TeamId; player: PlayerConfig }
  | { type: 'swap' }
  | { type: 'begin'; names: Record<TeamId, string>; minutes: number }
  | { type: 'server'; msg: ServerMsg }
  | { type: 'fail'; message: string }
  | { type: 'reset' };

const MAX_EVENTS = 400, MAX_THOUGHTS = 300;

export function matchReducer(s: MatchView, a: MatchAction): MatchView {
  switch (a.type) {
    case 'configure': return { ...s, players: { ...s.players, [a.team]: a.player } };
    case 'swap': return { ...s, players: { A: s.players.B, B: s.players.A } };
    case 'begin': return { ...initialMatch(s.players), status: 'connecting', names: a.names, minutes: a.minutes };
    case 'fail': return { ...s, error: a.message, status: s.status === 'connecting' ? 'setup' : s.status };
    case 'reset': return initialMatch(s.players);
    case 'server': return onServer(s, a.msg);
  }
}

function onServer(s: MatchView, m: ServerMsg): MatchView {
  switch (m.t) {
    case 'hello': return { ...s, matchId: m.matchId, roster: m.roster, names: m.names, minutes: m.minutes, status: s.status === 'setup' || s.status === 'connecting' ? 'live' : s.status };
    case 'state': return { ...s, vt: m.vt, half: m.half, playPhase: m.phase === 'halftime' ? 'halftime' : m.play, score: m.score, possession: m.possession, holder: m.holder, stats: m.stats, thinking: m.thinking };
    case 'event': {
      const events = [...s.events, m.event].slice(-MAX_EVENTS);
      if (m.event.type !== 'goal' || !m.event.team) return { ...s, events };
      return { ...s, events, goal: { n: (s.goal?.n ?? 0) + 1, team: m.event.team, playerId: m.event.playerId, assistId: m.event.assistId, vt: m.event.vt } };
    }
    case 'thought': return { ...s, thoughts: [...s.thoughts, m].slice(-MAX_THOUGHTS) };
    case 'paused': return { ...s, paused: m.paused };
    case 'full_time': return { ...s, fullTime: true, score: m.score };
    case 'shootout_start': return { ...s, status: 'shootout', shootout: { kicks: [], results: {}, score: [0, 0] } };
    case 'penalty_kick': {
      const so = s.shootout ?? { kicks: [], results: {}, score: [0, 0] as [number, number] };
      if (so.kicks.some((k) => k.index === m.index)) return s;
      return { ...s, status: 'shootout', shootout: { ...so, kicks: [...so.kicks, m] } }; // score and results are untouched: nothing is announced yet
    }
    case 'penalty_result': {
      const so = s.shootout; if (!so) return s;
      return { ...s, shootout: { ...so, results: { ...so.results, [m.index]: m }, score: m.score } };
    }
    case 'done': return { ...s, status: 'over', summary: m.summary, paused: false, thinking: { A: false, B: false } };
    case 'error': return { ...s, error: m.message };
  }
}

// ------------------------------------------------------------------------------------------------ selectors
export const currentKick = (s: MatchView): PenaltyKickMsg | null => s.shootout?.kicks.at(-1) ?? null;
/** The outcome of a kick, or null while it is still in the air. */
export const kickResult = (s: MatchView, index: number): PenaltyResultMsg | null => s.shootout?.results[index] ?? null;
/** One entry per attempt of a team: undefined = not taken, 'pending' = being taken, otherwise the revealed outcome. */
export function shootoutRow(s: MatchView, team: TeamId): ('pending' | PenaltyResultMsg['result'])[] {
  const so = s.shootout; if (!so) return [];
  return so.kicks.filter((k) => k.team === team).map((k) => so.results[k.index]?.result ?? 'pending');
}

export function resultHeadline(s: MatchView): string {
  const sm = s.summary; if (!sm) return '';
  if (sm.decidedBy === 'stopped') return 'Match stopped';
  if (!sm.winner) return 'Draw';
  return `${s.names[sm.winner]} win${sm.decidedBy === 'shootout' ? ' on penalties' : ''}`;
}

const ROLE_LABEL: Record<string, string> = { GK: 'Goalkeeper', FIXO: 'Fixo', ALA: 'Ala', PIVOT: 'Pivot', UNIVERSAL: 'Universal' };
/** "#4 Pivot" for a roster id (player names in the engine are generated, so number + role is the useful label). */
export function playerTag(s: MatchView, playerId?: string): string {
  if (!playerId || !s.roster) return '';
  const p = [...s.roster.A, ...s.roster.B].find((x) => x.id === playerId);
  return p ? `#${p.number} ${ROLE_LABEL[p.role] ?? p.role}` : '';
}
