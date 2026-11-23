import { COURT, PHYS, SHOOTOUT } from './config';
import { PhysicsWorld } from './physics';
import { fallbackPenaltyDecision, type PenaltyContext, type PenaltyDecision, type TeamAgent } from './agents';
import { Rng } from './rng';
import type { Match } from './match';
import type { TeamId } from './types';

export type PenaltyResult = 'goal' | 'saved' | 'missed' | 'post';
export interface ReplayFrame { t: number; bx: number; by: number; bz: number; kx: number; kz: number; tx: number; tz: number }
export interface PenaltyAttempt {
  index: number; round: number; team: TeamId; suddenDeath: boolean; takerId: string; keeperId: string;
  shot: { side: number; height: number; power: number; reason: string; usedFallback: boolean };
  keeper: { dive: number; reactDelay: number; reason: string; usedFallback: boolean };
  result: PenaltyResult; scoreAfter: [number, number]; frames: ReplayFrame[]; woodwork: boolean;
  ballSpeed: number; ballTarget: { z: number; y: number } | null;
}
export interface ShootoutResult {
  winner: TeamId; score: [number, number]; attempts: PenaltyAttempt[]; rounds: number; suddenDeathRounds: number;
  decidedBy: 'regulation_rounds' | 'early_termination' | 'sudden_death' | 'safety_fallback'; fallbackNote?: string; firstTeam: TeamId;
  stats: Record<TeamId, { attempts: number; scored: number; missed: number; saved: number; post: number; suddenDeathAttempts: number; keepersUsed: string[]; takers: string[] }>;
}

const sleepTick = () => new Promise<void>((r) => setImmediate(r));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

async function ask<T>(f: (() => T | Promise<T>) | undefined, fb: () => T): Promise<{ v: T; fallback: boolean }> {
  if (!f) return { v: fb(), fallback: true };
  try { return { v: await f(), fallback: false }; } catch { return { v: fb(), fallback: true }; }
}

