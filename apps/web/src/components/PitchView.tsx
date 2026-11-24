import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { fmtClock, otherTeam, type TeamId } from '@futsal/shared';
import type { Frame } from '../lib/types';
import { Court3D, type CamMode, type Celebration, type TeamLook } from '../scene/Court3D';
import { PenaltyScene } from '../scene/PenaltyScene';
import { currentKick, kickResult, playerTag, shootoutRow, type MatchView } from '../state/match';
import { Confetti } from './Celebration';

export const KITS: Record<TeamId, [string, string]> = { A: ['#f5f0e6', '#14151a'], B: ['#1b1c22', '#e9b44c'] };
const CAMS: [CamMode, string][] = [['broadcast', 'Broadcast'], ['tactical', 'Tactical'], ['follow', 'Follow ball'], ['goal', 'Goal']];
const RESULT_TEXT = { goal: 'GOAL!', saved: 'SAVED!', missed: 'MISSED', post: 'OFF THE POST' } as const;

/** Teams lined up for kick-off: shown before a match starts (and while it connects) so the pitch is never an empty box. */
const PREVIEW_IDS: [string, number, string][] = [['1', 1, 'GK'], ['2', 2, 'FIXO'], ['3', 3, 'ALA'], ['4', 4, 'ALA'], ['5', 5, 'PIVOT']];
const PREVIEW_LOOK: TeamLook = { A: KITS.A, B: KITS.B, numbers: Object.fromEntries((['A', 'B'] as const).flatMap((t) => PREVIEW_IDS.map(([n, num]) => [`${t}${n}`, num]))), roles: Object.fromEntries((['A', 'B'] as const).flatMap((t) => PREVIEW_IDS.map(([n, , role]) => [`${t}${n}`, role]))) };
const PREVIEW_SLOTS: [number, number][] = [[-18.8, 0], [-8, -4], [-8, 4], [-1.6, -5], [-1.6, 5]];
const PREVIEW_FRAME: Frame = { ball: [0, 0.1, 0], players: (['A', 'B'] as const).flatMap((t) => PREVIEW_SLOTS.map(([x, z], i): [string, number, number, number, string, number] => [`${t}${i + 1}`, t === 'A' ? x : -x, t === 'A' ? z : -z, t === 'A' ? 0 : Math.PI, 'idle', 1])) };

function useLook(s: MatchView): TeamLook | null {
  return useMemo(() => {
    if (!s.roster) return null; const numbers: Record<string, number> = {}, roles: Record<string, string> = {};
    for (const t of ['A', 'B'] as const) for (const p of s.roster[t]) { numbers[p.id] = p.number; roles[p.id] = p.role; }
    return { A: KITS.A, B: KITS.B, numbers, roles };
  }, [s.roster]);
}

/** Transient big caption (half-time, full time, cards, penalties). */
function useCaption(s: MatchView) {
  const [caption, setCaption] = useState<{ text: string; key: number } | null>(null); const seen = useRef(0);
  useEffect(() => {
    const e = s.events[s.events.length - 1]; if (!e || s.events.length === seen.current) return; seen.current = s.events.length;
    const text = e.type === 'halftime' ? 'Half-time' : e.type === 'fulltime' ? 'Full time' : e.type === 'red_card' ? 'Red card' : e.type === 'yellow_card' ? 'Yellow card' : e.type === 'penalty_kick' ? 'Penalty!' : e.type === 'kickoff' && e.detail === 'second half' ? 'Second half' : null;
    if (!text) return; setCaption({ text, key: s.events.length }); const t = window.setTimeout(() => setCaption(null), 2200); return () => window.clearTimeout(t);
  }, [s.events]);
  return caption;
}

