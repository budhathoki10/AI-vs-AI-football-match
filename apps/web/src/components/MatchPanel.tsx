import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtClock, sideLabel, type MatchEventMsg, type TeamId, type TeamStatsLite, type ThoughtMsg } from '@futsal/shared';
import { Icon, type IconName } from './Icon';
import { ProviderAvatar } from './ProviderAvatar';
import { playerTag, resultHeadline, type MatchView } from '../state/match';

type Tab = 'timeline' | 'thoughts' | 'stats';
const TABS: { id: Tab; label: string; icon: IconName }[] = [{ id: 'timeline', label: 'Timeline', icon: 'list' }, { id: 'thoughts', label: 'Thoughts', icon: 'chat' }, { id: 'stats', label: 'Stats', icon: 'chart' }];

/** Events worth a line in the feed (passes, kick-ins and goal clearances would drown it). */
const SHOWN = new Set(['kickoff', 'goal', 'shot', 'save', 'foul', 'yellow_card', 'red_card', 'corner', 'free_kick', 'penalty_kick', 'substitution', 'flying_gk', 'tactical_change', 'formation_change', 'halftime', 'fulltime', 'advantage', 'accumulated_foul']);
const EVENT_ICON: Record<string, string> = { goal: '⚽', shot: '🎯', save: '🧤', foul: '⚠', accumulated_foul: '⚠', yellow_card: '🟨', red_card: '🟥', corner: '⛳', free_kick: '🦶', penalty_kick: '⚑', substitution: '⇄', tactical_change: '♟', formation_change: '▦', halftime: '⏸', fulltime: '⏹', kickoff: '▶', flying_gk: '✈', advantage: '▶' };

function describe(e: MatchEventMsg, s: MatchView): string {
  const who = playerTag(s, e.playerId); const team = e.team ? s.names[e.team] : '';
  switch (e.type) {
    case 'goal': return `GOAL ${who}${e.assistId ? ` · assist ${playerTag(s, e.assistId)}` : ''}${e.detail === 'own goal' ? ' (own goal)' : ''}`;
    case 'shot': return `Shot ${who}`; case 'save': return `Save ${who}`; case 'foul': return `Foul ${who}`; case 'yellow_card': return `Yellow card ${who}`; case 'red_card': return `Red card ${who}`;
    case 'kickoff': return e.detail === 'second half' ? 'Second half kick-off' : 'Kick-off'; case 'halftime': return 'Half-time'; case 'fulltime': return `Full time ${e.detail ?? ''}`.trim();
    case 'tactical_change': return `${team}: ${e.detail ?? 'tactical change'}`; case 'formation_change': return `${team} formation ${e.detail ?? ''}`; case 'substitution': return `${team} substitution ${who}`;
    case 'flying_gk': return `${team} flying goalkeeper ${e.detail ?? ''}`; case 'penalty_kick': return `Penalty to ${team}`; case 'free_kick': return `Free kick to ${team}${e.detail?.includes('no wall') ? ' (no wall)' : ''}`;
    case 'advantage': return 'Advantage — play on'; case 'corner': return `Corner to ${team}`; case 'accumulated_foul': return `${team}: accumulated foul`;
    default: return e.type.replace(/_/g, ' ');
  }
}

function EmptyNote({ children }: { children: string }) {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" className="text-faint"><circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" className="emblem-flow" /><polygon points="24,16 30,20.4 27.6,27.6 20.4,27.6 18,20.4" fill="currentColor" className="logo-square" /></svg>
      <p className="text-[14px] text-muted">{children}</p>
    </div>
  );
}