/** One real 1v1 physics attempt: taker runs up and strikes a real impulse; keeper dives with a real impulse; result read from the ball. */
export function simulateAttempt(taker: { shooting: number; ballControl: number }, keeper: { goalkeeping: number; agility: number }, shot: { side: number; height: number; power: number }, dive: { dive: number; reactDelay: number }, rng: Rng) {
  const w = new PhysicsWorld();
  const goalX = COURT.halfL; const spotX = goalX - COURT.penaltyMark;
  w.addPlayer('T', spotX - 2.4, 0); w.addPlayer('K', goalX - 0.55, 0, true);
  w.placeBall(spotX, PHYS.ballRadius + 0.002, 0);
  const frames: ReplayFrame[] = []; let kicked = false, tKick = -1, kickStep = -1, diveDone = false, diveZ = 0, diveLeft = 0, saved = false, wood = false, result: PenaltyResult | null = null;
  const sh = taker.shooting / 100; let ballSpeed = 0; let target: { z: number; y: number } | null = null;
  const keeperSkill = keeper.goalkeeping / 100;
  const maxSteps = Math.round(SHOOTOUT.attemptMaxSeconds / PHYS.dt);
  for (let i = 0; i < maxSteps; i++) {
    const t = i * PHYS.dt; const ts = w.playerState('T'); const bs0 = w.ballState();
    if (!kicked) {
      // run-up: accelerate towards the ball, strike when within reach (never teleported)
      const d = Math.hypot(bs0.x - ts.x, bs0.z - ts.z);
      w.accelPlayer('T', clamp((bs0.x - ts.x) * 3 - ts.vx * 1.0, -5, 5), clamp((bs0.z - ts.z) * 3 - ts.vz, -5, 5));
      if (d < 0.62 && t > 0.35) {
        const zt = clamp(shot.side, -1, 1) * 1.2 + rng.gauss() * ((1 - sh) * 0.28 + 0.06 + shot.power * 0.08);
        const yt = 0.12 + clamp(shot.height, 0, 1) * 1.6 + rng.gauss() * ((1 - sh) * 0.16 + 0.04);
        const speed = 11 + 13 * clamp(shot.power, 0.3, 1) * (0.55 + 0.45 * sh);
        const dx = goalX - bs0.x; const horiz = Math.hypot(dx, zt - bs0.z); const tt = horiz / speed;
        const vy = clamp((yt - bs0.y + 0.5 * 9.81 * tt * tt) / tt, 0, 8);
        w.kickBall((dx / horiz) * speed, vy, ((zt - bs0.z) / horiz) * speed);
        kicked = true; tKick = t; kickStep = i; ballSpeed = speed; target = { z: zt, y: yt };
      }
    }
    const ks = w.playerState('K');
    if (!diveDone && (dive.dive !== 0 || keeperSkill > 0.3)) {
      const anticipate = dive.reactDelay < 0 && !kicked && Math.hypot(bs0.x - ts.x, bs0.z - ts.z) < 1.3;
      const afterKick = kicked && t - tKick >= Math.max(0, dive.reactDelay) + 0.06 * (1 - keeperSkill);
      if (anticipate || afterKick) {
        let zTarget = dive.dive * 1.15;
        if (kicked) { // the keeper can read the shot once struck: blend towards the real trajectory crossing
          const b = w.ballState(); const tt = (goalX - b.x) / Math.max(b.vx, 0.1); const zc = b.z + b.vz * tt;
          const read = clamp(keeperSkill * 0.65 - (dive.reactDelay > 0.12 ? 0.2 : 0), 0, 0.85);
          zTarget = dive.dive === 0 ? zc * read : zTarget * (1 - read) + zc * read;
        }
        const maxV = 4.5 + 4.0 * (keeper.agility / 100) * (0.55 + 0.45 * keeperSkill);
        diveZ = zTarget; diveLeft = 0.4; (w as any)._maxV = maxV; diveDone = true;
      }
    }
    if (diveLeft > 0) { // acceleration-limited dive (<= 32 m/s^2), not an instant velocity change
      const kk = w.playerState('K'); const mv = (w as any)._maxV as number;
      w.accelPlayer('K', 0, clamp((clamp((diveZ - kk.z) * 4.5, -mv, mv) - kk.vz) / PHYS.dt, -32, 32)); diveLeft -= PHYS.dt;
    }
    w.step();
    const b = w.ballState();
    if (w.woodwork) wood = true;
    for (const c of w.contacts) if (c.playerId === 'K' && kicked && !saved && result === null) { saved = true; }
    if (i % 2 === 0) { const k2 = w.playerState('K'), t2 = w.playerState('T'); frames.push({ t: +t.toFixed(3), bx: +b.x.toFixed(3), by: +b.y.toFixed(3), bz: +b.z.toFixed(3), kx: +k2.x.toFixed(3), kz: +k2.z.toFixed(3), tx: +t2.x.toFixed(3), tz: +t2.z.toFixed(3) }); }
    if (kicked && i > kickStep) {
      if (saved) { result = 'saved'; }
      else if (b.x > goalX + PHYS.ballRadius && Math.abs(b.z) < COURT.goalWidth / 2 && b.y < COURT.goalHeight) result = 'goal';
      else if (b.x > goalX + PHYS.ballRadius || Math.abs(b.z) > COURT.halfW) result = wood ? 'post' : 'missed';
      else if (b.y > 2.6 && b.x > goalX - 0.5) result = wood ? 'post' : 'missed';
      else if (Math.hypot(b.vx, b.vz) < 0.25 && b.y < 0.2 && i - kickStep > 30) result = wood ? 'post' : 'missed';
      if (result) { for (let k = 0; k < 30; k++) { w.step(); if (k % 2 === 0) { const bb = w.ballState(), k2 = w.playerState('K'), t2 = w.playerState('T'); frames.push({ t: +(((i + k) * PHYS.dt)).toFixed(3), bx: +bb.x.toFixed(3), by: +bb.y.toFixed(3), bz: +bb.z.toFixed(3), kx: +k2.x.toFixed(3), kz: +k2.z.toFixed(3), tx: +t2.x.toFixed(3), tz: +t2.z.toFixed(3) }); } } break; }
    }
  }
  w.free();
  return { result: result ?? 'missed', frames, woodwork: wood, ballSpeed, target };
}

