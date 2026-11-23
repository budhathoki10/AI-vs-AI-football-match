import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errText } from '../lib/api';
import { DURATIONS, defaultTeam } from '../lib/options';
import { TeamForm, toInput, type TeamState } from '../components/TeamForm';
import { useMe } from '../App';
export function CreateMatch() {
  const { me } = useMe(); const nav = useNavigate();
  const [a, setA] = useState<TeamState>(defaultTeam('Arena FC', '#10b981')); const [b, setB] = useState<TeamState>(defaultTeam('Rival United', '#f59e0b'));
  const [dur, setDur] = useState<number>(me?.settings.defaultDurationMinutes ?? 3); const [paced, setPaced] = useState(true); const [seed, setSeed] = useState(''); const [swap, setSwap] = useState(false);
  const [providers, setProviders] = useState<string[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/providers').then((r) => setProviders(r.configured.map((c: any) => c.kind))).catch(() => {}); }, []);
  const go = async () => { setBusy(true); setErr(''); try { const r = await api('/api/matches', { body: { teamA: toInput(a), teamB: toInput(b), realDurationMinutes: dur, paced, swapSides: swap, seed: seed ? Number(seed) : undefined } }); nav(`/match/${r.id}`); } catch (e) { setErr(errText(e)); setBusy(false); } };
  return <div className="col"><h1 style={{ fontSize: '1.8rem' }}>Create match</h1>
    <div className="grid g2"><TeamForm t={a} set={setA} title="Team A" providers={providers} /><TeamForm t={b} set={setB} title="Team B" providers={providers} /></div>
    <div className="card col"><h2>Match duration</h2>
      <div className="note">The duration below is <b>real-world watch time</b>. The virtual clock always runs the complete <b>00:00 → 90:00</b> match (half-time at 45:00). Players and the ball move at natural speeds — only dead time (restarts, walking back) is compressed. Short durations may overrun slightly; the results page reports actual elapsed time.</div>
      <div className="row" role="radiogroup" aria-label="real-world duration">{DURATIONS.map((d) => <button key={d} type="button" role="radio" aria-checked={dur === d} className={`btn ${dur === d ? '' : 'ghost'}`} onClick={() => setDur(d)}>{d} min</button>)}</div>
      <div className="row"><label style={{ flex: 1 }}>Seed (optional, for reproducible matches)<input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 18, minHeight: 18 }} checked={swap} onChange={(e) => setSwap(e.target.checked)} />Swap sides</label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 18, minHeight: 18 }} checked={paced} onChange={(e) => setPaced(e.target.checked)} />Watch live (real-time pacing)</label></div>
      <p className="muted small">Both teams get identical squad attributes (fair comparison). A level score after 90:00 automatically triggers a penalty shootout.</p>
      {err && <div className="err" role="alert">{err}</div>}<div><button className="btn" onClick={go} disabled={busy}>{busy ? 'Starting…' : 'Kick off'}</button></div></div></div>;
}