function ScoreChip({ s }: { s: MatchView }) {
  const so = s.shootout; const shoot = s.status === 'shootout' && so;
  const [a, b] = shoot ? so.score : s.score; const pct = Math.min(100, (s.vt / 5400) * 100);
  return (
    <div className="hud-chip pointer-events-none absolute top-2.5 left-1/2 z-10 -translate-x-1/2 overflow-hidden rounded-2xl px-3.5 pt-1.5 pb-2 text-center @sm:top-3">
      <div className="flex items-center justify-center gap-3">
        <span className="size-2.5 rounded-full bg-[#f5f0e6] ring-1 ring-white/40" aria-hidden="true" />
        <span className="font-mono text-[20px] font-extrabold tracking-tight tabular-nums @sm:text-[26px]" aria-label={`score ${a} to ${b}`}>{a}<span className="mx-1.5 text-faint">–</span>{b}</span>
        <span className="size-2.5 rounded-full bg-[#15161b] ring-1 ring-white/30" aria-hidden="true" />
      </div>
      <div className="mt-0.5 flex items-center justify-center gap-2 font-mono text-[11px] font-semibold text-muted @sm:text-[12px]">
        {shoot ? <span className="text-accent">PENALTIES · reg {s.score[0]}–{s.score[1]}</span> : <><span className="text-ink-soft tabular-nums" data-testid="clock">{fmtClock(s.vt)}</span><span aria-hidden="true">·</span><span>{s.playPhase === 'halftime' ? 'HT' : s.status === 'over' ? 'FT' : s.half === 1 ? '1ST' : '2ND'}</span></>}
      </div>
      {!shoot && <div className="well absolute inset-x-0 bottom-0 h-[3px]"><motion.i className="live-bar block h-full" initial={false} animate={{ width: `${pct}%` }} transition={{ type: 'tween', duration: 0.25, ease: 'linear' }} /></div>}
    </div>
  );
}

