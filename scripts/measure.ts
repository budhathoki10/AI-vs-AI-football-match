// Usage: npx tsx scripts/measure.ts [seedsPerDuration]
import { Match, makeMatchConfig, initPhysics } from '../packages/sim/src';
await initPhysics();
const n = Number(process.argv[2] ?? 4);
const durs = (process.argv[3] ?? "1,2,3,4,5,6").split(",").map(Number) as (1|2|3|4|5|6)[];
for (const minutes of durs) {
  let over = 0, shots = 0, ot = 0, goals = 0, draws = 0, pass = 0, fouls = 0, corners = 0, kin = 0;
  const t0 = Date.now();
  for (let s = 0; s < n; s++) {
    const m = await Match.create(makeMatchConfig({ seed: 100 + s * 13, minutes }));
    await m.runRegulation();
    const r = m.clock.report();
    over += r.actualRealSeconds / (minutes * 60);
    const a = m.teamStats.A, b = m.teamStats.B;
    shots += a.shots + b.shots; ot += a.onTarget + b.onTarget; goals += m.score[0] + m.score[1]; draws += m.score[0] === m.score[1] ? 1 : 0;
    pass += a.passes + b.passes; fouls += a.fouls + b.fouls; corners += a.corners + b.corners; kin += a.kickIns + b.kickIns;
    m.dispose();
  }
  console.log(`${minutes}min  phys/selected=${(over / n).toFixed(2)}  shots=${(shots / n).toFixed(1)} onT=${(ot / n).toFixed(1)} goals=${(goals / n).toFixed(1)} draws=${draws}/${n} passes=${(pass / n).toFixed(0)} fouls=${(fouls / n).toFixed(1)} corners=${(corners / n).toFixed(1)} kickins=${(kin / n).toFixed(1)}  (${((Date.now() - t0) / 1000).toFixed(0)}s wall)`);
}
