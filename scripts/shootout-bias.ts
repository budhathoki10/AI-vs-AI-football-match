// Usage: npx tsx scripts/shootout-bias.ts [shootouts=120]  -> are the two sides treated identically? (equal squads, same policy)
import { initPhysics, Match, makeMatchConfig, runShootout } from '../packages/sim/src';
await initPhysics();
const N = Number(process.argv[2] ?? 120); const win = { A: 0, B: 0 }; const goals = { A: 0, B: 0 }; const att = { A: 0, B: 0 }; const first = { first: 0, second: 0 };
for (let i = 0; i < N; i++) {
  const m = await Match.create(makeMatchConfig({ seed: 1000 + i * 7, minutes: 1 })); const r = await runShootout(m);
  win[r.winner]++; for (const t of ['A', 'B'] as const) { goals[t] += r.stats[t].scored; att[t] += r.stats[t].attempts; } if (r.winner === r.firstTeam) first.first++; else first.second++; m.dispose();
}
console.log({ N, wins: win, goalRate: { A: +(goals.A / att.A).toFixed(3), B: +(goals.B / att.B).toFixed(3) }, firstKickerWins: first });
