import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtClock, type Frame, type MEvent } from '../lib/api';
import { Court3D, type CamMode } from '../components/Court3D';
import { Scoreboard, Timeline } from '../components/ui';
import { useLook } from './MatchPage';

export function ReplayPage() {
  const { id } = useParams(); const [m, setM] = useState<any>(null); const [snaps, setSnaps] = useState<any[]>([]); const [ev, setEv] = useState<MEvent[]>([]);
  const frameRef = useRef<Frame | null>(null); const [idx, setIdx] = useState(0); const [playing, setPlaying] = useState(true); const [speed, setSpeed] = useState(1); const [cam, setCam] = useState<CamMode>('replay'); const [follow, setFollow] = useState(''); const [trail, setTrail] = useState(true);
  useEffect(() => { api(`/api/matches/${id}`).then(setM); api(`/api/matches/${id}/replay`).then((r) => setSnaps(r.snapshots)); api(`/api/matches/${id}/events`).then((r) => setEv(r.events)); }, [id]);
  const lk = useLook(m);
  const pos = useRef(0); // fractional snapshot index
  useEffect(() => {
    if (!snaps.length) return; let raf = 0; let last = performance.now();
    const loop = (t: number) => { const dt = Math.max(0, (t - last) / 1000); last = t; if (playing) { pos.current = Math.max(0, Math.min(snaps.length - 1, pos.current + dt * 5 * speed)); if (pos.current >= snaps.length - 1) setPlaying(false); }
      const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(pos.current))); const a = snaps[i], b = snaps[Math.min(i + 1, snaps.length - 1)]; const k = pos.current - i;
      frameRef.current = { ball: [a.ball.x + (b.ball.x - a.ball.x) * k, a.ball.y + (b.ball.y - a.ball.y) * k, a.ball.z + (b.ball.z - a.ball.z) * k], players: a.players.map((p: any) => [p.id, p.x, p.z, p.h, p.state, p.stamina]) };
      setIdx((p) => (p !== i ? i : p)); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, [snaps, playing, speed]);
  const jump = (vt: number) => { const i = snaps.findIndex((s) => s.vt >= vt - 4); pos.current = Math.max(0, i); setIdx(Math.max(0, i)); };
  const goals = ev.filter((e) => e.type === 'goal'); const key = useMemo(() => ev.filter((e) => ['goal', 'shot', 'foul', 'tactical_change', 'red_card', 'save'].includes(e.type)), [ev]);
  if (!m || !lk || !snaps.length) return <div className="muted">Loading replay…</div>; const s = snaps[idx]; const A = m.participants.find((p: any) => p.team === 'A'), B = m.participants.find((p: any) => p.team === 'B');
  return <div className="col"><div className="row spread"><h1 style={{ fontSize: '1.6rem' }}>Replay</h1><Link className="btn ghost" to={`/match/${id}`}>Back to results</Link></div>
    <Scoreboard a={A.name} b={B.name} ca={m.colors.A[0]} cb={m.colors.B[0]} score={s.score} vt={s.vt} half={s.vt > 2700 ? 2 : 1} status="Replay" />
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
      <div className="col"><div className="stage"><div className="camtabs">{(['replay', 'broadcast', 'tactical', 'follow', 'goal'] as CamMode[]).map((c) => <button key={c} className={cam === c ? 'on' : ''} onClick={() => setCam(c)}>{c}</button>)}</div><Court3D frameRef={frameRef} look={lk.look} mode={cam} follow={follow || undefined} trail={trail} /></div>
        <div className="card col"><div className="row"><button className="btn" onClick={() => { if (idx >= snaps.length - 2) { pos.current = 0; } setPlaying((p) => !p); }}>{playing ? 'Pause' : 'Play'}</button>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Speed<select style={{ width: 80 }} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[0.25, 0.5, 1, 2, 4].map((v) => <option key={v} value={v}>{v}×</option>)}</select></label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Follow<select style={{ width: 150 }} value={follow} onChange={(e) => { setFollow(e.target.value); if (e.target.value) setCam('follow'); }}><option value="">ball</option>{Object.entries(lk.names).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" style={{ width: 16, minHeight: 16 }} checked={trail} onChange={(e) => setTrail(e.target.checked)} />Ball trail</label></div>
          <input type="range" min={0} max={snaps.length - 1} value={idx} onChange={(e) => { pos.current = Number(e.target.value); setIdx(Number(e.target.value)); }} aria-label="scrub" />
          <div className="row">{goals.map((g, i) => <button key={i} className="btn ghost sm" onClick={() => jump(g.vt)}>⚽ {fmtClock(g.vt)}</button>)}<select style={{ width: 220 }} defaultValue="" onChange={(e) => e.target.value && jump(Number(e.target.value))}><option value="">Jump to event…</option>{key.slice(0, 200).map((e, i) => <option key={i} value={e.vt}>{fmtClock(e.vt)} {e.type.replace(/_/g, ' ')} {e.team ?? ''}</option>)}</select></div>
          <p className="muted small">Replay is rebuilt from recorded 5 Hz simulation snapshots of the actual match. Shootout attempts replay individually from the results page.</p></div></div>
      <div className="card"><h3>Timeline</h3><Timeline events={ev.filter((e) => e.vt <= s.vt)} names={lk.names} /></div></div></div>;
}
