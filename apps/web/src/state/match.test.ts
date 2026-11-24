import { describe, expect, it } from 'vitest';
import type { MatchSummary, PenaltyKickMsg, ServerMsg } from '@futsal/shared';
import { currentKick, initialMatch, kickResult, matchReducer, resultHeadline, shootoutRow, type MatchView } from './match';

const run = (msgs: ServerMsg[], from: MatchView = matchReducer(initialMatch(), { type: 'begin', names: { A: 'Home FC', B: 'Away FC' }, minutes: 1 })) => msgs.reduce((s, msg) => matchReducer(s, { type: 'server', msg }), from);
const kick = (index: number, team: 'A' | 'B'): PenaltyKickMsg => ({ t: 'penalty_kick', index, round: Math.ceil(index / 2), team, suddenDeath: false, takerId: `${team}5`, keeperId: `${team === 'A' ? 'B' : 'A'}1`, shot: { reason: 'low corner', usedFallback: false }, keeper: { reason: 'guess', usedFallback: false }, frames: [], durationMs: 1500 });
const summary = (o: Partial<MatchSummary> = {}): MatchSummary => ({ regulation: [1, 1], winner: 'A', decidedBy: 'shootout', teamStats: {} as MatchSummary['teamStats'], players: [], time: { selectedSeconds: 60, actualSeconds: 58, virtualSeconds: 5400 }, ...o });

describe('match state from the server stream', () => {
  it('connects, goes live on hello and tracks the clock, score and thinking flags', () => {
    const s = run([
      { t: 'hello', matchId: 'm1', status: 'running', roster: { A: [], B: [] }, names: { A: 'Haiku 5.5', B: 'GPT Test' }, minutes: 1 },
      { t: 'state', vt: 600, half: 1, phase: 'first_half', play: 'live', restart: null, clockMode: 'active', score: [1, 0], rt: 9, ball: [0, 0, 0], players: [], possession: [60, 40], holder: 'A', own: null, stats: {} as never, thinking: { A: true, B: false }, dirs: [1, -1] },
    ]);
    expect(s.status).toBe('live'); expect(s.names.A).toBe('Haiku 5.5'); expect(s.vt).toBe(600); expect(s.score).toEqual([1, 0]); expect(s.thinking).toEqual({ A: true, B: false });
  });

  it('a goal event raises a celebration for the scoring team', () => {
    const s = run([{ t: 'event', event: { type: 'goal', vt: 1200, half: 1, team: 'B', playerId: 'B4', assistId: 'B2' } }]);
    expect(s.goal).toMatchObject({ n: 1, team: 'B', playerId: 'B4', assistId: 'B2' });
    const s2 = matchReducer(s, { type: 'server', msg: { t: 'event', event: { type: 'goal', vt: 1500, half: 1, team: 'A' } } }); expect(s2.goal?.n).toBe(2);
  });

  it('SPOILER GUARD: a penalty kick changes neither the shootout score nor reveals any result', () => {
    const s = run([{ t: 'shootout_start', score: [1, 1] }, kick(1, 'A')]);
    expect(s.status).toBe('shootout'); expect(s.shootout!.score).toEqual([0, 0]); expect(kickResult(s, 1)).toBeNull(); expect(shootoutRow(s, 'A')).toEqual(['pending']); expect(currentKick(s)?.index).toBe(1);
  });

  it('SPOILER GUARD: the outcome and the score appear only with the result message, in order', () => {
    let s = run([{ t: 'shootout_start', score: [1, 1] }, kick(1, 'A')]);
    s = run([{ t: 'penalty_result', index: 1, team: 'A', result: 'goal', score: [1, 0] }, kick(2, 'B')], s);
    expect(s.shootout!.score).toEqual([1, 0]); expect(shootoutRow(s, 'A')).toEqual(['goal']); expect(shootoutRow(s, 'B')).toEqual(['pending']); expect(kickResult(s, 2)).toBeNull();
    s = run([{ t: 'penalty_result', index: 2, team: 'B', result: 'saved', score: [1, 0] }], s);
    expect(shootoutRow(s, 'B')).toEqual(['saved']); expect(s.shootout!.score).toEqual([1, 0]);
  });

  it('ignores a duplicate kick and a result with no shootout', () => {
    const once = run([{ t: 'shootout_start', score: [0, 0] }, kick(1, 'A'), kick(1, 'A')]); expect(once.shootout!.kicks).toHaveLength(1);
    expect(run([{ t: 'penalty_result', index: 1, team: 'A', result: 'goal', score: [1, 0] }]).shootout).toBeNull();
  });

  it('finishes with a summary and an honest headline', () => {
    const s = run([{ t: 'done', summary: summary() }]); expect(s.status).toBe('over'); expect(resultHeadline(s)).toBe('Home FC win on penalties');
    expect(resultHeadline(run([{ t: 'done', summary: summary({ winner: 'B', decidedBy: 'regulation' }) }]))).toBe('Away FC win');
    expect(resultHeadline(run([{ t: 'done', summary: summary({ winner: null, decidedBy: 'stopped' }) }]))).toBe('Match stopped');
  });

  it('swap trades the two cards; reset returns to setup but keeps the chosen players', () => {
    let s = matchReducer(initialMatch(), { type: 'configure', team: 'A', player: { provider: 'claude', model: 'claude-haiku-5-5', effort: 'low' } });
    s = matchReducer(s, { type: 'swap' }); expect(s.players.B.provider).toBe('claude');
    const over = run([{ t: 'done', summary: summary() }], s); const back = matchReducer(over, { type: 'reset' }); expect(back.status).toBe('setup'); expect(back.players.B.provider).toBe('claude'); expect(back.events).toEqual([]);
  });
});
