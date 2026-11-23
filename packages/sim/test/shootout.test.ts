import { describe, it, expect, beforeAll } from 'vitest';
import { Match, makeMatchConfig, initPhysics, runShootout, simulateAttempt, playMatch, SHOOTOUT, type PenaltyResult, type TeamAgent, type PenaltyDecision } from '../src';
import { Rng } from '../src/rng';

const strong = { shooting: 90, ballControl: 80 };
const gkLow = { goalkeeping: 20, agility: 30 }, gkHigh = { goalkeeping: 92, agility: 90 };

describe('1v1 penalty physics', () => {
  beforeAll(async () => { await initPhysics(); });
  it('a ball struck into the corner past a non-reacting keeper crosses the line: GOAL', () => {
    let goals = 0; for (let i = 0; i < 12; i++) { const r = simulateAttempt(strong, gkLow, { side: 1, height: 0.15, power: 0.95 }, { dive: -1, reactDelay: 0.3 }, new Rng(i + 1)); if (r.result === 'goal') goals++; }
    expect(goals).toBeGreaterThanOrEqual(9);
  });
  it('a shot hit straight at a keeper who stays central is SAVED by real contact', () => {
    let saves = 0; for (let i = 0; i < 10; i++) { const r = simulateAttempt(strong, gkHigh, { side: 0, height: 0.1, power: 0.6 }, { dive: 0, reactDelay: 0.05 }, new Rng(i + 5)); if (r.result === 'saved') saves++; }
    expect(saves).toBeGreaterThanOrEqual(8);
  });
  it('misses and woodwork happen for inaccurate shooters (physical outcomes, not dice)', () => {
    const res: PenaltyResult[] = []; for (let i = 0; i < 60; i++) res.push(simulateAttempt({ shooting: 15, ballControl: 20 }, gkLow, { side: 1, height: 1, power: 1 }, { dive: 0, reactDelay: 0.4 }, new Rng(i + 100)).result);
    expect(res.some((r) => r === 'missed' || r === 'post')).toBe(true);
  });
  it('records frames and a ball that physically travels from the spot to the goal line', () => {
    const r = simulateAttempt(strong, gkLow, { side: -1, height: 0.2, power: 0.9 }, { dive: 1, reactDelay: 0.3 }, new Rng(9));
    expect(r.frames.length).toBeGreaterThan(10); expect(r.frames[0].bx).toBeCloseTo(14, 0); const maxX = Math.max(...r.frames.map((f) => f.bx));
    expect(maxX).toBeGreaterThan(19); expect(r.ballSpeed).toBeGreaterThan(10);
  });
});

async function drawnMatch(seed = 1) { await initPhysics(); const m = await Match.create(makeMatchConfig({ seed, minutes: 1 })); m.phase = 'full_time'; return m; }
const script = (results: PenaltyResult[]) => { let i = 0; return ((..._a: unknown[]) => ({ result: results[i++] ?? 'missed', frames: [], woodwork: false, ballSpeed: 20, target: null })) as unknown as typeof simulateAttempt; };

