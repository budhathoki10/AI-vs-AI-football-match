import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import { Landing } from './pages/Landing';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { CreateMatch } from './pages/CreateMatch';
import { Providers } from './pages/Providers';
import { History } from './pages/History';
import { MatchPage } from './pages/MatchPage';
import { ReplayPage } from './pages/ReplayPage';
import { Tournaments } from './pages/Tournaments';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';

interface Me { id: number; username: string; settings: { defaultDurationMinutes?: number; quality?: 'low' | 'medium' | 'high' } }
const Ctx = createContext<{ me: Me | null; refresh: () => void; logout: () => void }>({ me: null, refresh: () => {}, logout: () => {} });
export const useMe = () => useContext(Ctx);

const LINKS: [string, string][] = [['/app', 'Dashboard'], ['/create', 'New match'], ['/matches', 'History'], ['/tournaments', 'Tournaments'], ['/analytics', 'Analytics'], ['/providers', 'Providers'], ['/settings', 'Settings']];

function Shell({ children }: { children: ReactNode }) {
  const { me } = useMe();
  return <div className="shell">
    <nav className="nav" aria-label="main"><div className="brand"><i />AI Futsal Arena</div>{LINKS.map(([to, l]) => <NavLink key={to} to={to} end={to === '/app'}>{l}</NavLink>)}<div style={{ flex: 1 }} /><div className="muted small" style={{ padding: 10 }}>Signed in as {me?.username}</div></nav>
    <div style={{ flex: 1, minWidth: 0 }}><div className="topbar"><div className="brand" style={{ padding: 0 }}><i />AI Futsal Arena</div><span className="muted small">{me?.username}</span></div><main className="main">{children}</main></div>
    <nav className="mnav" aria-label="mobile">{LINKS.slice(0, 6).map(([to, l]) => <NavLink key={to} to={to} end={to === '/app'}>{l}</NavLink>)}</nav>
  </div>;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null); const [ready, setReady] = useState(false); const nav = useNavigate();
  const refresh = () => api<Me>('/api/me').then(setMe).catch(() => setMe(null)).finally(() => setReady(true));
  useEffect(() => { refresh(); }, []);
  const logout = () => api('/api/auth/logout', { method: 'POST', body: {} }).finally(() => { setMe(null); nav('/'); });
  if (!ready) return <div className="main muted">Loading…</div>;
  const P = ({ children }: { children: ReactNode }) => (me ? <Shell>{children}</Shell> : <Navigate to="/login" replace />);
  return <Ctx.Provider value={{ me, refresh, logout }}><Routes>
    <Route path="/" element={<Landing />} /><Route path="/login" element={<Auth />} />
    <Route path="/app" element={<P><Dashboard /></P>} /><Route path="/create" element={<P><CreateMatch /></P>} /><Route path="/providers" element={<P><Providers /></P>} />
    <Route path="/matches" element={<P><History /></P>} /><Route path="/match/:id" element={<P><MatchPage /></P>} /><Route path="/match/:id/replay" element={<P><ReplayPage /></P>} />
    <Route path="/tournaments" element={<P><Tournaments /></P>} /><Route path="/analytics" element={<P><Analytics /></P>} /><Route path="/settings" element={<P><Settings /></P>} />
    <Route path="*" element={<Navigate to="/" replace />} /></Routes></Ctx.Provider>;
}
