import { initPhysics, Match, makeMatchConfig } from '../packages/sim/src';
await initPhysics();
const rows: any[] = [];
for (let i = 0; i < 3; i++) {
  const m: any = await Match.create(makeMatchConfig({ seed: 300 + i * 17, minutes: 3 }));
  let open: any = null;
  const orig = m.commitPass.bind(m); let lastOpt: any = null; m.commitPass = (p: any, o: any, r: boolean) => { lastOpt = { ...o, restart: r, carrier: p.cfg.id, team: p.team }; return orig(p, o, r); };
  const kick = m.kickTo.bind(m);
  m.kickTo = (p: any, tx: number, tz: number, speed: number, lift: number, kind: string, e = 1) => { const r = kick(p, tx, tz, speed, lift, kind, e); if (kind === 'pass' && lastOpt && lastOpt.carrier === p.cfg.id) { const b = m.ballWorld(); let nearest = 99; for (const o of m.byId.values()) if (o.onCourt && o.team !== p.team) { const s = m.playerWorld(o.cfg.id); nearest = Math.min(nearest, Math.hypot(s.x - b.x, s.z - b.z)); } open = { ...lastOpt, t: m.rt, nearestOppAtKick: nearest, speedReal: Math.hypot(b.vx, b.vz) }; } return r; };
  const rt = m.registerTouch.bind(m);
  m.registerTouch = (p: any, i2: boolean) => { if (open && p.cfg.id !== open.carrier) { const b = m.ballWorld(); rows.push({ who: p.cfg.id === open.toId ? 'receiver' : p.team === open.team ? 'mate' : 'OPP', kind: open.kind, risk: open.intercept, restart: open.restart, nearestOpp: open.nearestOppAtKick, dt: m.rt - open.t, ballSpeed: Math.hypot(b.vx, b.vz), v0: open.speed, d: Math.hypot(open.tx - b.x, open.tz - b.z), score: open.score }); open = null; } return rt(p, i2); };
  await m.runRegulation(); m.dispose();
}
const opp = rows.filter((r) => r.who === 'OPP'); const ok = rows.filter((r) => r.who === 'receiver');
const mean = (a: any[], k: string) => (a.reduce((s, r) => s + r[k], 0) / Math.max(1, a.length)).toFixed(2);
console.log('rows', rows.length, 'opp', opp.length, 'receiver', ok.length);
console.log('OPP  : risk', mean(opp, 'risk'), 'nearestOppAtKick', mean(opp, 'nearestOpp'), 'time to touch', mean(opp, 'dt'), 'speed at touch', mean(opp, 'ballSpeed'), 'v0', mean(opp, 'v0'), 'restart share', (opp.filter((r) => r.restart).length / opp.length).toFixed(2));
console.log('RECV : risk', mean(ok, 'risk'), 'nearestOppAtKick', mean(ok, 'nearestOpp'), 'time to touch', mean(ok, 'dt'), 'speed at touch', mean(ok, 'ballSpeed'), 'v0', mean(ok, 'v0'), 'restart share', (ok.filter((r) => r.restart).length / ok.length).toFixed(2));
const byKind: Record<string, number[]> = {}; for (const r of rows) (byKind[r.kind] ??= [0, 0])[r.who === 'OPP' ? 1 : 0]++; console.log('kind -> [not intercepted, intercepted]', JSON.stringify(byKind));
console.log('first 6 OPP rows', JSON.stringify(opp.slice(0, 6).map((r) => ({ k: r.kind, risk: +r.risk.toFixed(2), near: +r.nearestOpp.toFixed(1), dt: +r.dt.toFixed(2), bs: +r.ballSpeed.toFixed(1), rs: r.restart }))));
for (const rs of [false, true]) { const g = rows.filter((r) => !!r.restart === rs); const o = g.filter((r) => r.who === 'OPP').length; const rc = g.filter((r) => r.who === 'receiver').length; console.log(rs ? 'RESTART' : 'IN-PLAY', 'n', g.length, 'receiver', rc, 'opp', o, 'mate', g.length - o - rc); }
