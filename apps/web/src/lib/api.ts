export class ApiError extends Error { constructor(readonly status: number, msg: string, readonly issues?: { path: string; message: string }[]) { super(msg); } }
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), credentials: 'include', headers: opts.body ? { 'content-type': 'application/json' } : undefined, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, j.error ?? `HTTP ${res.status}`, j.issues);
  return j as T;
}
export const fmtClock = (vt: number) => { const s = Math.floor(vt); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const errText = (e: unknown) => (e instanceof ApiError ? `${e.message}${e.issues?.length ? ': ' + e.issues.map((i) => `${i.path} ${i.message}`).join('; ') : ''}` : e instanceof Error ? e.message : 'error');
export interface Frame { ball: [number, number, number]; players: [string, number, number, number, string, number][]; }
export interface LiveState extends Frame { t: 'state'; vt: number; half: number; phase: string; play: string; restart: string | null; clockMode: string; score: [number, number]; rt: number; possession: [number, number]; stats: { A: Record<string, number>; B: Record<string, number> }; dirs: [number, number] }
export interface MEvent { type: string; vt: number; half: number; team?: 'A' | 'B'; playerId?: string; detail?: string; assistId?: string; pos?: [number, number] }
export const EVENT_ICON: Record<string, string> = { goal: '⚽', shot: '🎯', save: '🧤', foul: '⚠', accumulated_foul: '⚠', yellow_card: '🟨', red_card: '🟥', corner: '⛳', kick_in: '↗', goal_clearance: '↘', free_kick: '🦶', penalty_kick: '⚑', substitution: '⇄', tactical_change: '♟', formation_change: '▦', halftime: '⏸', fulltime: '⏹', kickoff: '▶', four_second_violation: '⏱', flying_gk: '✈', shootout_start: '🥅' };
export function describeEvent(e: MEvent, names?: Record<string, string>): string {
  const p = e.playerId ? names?.[e.playerId] ?? e.playerId : '';
  switch (e.type) {
    case 'goal': return `GOAL ${p}${e.assistId ? ` (assist ${names?.[e.assistId] ?? e.assistId})` : ''}${e.detail === 'own goal' ? ' — own goal' : ''}`;
    case 'shot': return `Shot ${p}`; case 'save': return `Save ${p}`; case 'foul': return `Foul ${p}`; case 'yellow_card': return `Yellow card ${p}`; case 'red_card': return `RED card ${p}`;
    case 'kickoff': return e.detail === 'second half' ? 'Second half kick-off' : 'Kick-off'; case 'halftime': return 'Half-time'; case 'fulltime': return `Full-time ${e.detail ?? ''}`;
    default: return `${e.type.replace(/_/g, ' ')}${e.team ? ` (${e.team})` : ''}${e.detail ? ` — ${e.detail}` : ''}`;
  }
}
