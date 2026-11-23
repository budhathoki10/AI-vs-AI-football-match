import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errText, fmtClock, type Frame, type LiveState, type MEvent } from '../lib/api';
import { Court3D, type CamMode, type TeamLook } from '../components/Court3D';
import { PenaltyScene, type PFrame } from '../components/PenaltyScene';
import { Banner, Heatmap, Scoreboard, ShotMap, StatBars, Timeline } from '../components/ui';
import { useMe } from '../App';

export function useLook(m: any): { look: TeamLook; names: Record<string, string> } | null {
  return useMemo(() => {
    if (!m?.rosters) return null; const numbers: Record<string, number> = {}, roles: Record<string, string> = {}, names: Record<string, string> = {};
    for (const t of ['A', 'B'] as const) for (const p of m.rosters[t]) { numbers[p.id] = p.number; roles[p.id] = p.role; names[p.id] = `${p.name} #${p.number}`; }
    return { look: { A: m.colors.A, B: m.colors.B, numbers, roles }, names };
  }, [m]);
}

export function MatchPage() {
  const { id } = useParams(); const [m, setM] = useState<any>(null); const [err, setErr] = useState('');
  const load = () => api(`/api/matches/${id}`).then(setM).catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, [id]);
  useEffect(() => { if (m?.status !== 'running') return; const t = setInterval(load, 4000); return () => clearInterval(t); }, [m?.status]);
  if (err) return <div className="err">{err}</div>; if (!m) return <div className="muted">Loading…</div>;
  return m.status === 'running' ? <Live m={m} onDone={load} /> : m.status === 'failed' ? <div className="err">This match failed: {m.error ?? 'unknown error'}</div> : <Results m={m} />;
}

function PenaltyView({ m, attempts, ca, cb, regScore }: { m: any; attempts: any[]; ca: string; cb: string; regScore: [number, number] }) {
  const playRef = useRef({ t0: performance.now(), speed: 1 }); const last = attempts[attempts.length - 1]; const [lookIdx] = useState(0); void lookIdx;
  useEffect(() => { playRef.current = { t0: performance.now(), speed: 1 }; }, [attempts.length]);
  const score: [number, number] = [attempts.filter((a) => a.team === 'A' && a.result === 'goal').length, attempts.filter((a) => a.team === 'B' && a.result === 'goal').length];
  const pa = m.participants.find((p: any) => p.team === 'A').name, pb = m.participants.find((p: any) => p.team === 'B').name;
  const [showRes, setShowRes] = useState(false); useEffect(() => { setShowRes(true); const t = setTimeout(() => setShowRes(false), 2200); return () => clearTimeout(t); }, [attempts.length]);
  const shooting = last?.team ?? 'A'; const frames: PFrame[] = last?.frames ?? [];
  const row = (team: 'A' | 'B') => { const list = attempts.filter((a) => a.team === team); return <div className="pk-hist">{Array.from({ length: Math.max(5, list.length) }, (_, i) => { const a = list[i]; return <span key={i} className={`pk ${a ? a.result : 'pending'}`} title={a ? `${a.takerId}: ${a.result}` : 'pending'}>{a ? (a.result === 'goal' ? '✓' : a.result === 'saved' ? 'S' : '✕') : ''}</span>; })}</div>; };
  return <div className="col">
    <div className="card col" style={{ textAlign: 'center' }}><span className="chip warn" style={{ alignSelf: 'center' }}>PENALTY SHOOTOUT</span>
      <div className="small muted">Regulation: {pa} {regScore[0]} – {regScore[1]} {pb}</div><div className="mid"><div className="sc" style={{ fontSize: '2.4rem', fontWeight: 800 }}>{score[0]} – {score[1]}</div></div>
      <div className="small muted">{last ? `Attempt ${attempts.length} · round ${last.round}${last.suddenDeath ? ' · SUDDEN DEATH' : ''} · taker ${last.takerId} vs keeper ${last.keeperId} · ${last.team === 'A' ? pa : pb} shooting` : 'Preparing first attempt…'}</div></div>
    <div className="stage" style={{ aspectRatio: '16/9' }}>{last && <PenaltyScene frames={frames} tColor={shooting === 'A' ? ca : cb} kColor={shooting === 'A' ? cb : ca} playRef={playRef} />}
      <Banner show={showRes && !!last && last.frames.length > 0} text={last ? (last.result === 'goal' ? 'GOAL!' : last.result === 'saved' ? 'SAVED!' : last.result === 'post' ? 'OFF THE WOODWORK' : 'MISSED') : ''} /></div>
    <div className="grid g2"><div className="card"><h3>{pa}</h3>{row('A')}</div><div className="card"><h3>{pb}</h3>{row('B')}</div></div>
    {last && <div className="card small"><b>Decision summaries (no hidden reasoning):</b> shooter — {last.shot.reason || 'n/a'}{last.shot.usedFallback ? ' (fallback)' : ''}; keeper — {last.keeper.reason || 'n/a'}{last.keeper.usedFallback ? ' (fallback)' : ''}</div>}
  </div>;
}

