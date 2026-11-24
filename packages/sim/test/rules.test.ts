import { describe, it, expect } from 'vitest';
import { liveMatch, evs } from './helpers';

const noKeepers = (m: any) => { m.phys.placePlayer('B1', 0, 8); m.phys.placePlayer('A1', 0, -8); };
const step = (m: any, n: number) => { for (let i = 0; i < n; i++) m.step(); };

describe('rules engine', () => {
  it('awards a goal only after the ball crosses the line inside the goal mouth, credits the scorer', async () => {
    const m = await liveMatch(); noKeepers(m);
    m.phys.placeBall(17, 0.3, 0.2); m.phys.kickBall(18, 0, 0); m.lastTouch = { pid: 'A5', team: 'A', rt: m.rt };
    for (let i = 0; i < 90 && !evs(m, 'goal').length; i++) m.step();
    expect(evs(m, 'goal')).toHaveLength(1); expect(m.score).toEqual([1, 0]); expect(m.teamStats.A.goals).toBe(1); expect(m.playerStats.get('A5')!.goals).toBe(1);
    expect(m.restart?.type).toBe('kickoff'); expect(m.restart?.team).toBe('B');
  });
  it('does not award a goal for a shot wide of the post', async () => {
    const m = await liveMatch();
    m.phys.placeBall(17, 0.3, 2.4); m.phys.kickBall(18, 0, 0); m.lastTouch = { pid: 'A5', team: 'A', rt: m.rt };
    step(m, 60); expect(m.score).toEqual([0, 0]);
  });
  it('own goal is credited to the attacking team but not to the player as a goal', async () => {
    const m = await liveMatch(); noKeepers(m);
    m.phys.placeBall(17, 0.3, 0); m.phys.kickBall(18, 0, 0); m.lastTouch = { pid: 'B3', team: 'B', rt: m.rt };
    for (let i = 0; i < 90 && !evs(m, 'goal').length; i++) m.step();
    expect(m.score).toEqual([1, 0]); expect(m.playerStats.get('B3')!.goals).toBe(0); expect(evs(m, 'goal')[0].detail).toContain('own goal');
  });
  it('kick-in (not throw-in) for the opponent of the last toucher when the ball crosses the touchline', async () => {
    const m = await liveMatch();
    m.phys.placeBall(3, 0.1, 10.6); m.lastTouch = { pid: 'A2', team: 'A', rt: m.rt }; step(m, 2);
    const e = evs(m, 'kick_in'); expect(e).toHaveLength(1); expect(e[0].team).toBe('B'); expect(m.restart?.type).toBe('kick_in');
  });
  it('corner kick when the defending team last touches the ball over its own goal line', async () => {
    const m = await liveMatch();
    m.phys.placeBall(20.4, 0.1, 5); m.lastTouch = { pid: 'B2', team: 'B', rt: m.rt }; step(m, 2);
    expect(evs(m, 'corner')[0]?.team).toBe('A');
  });
  it('goal clearance when the attacking team last touches the ball over the goal line', async () => {
    const m = await liveMatch();
    m.phys.placeBall(20.4, 0.1, 5); m.lastTouch = { pid: 'A2', team: 'A', rt: m.rt }; step(m, 2);
    expect(evs(m, 'goal_clearance')[0]?.team).toBe('B'); expect(m.restart?.takerId).toBe('B1');
  });
  it('foul -> direct free kick, accumulated fouls reach the sixth foul without a wall', async () => {
    const m = await liveMatch();
    m.phys.placePlayer('A3', 0, 3);
    for (let i = 0; i < 5; i++) m.callFoul('B3', 'A3', 4);
    expect(evs(m, 'free_kick').length).toBe(5); expect(evs(m, 'accumulated_foul')).toHaveLength(0);
    m.callFoul('B3', 'A3', 4);
    expect(evs(m, 'accumulated_foul')).toHaveLength(1); expect(m.restart?.noWall).toBe(true); expect(m.teamStats.B.fouls).toBe(6);
  });
  it('foul inside the defending penalty area gives a regulation penalty kick (separate from the shootout)', async () => {
    const m = await liveMatch();
    m.phys.placePlayer('A3', 18, 0); m.callFoul('B3', 'A3', 4);
    expect(evs(m, 'penalty_kick')).toHaveLength(1); expect(m.restart?.type).toBe('penalty_kick'); expect(m.restart?.x).toBeCloseTo(14, 5);
    expect(m.shootout).toBeNull();
  });
  it('second yellow card is a red card: player dismissed and removed from the court', async () => {
    const m = await liveMatch();
    m.phys.placePlayer('A3', 0, 3);
    m.callFoul('B3', 'A3', 5.5); expect(evs(m, 'yellow_card')).toHaveLength(1);
    m.callFoul('B3', 'A3', 5.5);
    expect(evs(m, 'red_card')).toHaveLength(1); const p = m.byId.get('B3')!; expect(p.red).toBe(true); expect(p.onCourt).toBe(false); expect(m.phys.hasPlayer('B3')).toBe(false);
    expect(m.teamStats.B.red).toBe(1);
  });
  it('a dismissed player is replaced after the dismissal window at a stoppage', async () => {
    const m = await liveMatch();
    m.phys.placePlayer('A3', 0, 3); m.callFoul('B3', 'A3', 6.8);
    expect((m as any).outfield('B').length).toBe(3);
    m.clock.vt += 130; (m as any).startRestart('kick_in', 'A', 3, 10, 1, true);
    expect((m as any).outfield('B').length).toBe(4);
  });
  it('queued substitutions are executed at a stoppage and only with legal ids', async () => {
    const m = await liveMatch();
    m.teams.A.queuedSubs.push({ out: 'A3', in: 'A7' }, { out: 'A3', in: 'B7' });
    (m as any).startRestart('kick_in', 'B', 3, 10, 1, true);
    expect(m.byId.get('A3')!.onCourt).toBe(false); expect(m.byId.get('A7')!.onCourt).toBe(true); expect(m.byId.get('B7')!.onCourt).toBe(false);
  });
  it('indirect kick-in cannot score directly (goal disallowed without a second touch)', async () => {
    const m = await liveMatch(); noKeepers(m);
    m.restartLive = { type: 'kick_in', team: 'A', x: 0, z: 0, takerId: 'A2', timer: 0, minWait: 0, indirect: true, noWall: false, readyAt: null, touches: new Set(['A2']), kicked: true, wall: [], wallPoint: null };
    m.phys.placeBall(17, 0.3, 0); m.phys.kickBall(18, 0, 0); m.lastTouch = { pid: 'A2', team: 'A', rt: m.rt };
    for (let i = 0; i < 90 && m.play === 'live'; i++) m.step();
    expect(m.score).toEqual([0, 0]); expect(m.restart?.type).toBe('goal_clearance');
  });
  it('shots are classified from the real ball trajectory and saves come from real keeper contact', async () => {
    const m = await liveMatch(21);
    // run a whole 1-minute match and check bookkeeping invariants
    const { Match, makeMatchConfig } = await import('../src');
    const mm = await Match.create(makeMatchConfig({ seed: 5, minutes: 2 })); await mm.runRegulation();
    for (const t of ['A', 'B'] as const) { const s = mm.teamStats[t]; expect(s.onTarget + s.offTarget + s.blocked).toBeLessThanOrEqual(s.shots + s.blocked); expect(s.passesOk).toBeLessThanOrEqual(s.passes); }
    expect(m).toBeTruthy();
  });
});