function Timeline({ s }: { s: MatchView }) {
  const endRef = useRef<HTMLDivElement>(null);
  const list = useMemo(() => s.events.filter((e) => SHOWN.has(e.type)), [s.events]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [list.length]);
  if (list.length === 0) return <EmptyNote>The first events appear here.</EmptyNote>;
  return (
    <LayoutGroup id="timeline"><ol className="p-2">
      {list.map((e, i) => {
        const goal = e.type === 'goal';
        return (
          <motion.li key={`${e.vt}-${e.type}-${i}`} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            className={`grid grid-cols-[3.2rem_1.4rem_1fr] items-center gap-1 rounded-lg px-1.5 py-1.5 text-[13.5px] ${goal ? 'bg-accent/15 text-ink' : i % 2 ? 'bg-white/[0.022] text-ink-soft' : 'text-ink-soft'}`}>
            <span className="font-mono text-[12px] text-faint tabular-nums">{fmtClock(e.vt)}</span>
            <span aria-hidden="true">{EVENT_ICON[e.type] ?? '•'}</span>
            <span className="flex min-w-0 items-center gap-2"><span className={`min-w-0 truncate ${goal ? 'font-bold' : ''}`}>{describe(e, s)}</span>
              {e.team && <span className={`ml-auto size-2 shrink-0 rounded-full ring-1 ${e.team === 'A' ? 'bg-[#f5f0e6] ring-white/40' : 'bg-[#15161b] ring-white/25'}`} title={sideLabel(e.team)} />}</span>
          </motion.li>
        );
      })}
      <div ref={endRef} />
    </ol></LayoutGroup>
  );
}

