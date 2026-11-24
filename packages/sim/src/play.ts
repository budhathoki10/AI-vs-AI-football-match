import { COURT } from './config';
import { xgOf } from './xg';

/**
 * Football decision geometry as pure functions (no engine state), so every decision can be unit-tested with a hand-built situation.
 * Coordinates: x = length, z = width, metres, world frame. `dir` is the direction the team attacks (+1 / -1 along x).
 */
export interface PV { id: string; x: number; z: number; vx: number; vz: number; maxSpeed: number; role: string; gk: boolean; control: number /* 0..1 */ }
export type PassKind = 'short' | 'long' | 'through' | 'quick' | 'space' | 'back' | 'pressure';

/** Effective ground deceleration of the ball: rolling resistance (0.9 m/s^2) plus Rapier linear damping (0.08 /s). */
const A_ROLL = 0.9, DAMP = 0.08;
const aEff = (v: number) => A_ROLL + DAMP * v;

/** Launch speed so that a ground ball arrives after `d` metres still moving at `arrive` m/s. */
export function ballSpeedFor(d: number, arrive: number): number {
  let v = Math.sqrt(arrive * arrive + 2 * A_ROLL * d);
  for (let i = 0; i < 4; i++) v = Math.sqrt(arrive * arrive + 2 * aEff((v + arrive) / 2) * d);
  return v;
}
/** Time for a ground ball launched at v0 to cover s metres (Infinity if it stops first). */
export function ballTimeAt(s: number, v0: number): number {
  if (s <= 0) return 0; const a = aEff(v0 * 0.72); const disc = v0 * v0 - 2 * a * s; if (disc < 0) return Infinity; return (v0 - Math.sqrt(disc)) / a;
}
/** Ball speed after covering s metres. */
export function ballSpeedAt(s: number, v0: number): number { const a = aEff(v0 * 0.72); return Math.sqrt(Math.max(0, v0 * v0 - 2 * a * s)); }

/** Time for a player to reach a point: reaction + running at ~90% of top speed (moving towards the point helps, away hurts). */
export function reachTime(p: PV, x: number, z: number, radius = 0.45, reaction = 0.4): number {
  const d = Math.max(0, Math.hypot(x - p.x, z - p.z) - radius); if (d <= 0) return 0.05;
  const dx = x - p.x, dz = z - p.z, L = Math.hypot(dx, dz) || 1; const along = (p.vx * dx + p.vz * dz) / L;
  return reaction - 0.04 * Math.max(-3, Math.min(3, along)) + d / (0.9 * p.maxSpeed);
}

/** Probability that some opponent reaches the ball path (from -> to, launched at v0) before the ball does. */
export function interceptRisk(from: { x: number; z: number }, to: { x: number; z: number }, v0: number, opps: PV[]): { risk: number; by?: string } {
  const d = Math.hypot(to.x - from.x, to.z - from.z); if (d < 0.05) return { risk: 0 };
  const ux = (to.x - from.x) / d, uz = (to.z - from.z) / d; let keep = 1; let worst = 0; let by: string | undefined;
  for (const o of opps) {
    let r = 0;
    for (let s = 0; s <= d + 0.01; s += 0.4) {
      const px = from.x + ux * s, pz = from.z + uz * s; const tb = s === 0 ? 0 : ballTimeAt(s, v0); if (!isFinite(tb)) break;
      if (!o.gk && Math.hypot(o.x - px, o.z - pz) < (s === 0 ? 0.95 : 0.85)) { r = 1; break; } // standing on the ball's path (or in tackle range of the passer): it will be touched
      const to_ = reachTime(o, px, pz, o.gk ? 0.9 : 0.6, 0.12);
      r = Math.max(r, Math.max(0, Math.min(1, (tb - to_ + 0.15) / 0.45)));
    }
    keep *= 1 - r; if (r > worst) { worst = r; by = o.id; }
  }
  return { risk: 1 - keep, by };
}

export interface PassCtx {
  carrier: PV; mates: PV[]; opps: PV[]; dir: 1 | -1; risk: number; style: string; now: number;
  /** the previous completed pass (to discourage pointless back-and-forth) */
  recent: { from: string; to: string; t: number } | null;
}
export interface PassOption { toId: string; tx: number; tz: number; speed: number; arrive: number; kind: PassKind; score: number; intercept: number; eta: number; progress: number; threat: number; space: number; recvMargin: number; why: string }

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const goalAt = (dir: 1 | -1) => ({ x: dir * COURT.halfL, z: 0 });

/** How pressured is a player: distance (m) to the nearest opponent, ignoring the goalkeeper. */
export function nearestOpp(p: { x: number; z: number }, opps: PV[]): number { let d = 99; for (const o of opps) if (!o.gk) d = Math.min(d, Math.hypot(o.x - p.x, o.z - p.z)); return d; }

/** Chance estimate of a shot from a point (the fitted xG model, discounted when a defender is in the shooting line). */
export function shotThreat(x: number, z: number, dir: 1 | -1, opps: PV[]): number {
  const g = goalAt(dir); const dx = Math.abs(g.x - x); if (dx > 17) return 0; const base = xgOf(dx, z, COURT.goalWidth);
  let block = 1; const L = Math.hypot(g.x - x, g.z - z) || 1;
  for (const o of opps) { if (o.gk) continue; const t = clamp(((o.x - x) * (g.x - x) + (o.z - z) * (g.z - z)) / (L * L), 0, 1); const d = Math.hypot(o.x - (x + (g.x - x) * t), o.z - (z + (g.z - z) * t)); if (d < 1.1) block *= 0.45 + 0.5 * d / 1.1; }
  return base * block;
}

