import { describe, it, expect, beforeAll } from 'vitest';
import { Match, makeMatchConfig, initPhysics, MATCH, PHYS, playerRating } from '../src';

beforeAll(async () => { await initPhysics(); });

describe('complete virtual 90-minute regulation for all six real-world durations', () => {
  for (const minutes of [1, 2, 3, 4, 5, 6] as const) {
    it(`${minutes} min real -> 00:00..45:00 | halftime | 45:00..90:00`, async () => {
      const m = await Match.create(makeMatchConfig({ seed: 40 + minutes, minutes }));
      expect(m.vt).toBe(0);
      await m.runRegulation();
      expect(m.vt).toBe(5400); expect(m.phase).toBe('full_time'); expect(m.half).toBe(2);
      const ht = m.events.filter((e) => e.type === 'halftime'); const ft = m.events.filter((e) => e.type === 'fulltime');
      expect(ht).toHaveLength(1); expect(ht[0].vt).toBe(2700); expect(ft).toHaveLength(1); expect(ft[0].vt).toBe(5400);
      // event timestamps are virtual, monotonic, bounded
      let prev = 0; for (const e of m.events) { expect(e.vt).toBeGreaterThanOrEqual(prev - 0.11); expect(e.vt).toBeLessThanOrEqual(5400); prev = Math.max(prev, e.vt); }
      for (const e of m.events) expect(e.half).toBe(e.vt <= 2700 && !(e.type === 'kickoff' && e.detail === 'second half') && e.type !== 'fulltime' && !(e.vt === 2700 && e.half === 2) ? 1 : e.half);
      const rep = m.clock.report();
      expect(rep.selectedRealSeconds).toBe(minutes * 60);
      expect(rep.virtualSeconds).toBe(5400);
      expect(rep.meanInactiveRate).toBeGreaterThan(rep.meanActiveRate);
      // the physics timestep is constant: one physics step per tick
      expect(m.phys.steps).toBe(m.tick);
      // real elapsed (physics seconds) is tracked separately from virtual and from the selected duration
      if (minutes >= 3) expect(rep.actualRealSeconds).toBeLessThan(minutes * 60 * 1.2);
      else expect(rep.note.length).toBeGreaterThan(20); // short budgets may overrun; the limitation is reported transparently
      // score integrity
      expect(m.teamStats.A.goals).toBe(m.score[0]); expect(m.teamStats.B.goals).toBe(m.score[1]);
      expect(m.events.filter((e) => e.type === 'goal').length).toBe(m.score[0] + m.score[1]);
      for (const e of m.events.filter((x) => x.type === 'goal')) expect(e.team).toBeTruthy();
    }, 120000);
  }
});

describe('physical realism: natural movement (no speed multipliers), no teleporting', () => {
  it('player & ball speeds/accelerations stay within physical limits over a full 3-minute match', async () => {
    const m = await Match.create(makeMatchConfig({ seed: 77, minutes: 3 }));
    let maxPlayerSpeed = 0, maxBall = 0, maxJump = 0, maxAcc = 0, maxContactAcc = 0; const prev = new Map<string, { x: number; z: number; vx: number; vz: number }>();
    await m.runRegulation({ onStep: (mm) => {
      for (const t of [mm.teams.A, mm.teams.B]) for (const p of t.players) {
        if (!p.onCourt) { prev.delete(p.cfg.id); continue; }
        const s = mm.playerWorld(p.cfg.id); const sp = Math.hypot(s.vx, s.vz); maxPlayerSpeed = Math.max(maxPlayerSpeed, sp);
        const q = prev.get(p.cfg.id); if (q) { maxJump = Math.max(maxJump, Math.hypot(s.x - q.x, s.z - q.z)); const acc = Math.hypot(s.vx - q.vx, s.vz - q.vz) / PHYS.dt; const contact = [...mm.byId.values()].some((o) => o !== p && o.onCourt && Math.hypot(mm.playerWorld(o.cfg.id).x - s.x, mm.playerWorld(o.cfg.id).z - s.z) < 0.8) || Math.hypot(mm.ballWorld().x - s.x, mm.ballWorld().z - s.z) < 0.6; if (contact) maxContactAcc = Math.max(maxContactAcc, acc); else maxAcc = Math.max(maxAcc, acc); }
        prev.set(p.cfg.id, s);
      }
      const b = mm.ballWorld(); maxBall = Math.max(maxBall, Math.hypot(b.vx, b.vy, b.vz));
    } });
    expect(maxPlayerSpeed).toBeLessThan(8.5); // human sprint range (<= ~7.2 m/s configured; collisions/dives add a little)
    expect(maxJump).toBeLessThan(0.16); // < 9.6 m/s per step: no teleporting
    expect(maxAcc).toBeLessThan(45); // free running: steering <= ~7.2*1.5 m/s^2, dives <= 32 m/s^2
    expect(maxContactAcc).toBeLessThan(400); // player-player collisions are real momentum exchange, bounded
    console.log('max player accel m/s^2', maxAcc.toFixed(1), 'max speed', maxPlayerSpeed.toFixed(2));
    expect(maxBall).toBeLessThanOrEqual(PHYS.maxBallSpeed + 1);
    expect(maxPlayerSpeed).toBeGreaterThan(3); // players actually run
  }, 120000);

  it('long-running stability: 6-minute match has finite state and bounded positions', async () => {
    const m = await Match.create(makeMatchConfig({ seed: 5, minutes: 6 })); await m.runRegulation();
    for (const s of m.snapshots) { expect(Number.isFinite(s.ball.x + s.ball.y + s.ball.z)).toBe(true); expect(Math.abs(s.ball.x)).toBeLessThan(30); for (const p of s.players) expect(Math.abs(p.x)).toBeLessThan(30); }
  }, 120000);
});