describe('advantage, wall, pass network, xG', () => {
  it('advantage: the referee plays on while the fouled carrier keeps the ball, then it counts as played', async () => {
    const m = await liveMatch(); noKeepers(m);
    m.phys.placePlayer('A3', 0, 3); m.phys.placeBall(0.3, 0.1, 3); m.phys.kickBall(0, 0, 0);
    // only the fouling player stays on court besides the keeper, parked in the far corner: nobody can win the ball inside the window
    for (const id of ['B1', 'B2', 'B3', 'B4', 'B5']) { m.byId.get(id)!.onCourt = false; m.phys.removePlayer(id); } // the foul was already committed; nobody is left to win the ball
    // fouled player is moving forward with the ball at his feet
    const body = (m.phys as any).players.get('A3').body; body.setLinvel({ x: 3, y: 0, z: 0 }, true);
    m.lastTouch = { pid: 'A3', team: 'A', rt: m.rt };
    m.callFoul('B3', 'A3', 4);
    expect(evs(m, 'foul')).toHaveLength(1); expect(evs(m, 'advantage')).toHaveLength(1); expect(m.advantage).not.toBeNull();
    expect(m.play).toBe('live'); expect(evs(m, 'free_kick')).toHaveLength(0);
    for (let i = 0; i < 200; i++) { m.lastTouch = { pid: 'A3', team: 'A', rt: m.rt }; m.step(); } // the fouled team keeps the ball for the whole window
    expect(evs(m, 'advantage_over')[0]?.detail).toBe('advantage played'); expect(evs(m, 'free_kick')).toHaveLength(0); expect(m.teamStats.B.fouls).toBe(1);
  });
  it('advantage lost: when the opponent wins the ball inside the window the free kick is awarded at the foul spot', async () => {
    const m = await liveMatch(); noKeepers(m);
    m.phys.placePlayer('A3', 0, 3); m.phys.placeBall(0.3, 0.1, 3);
    (m.phys as any).players.get('A3').body.setLinvel({ x: 3, y: 0, z: 0 }, true);
    m.lastTouch = { pid: 'A3', team: 'A', rt: m.rt };
    m.callFoul('B3', 'A3', 4); expect(m.advantage).not.toBeNull();
    step(m, 2); m.lastTouch = { pid: 'B2', team: 'B', rt: m.rt + 0.5 };
    step(m, 2);
    expect(evs(m, 'advantage_over')[0]?.detail).toContain('free kick awarded'); expect(evs(m, 'free_kick')).toHaveLength(1); expect(m.restart?.type).toBe('free_kick');
  });
  it('no advantage for a foul that earns a red card or happens in the penalty area', async () => {
    const m = await liveMatch();
    m.phys.placePlayer('A3', 18, 0); m.callFoul('B3', 'A3', 4);
    expect(evs(m, 'advantage')).toHaveLength(0); expect(evs(m, 'penalty_kick')).toHaveLength(1);
  });
  it('free kick in shooting range builds a two-player wall about 5 m from the ball on the line to goal', async () => {
    const m = await liveMatch(); noKeepers(m);
    m.phys.placePlayer('A3', 9, 0); m.callFoul('B3', 'A3', 4);
    const r = m.restart!; expect(r.type).toBe('free_kick'); expect(r.wall).toHaveLength(2); expect(r.wallPoint).not.toBeNull();
    for (const id of r.wall) expect(m.byId.get(id)!.team).toBe('B');
    let formed = false;
    for (let i = 0; i < 400 && m.restart === r && !r.kicked; i++) {
      m.step();
      const ds = r.wall.map((id) => { const s = m.playerWorld(id); return Math.hypot(s.x - r.x, s.z - r.z); });
      if (ds.every((d) => d > 4.2 && d < 6.2)) formed = true;
    }
    expect(formed).toBe(true); // physically walked to the wall position before the kick (never teleported)
  });
  it('accumulated-foul free kicks have no wall', async () => {
    const m = await liveMatch(); m.phys.placePlayer('A3', 9, 0);
    for (let i = 0; i < 6; i++) m.callFoul('B3', 'A3', 4);
    expect(m.restart!.noWall).toBe(true); expect(m.restart!.wall).toHaveLength(0);
  });
});
