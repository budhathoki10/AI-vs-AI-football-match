import { initPhysics, Match, makeMatchConfig } from '../packages/sim/src';
await initPhysics();
const out: any[] = [];
for (let i = 0; i < 3; i++) {
  const m: any = await Match.create(makeMatchConfig({ seed: 300 + i * 17, minutes: 3 }));
  let open: any = null; let lastOpt: any = null;
  const orig = m.commitPass.bind(m); m.commitPass = (p: any, o: any, r: boolean) => { lastOpt = { ...o, carrier: p.cfg.id, team: p.team, restart: r }; return orig(p, o, r); };
  const kick = m.kickTo.bind(m); m.kickTo = (p: any, tx: number, tz: number, sp: number, lf: number, kind: string, e = 1) => { const r = kick(p, tx, tz, sp, lf, kind, e); if (kind === 'pass' && lastOpt?.carrier === p.cfg.id && !lastOpt.restart) { const b = m.ballWorld(); const ang = Math.atan2(b.vz, b.vx); const want = Math.atan2(lastOpt.tz - b.z, lastOpt.tx - b.x); open = { ...lastOpt, t: m.rt, v0: Math.hypot(b.vx, b.vz), angErr: Math.abs(ang - want) * 57.3, minRecvDist: 99, recvAtTouch: 0 }; } return r; };
  const step = m.step.bind(m); m.step = () => { step(); if (open) { const b = m.ballWorld(); const rs = m.playerWorld(open.toId); open.minRecvDist = Math.min(open.minRecvDist, Math.hypot(rs.x - b.x, rs.z - b.z)); } };
  const rt = m.registerTouch.bind(m);
  m.registerTouch = (p: any) => { if (open && p.cfg.id !== open.carrier) { const b = m.ballWorld(); const rs = m.playerWorld(open.toId); out.push({ who: p.cfg.id === open.toId ? 'R' : p.team === open.team ? 'M' : 'O', dt: m.rt - open.t, recvDist: Math.hypot(rs.x - b.x, rs.z - b.z), minRecv: open.minRecvDist, angErr: open.angErr, kind: open.kind, risk: open.intercept, d: Math.hypot(open.tx - open.x0 || 0, 0), bsp: Math.hypot(b.vx, b.vz), v0: open.v0 }); open = null; } return rt(p); };
  await m.runRegulation({}); m.dispose();
}
const avg = (g: any[], k: string) => (g.reduce((s, r) => s + r[k], 0) / Math.max(1, g.length)).toFixed(2);
for (const w of ['R', 'O', 'M']) { const g = out.filter((r) => r.who === w); console.log(w, g.length, 'dt', avg(g, 'dt'), 'recvDistAtTouch', avg(g, 'recvDist'), 'minRecvDist', avg(g, 'minRecv'), 'angErr', avg(g, 'angErr'), 'risk', avg(g, 'risk'), 'ballSpeed', avg(g, 'bsp')); }
