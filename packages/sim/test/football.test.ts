import { describe, it, expect } from 'vitest';
import { ballSpeedFor, ballSpeedAt, ballTimeAt, evaluatePasses, interceptRisk, reachTime, type PV } from '../src/play';
import { liveMatch, evs } from './helpers';

const pv = (id: string, x: number, z: number, o: Partial<PV> = {}): PV => ({ id, x, z, vx: 0, vz: 0, maxSpeed: 5.4, role: 'ALA', gk: false, control: 0.7, ...o });
const ctx = (carrier: PV, mates: PV[], opps: PV[], o: any = {}) => ({ carrier, mates, opps, dir: 1 as const, risk: 0.5, style: 'balanced', now: 10, recent: null, ...o });
const step = (m: any, n: number) => { for (let i = 0; i < n; i++) m.step(); };
/** keep keepers out of the way and park everybody else far from the test area */
function clearPitch(m: any) {
  for (const t of ['A', 'B']) m.onCourt(t).forEach((p: any, i: number) => m.phys.placePlayer(p.cfg.id, t === 'A' ? -19 : 19, -9 + i * 1.2));
  for (const t of ['A', 'B']) { const gk = m.onCourt(t).find((p: any) => m.isKeeper(p)); if (gk) m.phys.placePlayer(gk.cfg.id, t === 'A' ? -19.5 : 19.5, 0); }
  for (const p of m.byId.values()) if (p.onCourt) { const w = m.playerWorld(p.cfg.id); p.tx = w.x; p.tz = w.z; }
}

describe('pass geometry (pure)', () => {
  it('launch speed makes the ball arrive at the requested speed and the time matches', () => {
    for (const d of [4, 8, 14]) { const v0 = ballSpeedFor(d, 3.4); expect(ballSpeedAt(d, v0)).toBeGreaterThan(2.9); expect(ballSpeedAt(d, v0)).toBeLessThan(3.9); expect(ballTimeAt(d, v0)).toBeGreaterThan(d / v0); }
  });
  it('only teammates are ever offered as targets, never an opponent', () => {
    const opts = evaluatePasses(ctx(pv('A3', 0, 0), [pv('A2', 6, 3), pv('A4', 5, -4)], [pv('B2', -5, 6), pv('B3', -6, -6)]));
    expect(opts.length).toBeGreaterThan(0); for (const o of opts) expect(['A2', 'A4']).toContain(o.toId);
  });
  it('a defender standing in the lane makes that pass unattractive or impossible', () => {
    const open = evaluatePasses(ctx(pv('A3', 0, 0), [pv('A2', 8, 0)], [pv('B2', -6, 8)]))[0];
    const blocked = evaluatePasses(ctx(pv('A3', 0, 0), [pv('A2', 8, 0)], [pv('B2', 4, 0)]))[0];
    expect(open).toBeDefined(); expect(open.intercept).toBeLessThan(0.3);
    if (blocked) expect(blocked.score).toBeLessThan(open.score - 0.1);
  });
  it('interception risk grows as an opponent gets closer to the ball path', () => {
    const far = interceptRisk({ x: 0, z: 0 }, { x: 8, z: 0 }, ballSpeedFor(8, 3.4), [pv('B2', 4, 6)]).risk;
    const near = interceptRisk({ x: 0, z: 0 }, { x: 8, z: 0 }, ballSpeedFor(8, 3.4), [pv('B2', 4, 1.2)]).risk;
    const on = interceptRisk({ x: 0, z: 0 }, { x: 8, z: 0 }, ballSpeedFor(8, 3.4), [pv('B2', 4, 0.2)]).risk;
    expect(near).toBeGreaterThan(far); expect(on).toBe(1);
  });
  it('a receiver who cannot get there in time is not a real option', () => {
    expect(evaluatePasses(ctx(pv('A3', 0, 0), [pv('A2', 3, 9, { maxSpeed: 2 })], [])).filter((o) => !o.kind.startsWith('through') && o.recvMargin < -0.35)).toHaveLength(0);
  });
  it('does not return the ball to the player who just passed it unless forced', () => {
    const base = evaluatePasses(ctx(pv('A3', 0, 0), [pv('A2', -4, 2), pv('A4', 5, 3)], [pv('B2', 7, -3)]));
    const recent = evaluatePasses(ctx(pv('A3', 0, 0), [pv('A2', -4, 2), pv('A4', 5, 3)], [pv('B2', 7, -3)], { recent: { from: 'A2', to: 'A3', t: 9 } }));
    const a2 = (l: any[]) => l.find((o) => o.toId === 'A2')?.score ?? -9; expect(a2(recent)).toBeLessThan(a2(base) - 0.2);
  });
  it('reach time grows with distance and shrinks for a defender already moving there', () => {
    expect(reachTime(pv('B2', 0, 0), 6, 0)).toBeGreaterThan(reachTime(pv('B2', 0, 0), 3, 0));
    expect(reachTime(pv('B2', 0, 0, { vx: 4 }), 6, 0)).toBeLessThan(reachTime(pv('B2', 0, 0, { vx: -4 }), 6, 0));
  });
});

