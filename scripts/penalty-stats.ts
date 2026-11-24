// Usage: npx tsx scripts/penalty-stats.ts [attempts=300]  -> goal/save/miss rates of the physics penalty with the documented fallback policy
import { initPhysics, simulateAttempt, fallbackPenaltyDecision, Rng } from '../packages/sim/src';
await initPhysics();
const N = Number(process.argv[2] ?? 300); const rng = new Rng(12345); const c: Record<string, number> = {}; const bySide: Record<string, Record<string, number>> = {};
for (let i = 0; i < N; i++) {
  const sd = fallbackPenaltyDecision({ role: 'shoot', round: 1, suddenDeath: false, ownScore: 0, oppScore: 0, history: [], eligible: [{ id: 'T', shooting: 60 + (i % 25), role: 'ALA' }], keepers: [{ id: 'K', goalkeeping: 70 }] }, rng.next());
  const kd = fallbackPenaltyDecision({ role: 'defend', round: 1, suddenDeath: false, ownScore: 0, oppScore: 0, history: [], eligible: [], keepers: [{ id: 'K', goalkeeping: 70 }] }, rng.next());
  const r = simulateAttempt({ shooting: 60 + (i % 25), ballControl: 60 }, { goalkeeping: 70, agility: 65 }, { side: sd.side!, height: sd.height!, power: sd.power! }, { dive: kd.dive ?? 0, reactDelay: kd.reactDelay ?? 0.05 }, rng);
  c[r.result] = (c[r.result] ?? 0) + 1; const k = `dive ${kd.dive}`; (bySide[k] ??= {})[r.result] = ((bySide[k] ??= {})[r.result] ?? 0) + 1;
}
console.log('attempts', N, Object.fromEntries(Object.entries(c).map(([k, v]) => [k, `${v} (${((100 * v) / N).toFixed(0)}%)`]))); console.log('by keeper dive', bySide);