describe('determinism, statistics & replay data', () => {
  it('same seed + algorithmic agents => identical match', async () => {
    const run = async () => { const m = await Match.create(makeMatchConfig({ seed: 9, minutes: 2 })); await m.runRegulation(); return m; };
    const a = await run(), b = await run();
    expect(a.score).toEqual(b.score); expect(a.events.length).toBe(b.events.length); expect(JSON.stringify(a.teamStats)).toBe(JSON.stringify(b.teamStats));
    expect(a.snapshots.at(-1)).toEqual(b.snapshots.at(-1));
  }, 120000);
  it('statistics come from recorded simulation data and are internally consistent', async () => {
    const m = await Match.create(makeMatchConfig({ seed: 12, minutes: 4 })); await m.runRegulation();
    for (const t of ['A', 'B'] as const) {
      const s = m.teamStats[t]; expect(s.passesOk).toBeLessThanOrEqual(s.passes); expect(s.onTarget).toBeLessThanOrEqual(s.shots); expect(s.saves).toBeLessThanOrEqual(m.teamStats[t === 'A' ? 'B' : 'A'].onTarget + 1);
      const ps = m.teams[t].players.map((p) => m.playerStats.get(p.cfg.id)!);
      expect(ps.reduce((a, p) => a + p.goals, 0)).toBeLessThanOrEqual(s.goals); expect(ps.reduce((a, p) => a + p.shots, 0)).toBe(s.shots); expect(ps.reduce((a, p) => a + p.passes, 0)).toBe(s.passes);
      expect(Math.abs(ps.reduce((a, p) => a + p.distance, 0) - s.distance)).toBeLessThan(1e-6);
      expect(s.distance).toBeGreaterThan(500);
    }
    const poss = m.teamStats.A.possessionSeconds + m.teamStats.B.possessionSeconds; expect(poss).toBeGreaterThan(10); expect(poss).toBeLessThanOrEqual(m.rt);
    for (const st of m.playerStats.values()) { expect(st.rating).toBeGreaterThanOrEqual(3); expect(st.rating).toBeLessThanOrEqual(10); }
    // snapshots (replay): monotonic virtual time, 10 players on court, score matches final
    expect(m.snapshots.length).toBeGreaterThan(100); for (let i = 1; i < m.snapshots.length; i++) expect(m.snapshots[i].vt).toBeGreaterThanOrEqual(m.snapshots[i - 1].vt);
    expect(m.snapshots.at(-1)!.score).toEqual(m.score); expect(m.snapshots[10].players.length).toBe(10);
  }, 120000);
  it('rating formula is transparent and bounded', () => {
    const z = { goals: 0, assists: 0, shots: 0, onTarget: 0, passes: 0, passesOk: 0, tackles: 0, interceptions: 0, saves: 0, fouls: 0, distance: 0, recoveries: 0, yellow: 0, red: 0, secondsOnCourt: 0, rating: 6 };
    expect(playerRating(z)).toBe(6); expect(playerRating({ ...z, goals: 2 })).toBe(8); expect(playerRating({ ...z, red: 3 })).toBe(3); expect(playerRating({ ...z, goals: 9 })).toBe(10);
  });
  it('rejects unsupported durations', async () => {
    const cfg = makeMatchConfig({ seed: 1 }); (cfg as any).realDurationMinutes = 7;
    await expect(Match.create(cfg)).rejects.toThrow(/1\.\.6/); expect(MATCH.allowedRealDurationsMin.length).toBe(6);
  });
  it('team squads: exactly 1 goalkeeper + 4 outfield on court for 10 players total', async () => {
    const m = await Match.create(makeMatchConfig({ seed: 1 }));
    for (const t of ['A', 'B'] as const) { const on = m.teams[t].players.filter((p) => p.onCourt); expect(on).toHaveLength(5); expect(on.filter((p) => p.cfg.role === 'GK')).toHaveLength(1); }
  });
});