function ShootoutHud({ s }: { s: MatchView }) {
  const kick = currentKick(s); const result = kick ? kickResult(s, kick.index) : null; const [showResult, setShowResult] = useState<number | null>(null);
  useEffect(() => { if (!result) return; setShowResult(result.index); const t = window.setTimeout(() => setShowResult(null), 2100); return () => window.clearTimeout(t); }, [result?.index]); // eslint-disable-line react-hooks/exhaustive-deps
  const row = (team: TeamId) => { const list = shootoutRow(s, team); const n = Math.max(5, list.length);
    return (
      <div className="flex items-center gap-1.5" aria-label={`${s.names[team]} penalties`}>
        <span className={`size-2.5 rounded-full ring-1 ${team === 'A' ? 'bg-[#f5f0e6] ring-white/40' : 'bg-[#15161b] ring-white/30'}`} aria-hidden="true" />
        {Array.from({ length: n }, (_, i) => { const r = list[i];
          return (
            <motion.span key={i} initial={false} animate={{ scale: r && r !== 'pending' ? [1.5, 1] : 1 }} className={`grid size-[19px] place-items-center rounded-full border text-[10px] font-extrabold ${!r ? 'border-line-strong text-transparent' : r === 'pending' ? 'pulse-dot border-accent bg-accent/20 text-transparent' : r === 'goal' ? 'border-signal bg-signal text-[#04231b]' : 'border-danger bg-danger/85 text-white'}`} title={r ?? 'to come'}>
              {r === 'goal' ? '✓' : r === 'saved' ? 'S' : r && r !== 'pending' ? '✕' : ''}
            </motion.span>
          );
        })}
      </div>
    );
  };
  return (
    <>
      <div className="hud-chip pointer-events-none absolute bottom-2.5 left-2.5 z-10 flex flex-col gap-1.5 rounded-2xl px-3 py-2 @sm:bottom-3 @sm:left-3">{row('A')}{row('B')}</div>
      {kick && (
        <motion.div key={kick.index} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="hud-chip pointer-events-none absolute bottom-2.5 left-1/2 z-10 hidden max-w-[52%] -translate-x-1/2 rounded-2xl px-3.5 py-2 text-center @sm:block @sm:bottom-3">
          <div className="text-[11px] font-bold tracking-[0.16em] text-faint uppercase">{kick.suddenDeath ? 'Sudden death' : `Round ${kick.round}`} · {s.names[kick.team]}</div>
          <div className="mt-0.5 truncate text-[13px] font-semibold text-ink-soft">{playerTag(s, kick.takerId)} <span className="text-faint">vs</span> {playerTag(s, kick.keeperId)}</div>
        </motion.div>
      )}
      <AnimatePresence>
        {result && showResult === result.index && (
          <motion.div key={result.index} className="pointer-events-none absolute inset-0 z-20 grid place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ scale: 2.4, opacity: 0, rotate: -6 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 16 }}
              className={`font-display text-[clamp(44px,9vw,96px)] leading-none italic ${result.result === 'goal' ? 'goal-text' : 'text-ink [text-shadow:0_8px_40px_rgb(0_0_0/0.8)]'}`}>{RESULT_TEXT[result.result]}</motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

interface PitchViewProps { state: MatchView; frameRef: MutableRefObject<Frame | null>; cam: CamMode; onCam: (c: CamMode) => void; quality: 'low' | 'medium' | 'high'; glow: string; celebrate: MutableRefObject<Celebration> }

/** Simulation debug readout (toggle with the bug button or the D key): owner, possession, speeds, actions, pass options, collisions. */
function DebugPanel({ frameRef, state }: { frameRef: MutableRefObject<Frame | null>; state: MatchView }) {
  const [, force] = useState(0);
  useEffect(() => { const id = window.setInterval(() => force((n) => n + 1), 250); return () => window.clearInterval(id); }, []);
  const d = frameRef.current?.dbg; if (!d) return null;
  const rows = Object.entries(d.acts).map(([id, act]) => ({ id, act, v: d.speeds[id] ?? 0 })).sort((a, b) => a.id.localeCompare(b.id));
  const opt = (t: TeamId) => d.options[t][0];
  return (
    <div role="region" aria-label="Simulation debug" className="hud-chip absolute top-14 left-2.5 z-10 max-h-[70%] w-[min(19rem,calc(100%-1.25rem))] overflow-auto rounded-xl p-2.5 font-mono text-[10.5px] leading-[1.45] text-muted @sm:left-3">
      <p className="mb-1 font-semibold text-ink">tick {d.tick} · step {(d.dt * 1000).toFixed(1)} ms · {state.playPhase}</p>
      <p>owner <b className="text-ink">{d.owner ?? 'loose / in flight'}</b> · possession {state.holder ?? '-'} · ball {d.ballSpeed} m/s · bumps {d.bumps}{d.lastBump ? ` (${d.lastBump.a}×${d.lastBump.b} ${d.lastBump.v.toFixed(1)})` : ''}</p>
      {(['A', 'B'] as const).map((t) => <p key={t}>pass {t}: {opt(t) ? `${opt(t).kind} → ${opt(t).to} risk ${opt(t).risk} score ${opt(t).score}` : '—'}</p>)}
      <div className="mt-1.5 grid grid-cols-2 gap-x-3">{rows.map((r) => <p key={r.id} className={r.id === d.owner ? 'text-accent' : ''}>{r.id} {r.act} {r.v.toFixed(1)}</p>)}</div>
    </div>
  );
}

export function PitchView({ state, frameRef, cam, onCam, quality, glow, celebrate }: PitchViewProps) {
  const [debug, setDebug] = useState(false);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.key === 'd' || e.key === 'D') && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) setDebug((v) => !v); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const look = useLook(state); const caption = useCaption(state); const previewRef = useRef<Frame | null>(PREVIEW_FRAME);
  const kick = currentKick(state); const shoot = state.status === 'shootout' && !!kick;
  const playRef = useRef({ t0: performance.now(), speed: 1 });
  useEffect(() => { playRef.current = { t0: performance.now(), speed: 1 }; }, [kick?.index]);
  const thinkingNow = state.thinking.A || state.thinking.B;

  // goal celebration: confetti in the scoring team's colours, the big caption, and the players' arms-up animation
  const [celebration, setCelebration] = useState<NonNullable<MatchView['goal']> | null>(null);
  useEffect(() => {
    if (!state.goal) return; setCelebration(state.goal);
    celebrate.current = { team: state.goal.team, sad: otherTeam(state.goal.team), until: performance.now() + 3800 };
    const t = window.setTimeout(() => setCelebration(null), 3600); return () => window.clearTimeout(t);
  }, [state.goal?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pitch-frame" data-live={thinkingNow && !state.paused} style={{ ['--glow' as string]: glow }}>
      <div className="pitch-surface @container">
        {look && !shoot && <Court3D frameRef={frameRef} look={look} mode={cam} quality={quality} celebrate={celebrate} debug={debug} />}
        {look && !shoot && debug && <DebugPanel frameRef={frameRef} state={state} />}
        {look && shoot && kick && <PenaltyScene frames={kick.frames} tColor={KITS[kick.team][0]} tColor2={KITS[kick.team][1]} kColor={KITS[otherTeam(kick.team)][0]} playRef={playRef} />}

        {!look && (
          <>
            <Court3D frameRef={previewRef} look={PREVIEW_LOOK} mode="tactical" quality="low" />
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgb(6_7_9/0.15),rgb(6_7_9/0.6))]">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="hud-chip rounded-2xl px-5 py-3 text-center"><p className="thinking-text text-[14px] font-semibold">{state.status === 'setup' ? 'Choose two coaches and kick off' : 'Warming up the pitch…'}</p></motion.div>
            </div>
          </>
        )}

        {state.status !== 'setup' && look && <ScoreChip s={state} />}
        {shoot && <ShootoutHud s={state} />}

        {look && !shoot && state.status !== 'over' && (
          <div role="radiogroup" aria-label="Camera" className="hud-chip absolute right-2.5 bottom-2.5 z-10 flex gap-0.5 rounded-xl p-1 @sm:right-3 @sm:bottom-3">
            {CAMS.map(([c, label]) => (
              <button key={c} type="button" role="radio" aria-checked={cam === c} onClick={() => onCam(c)} className={`relative rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors @sm:px-2.5 @sm:text-[12px] ${cam === c ? 'text-accent-ink' : 'text-muted hover:text-ink'}`}>
                {cam === c && <motion.span layoutId="cam-pill" className="absolute inset-0 rounded-lg bg-accent shadow-[0_0_14px_-3px_rgb(233_180_76/0.8)]" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
                <span className="relative">{label}</span>
              </button>
            ))}
            <button type="button" aria-pressed={debug} aria-label="Toggle simulation debug overlay" title="Debug overlay (D)" onClick={() => setDebug((v) => !v)} className={`ml-0.5 rounded-lg px-2 py-1.5 font-mono text-[11px] font-semibold transition-colors @sm:text-[12px] ${debug ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'}`}>dbg</button>
          </div>
        )}

        <AnimatePresence>
          {caption && !celebration && (
            <motion.div key={caption.key} className="pointer-events-none absolute inset-0 z-20 grid place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.div initial={{ scale: 1.9, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.85, opacity: 0, y: -10 }} transition={{ type: 'spring', stiffness: 340, damping: 18 }} className="hud-chip rounded-2xl px-7 py-3 font-display text-[clamp(28px,6vw,54px)] leading-none text-ink italic">{caption.text}</motion.div>
            </motion.div>
          )}
          {celebration && !shoot && (
            <motion.div key={`goal-${celebration.n}`} className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(10_11_14/0.35),rgb(4_5_8/0.65))]" />
              <Confetti colors={celebration.team === 'A' ? ['#f5f0e6', '#e9b44c', '#6ff0c0'] : ['#e9b44c', '#fde7b0', '#6ff0c0']} />
              <div className="relative text-center">
                <motion.div initial={{ scale: 3, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }} className="goal-text font-display text-[clamp(56px,13vw,132px)] leading-none italic">GOAL</motion.div>
                <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mt-1 text-[clamp(13px,2.4vw,18px)] font-semibold text-ink">{state.names[celebration.team]}{celebration.playerId ? ` · ${playerTag(state, celebration.playerId)}` : ''}</motion.p>
                {celebration.assistId && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-[13px] text-muted">assist {playerTag(state, celebration.assistId)}</motion.p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {state.paused && (
            <motion.div className="absolute inset-0 z-30 grid place-items-center bg-[rgb(6_7_9/0.55)] backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="hud-chip flex items-center gap-3 rounded-2xl px-6 py-3 text-[15px] font-bold tracking-[0.18em] text-ink uppercase"><span className="flex gap-1" aria-hidden="true"><i className="block h-4 w-1.5 rounded-sm bg-accent" /><i className="block h-4 w-1.5 rounded-sm bg-accent" /></span>Paused</motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