describe('engine scenarios', () => {
  it('a pass to a teammate arrives, is controlled, and the receiver becomes the single owner', async () => {
    const m: any = await liveMatch(21); clearPitch(m);
    m.phys.placePlayer('A3', -2, 0); m.phys.placePlayer('A4', 5, 3); m.phys.placeBall(-1.5, 0.12, 0);
    m.lastTouch = { pid: 'A3', team: 'A', rt: m.rt }; m.owner = 'A3';
    const A3 = m.byId.get('A3'); const opts = m.passOptions(A3); const o = opts.find((x: any) => x.toId === 'A4'); expect(o).toBeDefined();
    A3.plan = { type: 'pass', tx: o.tx, tz: o.tz, speed: o.speed, lift: 0, toId: 'A4', until: m.rt + 1 }; m.teams.A.passTarget = { id: 'A4', until: m.rt + 4, tx: o.tx, tz: o.tz, eta: m.rt + o.eta };
    let completed = false; for (let i = 0; i < 360 && !completed; i++) { m.step(); completed = m.owner === 'A4'; }
    expect(completed).toBe(true); expect(m.possessionTeam()).toBe('A');
  });
  it('an opponent standing in the lane intercepts and possession flips to him', async () => {
    const m: any = await liveMatch(22); clearPitch(m);
    m.phys.placePlayer('A3', -3, 0); m.phys.placePlayer('A4', 6, 0); m.phys.placePlayer('B3', 1.5, 0.1); m.phys.placeBall(-2.5, 0.12, 0);
    m.lastTouch = { pid: 'A3', team: 'A', rt: m.rt }; m.owner = 'A3';
    m.kickTo(m.byId.get('A3'), 6, 0, 8, 0, 'pass', 0.01); m.teams.A.passTarget = { id: 'A4', until: m.rt + 3, tx: 6, tz: 0, eta: m.rt + 1 };
    for (let i = 0; i < 240 && m.possessionTeam() === 'A'; i++) m.step();
    expect(m.possessionTeam()).toBe('B');
  });
  it('a dribbler keeps the ball at his feet while carrying it (owner stays within reach)', async () => {
    const m: any = await liveMatch(23); clearPitch(m);
    m.phys.placePlayer('A3', -8, 0); m.phys.placeBall(-7.5, 0.12, 0); m.lastTouch = { pid: 'A3', team: 'A', rt: m.rt }; m.owner = 'A3';
    const A3 = m.byId.get('A3'); let maxGap = 0; let ownedTicks = 0;
    for (let i = 0; i < 180; i++) { A3.plan = { type: 'dribble', tx: 4, tz: 0, speed: 0, lift: 0, until: m.rt + 0.5 }; A3.tx = 4; A3.tz = 0; A3.sf = 0.9; m.step(); const b = m.ballWorld(), s = m.playerWorld('A3'); maxGap = Math.max(maxGap, Math.hypot(b.x - s.x, b.z - s.z)); if (m.owner === 'A3') ownedTicks++; }
    expect(maxGap).toBeLessThan(2.2); expect(ownedTicks).toBeGreaterThan(120); expect(m.playerWorld('A3').x).toBeGreaterThan(-6);
  });
  it('the ball has exactly one owner at a time and the owner is always within reach of it', async () => {
    const m: any = await liveMatch(24, 1); m.play = 'live'; let bad = 0, n = 0;
    for (let i = 0; i < 3000; i++) { m.step(); if (m.play !== 'live' || !m.owner) continue; n++; const b = m.ballWorld(), s = m.playerWorld(m.owner); if (Math.hypot(b.x - s.x, b.z - s.z) > 2.5) bad++; }
    expect(n).toBeGreaterThan(100); expect(bad).toBe(0);
  });
  it('players do not overlap or pass through each other during live play', async () => {
    const m: any = await liveMatch(25, 1); let overlaps = 0, pairs = 0;
    for (let i = 0; i < 2400; i++) { m.step(); if (m.play !== 'live') continue; const ps = [...m.byId.values()].filter((p: any) => p.onCourt).map((p: any) => m.playerWorld(p.cfg.id)); for (let a = 0; a < ps.length; a++) for (let c = a + 1; c < ps.length; c++) { pairs++; if (Math.hypot(ps[a].x - ps[c].x, ps[a].z - ps[c].z) < 0.4) overlaps++; } }
    expect(overlaps / pairs).toBeLessThan(0.0005);
  });
  it('defenders mark: the nearest defender goes to the carrier while the others do not all chase', async () => {
    const m: any = await liveMatch(26); clearPitch(m);
    m.phys.placePlayer('A3', 2, 0); m.phys.placeBall(2.4, 0.12, 0); m.owner = 'A3'; m.lastTouch = { pid: 'A3', team: 'A', rt: m.rt };
    m.phys.placePlayer('A4', 7, 6); m.phys.placePlayer('A5', 6, -6); m.phys.placePlayer('A2', -4, 0);
    m.phys.placePlayer('B2', 5, 0); m.phys.placePlayer('B3', 8, 5); m.phys.placePlayer('B4', 8, -5); m.phys.placePlayer('B5', 12, 0);
    step(m, 30); const acts = ['B2', 'B3', 'B4', 'B5'].map((id) => m.byId.get(id).act);
    expect(acts.filter((a) => a === 'press' || a === 'chase')).toHaveLength(1); expect(acts.filter((a) => a === 'mark' || a === 'cover' || a === 'hold').length).toBeGreaterThanOrEqual(2);
  });
  it('supporters spread out around the carrier instead of stacking on him', async () => {
    const m: any = await liveMatch(27); clearPitch(m);
    m.phys.placePlayer('A3', 0, 0); m.phys.placeBall(0.4, 0.12, 0); m.owner = 'A3'; m.lastTouch = { pid: 'A3', team: 'A', rt: m.rt };
    m.phys.placePlayer('A2', -1.5, 1); m.phys.placePlayer('A4', 1.5, -1); m.phys.placePlayer('A5', 0, 2);
    m.phys.placePlayer('B2', 10, 4); m.phys.placePlayer('B3', 10, -4); m.phys.placePlayer('B4', 12, 0); m.phys.placePlayer('B5', 14, 2);
    for (const id of ['A2', 'A4', 'A5']) m.byId.get(id).plan = null; step(m, 150);
    const c = m.playerWorld('A3'); for (const id of ['A2', 'A4', 'A5']) { const s = m.playerWorld(id); expect(Math.hypot(s.x - c.x, s.z - c.z)).toBeGreaterThan(2.2); }
  });
  it('a shot is a physical ball: leaves the shooter at speed, never teleports, and a goalkeeper in line reacts', async () => {
    const m: any = await liveMatch(28); clearPitch(m);
    m.phys.placePlayer('A3', 12, 1); m.phys.placeBall(12.4, 0.12, 1); m.owner = 'A3'; m.lastTouch = { pid: 'A3', team: 'A', rt: m.rt };
    m.phys.placePlayer('B1', 19.4, 0.2); const gk0 = m.playerWorld('B1');
    m.kickTo(m.byId.get('A3'), 20, -1, 20, 0.2, 'shoot', 0.01); let prev = m.ballWorld(), maxJump = 0;
    for (let i = 0; i < 90 && m.play === 'live'; i++) { m.step(); if (m.play !== 'live') break; const b = m.ballWorld(); maxJump = Math.max(maxJump, Math.hypot(b.x - prev.x, b.z - prev.z)); prev = b; }
    expect(maxJump).toBeLessThan(0.6); const gk1 = m.playerWorld('B1'); expect(Math.hypot(gk1.x - gk0.x, gk1.z - gk0.z) + Math.abs(gk1.vz)).toBeGreaterThan(0.05);
    expect(evs(m, 'shot').length + evs(m, 'goal').length + evs(m, 'save').length).toBeGreaterThan(0);
  });
  it('a full 3 minute match stays consistent: scores match goal events, no ball teleports, clock completes', async () => {
    const m: any = await liveMatch(29, 3); let prev = m.ballWorld(), teleports = 0;
    await m.runRegulation({ onStep: (mm: any) => { const b = mm.ballWorld(); if (mm.play === 'live' && Math.hypot(b.x - prev.x, b.z - prev.z) > 1) teleports++; prev = b; } });
    expect(teleports).toBe(0); expect(evs(m, 'goal').length).toBe(m.score[0] + m.score[1]);
    expect(m.teamStats.A.tackles + m.teamStats.B.tackles).toBeGreaterThan(0);
  }, 120000);
});
describe('restarts', () => {
  it('no restart stalls, over many different matches', async () => {
    for (const seed of [41, 45, 77, 101, 202, 303, 404, 505]) {
      const m: any = await liveMatch(seed, 1); let longest = 0, since = 0, cur: any = null;
      await m.runRegulation({ onStep: (mm: any) => { const r = mm.restart; if (r && cur !== r) { cur = r; since = mm.rt; } if (!r) cur = null; else longest = Math.max(longest, mm.rt - since); } });
      expect(longest, 'seed ' + seed).toBeLessThan(15);
    }
  }, 120000);
  it('a kick-in leaves at close to the planned speed (the taker does not drive it into his own legs) and starts on the line', async () => {
    const m: any = await liveMatch(31); clearPitch(m); m.play = 'restart';
    m.phys.placePlayer('A3', 6, 8); m.phys.placePlayer('A4', 2, 3);
    m.startRestart('kick_in', 'A', 6, 10, 0.2, true); m.restart.takerId = 'A3';
    let peak = 0, started = 0; for (let i = 0; i < 600 && m.restart && !m.restart.kicked; i++) m.step();
    expect(m.restart === null || m.restart.kicked).toBe(true);
    for (let i = 0; i < 20; i++) { m.step(); const b = m.ballWorld(); peak = Math.max(peak, Math.hypot(b.vx, b.vz)); started = Math.max(started, Math.abs(b.z)); }
    expect(peak).toBeGreaterThan(4); expect(started).toBeLessThan(11);
  });
});