describe('shootout state machine', () => {
  it('alternates teams starting with the coin-toss winner; five rounds when level (A and B all score)', async () => {
    const m = await drawnMatch(); const g = Array(14).fill('goal') as PenaltyResult[];
    const r = await runShootout(m, { firstTeam: 'A', simulate: script([...g.slice(0, 10), 'goal', 'missed']) });
    expect(r.attempts.slice(0, 10).map((a) => a.team)).toEqual(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
    expect(r.attempts.length).toBe(12); expect(r.decidedBy).toBe('sudden_death'); expect(r.winner).toBe('A'); expect(r.suddenDeathRounds).toBe(1);
    expect(r.score).toEqual([6, 5]);
  });
  it('terminates early once a lead is unassailable', async () => {
    const m = await drawnMatch(); // after B's 3rd miss: A 3-0 with only 2 attempts left for B -> unassailable
    const r = await runShootout(m, { firstTeam: 'A', simulate: script(['goal', 'missed', 'goal', 'missed', 'goal', 'missed', 'goal']) });
    expect(r.decidedBy).toBe('early_termination'); expect(r.winner).toBe('A'); expect(r.attempts.length).toBe(6); expect(r.score).toEqual([3, 0]);
  });
  it('sudden death: ends only when exactly one team scores in the same round; both-miss continues', async () => {
    const m = await drawnMatch();
    const seq: PenaltyResult[] = [...Array(10).fill('goal'), 'missed', 'missed', 'saved', 'goal', 'goal', 'saved'];
    const r = await runShootout(m, { firstTeam: 'B', simulate: script(seq) });
    expect(r.suddenDeathRounds).toBe(2); expect(r.winner).toBe('A'); expect(r.attempts.filter((a) => a.suddenDeath).length).toBe(4);
    expect(r.attempts[10].team).toBe('B');
  });
  it('safety limit uses a documented deterministic fallback, not an arbitrary winner', async () => {
    const m = await drawnMatch(); const r = await runShootout(m, { firstTeam: 'A', suddenDeathMax: 2, simulate: script(Array(40).fill('goal')) });
    expect(r.decidedBy).toBe('safety_fallback'); expect(r.fallbackNote).toMatch(/safety limit/); expect(['A', 'B']).toContain(r.winner);
    const r2 = await runShootout(await drawnMatch(), { firstTeam: 'A', suddenDeathMax: 2, simulate: script(Array(40).fill('goal')) }); expect(r2.winner).toBe(r.winner);
  });
  it('never repeats a taker before every eligible player has kicked; excludes dismissed players', async () => {
    const m = await drawnMatch(); m.byId.get('B4')!.red = true; m.byId.get('A4')!.red = true;
    const r = await runShootout(m, { firstTeam: 'A', simulate: script(Array(30).fill('goal')), suddenDeathMax: 4 });
    const takers = (t: 'A' | 'B') => r.attempts.filter((a) => a.team === t).map((a) => a.takerId);
    for (const t of ['A', 'B'] as const) { const list = takers(t); expect(list.includes(`${t}4`)).toBe(false); expect(new Set(list.slice(0, 5)).size).toBe(5); }
  });
  it('shootout stats are separate from regulation stats', async () => {
    const m = await drawnMatch(); const before = JSON.stringify([m.score, m.teamStats.A.goals, m.teamStats.B.goals]);
    const r = await runShootout(m, { firstTeam: 'A', simulate: script(['goal', 'saved', 'goal', 'missed', 'goal', 'post', 'goal']) });
    expect(JSON.stringify([m.score, m.teamStats.A.goals, m.teamStats.B.goals])).toBe(before);
    expect(r.stats.A.scored).toBe(3); expect(r.stats.B.saved).toBe(1); expect(r.stats.B.post).toBe(1); expect(r.stats.B.missed).toBe(2);
    expect(m.result().decidedBy).toBe('shootout'); expect(m.result().regulationScore).toEqual([0, 0]);
  });
  it('real-physics shootout completes with a winner; AI agents choose independently; fallback on agent failure', async () => {
    const m = await drawnMatch(3);
    const throwing: TeamAgent = { ...m.teams.A.agent, decidePenalty: () => { throw new Error('provider down'); } };
    const smart: TeamAgent = { ...m.teams.B.agent, decidePenalty: (c): PenaltyDecision => (c.role === 'shoot' ? { takerId: c.eligible[0].id, side: -0.9, height: 0.2, power: 0.9, reason: 'corner' } : { dive: 1, reactDelay: 0.05, reason: 'guess' }) };
    m.teams.A.agent = throwing; m.teams.B.agent = smart;
    const r = await runShootout(m, { firstTeam: 'A' });
    expect(['A', 'B']).toContain(r.winner); expect(r.attempts.length).toBeGreaterThanOrEqual(3);
    expect(r.attempts.filter((a) => a.team === 'A').every((a) => a.shot.usedFallback)).toBe(true);
    expect(r.attempts.filter((a) => a.team === 'B').every((a) => !a.shot.usedFallback)).toBe(true);
    for (const a of r.attempts) { expect(a.frames.length).toBeGreaterThan(5); expect(a.takerId).not.toBe(a.keeperId); }
  }, 120000);
  it('invalid agent penalty decisions fall back (unknown taker, out-of-range values)', async () => {
    const m = await drawnMatch(4);
    const bad: TeamAgent = { ...m.teams.A.agent, decidePenalty: (c) => (c.role === 'shoot' ? ({ takerId: 'ZZ', side: 9, height: -1, power: 5, reason: '' } as PenaltyDecision) : ({ dive: 7 as any, reason: '' })) };
    m.teams.A.agent = bad; m.teams.B.agent = bad;
    const r = await runShootout(m, { firstTeam: 'A', simulate: script(['goal', 'goal', 'goal', 'goal', 'goal', 'goal', 'goal']) });
    expect(r.attempts.every((a) => a.shot.usedFallback && a.keeper.usedFallback)).toBe(true);
  });
  it('configured constants: five regular rounds', () => expect(SHOOTOUT.regularRounds).toBe(5));
});

describe('automatic shootout after a drawn regulation', () => {
  it('playMatch runs 90:00 then a shootout when level; regulation score preserved', async () => {
    let found = false;
    for (let seed = 1; seed < 12 && !found; seed++) {
      const m = await playMatch(makeMatchConfig({ seed, minutes: 1 }));
      if (m.score[0] === m.score[1]) { found = true; expect(m.shootout).not.toBeNull(); expect(m.phase).toBe('finished'); expect(m.result().decidedBy).toBe('shootout'); expect(m.result().regulationScore).toEqual([m.score[0], m.score[1]]); expect(m.vt).toBe(5400); }
      else { expect(m.shootout).toBeNull(); expect(m.result().decidedBy).toBe('regulation'); }
    }
    expect(found).toBe(true);
  }, 300000);
});
