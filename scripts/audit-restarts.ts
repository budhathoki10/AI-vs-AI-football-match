// Usage: npx tsx scripts/audit-restarts.ts — pass outcome by situation (live play vs each restart type)
import { initPhysics, Match, makeMatchConfig } from '../packages/sim/src';
await initPhysics();
const res: Record<string, { n: number; ok: number; opp: number; other: number }> = {};
for (let i = 0; i < 6; i++) {
  const m: any = await Match.create(makeMatchConfig({ seed: 300 + i * 17, minutes: 3 }));
  let open: { kind: string; from: string; team: string; to: string } | null = null;
  const kick = m.kickTo.bind(m);
  m.kickTo = (p: any, tx: number, tz: number, sp: number, lf: number, k: string, e = 1) => { const r = kick(p, tx, tz, sp, lf, k, e); if (k === 'pass' && r) open = { kind: m.restart?.type ?? 'live', from: p.cfg.id, team: p.team, to: m.teams[p.team].passTarget?.id ?? '' }; return r; };
  const rt = m.registerTouch.bind(m);
  m.registerTouch = (p: any, x: boolean) => { if (open && p.cfg.id !== open.from) { const g = (res[open.kind] ??= { n: 0, ok: 0, opp: 0, other: 0 }); g.n++; if (p.team !== open.team) g.opp++; else if (p.cfg.id === open.to) g.ok++; else g.other++; open = null; } return rt(p, x); };
  await m.runRegulation({}); m.dispose();
}
for (const [k, g] of Object.entries(res)) console.log(k.padEnd(15), 'n', String(g.n).padStart(3), 'receiver', ((100 * g.ok) / g.n).toFixed(0) + '%', 'opponent', ((100 * g.opp) / g.n).toFixed(0) + '%', 'other mate', ((100 * g.other) / g.n).toFixed(0) + '%');
