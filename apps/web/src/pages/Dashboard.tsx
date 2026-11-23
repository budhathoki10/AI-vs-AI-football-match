import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { MatchTable } from './History';
export function Dashboard() {
  const [m, setM] = useState<any[]>([]); const [an, setAn] = useState<any>(null); const [t, setT] = useState<any[]>([]); const [tm, setTm] = useState<any[]>([]);
  useEffect(() => { api('/api/matches?limit=8').then((r) => setM(r.matches)); api('/api/analytics').then(setAn); api('/api/tournaments').then((r) => setT(r.tournaments)); api('/api/teams').then((r) => setTm(r.teams)); }, []);
  const cost = (an?.cost ?? []) as any[];
  return <div className="col"><div className="row spread"><h1 style={{ fontSize: '1.8rem' }}>Dashboard</h1><Link className="btn" to="/create">Quick match</Link></div>
    <div className="grid g3"><div className="card"><h3>Matches played</h3><div style={{ fontSize: '2rem', fontWeight: 800 }}>{an?.byArchitecture?.reduce((a: number, x: any) => a + x.matches, 0) / 2 || 0}</div></div><div className="card"><h3>Saved teams</h3><div style={{ fontSize: '2rem', fontWeight: 800 }}>{tm.length}</div></div><div className="card"><h3>LLM spend</h3><div style={{ fontSize: '2rem', fontWeight: 800 }}>{cost.length === 0 ? '$0' : cost.some((c) => !c.known) ? 'unknown' : `$${cost.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(3)}`}</div><div className="muted small">Based on prices you or the provider supplied.</div></div></div>
    <div className="card"><h2>Recent matches</h2><MatchTable rows={m} /></div>
    <div className="grid g2"><div className="card"><h2>Model performance</h2>{(an?.byArchitecture ?? []).length === 0 ? <p className="muted">Play some matches to see performance.</p> : <table><thead><tr><th>Agent</th><th className="num">Matches</th><th className="num">Wins</th><th className="num">GF</th><th className="num">GA</th></tr></thead><tbody>{an.byArchitecture.map((x: any, i: number) => <tr key={i}><td>{x.architecture}{x.model !== '-' ? `:${x.model}` : ''}</td><td className="num">{x.matches}</td><td className="num">{x.wins}</td><td className="num">{x.avg_gf.toFixed(2)}</td><td className="num">{x.avg_ga.toFixed(2)}</td></tr>)}</tbody></table>}</div>
      <div className="card"><h2>Recent tournaments</h2>{t.length === 0 ? <p className="muted">None yet.</p> : t.slice(0, 5).map((x) => <div key={x.id} className="row spread"><Link to="/tournaments">{x.name}</Link><span className="chip">{x.format} · {x.status}</span></div>)}</div></div></div>;
}