/**
 * Ranks every sensible pass for the carrier. Only teammates are ever candidates (an opponent can never be a target). Each candidate is judged by:
 * can the receiver get there in time, can an opponent cut the lane (arrival-time geometry, not just distance), how much it gains, the shot it creates,
 * the space the receiver gets, and whether it is just a pointless return to the previous passer.
 */
export function evaluatePasses(c: PassCtx): PassOption[] {
  const { carrier, opps, dir } = c; const out: PassOption[] = []; const pressure = nearestOpp(carrier, opps); const pressured = pressure < 2.3;
  const here = { x: carrier.x, z: carrier.z }; const baseU = carrier.x * dir;
  for (const m of c.mates) {
    if (m.id === carrier.id) continue;
    const d0 = Math.hypot(m.x - carrier.x, m.z - carrier.z); if (d0 < 1.4 || d0 > 20) continue;
    // candidate targets: to the receiver's feet (where he will be) and into the space ahead of his run
    const cands: { x: number; z: number; lead: boolean }[] = [];
    const arrive = pressured ? 4.6 : 3.4; let v0 = ballSpeedFor(d0, arrive); const tb0 = ballTimeAt(d0, v0); const px = m.x + m.vx * Math.min(tb0, 1.2) * 0.8, pz = m.z + m.vz * Math.min(tb0, 1.2) * 0.8;
    cands.push({ x: clamp(px, -COURT.halfL + 1, COURT.halfL - 1), z: clamp(pz, -COURT.halfW + 0.8, COURT.halfW - 0.8), lead: false });
    if (!m.gk && !(m.x * dir < baseU - 1)) { const lead = 2.2 + 0.8 * c.risk; cands.push({ x: clamp(px + dir * lead, -COURT.halfL + 1.5, COURT.halfL - 1.5), z: clamp(pz * 0.85, -COURT.halfW + 0.8, COURT.halfW - 0.8), lead: true }); }
    for (const t of cands) {
      const d = Math.hypot(t.x - carrier.x, t.z - carrier.z); if (d < 1.2) continue;
      v0 = ballSpeedFor(d, arrive); const eta = ballTimeAt(d, v0); if (!isFinite(eta)) continue;
      const recv = reachTime(m, t.x, t.z, 0.4); const margin = eta - recv; // > 0: receiver is there before the ball
      if (margin < -0.35) continue; // the ball would arrive before he can: not a real option
      const ir = interceptRisk(here, t, v0, opps); if (ir.risk > 0.8) continue;
      const progress = ((t.x * dir) - baseU) / 14; const threat = shotThreat(t.x, t.z, dir, opps);
      const space = clamp(nearestOpp(t, opps) / 4.5, 0, 1); const safety = 1 - ir.risk;
      const ownThird = baseU < -8;
      let kind: PassKind = 'short';
      if (t.lead && progress > 0.1) kind = 'through'; else if (t.lead) kind = 'space'; else if (progress < -0.1) kind = 'back'; else if (d > 10) kind = 'long'; else if (pressured && d < 6.5) kind = 'quick';
      if (pressured && kind !== 'quick' && d < 8 && safety > 0.7) kind = 'pressure';
      // value: forward progress and threat matter more for risk-takers; safety and space matter more for possession play
      let value = (0.36 + 0.3 * c.risk) * clamp(progress, -0.6, 1) + 0.55 * threat + 0.22 * space + 0.1 * clamp(margin, 0, 1);
      if (c.style === 'possession') value += 0.05 * (1 - Math.abs(progress)); if (c.style === 'direct' || c.style === 'counter') value += 0.07 * Math.max(0, progress);
      if (c.style === 'pivot_play' && m.role === 'PIVOT') value += 0.14; if (c.style === 'wing_play' && m.role === 'ALA' && Math.abs(t.z) > 5) value += 0.12;
      if (m.role === 'PIVOT' && progress > 0) value += 0.04;
      let score = safety * (value + 0.2) - 0.05;
      if (d < 2.6 && !pressured) score -= 0.16;                             // pointless tiny pass
      if (Math.abs(t.z) > 9.2) score -= 0.25;                                // will run out of play
      if (m.gk) score -= pressured && ownThird ? 0.1 : 0.45;                // the keeper is the safety valve, not a target
      if (c.recent && c.recent.from === m.id && c.recent.to === carrier.id && c.now - c.recent.t < 4) score -= pressured ? 0.1 : 0.4; // no ping-pong
      if (progress < -0.1 && !pressured && safety > 0.5) score -= 0.12;     // backwards only to keep the ball under pressure
      out.push({ toId: m.id, tx: t.x, tz: t.z, speed: v0, arrive, kind, score, intercept: ir.risk, eta, progress, threat, space, recvMargin: margin, why: `${kind} to ${m.id}: risk ${(ir.risk * 100).toFixed(0)}%, gain ${(progress * 14).toFixed(1)} m, space ${(space * 4.5).toFixed(1)} m` });
    }
  }
  // keep the best target per receiver, then rank
  const best = new Map<string, PassOption>(); for (const o of out) { const b = best.get(o.toId); if (!b || o.score > b.score) best.set(o.toId, o); }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** Value of simply carrying the ball: good when there is space and pressure is low, poor with a defender on top of you. */
export function dribbleValue(carrier: PV, opps: PV[], dir: 1 | -1, dribbling: number, risk: number): number {
  const pr = nearestOpp(carrier, opps); const space = clamp((pr - 1.2) / 3.5, 0, 1); const u = carrier.x * dir;
  return 0.1 + 0.34 * space + 0.1 * dribbling + 0.05 * risk + (u > 4 ? 0.06 : 0) - (u < -8 ? 0.08 : 0);
}
