import { Link } from 'react-router-dom';
import { useMe } from '../App';
export function Landing() {
  const { me } = useMe();
  return <div className="landing">
    <div className="lhead"><div className="brand" style={{ padding: 0 }}><i />AI Futsal Arena</div><div className="row">{me ? <Link className="btn" to="/app">Open dashboard</Link> : <><Link className="btn ghost" to="/login">Sign in</Link><Link className="btn" to="/login?register=1">Get started</Link></>}</div></div>
    <section className="hero"><span className="chip ok">5v5 futsal · real physics · independent AI coaches</span>
      <h1>Pit two AI coaches against each other. Watch a full 90 minutes in minutes.</h1>
      <p>Configure two teams — GPT-, Claude-, Gemini-, DeepSeek-powered or classic game AI — and watch them play a physics-simulated match. If it ends level, a real 1v1 penalty shootout decides the winner.</p>
      <div className="row"><Link className="btn" to={me ? '/create' : '/login?register=1'}>Create a match</Link><a className="btn ghost" href="#how">How it works</a></div></section>
    <section id="how" className="grid g3" style={{ marginBottom: 28 }}>
      {[['Compressed 90:00', 'Pick 1–6 real minutes. The scoreboard always runs 00:00 → 90:00. Only dead time is compressed — players and the ball never move faster than real life.'], ['One agent per team', 'Each side has a single team-level agent choosing formation, pressing, risk and player instructions. A deterministic rules engine and physics decide what actually happens.'], ['Real shootouts', 'Level after 90:00? A dedicated penalty scene: a real strike against a real diving keeper, five rounds each, then sudden death.']].map(([h, p]) => <div className="card" key={h}><h2>{h}</h2><p className="muted">{p}</p></div>)}</section>
    <section className="grid g2"><div className="card"><h3>Compare architectures</h3><p className="muted">LLM agents, rule-based, finite state machine, behavior tree, utility AI, GOAP and hybrid — all through the same tactical interface, on identical squads, with swap-sides benchmarking and honest sample-size warnings.</p></div>
      <div className="card"><h3>Bring your own key</h3><p className="muted">Provider keys are encrypted at rest on the server (AES-256-GCM), never sent back to the browser, and every decision records latency, tokens and estimated cost.</p></div></section>
    <p className="muted small" style={{ marginTop: 28 }}>A custom 90-minute virtual match format presented in a futsal environment, based on FIFA Futsal Laws with documented adaptations — not a standard regulation-length futsal match.</p>
  </div>;
}
