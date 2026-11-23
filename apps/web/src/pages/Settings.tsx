import { useState } from 'react';
import { api } from '../lib/api';
import { useMe } from '../App';
export function Settings() {
  const { me, refresh, logout } = useMe(); const [d, setD] = useState(me?.settings.defaultDurationMinutes ?? 3); const [q, setQ] = useState(me?.settings.quality ?? 'medium'); const [msg, setMsg] = useState('');
  const save = async () => { await api('/api/me/settings', { method: 'PUT', body: { defaultDurationMinutes: d, quality: q } }); await refresh(); setMsg('Saved'); };
  return <div className="col" style={{ maxWidth: 560 }}><h1 style={{ fontSize: '1.8rem' }}>Settings</h1>
    <div className="card col"><h2>Profile</h2><div>Signed in as <b>{me?.username}</b></div><div className="muted small">Sessions use an HttpOnly cookie; provider keys live only on the server (see Providers).</div></div>
    <div className="card col"><h2>Defaults</h2><label>Default real-world match duration<select value={d} onChange={(e) => setD(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((x) => <option key={x} value={x}>{x} minute{x > 1 ? 's' : ''}</option>)}</select></label>
      <label>3D quality<select value={q} onChange={(e) => setQ(e.target.value as 'low')}><option value="low">Low (no shadows)</option><option value="medium">Medium</option><option value="high">High</option></select></label><div className="row"><button className="btn" onClick={save}>Save</button>{msg && <span className="chip ok">{msg}</span>}</div></div>
    <div className="card"><button className="btn danger" onClick={logout}>Sign out</button></div></div>;
}
