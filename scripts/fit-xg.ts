// Usage: npx tsx scripts/fit-xg.ts [matches=80]   -> rewrites the coefficients in packages/sim/src/xg.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { Match, makeMatchConfig, initPhysics, COURT, goalMouthAngle } from '../packages/sim/src';
await initPhysics();
const N = Number(process.argv[2] ?? 80);
const rows: { d: number; a: number; y: number }[] = []; let goals = 0;
for (let i = 0; i < N; i++) {
  const m = await Match.create(makeMatchConfig({ seed: 5000 + i * 17, minutes: (5 + (i % 2)) as 5 | 6 }));
  await m.runRegulation();
  for (const s of m.shotLog) {
    if (s.dx === undefined) continue; const z = s.pos[1];
    const y = s.outcome === 'goal' ? 1 : 0; goals += y; rows.push({ d: Math.hypot(s.dx, z), a: goalMouthAngle(s.dx, z, COURT.goalWidth), y });
  }
  m.dispose();
  if ((i + 1) % 10 === 0) console.log(`${i + 1}/${N} matches, ${rows.length} shots, ${goals} goals`);
}
// logistic regression by Newton-Raphson (IRLS) on [1, d, a]. If the angle coefficient comes out negative (collinearity with distance in a small
// sample) the angle feature is dropped and the model refitted, so the published model never says that a wider angle is worse.
const fit = (useAngle: boolean) => {
let b = [-1, -0.05, useAngle ? 1 : 0]; const X = rows.map((r) => [1, r.d, useAngle ? r.a : 0]);
for (let it = 0; it < 50; it++) {
  const g = [0, 0, 0]; const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  X.forEach((x, i) => { const p = 1 / (1 + Math.exp(-(b[0] * x[0] + b[1] * x[1] + b[2] * x[2]))); const e = rows[i].y - p; const w = p * (1 - p);
    for (let j = 0; j < 3; j++) { g[j] += e * x[j]; for (let k = 0; k < 3; k++) H[j][k] += w * x[j] * x[k]; } });
  for (let j = 0; j < 3; j++) H[j][j] += 1e-6;
  // solve H * delta = g (3x3, Gauss)
  const A = H.map((row, i) => [...row, g[i]]);
  for (let i = 0; i < 3; i++) { let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]];
    for (let r = i + 1; r < 3; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < 4; c++) A[r][c] -= f * A[i][c]; } }
  const dlt = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = A[i][3]; for (let c = i + 1; c < 3; c++) s -= A[i][c] * dlt[c]; dlt[i] = s / A[i][i]; }
  b = b.map((v, j) => v + dlt[j]); if (Math.hypot(...dlt) < 1e-9) break;
}
return { b, X };
};
let { b, X } = fit(true);
if (b[2] < 0) ({ b, X } = fit(false));
const pred = X.map((x) => 1 / (1 + Math.exp(-(b[0] * x[0] + b[1] * x[1] + b[2] * x[2]))));
const sumXg = pred.reduce((a, v) => a + v, 0);
console.log('coefficients', b.map((v) => +v.toFixed(4)), 'shots', rows.length, 'goals', goals, 'sum xG', sumXg.toFixed(1));
const f = 'packages/sim/src/xg.ts'; let s = readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
s = s.replace(/intercept: [-\d.]+,\n {2}distance: [-\d.]+,\n {2}angle: [-\d.]+,\n {2}trainedOn: \{[^}]*\},/, `intercept: ${b[0].toFixed(4)},\n  distance: ${b[1].toFixed(4)},\n  angle: ${b[2].toFixed(4)},\n  trainedOn: { matches: ${N}, shots: ${rows.length}, goals: ${goals}, note: 'logistic regression (IRLS) on simulated shots, 5-6 min matches, seeds 5000+17i' },`);
writeFileSync('scripts/xg-training-rows.json', JSON.stringify(rows));
writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
