import { motion, AnimatePresence } from 'framer-motion';
import { fmtClock, EVENT_ICON, describeEvent, type MEvent } from '../lib/api';

export const Badge = ({ name, color, text = '#fff' }: { name: string; color: string; text?: string }) => <span className="badge" style={{ background: color, color: text }}>{name.slice(0, 3).toUpperCase()}</span>;

export function Scoreboard({ a, b, ca, cb, score, vt, half, status, poss }: { a: string; b: string; ca: string; cb: string; score: [number, number]; vt: number; half: number; status: string; poss?: [number, number] }) {
  return <div className="score" role="status" aria-label="scoreboard">
    <div className="team"><Badge name={a} color={ca} /><span className="n">{a}</span></div>
    <div className="mid"><div className="sc">{score[0]} – {score[1]}</div><div className="clk mono">{fmtClock(vt)}</div><div className="sub">{status}{half ? ` · ${half === 1 ? '1st' : '2nd'} half` : ''}{poss ? ` · poss ${poss[0]}–${poss[1]}%` : ''}</div></div>
    <div className="team r"><Badge name={b} color={cb} /><span className="n">{b}</span></div>
  </div>;
}

export function Timeline({ events, names, limit = 80 }: { events: MEvent[]; names?: Record<string, string>; limit?: number }) {
  const list = events.filter((e) => e.type !== 'pass').slice(-limit).reverse();
  return <div className="timeline">{list.length === 0 && <span className="muted small">No events yet.</span>}{list.map((e, i) => <div className="ev" key={`${e.type}${e.vt}${i}`}><span className="t">{fmtClock(e.vt)}</span><span aria-hidden>{EVENT_ICON[e.type] ?? '•'}</span><span>{describeEvent(e, names)}{e.team ? <span className="muted"> · {e.team}</span> : null}</span></div>)}</div>;
}

export function StatBars({ rows, ca, cb }: { rows: { label: string; a: number; b: number; fmt?: (n: number) => string }[]; ca: string; cb: string }) {
  return <div>{rows.map((r) => { const t = r.a + r.b || 1; const f = r.fmt ?? ((n: number) => String(Math.round(n * 10) / 10)); return <div className="bar" key={r.label}><span className="mono">{f(r.a)}</span><div><div className="small muted" style={{ textAlign: 'center' }}>{r.label}</div><div className="track"><i style={{ width: `${(100 * r.a) / t}%`, background: ca }} /><i style={{ width: `${(100 * r.b) / t}%`, background: cb }} /></div></div><span className="mono" style={{ textAlign: 'right' }}>{f(r.b)}</span></div>; })}</div>;
}

export function Banner({ text, show }: { text: string; show: boolean }) {
  return <div className="overlay"><AnimatePresence>{show && <motion.div key={text} className="banner" initial={{ opacity: 0, scale: 0.8, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 1.05 }} transition={{ duration: 0.35 }}>{text}</motion.div>}</AnimatePresence></div>;
}

/** SVG heatmap from replay snapshots (actual recorded positions). */
export function Heatmap({ snaps, ids, color }: { snaps: { players: { id: string; x: number; z: number }[] }[]; ids: Set<string>; color: string }) {
  const cols = 20, rows = 10; const g = new Array(cols * rows).fill(0);
  for (const s of snaps) for (const p of s.players) if (ids.has(p.id)) { const c = Math.min(cols - 1, Math.max(0, Math.floor(((p.x + 20) / 40) * cols))); const r = Math.min(rows - 1, Math.max(0, Math.floor(((p.z + 10) / 20) * rows))); g[r * cols + c]++; }
  const mx = Math.max(1, ...g);
  return <svg className="hm" viewBox="0 0 400 200" role="img" aria-label="heatmap">
    {g.map((v, i) => <rect key={i} x={(i % cols) * 20} y={Math.floor(i / cols) * 20} width="20" height="20" fill={color} opacity={0.08 + 0.9 * (v / mx)} />)}
    <g fill="none" stroke="#e8f5ee" strokeWidth="1.2" opacity=".8"><rect x="1" y="1" width="398" height="198" /><line x1="200" y1="0" x2="200" y2="200" /><circle cx="200" cy="100" r="30" /><path d="M0 40 A60 60 0 0 1 0 160" /><path d="M400 40 A60 60 0 0 0 400 160" /></g>
  </svg>;
}
export function ShotMap({ events, ca, cb }: { events: MEvent[]; ca: string; cb: string }) {
  return <svg className="hm" viewBox="0 0 400 200" role="img" aria-label="shot map"><g fill="none" stroke="#e8f5ee" strokeWidth="1.2" opacity=".8"><rect x="1" y="1" width="398" height="198" /><line x1="200" y1="0" x2="200" y2="200" /><circle cx="200" cy="100" r="30" /></g>
    {events.filter((e) => (e.type === 'shot' || e.type === 'goal') && e.pos).map((e, i) => <circle key={i} cx={(e.pos![0] + 20) * 10} cy={(e.pos![1] + 10) * 10} r={e.type === 'goal' ? 6 : 3.5} fill={e.team === 'A' ? ca : cb} stroke={e.type === 'goal' ? '#fff' : 'none'} strokeWidth="1.5" opacity=".9"><title>{describeEvent(e)}</title></circle>)}</svg>;
}
