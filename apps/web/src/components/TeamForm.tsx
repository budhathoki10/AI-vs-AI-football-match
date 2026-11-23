import { ARCH_OPTS } from '../lib/options';

export interface TeamState { name: string; formation: string; attackingStyle: string; defensiveStyle: string; architecture: string; provider: string; model: string; tacticalInstructions: string; primaryColor: string }
export function TeamForm({ t, set, title, providers }: { t: TeamState; set: (t: TeamState) => void; title: string; providers: string[] }) {
  const u = (k: keyof TeamState) => (e: { target: { value: string } }) => set({ ...t, [k]: e.target.value });
  const llm = t.architecture === 'llm';
  return <div className="card col"><h2>{title}</h2>
    <label>Team name<input value={t.name} onChange={u('name')} maxLength={40} /></label>
    <div className="row"><label style={{ flex: 1 }}>Formation<select value={t.formation} onChange={u('formation')}>{['2-2', '1-2-1', '3-1', '4-0'].map((f) => <option key={f}>{f}</option>)}</select></label>
      <label style={{ width: 90 }}>Colour<input type="color" value={t.primaryColor} onChange={u('primaryColor')} /></label></div>
    <div className="row"><label style={{ flex: 1 }}>Attack<select value={t.attackingStyle} onChange={u('attackingStyle')}>{['possession', 'direct', 'counter', 'wing_play', 'pivot_play'].map((f) => <option key={f}>{f}</option>)}</select></label>
      <label style={{ flex: 1 }}>Defence<select value={t.defensiveStyle} onChange={u('defensiveStyle')}>{['high_press', 'mid_block', 'low_block', 'man_marking'].map((f) => <option key={f}>{f}</option>)}</select></label></div>
    <label>Decision architecture<select value={t.architecture} onChange={u('architecture')}>{ARCH_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    {llm && <div className="row"><label style={{ flex: 1 }}>Provider<select value={t.provider} onChange={u('provider')}><option value="">select…</option>{providers.map((p) => <option key={p}>{p}</option>)}</select></label>
      <label style={{ flex: 2 }}>Model id<input value={t.model} onChange={u('model')} placeholder="model identifier" maxLength={120} /></label></div>}
    {llm && providers.length === 0 && <div className="note">No provider key configured yet. Add one under Providers.</div>}
    <label>Tactical notes (optional, sent to LLM agents)<textarea rows={2} value={t.tacticalInstructions} onChange={u('tacticalInstructions')} maxLength={500} /></label>
  </div>;
}
export const toInput = (t: TeamState) => ({ name: t.name, formation: t.formation, attackingStyle: t.attackingStyle, defensiveStyle: t.defensiveStyle, architecture: t.architecture, primaryColor: t.primaryColor, tacticalInstructions: t.tacticalInstructions || undefined, ...(t.architecture === 'llm' ? { provider: t.provider || undefined, model: t.model || undefined } : {}) });
