import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, errText } from '../lib/api';
import { useMe } from '../App';
export function Auth() {
  const [q] = useSearchParams(); const [reg, setReg] = useState(q.get('register') === '1'); const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const nav = useNavigate(); const { refresh } = useMe();
  const submit = async (e: FormEvent) => { e.preventDefault(); setErr(''); try { await api(reg ? '/api/auth/register' : '/api/auth/login', { body: { username: u, password: p } }); await refresh(); nav('/app'); } catch (x) { setErr(errText(x)); } };
  return <div className="landing" style={{ maxWidth: 420, paddingTop: 60 }}><Link to="/" className="brand" style={{ padding: 0, marginBottom: 20 }}><i />AI Futsal Arena</Link>
    <form className="card col" onSubmit={submit}><h2>{reg ? 'Create account' : 'Sign in'}</h2>
      <label>Username<input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required minLength={3} /></label>
      <label>Password{reg && ' (min 8 characters)'}<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete={reg ? 'new-password' : 'current-password'} required minLength={8} /></label>
      {err && <div className="err" role="alert">{err}</div>}<button className="btn" type="submit">{reg ? 'Create account' : 'Sign in'}</button>
      <button type="button" className="btn ghost" onClick={() => setReg(!reg)}>{reg ? 'I already have an account' : 'Create an account'}</button></form></div>;
}