export async function runShootout(match: Match, opts: { firstTeam?: TeamId; suddenDeathMax?: number; simulate?: typeof simulateAttempt } = {}): Promise<ShootoutResult> {
  const rng = new Rng(match.cfg.seed ^ 0x5eed);
  const first: TeamId = opts.firstTeam ?? (rng.next() < 0.5 ? 'A' : 'B'); // coin toss, recorded in the result
  const maxSD = opts.suddenDeathMax ?? SHOOTOUT.suddenDeathMaxRounds;
  match.phase = 'shootout';
  match.events.push({ id: match.events.length + 1000, type: 'shootout_start', vt: 5400, half: 2, detail: `first: ${first}` });
  const score: [number, number] = [0, 0]; const attempts: PenaltyAttempt[] = [];
  const stats = { A: { attempts: 0, scored: 0, missed: 0, saved: 0, post: 0, suddenDeathAttempts: 0, keepersUsed: [] as string[], takers: [] as string[] }, B: { attempts: 0, scored: 0, missed: 0, saved: 0, post: 0, suddenDeathAttempts: 0, keepersUsed: [] as string[], takers: [] as string[] } };
  const elig = (t: TeamId) => match.teams[t].players.filter((p) => !p.red);
  const n = Math.min(elig('A').length, elig('B').length);
  const roster: Record<TeamId, typeof match.teams.A.players> = {
    A: elig('A').sort((a, b) => b.cfg.attributes.shooting - a.cfg.attributes.shooting).slice(0, n),
    B: elig('B').sort((a, b) => b.cfg.attributes.shooting - a.cfg.attributes.shooting).slice(0, n),
  };
  const used: Record<TeamId, Set<string>> = { A: new Set(), B: new Set() };
  const history: PenaltyContext['history'] = [];
  const keeperOf = (t: TeamId) => elig(t).filter((p) => p.cfg.role === 'GK').sort((a, b) => b.cfg.attributes.goalkeeping - a.cfg.attributes.goalkeeping)[0] ?? elig(t).sort((a, b) => b.cfg.attributes.goalkeeping - a.cfg.attributes.goalkeeping)[0];
  let decidedBy: ShootoutResult['decidedBy'] = 'regulation_rounds'; let fallbackNote: string | undefined; let rounds = 0; let winner: TeamId | null = null;
  const order: TeamId[] = [first, first === 'A' ? 'B' : 'A'];
  const remaining = (t: TeamId, round: number) => Math.max(0, SHOOTOUT.regularRounds - (stats[t].attempts - (round > SHOOTOUT.regularRounds ? 0 : 0)));

  const kickOne = async (team: TeamId, round: number, sd: boolean) => {
    const opp: TeamId = team === 'A' ? 'B' : 'A';
    const ag: TeamAgent = match.teams[team].agent, og: TeamAgent = match.teams[opp].agent;
    let pool = roster[team].filter((p) => !used[team].has(p.cfg.id)); if (!pool.length) { used[team].clear(); pool = roster[team]; }
    const keeper = keeperOf(opp);
    const sIdx = team === 'A' ? 0 : 1;
    const ctxShoot: PenaltyContext = { role: 'shoot', round, suddenDeath: sd, ownScore: score[sIdx], oppScore: score[1 - sIdx], history: history.map((h) => ({ ...h })), eligible: pool.map((p) => ({ id: p.cfg.id, shooting: p.cfg.attributes.shooting, role: p.cfg.role })), keepers: [{ id: keeper.cfg.id, goalkeeping: keeper.cfg.attributes.goalkeeping }] };
    const ctxKeep: PenaltyContext = { ...ctxShoot, role: 'defend', ownScore: score[1 - sIdx], oppScore: score[sIdx], eligible: [] };
    const fbS = () => fallbackPenaltyDecision(ctxShoot, rng.next());
    const fbK = () => fallbackPenaltyDecision(ctxKeep, rng.next());
    const [sa, ka] = await Promise.all([ask<PenaltyDecision>(ag.decidePenalty ? () => ag.decidePenalty!(ctxShoot) : undefined, fbS), ask<PenaltyDecision>(og.decidePenalty ? () => og.decidePenalty!(ctxKeep) : undefined, fbK)]);
    let sd1 = sa.v, fbS1 = sa.fallback;
    const valid = (d: PenaltyDecision) => d && typeof d.takerId === 'string' && pool.some((p) => p.cfg.id === d.takerId) && Number.isFinite(d.side) && Math.abs(d.side!) <= 1 && Number.isFinite(d.height) && d.height! >= 0 && d.height! <= 1 && Number.isFinite(d.power) && d.power! >= 0.3 && d.power! <= 1;
    if (!valid(sd1)) { sd1 = fbS(); fbS1 = true; }
    let kd = ka.v, fbK1 = ka.fallback;
    if (!kd || ![-1, 0, 1].includes(kd.dive as number) || !Number.isFinite(kd.reactDelay ?? 0) || (kd.reactDelay ?? 0) < -0.5 || (kd.reactDelay ?? 0) > 0.6) { kd = fbK(); fbK1 = true; }
    const taker = roster[team].find((p) => p.cfg.id === sd1.takerId) ?? pool[0];
    used[team].add(taker.cfg.id);
    const sim = (opts.simulate ?? simulateAttempt)(taker.cfg.attributes, keeper.cfg.attributes, { side: sd1.side!, height: sd1.height!, power: sd1.power! }, { dive: kd.dive ?? 0, reactDelay: kd.reactDelay ?? 0.08 }, rng);
    if (sim.result === 'goal') score[sIdx]++;
    const st = stats[team]; st.attempts++; if (sd) st.suddenDeathAttempts++; st.takers.push(taker.cfg.id);
    if (sim.result === 'goal') st.scored++; else if (sim.result === 'saved') st.saved++; else if (sim.result === 'post') { st.post++; st.missed++; } else st.missed++;
    if (!stats[opp].keepersUsed.includes(keeper.cfg.id)) stats[opp].keepersUsed.push(keeper.cfg.id);
    history.push({ team, takerId: taker.cfg.id, result: sim.result, side: sd1.side! });
    attempts.push({ index: attempts.length + 1, round, team, suddenDeath: sd, takerId: taker.cfg.id, keeperId: keeper.cfg.id, shot: { side: sd1.side!, height: sd1.height!, power: sd1.power!, reason: sd1.reason?.slice(0, 200) ?? '', usedFallback: fbS1 }, keeper: { dive: kd.dive ?? 0, reactDelay: kd.reactDelay ?? 0, reason: kd.reason?.slice(0, 200) ?? '', usedFallback: fbK1 }, result: sim.result, scoreAfter: [score[0], score[1]], frames: sim.frames, woodwork: sim.woodwork, ballSpeed: sim.ballSpeed, ballTarget: sim.target });
    await sleepTick();
  };

  // opening phase: 5 rounds, alternating, early termination when unassailable
  outer: for (let round = 1; round <= SHOOTOUT.regularRounds; round++) {
    for (const team of order) {
      await kickOne(team, round, false); rounds = round;
      const a = score[0], b = score[1];
      const remA = SHOOTOUT.regularRounds - stats.A.attempts, remB = SHOOTOUT.regularRounds - stats.B.attempts;
      if (a > b + remB) { winner = 'A'; decidedBy = 'early_termination'; break outer; }
      if (b > a + remA) { winner = 'B'; decidedBy = 'early_termination'; break outer; }
    }
  }
  void remaining;
  let sdRounds = 0;
  if (!winner && score[0] === score[1]) {
    for (let k = 1; k <= maxSD && !winner; k++) {
      sdRounds = k; const round = SHOOTOUT.regularRounds + k;
      for (const team of order) await kickOne(team, round, true);
      rounds = round; if (score[0] !== score[1]) { winner = score[0] > score[1] ? 'A' : 'B'; decidedBy = 'sudden_death'; }
    }
    if (!winner) { // documented deterministic fallback: aggregate skill of takers used + keepers, then a seeded coin recorded in the note
      const sk = (t: TeamId) => roster[t].reduce((a, p) => a + p.cfg.attributes.shooting, 0) + keeperOf(t === 'A' ? 'B' : 'A').cfg.attributes.goalkeeping * 0 + keeperOf(t).cfg.attributes.goalkeeping;
      const sa = sk('A'), sb = sk('B');
      winner = sa !== sb ? (sa > sb ? 'A' : 'B') : rng.next() < 0.5 ? 'A' : 'B'; decidedBy = 'safety_fallback';
      fallbackNote = `Sudden death hit the safety limit of ${maxSD} rounds. Winner decided by aggregate squad skill (${sa} vs ${sb}), then a seeded coin if equal.`;
    }
  } else if (!winner) { winner = score[0] > score[1] ? 'A' : 'B'; decidedBy = 'regulation_rounds'; }
  const res: ShootoutResult = { winner: winner!, score, attempts, rounds, suddenDeathRounds: sdRounds, decidedBy, fallbackNote, firstTeam: first, stats };
  match.shootout = res; match.phase = 'finished';
  return res;
}