function Live({ m, onDone }: { m: any; onDone: () => void }) {
  const { me } = useMe(); const lk = useLook(m); const frameRef = useRef<Frame | null>(null);
  const [st, setSt] = useState<LiveState | null>(null); const [events, setEvents] = useState<MEvent[]>([]); const [cam, setCam] = useState<CamMode>('broadcast'); const [banner, setBanner] = useState(''); const [attempts, setAttempts] = useState<any[]>([]); const [phase, setPhase] = useState('Kick-off');
  const [conn, setConn] = useState('connecting');
  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/matches/${m.id}`);
    ws.onopen = () => setConn('live'); ws.onclose = () => { setConn('closed'); onDone(); };
    ws.onmessage = (ev) => { const d = JSON.parse(ev.data);
      if (d.t === 'state') { frameRef.current = d; setSt(d); }
      else if (d.t === 'event') { setEvents((x) => [...x.slice(-300), d.event]); const e = d.event as MEvent;
        const flash = (s: string, ms = 2200) => { setBanner(s); setTimeout(() => setBanner(''), ms); };
        if (e.type === 'goal') flash('GOAL!'); else if (e.type === 'halftime') { setPhase('Half-time'); flash('HALF-TIME', 2500); } else if (e.type === 'red_card') flash('RED CARD'); else if (e.type === 'kickoff' && e.detail === 'second half') setPhase('Second half'); else if (e.type === 'fulltime') flash('FULL TIME', 2500); }
      else if (d.t === 'full_time') { setPhase('Full-time'); }
      else if (d.t === 'shootout_start') { setPhase('Penalty shootout'); setBanner('MATCH DRAWN → PENALTY SHOOTOUT'); setTimeout(() => setBanner(''), 3500); }
      else if (d.t === 'penalty') setAttempts((a) => (a.some((x) => x.index === d.attempt.index) ? a : [...a, d.attempt]));
      else if (d.t === 'done') { setTimeout(onDone, 800); } };
    return () => ws.close();
  }, [m.id]);
  if (!lk) return null; const pa = m.participants.find((p: any) => p.team === 'A'), pb = m.participants.find((p: any) => p.team === 'B');
  const shoot = phase === 'Penalty shootout'; const score = st?.score ?? [0, 0];
  const CAMS: [CamMode, string][] = [['broadcast', 'Broadcast'], ['tactical', 'Tactical'], ['follow', 'Follow ball'], ['goal', 'Goal']];
  const s = st?.stats; const rows = s ? [{ label: 'Possession %', a: st!.possession[0], b: st!.possession[1], fmt: (n: number) => `${n}%` }, { label: 'Shots', a: s.A.shots, b: s.B.shots }, { label: 'On target', a: s.A.onTarget, b: s.B.onTarget }, { label: 'Passes', a: s.A.passes, b: s.B.passes }, { label: 'Pass accuracy %', a: s.A.passes ? Math.round((100 * s.A.passesOk) / s.A.passes) : 0, b: s.B.passes ? Math.round((100 * s.B.passesOk) / s.B.passes) : 0 }, { label: 'Saves', a: s.A.saves, b: s.B.saves }, { label: 'Fouls', a: s.A.fouls, b: s.B.fouls }, { label: 'Corners', a: s.A.corners, b: s.B.corners }, { label: 'Recoveries', a: s.A.recoveries, b: s.B.recoveries }] : [];
  return <div className="col">
    <Scoreboard a={pa.name} b={pb.name} ca={m.colors.A[0]} cb={m.colors.B[0]} score={score} vt={st?.vt ?? 0} half={st?.half ?? 1} status={shoot ? 'Shootout' : phase} poss={st?.possession} />
    <div className="row small muted"><span className={`chip ${conn === 'live' ? 'ok' : 'warn'}`}>{conn}</span><span>Virtual clock {fmtClock(st?.vt ?? 0)} / 90:00 · real elapsed {st?.rt ?? 0}s of {m.time.selectedRealDurationSeconds}s selected · clock mode: {st?.clockMode ?? '—'}</span></div>
    {shoot ? <PenaltyView m={m} attempts={attempts} ca={m.colors.A[0]} cb={m.colors.B[0]} regScore={score} /> :
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
        <div className="stage"><div className="camtabs">{CAMS.map(([c, l]) => <button key={c} className={cam === c ? 'on' : ''} onClick={() => setCam(c)}>{l}</button>)}</div>
          <Court3D frameRef={frameRef} look={lk.look} mode={cam} quality={me?.settings.quality} /><Banner show={!!banner} text={banner} /></div>
        <div className="col"><div className="card"><h3>Timeline</h3><Timeline events={events} names={lk.names} /></div></div></div>}
    {!shoot && s && <div className="card"><h3>Live statistics</h3><StatBars rows={rows} ca={m.colors.A[0]} cb={m.colors.B[0]} /></div>}
    {banner && shoot && <div className="note">{banner}</div>}
  </div>;
}

function Results({ m }: { m: any }) {
  const lk = useLook(m); const [tab, setTab] = useState('summary'); const [dec, setDec] = useState<any[] | null>(null); const [ev, setEv] = useState<MEvent[]>([]); const [snaps, setSnaps] = useState<any[] | null>(null);
  const [attempt, setAttempt] = useState<any>(null); const playRef = useRef({ t0: performance.now(), speed: 1 });
  useEffect(() => { api(`/api/matches/${m.id}/events`).then((r) => setEv(r.events)); }, [m.id]);
  useEffect(() => { if (tab === 'tactical' && !dec) { api(`/api/matches/${m.id}/decisions`).then((r) => setDec(r.decisions)); api(`/api/matches/${m.id}/replay`).then((r) => setSnaps(r.snapshots)); } }, [tab]);
  if (!lk) return null; const A = m.participants.find((p: any) => p.team === 'A'), B = m.participants.find((p: any) => p.team === 'B'); const ca = m.colors.A[0], cb = m.colors.B[0]; const ts = m.teamStats; const so = m.shootout;
  const winnerName = m.winner === 'A' ? A.name : m.winner === 'B' ? B.name : 'Draw';
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0); const totPoss = ts.A.possessionSeconds + ts.B.possessionSeconds || 1;
  const rows = [{ label: 'Goals', a: ts.A.goals, b: ts.B.goals }, { label: 'Possession %', a: Math.round((100 * ts.A.possessionSeconds) / totPoss), b: Math.round((100 * ts.B.possessionSeconds) / totPoss), fmt: (n: number) => `${n}%` }, { label: 'Shots', a: ts.A.shots, b: ts.B.shots }, { label: 'On target', a: ts.A.onTarget, b: ts.B.onTarget }, { label: 'Off target', a: ts.A.offTarget, b: ts.B.offTarget }, { label: 'Blocked', a: ts.A.blocked, b: ts.B.blocked }, { label: 'xG (heuristic)', a: +ts.A.xg.toFixed(2), b: +ts.B.xg.toFixed(2) }, { label: 'Passes', a: ts.A.passes, b: ts.B.passes }, { label: 'Pass accuracy %', a: pct(ts.A.passesOk, ts.A.passes), b: pct(ts.B.passesOk, ts.B.passes) }, { label: 'Dribbles ok', a: ts.A.dribblesOk, b: ts.B.dribblesOk }, { label: 'Tackles', a: ts.A.tackles, b: ts.B.tackles }, { label: 'Interceptions', a: ts.A.interceptions, b: ts.B.interceptions }, { label: 'Saves', a: ts.A.saves, b: ts.B.saves }, { label: 'Corners', a: ts.A.corners, b: ts.B.corners }, { label: 'Kick-ins', a: ts.A.kickIns, b: ts.B.kickIns }, { label: 'Goal clearances', a: ts.A.goalClearances, b: ts.B.goalClearances }, { label: 'Fouls', a: ts.A.fouls, b: ts.B.fouls }, { label: 'Accumulated fouls', a: ts.A.accumulatedFouls, b: ts.B.accumulatedFouls }, { label: 'Yellow cards', a: ts.A.yellow, b: ts.B.yellow }, { label: 'Red cards', a: ts.A.red, b: ts.B.red }, { label: 'Distance (m)', a: Math.round(ts.A.distance), b: Math.round(ts.B.distance) }, { label: 'Recoveries', a: ts.A.recoveries, b: ts.B.recoveries }];
  const players = Object.entries(m.playerStats as Record<string, any>).map(([id, p]) => ({ id, ...p, label: lk.names[id] }));
  const clock = m.time.clock;
  const TABS = [['summary', 'Summary'], ['team', 'Team stats'], ['players', 'Players'], ['tactical', 'Tactical & AI'], ...(so ? [['shootout', 'Shootout']] : [])];
  const playAttempt = async (idx: number) => { const r = await api(`/api/matches/${m.id}/shootout/${idx}/replay`); setAttempt(r); playRef.current = { t0: performance.now(), speed: 1 }; };
  return <div className="col">
    <Scoreboard a={A.name} b={B.name} ca={ca} cb={cb} score={[m.regulation.a, m.regulation.b]} vt={5400} half={2} status="Full-time" />
    <div className="card row spread"><div><h2 style={{ margin: 0 }}>{m.decidedBy === 'shootout' ? `${winnerName} win on penalties` : `${winnerName} win`}</h2>{so && <div className="muted">Regulation {m.regulation.a}–{m.regulation.b} · Penalty shootout {so.score[0]}–{so.score[1]}{so.decidedBy === 'sudden_death' ? ' (sudden death)' : so.decidedBy === 'early_termination' ? ' (decided early)' : ''}</div>}</div>
      <div className="row"><Link className="btn" to={`/match/${m.id}/replay`}>Open replay</Link></div></div>
    <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'summary' && <div className="grid g2"><div className="card"><h3>Timeline</h3><Timeline events={ev} names={lk.names} limit={400} /></div><div className="col">
      <div className="card"><h3>Time accounting</h3><table><tbody><tr><td>Selected real duration</td><td className="num">{m.time.selectedRealDurationSeconds}s</td></tr><tr><td>Actual real elapsed (physics time)</td><td className="num">{m.time.actualRealElapsedSeconds?.toFixed(1)}s</td></tr><tr><td>Virtual match duration</td><td className="num">{fmtClock(m.time.virtualMatchDurationSeconds)}</td></tr><tr><td>Virtual s per real s (active / important / dead time)</td><td className="num">{clock ? `${clock.meanActiveRate.toFixed(1)} / ${clock.meanImportantRate.toFixed(1)} / ${clock.meanInactiveRate.toFixed(1)}` : '—'}</td></tr></tbody></table>
        {clock && <p className="muted small">{clock.note}</p>}</div>
      <div className="card"><h3>Shot map</h3><ShotMap events={ev} ca={ca} cb={cb} /></div></div></div>}
    {tab === 'team' && <div className="card"><div className="row spread"><b>{A.name}</b><b>{B.name}</b></div><StatBars rows={rows} ca={ca} cb={cb} /><p className="muted small">All values are computed from recorded simulation data. Shootout goals are never included here. xG is a simple distance/angle heuristic, not a trained model.</p></div>}
    {tab === 'players' && <div className="card tablewrap"><table><thead><tr><th>Player</th><th>Team</th><th className="num">Rating</th><th className="num">G</th><th className="num">A</th><th className="num">Shots</th><th className="num">On T</th><th className="num">Pass</th><th className="num">Tkl</th><th className="num">Int</th><th className="num">Saves</th><th className="num">Fouls</th><th className="num">Dist m</th></tr></thead><tbody>{players.map((p) => <tr key={p.id}><td>{p.label}</td><td>{p.team}</td><td className="num">{p.rating}</td><td className="num">{p.goals}</td><td className="num">{p.assists}</td><td className="num">{p.shots}</td><td className="num">{p.onTarget}</td><td className="num">{p.passesOk}/{p.passes}</td><td className="num">{p.tackles}</td><td className="num">{p.interceptions}</td><td className="num">{p.saves}</td><td className="num">{p.fouls}</td><td className="num">{Math.round(p.distance)}</td></tr>)}</tbody></table><p className="muted small">Rating = 6 + 1.0·goals + 0.6·assists + 0.1·shots on target + 0.03·(accurate passes) − 0.03·(failed passes) + 0.15·(tackles + interceptions) + 0.3·saves − 0.3·fouls − 0.8·yellow − 2.5·red, clamped to 3–10.</p></div>}
    {tab === 'tactical' && <div className="col"><div className="grid g2"><div className="card"><h3>{A.name} heatmap</h3>{snaps ? <Heatmap snaps={snaps} ids={new Set(m.rosters.A.map((p: any) => p.id))} color={ca} /> : <span className="muted">Loading…</span>}</div><div className="card"><h3>{B.name} heatmap</h3>{snaps ? <Heatmap snaps={snaps} ids={new Set(m.rosters.B.map((p: any) => p.id))} color={cb} /> : <span className="muted">Loading…</span>}</div></div>
      <div className="card tablewrap"><h3>AI decision review ({A.architecture}{A.model ? `:${A.model}` : ''} vs {B.architecture}{B.model ? `:${B.model}` : ''})</h3><table><thead><tr><th>Time</th><th>Team</th><th>Trigger</th><th>Strategy</th><th>Summary (no hidden reasoning)</th><th>Status</th><th>Outcome</th><th className="num">Tokens</th><th className="num">ms</th></tr></thead><tbody>{(dec ?? []).map((d, i) => <tr key={i}><td className="mono">{fmtClock(d.vt)}</td><td>{d.team}</td><td>{d.trigger}</td><td>{d.tactics?.teamStrategy ?? '—'}</td><td>{d.objective || '—'}</td><td>{d.accepted ? <span className="chip ok">accepted</span> : <span className="chip bad" title={d.rejectReason}>{d.rejectReason?.slice(0, 40) ?? 'rejected'}</span>}</td><td className="small">{d.outcome ?? '—'}</td><td className="num">{(d.tokensIn ?? 0) + (d.tokensOut ?? 0)}</td><td className="num">{d.latencyMs}</td></tr>)}</tbody></table></div>
      {m.apiUsage.length > 0 && <div className="card"><h3>API usage</h3><table><thead><tr><th>Team</th><th>Model</th><th className="num">Calls</th><th className="num">Tokens in/out</th><th className="num">Failures</th><th className="num">Est. cost</th></tr></thead><tbody>{m.apiUsage.map((u: any) => <tr key={u.team}><td>{u.team}</td><td>{u.provider}:{u.model}</td><td className="num">{u.calls}</td><td className="num">{u.tokens_in}/{u.tokens_out}</td><td className="num">{u.failures}</td><td className="num">{u.cost_known ? `$${u.cost_usd.toFixed(4)}` : 'unknown pricing'}</td></tr>)}</tbody></table></div>}</div>}
    {tab === 'shootout' && so && <div className="col"><div className="card"><h2>Shootout {so.score[0]}–{so.score[1]} · first: {so.firstTeam === 'A' ? A.name : B.name}</h2><div className="grid g2"><div><h3>{A.name}</h3><div>scored {so.stats.A.scored} · saved {so.stats.A.saved} · missed {so.stats.A.missed} (post {so.stats.A.post}) · sudden-death attempts {so.stats.A.suddenDeathAttempts}</div></div><div><h3>{B.name}</h3><div>scored {so.stats.B.scored} · saved {so.stats.B.saved} · missed {so.stats.B.missed} (post {so.stats.B.post}) · sudden-death attempts {so.stats.B.suddenDeathAttempts}</div></div></div>{so.note && <div className="note">{so.note}</div>}</div>
      <div className="card tablewrap"><table><thead><tr><th>#</th><th>Round</th><th>Team</th><th>Taker</th><th>Keeper</th><th>Result</th><th>Shot summary</th><th>Keeper summary</th><th /></tr></thead><tbody>{so.attempts.map((a: any) => <tr key={a.index}><td>{a.index}</td><td>{a.round}{a.suddenDeath ? ' SD' : ''}</td><td>{a.team}</td><td>{lk.names[a.takerId]}</td><td>{lk.names[a.keeperId]}</td><td><span className={`chip ${a.result === 'goal' ? 'ok' : 'bad'}`}>{a.result}</span></td><td className="small">{a.shot.reason}{a.shot.usedFallback ? ' (fallback)' : ''}</td><td className="small">{a.keeper.reason}{a.keeper.usedFallback ? ' (fallback)' : ''}</td><td><button className="btn ghost sm" onClick={() => playAttempt(a.index)}>Replay</button></td></tr>)}</tbody></table></div>
      {attempt && <div className="stage"><PenaltyScene frames={attempt.frames} tColor={attempt.team === 'A' ? ca : cb} kColor={attempt.team === 'A' ? cb : ca} playRef={playRef} /><Banner show text={attempt.result.toUpperCase()} /></div>}</div>}
    {err0(m)}
  </div>;
}
const err0 = (m: any) => (m.error ? <div className="err">{m.error}</div> : null);
