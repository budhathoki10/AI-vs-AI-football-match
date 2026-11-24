// Usage: npx tsx scripts/audit.ts [matches=4] [minutes=3]
// Football-behaviour audit of the simulation engine: measures movement, passing, possession, spacing and ball behaviour over whole matches.
import { initPhysics, Match, makeMatchConfig } from '../packages/sim/src';

const N = Number(process.argv[2] ?? 4); const MIN = Number(process.argv[3] ?? 3) as 1 | 2 | 3 | 4 | 5 | 6;
await initPhysics();
const agg = { ticks: 0, live: 0, maxSpeed: 0, reversals: 0, movingSamples: 0, headingMismatch: 0, headingSamples: 0, overlapTicks: 0, pairTicks: 0, clusterTicks: 0, chasersSum: 0, chasersN: 0, accelOver: 0, ballTeleports: 0,
  passes: 0, passesOk: 0, interceptions: 0, pingPong: 0, passLog: 0, owners: 0, ownerFlips: 0, shots: 0, goals: 0, outs: 0, tackles: 0, recoveries: 0, spacingSum: 0, spacingN: 0, tooClose: 0, ballDetached: 0, ownerSamples: 0 };
for (let i = 0; i < N; i++) {
  const m: any = await Match.create(makeMatchConfig({ seed: 300 + i * 17, minutes: MIN }));
  const prevV = new Map<string, [number, number]>(); const prevBall = { x: 0, y: 0, z: 0 }; const lastEvents = 0; const logs: { t: number; from: string; to: string }[] = []; let lastOwner: string | null = null;
  const orig = m.commitPass.bind(m); m.commitPass = (p: any, o: any, r: boolean) => { logs.push({ t: m.rt, from: p.cfg.id, to: o.toId }); return orig(p, o, r); };
  await m.runRegulation({ onStep: (mm: any) => {
    agg.ticks++; const live = mm.play === 'live'; if (live) agg.live++;
    const b = mm.ballWorld(); const players = [...mm.byId.values()].filter((p: any) => p.onCourt);
    const bj = Math.hypot(b.x - prevBall.x, b.y - prevBall.y, b.z - prevBall.z); if (live && bj > 1) agg.ballTeleports++; prevBall.x = b.x; prevBall.y = b.y; prevBall.z = b.z;
    for (const p of players) {
      const s = mm.playerWorld(p.cfg.id); const sp = Math.hypot(s.vx, s.vz); agg.maxSpeed = Math.max(agg.maxSpeed, sp);
      const pv = prevV.get(p.cfg.id); if (pv) { const a = Math.hypot(s.vx - pv[0], s.vz - pv[1]) * 60; if (a > 14 && live) agg.accelOver++; }
      if (mm.tick % 6 === 0) { const q = prevV.get(p.cfg.id + 'k'); if (q && sp > 2 && Math.hypot(q[0], q[1]) > 2) { const dot = (s.vx * q[0] + s.vz * q[1]) / (sp * Math.hypot(q[0], q[1])); agg.movingSamples++; if (dot < -0.5) agg.reversals++; } prevV.set(p.cfg.id + 'k', [s.vx, s.vz]); }
      prevV.set(p.cfg.id, [s.vx, s.vz]);
      if (sp > 1.5) { let d = Math.atan2(s.vz, s.vx) - p.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; agg.headingSamples++; if (Math.abs(d) > 0.9) agg.headingMismatch++; }
    }
    if (!live) return;
    for (let a = 0; a < players.length; a++) for (let c = a + 1; c < players.length; c++) { const sa = mm.playerWorld(players[a].cfg.id), sc = mm.playerWorld(players[c].cfg.id); const d = Math.hypot(sa.x - sc.x, sa.z - sc.z); agg.pairTicks++; if (d < 0.5) agg.overlapTicks++; if (players[a].team === players[c].team && d < 1.6) agg.tooClose++; }
    for (const t of ['A', 'B'] as const) {
      const out = players.filter((p: any) => p.team === t && p.cfg.role !== 'GK'); let near = 0; for (const p of out) { const s = mm.playerWorld(p.cfg.id); if (Math.hypot(s.x - b.x, s.z - b.z) < 3.5) near++; }
      agg.chasersSum += near; agg.chasersN++; if (near >= 3) agg.clusterTicks++;
      let sum = 0, n = 0; for (let a = 0; a < out.length; a++) for (let c = a + 1; c < out.length; c++) { const sa = mm.playerWorld(out[a].cfg.id), sc = mm.playerWorld(out[c].cfg.id); sum += Math.hypot(sa.x - sc.x, sa.z - sc.z); n++; } if (n) { agg.spacingSum += sum / n; agg.spacingN++; }
    }
    const lt = mm.owner ? { pid: mm.owner } : null; if (lt) { const owner = lt.pid; agg.ownerSamples++; const os = mm.playerWorld(owner); if (Math.hypot(os.x - b.x, os.z - b.z) > 2.5) agg.ballDetached++; if (owner !== lastOwner) { agg.ownerFlips++; lastOwner = owner; } }
    void lastEvents;
  } });
  agg.passes += m.teamStats.A.passes + m.teamStats.B.passes; agg.passesOk += m.teamStats.A.passesOk + m.teamStats.B.passesOk; agg.interceptions += m.teamStats.A.interceptions + m.teamStats.B.interceptions;
  agg.shots += m.teamStats.A.shots + m.teamStats.B.shots; agg.goals += m.score[0] + m.score[1]; agg.tackles += m.teamStats.A.tackles + m.teamStats.B.tackles; agg.recoveries += m.teamStats.A.recoveries + m.teamStats.B.recoveries;
  agg.outs += m.events.filter((e: any) => ['kick_in', 'corner', 'goal_clearance'].includes(e.type)).length;
  for (let k = 2; k < logs.length; k++) { agg.passLog++; if (logs[k].from === logs[k - 1].to && logs[k].to === logs[k - 1].from && logs[k].t - logs[k - 1].t < 4 && logs[k - 2].to === logs[k - 1].from) agg.pingPong++; }
  m.dispose();
}
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a'); const per = (a: number) => (a / N).toFixed(1);
console.log(`AUDIT over ${N} matches of ${MIN} min (default tactics, no model), live play ${(agg.live / agg.ticks * 100).toFixed(0)}% of ticks`);
console.log(`MOVEMENT  max speed ${agg.maxSpeed.toFixed(2)} m/s | hard accel >14 m/s^2: ${pct(agg.accelOver, agg.live * 10)} of player-ticks | direction reversals (>120deg within 0.1s while moving): ${pct(agg.reversals, agg.movingSamples)} | heading differs from velocity by >50deg while running: ${pct(agg.headingMismatch, agg.headingSamples)}`);
console.log(`SPACING   player overlaps (<0.5m): ${pct(agg.overlapTicks, agg.pairTicks)} of pair-ticks | teammates within 1.6m: ${pct(agg.tooClose, agg.pairTicks / 4)} | mean outfield spacing ${(agg.spacingSum / agg.spacingN).toFixed(1)} m | avg teammates within 3.5m of ball ${(agg.chasersSum / agg.chasersN).toFixed(2)} | 3+ teammates crowding the ball ${pct(agg.clusterTicks, agg.chasersN)}`);
console.log(`PASSING   per match: passes ${per(agg.passes)}, completed ${pct(agg.passesOk, agg.passes)}, interceptions ${per(agg.interceptions)}, ping-pong (A>B>A>B in <4s) ${pct(agg.pingPong, agg.passLog)} of passes`);
console.log(`BALL      teleports >1m/tick ${agg.ballTeleports} | toucher more than 2.5 m from the ball (owner/visual mismatch) ${pct(agg.ballDetached, agg.ownerSamples)} | owner changes per match ${per(agg.ownerFlips)} | shots ${per(agg.shots)} goals ${per(agg.goals)} | tackles ${per(agg.tackles)} recoveries ${per(agg.recoveries)} | restarts from ball out ${per(agg.outs)}`);