/** Each coach's reasoning, as short summaries. Models decide every few virtual minutes, so repeats of the same call are folded away. */
function Thoughts({ s }: { s: MatchView }) {
  const endRef = useRef<HTMLDivElement>(null);
  const list = useMemo(() => {
    const last: Partial<Record<TeamId, string>> = {}; const out: ThoughtMsg[] = [];
    for (const t of s.thoughts) {
      const key = `${t.strategy}|${t.summary}`; const builtin = !t.source.startsWith('llm');
      if (builtin && last[t.team] === key && t.trigger === 'interval') continue;
      last[t.team] = key; out.push(t);
    }
    return out;
  }, [s.thoughts]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [list.length]);
  if (list.length === 0) return <EmptyNote>Each coach explains its tactics here.</EmptyNote>;
  return (
    <ul className="space-y-3 p-3">
      {list.map((t, i) => {
        const right = t.team === 'B'; const player = s.players[t.team];
        return (
          <motion.li key={`${t.vt}-${t.team}-${i}`} initial={{ opacity: 0, y: 16, scale: 0.94, x: right ? 12 : -12 }} animate={{ opacity: 1, y: 0, scale: 1, x: 0 }} transition={{ type: 'spring', stiffness: 340, damping: 26 }} className={`flex gap-2.5 ${right ? 'flex-row-reverse' : ''}`}>
            <ProviderAvatar provider={player.provider} size={30} />
            <div className={`min-w-0 max-w-[85%] rounded-2xl border px-3.5 py-2.5 ${t.accepted ? 'border-line' : 'border-warning/30'} ${right ? 'rounded-tr-md bg-[linear-gradient(160deg,#23252e,#191a20)]' : 'rounded-tl-md bg-[linear-gradient(160deg,#2b2a26,#1d1c19)]'}`}>
              <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11.5px] text-muted ${right ? 'flex-row-reverse' : ''}`}>
                <span className="truncate font-semibold text-ink-soft">{s.names[t.team]}</span>
                <span className="shrink-0 rounded-md bg-black/30 px-1.5 py-px font-mono text-accent">{fmtClock(t.vt)}</span>
                {t.strategy && <span className="shrink-0 rounded-md bg-white/[0.07] px-1.5 py-px font-semibold text-ink-soft capitalize">{t.strategy.replace(/_/g, ' ')}</span>}
                {t.latencyMs > 0 && <span className="shrink-0 font-mono text-faint">{(t.latencyMs / 1000).toFixed(1)}s</span>}
              </div>
              <p className="mt-1 text-[14px] leading-snug text-ink">{t.summary || 'No explanation given.'}</p>
              {!t.accepted && <p className="mt-1.5 flex gap-1.5 text-[12px] leading-snug text-warning"><span aria-hidden="true">⚠</span><span>The model&apos;s answer could not be used{t.reason ? ` (${t.reason.replace(/^invalid\/failed:\s*/, '')})` : ''}. The team keeps its current tactics until the next answer.</span></p>}
            </div>
          </motion.li>
        );
      })}
      <div ref={endRef} />
    </ul>
  );
}

function StatRow({ label, a, b, fmt }: { label: string; a: number; b: number; fmt?: (n: number) => string }) {
  const total = a + b || 1; const f = fmt ?? ((n: number) => String(Math.round(n * 10) / 10));
  return (
    <div className="grid grid-cols-[3rem_1fr_3rem] items-center gap-2 py-1.5">
      <span className="font-mono text-[14px] font-bold tabular-nums">{f(a)}</span>
      <div><div className="text-center text-[11.5px] font-semibold tracking-wide text-muted uppercase">{label}</div>
        <div className="well mt-1 flex h-2 overflow-hidden rounded-full"><motion.i className="block h-full bg-[#f5f0e6]" initial={false} animate={{ width: `${(100 * a) / total}%` }} transition={{ type: 'spring', stiffness: 180, damping: 26 }} /><motion.i className="block h-full bg-accent" initial={false} animate={{ width: `${(100 * b) / total}%` }} transition={{ type: 'spring', stiffness: 180, damping: 26 }} /></div></div>
      <span className="text-right font-mono text-[14px] font-bold tabular-nums">{f(b)}</span>
    </div>
  );
}

function Stats({ s }: { s: MatchView }) {
  const A: TeamStatsLite = s.summary ? s.summary.teamStats.A : s.stats.A; const B: TeamStatsLite = s.summary ? s.summary.teamStats.B : s.stats.B;
  const pct = (x: number, y: number) => (y ? Math.round((100 * x) / y) : 0);
  return (
    <div className="p-4">
      <div className="mb-2 flex justify-between text-[12px] font-bold tracking-wider text-faint uppercase"><span>{s.names.A}</span><span>{s.names.B}</span></div>
      <StatRow label="Possession" a={s.possession[0]} b={s.possession[1]} fmt={(n) => `${n}%`} />
      <StatRow label="Shots" a={A.shots} b={B.shots} /><StatRow label="On target" a={A.onTarget} b={B.onTarget} />
      <StatRow label="Expected goals" a={+A.xg.toFixed(2)} b={+B.xg.toFixed(2)} fmt={(n) => n.toFixed(2)} />
      <StatRow label="Pass accuracy" a={pct(A.passesOk, A.passes)} b={pct(B.passesOk, B.passes)} fmt={(n) => `${n}%`} />
      <StatRow label="Saves" a={A.saves} b={B.saves} /><StatRow label="Corners" a={A.corners} b={B.corners} /><StatRow label="Fouls" a={A.fouls} b={B.fouls} /><StatRow label="Recoveries" a={A.recoveries} b={B.recoveries} />
      <p className="mt-3 text-[12px] leading-snug text-faint">Every number is counted from the simulation itself. Expected goals comes from a model fitted on simulated shots.</p>
    </div>
  );
}

function StatusLine({ s }: { s: MatchView }) {
  const content = (() => {
    if (s.status === 'over') return { key: 'over', node: <><span className="rounded-md bg-accent/15 px-1.5 py-px text-[11px] font-bold tracking-wider text-accent uppercase">Final</span><span className="truncate font-semibold text-ink">{resultHeadline(s)}</span></> };
    if (s.paused) return { key: 'paused', node: <><span className="rounded-md bg-warning/15 px-1.5 py-px text-[11px] font-bold tracking-wider text-warning uppercase">Paused</span><span className="text-muted">Press resume to continue</span></> };
    if (s.status === 'connecting') return { key: 'conn', node: <span className="thinking-text">Connecting to the match…</span> };
    const label = s.status === 'shootout' ? 'Penalties' : s.playPhase === 'halftime' ? 'Half-time' : 'Live';
    const thinking = (['A', 'B'] as const).filter((t) => s.thinking[t]).map((t) => s.names[t]);
    return { key: `live-${label}-${thinking.join()}`, node: <><span className="flex items-center gap-1.5 rounded-md bg-danger/15 px-1.5 py-px text-[11px] font-bold tracking-wider text-danger uppercase"><span className="pulse-dot size-1.5 rounded-full bg-danger" aria-hidden="true" />{label}</span>
      <span className="truncate text-muted">{thinking.length ? <><span className="text-ink-soft">{thinking.join(' & ')}</span> thinking</> : s.status === 'shootout' ? 'Sudden pressure, one on one' : `${fmtClock(s.vt)} of 90:00`}</span></> };
  })();
  return (
    <div className="relative mt-2 h-6 overflow-hidden text-[13.5px]"><AnimatePresence mode="popLayout" initial={false}>
      <motion.p key={content.key} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -18, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }} className="flex min-w-0 items-center gap-2">{content.node}</motion.p></AnimatePresence></div>
  );
}

interface MatchPanelProps { state: MatchView; onPause: () => void; onResume: () => void; onEnd: () => void; onNewMatch: () => void; onReview: () => void }

export function MatchPanel({ state, onPause, onResume, onEnd, onNewMatch, onReview }: MatchPanelProps) {
  const [tab, setTab] = useState<Tab>('timeline');
  const running = state.status === 'live' || state.status === 'shootout' || state.status === 'connecting';
  const thoughtCount = state.thoughts.length;
  return (
    <motion.div className="flex h-full min-h-[420px] flex-col" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 26 }}>
      <div className="border-b border-line px-5 pt-4 pb-3.5">
        <h2 className="flex min-w-0 items-center gap-2.5"><ProviderAvatar provider={state.players.A.provider} size={26} /><span className="min-w-0 truncate text-[15px] font-semibold">{state.names.A}</span>
          <span className="font-display shrink-0 text-[18px] text-faint italic">vs</span><span className="min-w-0 truncate text-[15px] font-semibold">{state.names.B}</span><ProviderAvatar provider={state.players.B.provider} size={26} /></h2>
        <StatusLine s={state} />
      </div>
      <AnimatePresence>
        {state.error && (
          <motion.div key={state.error} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="shake m-3 rounded-xl border border-danger/40 bg-[linear-gradient(160deg,rgb(255_92_80/0.16),rgb(255_92_80/0.05))] p-3.5 text-[13px]" role="alert"><p className="flex items-center gap-2 font-semibold text-ink"><span className="pulse-dot size-2 rounded-full bg-danger" aria-hidden="true" />Something went wrong</p><p className="mt-1 break-words text-ink-soft">{state.error}</p></div>
          </motion.div>
        )}
      </AnimatePresence>
      <div role="tablist" aria-label="Match details" className="flex gap-1 border-b border-line px-3">
        {TABS.map(({ id, label, icon }) => (
          <button key={id} role="tab" type="button" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)} className={`relative flex min-h-11 items-center gap-1.5 px-3 text-[14px] font-semibold transition-colors ${tab === id ? 'text-ink' : 'text-muted hover:text-ink'}`}>
            <Icon name={icon} size={15} />{label}
            {id === 'thoughts' && thoughtCount > 0 && <motion.span key={thoughtCount} initial={{ scale: 1.5 }} animate={{ scale: 1 }} className="rounded-full bg-white/10 px-1.5 font-mono text-[10.5px] text-ink-soft">{thoughtCount}</motion.span>}
            {tab === id && <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent shadow-[0_0_12px_var(--accent)]" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
          </button>
        ))}
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-[180px] flex-1 overflow-y-auto overscroll-contain">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }}>
            {tab === 'timeline' ? <Timeline s={state} /> : tab === 'thoughts' ? <Thoughts s={state} /> : <Stats s={state} />}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="border-t border-line bg-black/20 p-2.5">
        <div className="flex flex-wrap gap-1.5">
          {running && (state.paused ? (
            <button type="button" onClick={onResume} className="btn-primary flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl font-bold"><Icon name="play" size={17} /> Resume</button>
          ) : (
            <button type="button" onClick={onPause} disabled={state.status === 'connecting'} className="btn-glass flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl font-semibold"><Icon name="pause" size={17} /> Pause</button>
          ))}
          {running ? (
            <button type="button" onClick={onEnd} className="btn-glass flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl font-semibold"><Icon name="stop" size={15} /> End match</button>
          ) : (
            <>
              <button type="button" onClick={onNewMatch} className="btn-primary flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl font-bold"><Icon name="plus" size={18} /> New match</button>
              {state.summary && <button type="button" onClick={onReview} className="btn-glass flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 font-semibold"><Icon name="crown" size={15} /> Result</button>}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
