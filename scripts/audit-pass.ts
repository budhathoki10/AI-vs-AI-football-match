import { initPhysics, Match, makeMatchConfig } from '../packages/sim/src';
await initPhysics();
const cls: Record<string, number> = {}; const dist: Record<string, number[]> = {}; const spd: number[] = [];
for (let i = 0; i < 4; i++) {
  const m: any = await Match.create(makeMatchConfig({ seed: 300 + i * 17, minutes: 3 }));
  let open: { from: string; to: string; team: string; t: number; d: number; id: number } | null = null; let pid = 0;
  const kick = m.kickTo.bind(m);
  m.kickTo = (p: any, tx: number, tz: number, speed: number, lift: number, kind: string, e = 1) => {
    const r = kick(p, tx, tz, speed, lift, kind, e);
    if (kind === 'pass' && m.lastPass && m.lastPass.from === p.cfg.id) { if (open) { cls['superseded'] = (cls['superseded'] ?? 0) + 1; } const b = m.ballWorld(); open = { from: p.cfg.id, to: m.lastPass.to, team: p.team, t: m.rt, d: Math.hypot(tx - b.x, tz - b.z), id: ++pid }; spd.push(Math.hypot(b.vx, b.vz)); }
    return r;
  };
  const rt = m.registerTouch.bind(m);
  m.registerTouch = (p: any, intentional: boolean) => {
    if (open && p.cfg.id !== open.from) {
      const k = p.cfg.id === open.to ? 'intended receiver' : p.team === open.team ? 'other teammate' : 'OPPONENT';
      cls[k] = (cls[k] ?? 0) + 1; (dist[k] ??= []).push(open.d); open = null;
    }
    return rt(p, intentional);
  };
  const out = m.outOfPlay.bind(m); m.outOfPlay = (...a: any[]) => { if (open) { cls['ball out of play'] = (cls['ball out of play'] ?? 0) + 1; open = null; } return out(...a); };
  const step = m.step.bind(m); m.step = () => { step(); if (open && m.rt - open.t > 4) { cls['nobody touched in 4s'] = (cls['nobody touched in 4s'] ?? 0) + 1; open = null; } };
  await m.runRegulation(); m.dispose();
}
const tot = Object.values(cls).reduce((a, b) => a + b, 0);
for (const [k, v] of Object.entries(cls).sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(24)} ${String(v).padStart(4)}  ${((100 * v) / tot).toFixed(1)}%  mean pass length ${(dist[k] ? dist[k].reduce((a, b) => a + b, 0) / dist[k].length : 0).toFixed(1)} m`);
console.log('mean initial pass speed', (spd.reduce((a, b) => a + b, 0) / spd.length).toFixed(1), 'm/s over', spd.length, 'passes');
