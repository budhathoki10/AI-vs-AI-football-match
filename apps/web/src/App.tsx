import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DEFAULT_PLAYERS, MATCH_MINUTES, PROVIDER_IDS, type MatchMinutes, type PlayerConfig, type StartMatchBody, type TeamId } from '@futsal/shared';
import { Backdrop } from './components/Backdrop';
import { GameOverDialog, SettingsDialog } from './components/Dialogs';
import { Icon } from './components/Icon';
import { Logo } from './components/Logo';
import { MatchIntro } from './components/MatchIntro';
import { MatchPanel } from './components/MatchPanel';
import { PitchView } from './components/PitchView';
import { defaultModelFor, SetupPanel } from './components/SetupPanel';
import { TeamBar } from './components/TeamBar';
import { useMatchSession } from './hooks/useMatchSession';
import { useIsClient, usePersistentState } from './hooks/usePersistentState';
import { useProviders } from './hooks/useProviders';
import { modelLabel } from './lib/labels';
import { PROVIDER_STYLES } from './lib/providerStyle';
import { playSound } from './lib/sound';
import type { Frame } from './lib/types';
import type { CamMode, Celebration } from './scene/Court3D';
import { initialMatch, matchReducer, resultHeadline } from './state/match';

const KEY_PLAYERS = 'ai-futsal.players', KEY_OPENROUTER = 'ai-futsal.openrouter-key', KEY_MINUTES = 'ai-futsal.minutes', KEY_SOUND = 'ai-futsal.sound';

export function App() {
  const [state, dispatch] = useReducer(matchReducer, undefined, () => initialMatch());
  const { providers, refresh } = useProviders(); const isClient = useIsClient();
  const [savedPlayers, setSavedPlayers] = usePersistentState<Record<TeamId, PlayerConfig>>(KEY_PLAYERS, DEFAULT_PLAYERS);
  const [openRouterKey, setOpenRouterKey] = usePersistentState(KEY_OPENROUTER, '');
  const [minutes, setMinutes] = usePersistentState<MatchMinutes>(KEY_MINUTES, 3);
  const [soundOn, setSoundOn] = usePersistentState(KEY_SOUND, true);
  const [cam, setCam] = useState<CamMode>('broadcast'); const [settingsOpen, setSettingsOpen] = useState(false);
  const [dismissed, setDismissed] = useState<unknown>(null); const [introRun, setIntroRun] = useState<number | null>(null);
  const frameRef = useRef<Frame | null>(null); const celebrate = useRef<Celebration>({ team: null, until: 0 }); const restored = useRef(false);
  const session = useMatchSession(dispatch, frameRef);

  // restore the saved cards once; keep saving later changes
  useEffect(() => { if (!isClient || restored.current) return; restored.current = true; for (const t of ['A', 'B'] as const) { const sp = savedPlayers[t]; dispatch({ type: 'configure', team: t, player: sp && (PROVIDER_IDS as readonly string[]).includes(sp.provider) ? sp : DEFAULT_PLAYERS[t] }); } }, [isClient, savedPlayers]);
  useEffect(() => { if (restored.current) setSavedPlayers(state.players); }, [state.players, setSavedPlayers]);
  const safeMinutes: MatchMinutes = (MATCH_MINUTES as readonly number[]).includes(minutes) ? minutes : 3;

  // a saved model can disappear from a CLI's list (plan change, CLI update): fall back to that provider's default
  useEffect(() => {
    if (providers.kind !== 'ready' || state.status !== 'setup') return;
    for (const t of ['A', 'B'] as const) {
      const p = state.players[t]; if (p.provider === 'openrouter') continue;
      const known = providers.byId[p.provider].models.some((m) => m.id === p.model); const fb = defaultModelFor(p.provider, providers);
      if (!known && fb) dispatch({ type: 'configure', team: t, player: { ...p, model: fb } });
    }
  }, [providers, state.players, state.status]);

  const byId = providers.kind === 'ready' ? providers.byId : null;
  const labelFor = useCallback((p: PlayerConfig) => modelLabel(p, byId), [byId]);
  const setupNames = useMemo(() => ({ A: labelFor(state.players.A), B: labelFor(state.players.B) }), [state.players, labelFor]);
  const names = state.status === 'setup' ? setupNames : state.names;

  const begin = useCallback((players: Record<TeamId, PlayerConfig>) => {
    const nm = { A: labelFor(players.A), B: labelFor(players.B) }; setDismissed(null);
    dispatch({ type: 'begin', names: nm, minutes: safeMinutes }); setIntroRun((n) => (n ?? 0) + 1);
    const body: StartMatchBody = { home: players.A, away: players.B, minutes: safeMinutes, names: nm, openRouterKey: players.A.provider === 'openrouter' || players.B.provider === 'openrouter' ? openRouterKey || undefined : undefined };
    void session.start(body);
  }, [labelFor, openRouterKey, safeMinutes, session]);
  useEffect(() => { if (state.status === 'setup') setIntroRun(null); }, [state.status]);
  const endIntro = useCallback(() => setIntroRun(null), []);

  // sounds follow the real events and revealed results
  const lastEvents = useRef(0); const lastResult = useRef<number>(-1);
  useEffect(() => {
    if (state.events.length < lastEvents.current) lastEvents.current = 0;
    const fresh = state.events.slice(lastEvents.current); lastEvents.current = state.events.length;
    if (!soundOn) return;
    for (const e of fresh) { if (e.type === 'goal') playSound('goal'); else if (e.type === 'save') playSound('save'); else if (e.type === 'halftime' || e.type === 'kickoff') playSound('whistle'); else if (e.type === 'fulltime') playSound('final'); else if (e.type === 'yellow_card' || e.type === 'red_card') playSound('card'); }
  }, [state.events, soundOn]);
  useEffect(() => {
    const so = state.shootout; if (!so) { lastResult.current = -1; return; }
    const keys = Object.keys(so.results).map(Number); const latest = keys.length ? Math.max(...keys) : -1;
    if (latest > lastResult.current) { lastResult.current = latest; if (soundOn) playSound(so.results[latest].result === 'goal' ? 'goal' : 'save'); }
  }, [state.shootout, soundOn]);

  const thinkingTeam: TeamId | null = state.thinking.A ? 'A' : state.thinking.B ? 'B' : null;
  const glow = thinkingTeam ? PROVIDER_STYLES[state.players[thinkingTeam].provider].glow : 'var(--accent)';
  const inMatch = state.status !== 'setup'; const running = state.status === 'live' || state.status === 'shootout';
  const winner = state.summary?.winner ?? null;
  const tacticOf = (t: TeamId) => { for (let i = state.thoughts.length - 1; i >= 0; i--) { const th = state.thoughts[i]; if (th.team === t && th.strategy) return th.strategy.replace(/_/g, ' '); } return null; };

  const bar = (t: TeamId) => (
    <TeamBar team={t} player={state.players[t]} label={names[t]} goals={state.status === 'setup' ? 0 : state.score[t === 'A' ? 0 : 1]} possession={state.possession[t === 'A' ? 0 : 1]} thinking={state.thinking[t] && !state.paused}
      tactic={tacticOf(t)} hasBall={state.holder === t} isWinner={winner === t} running={running} />
  );

  return (
    <MotionConfig reducedMotion="user">
      <Backdrop />
      <div className="flex min-h-dvh flex-col">
        <motion.header initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 26 }} className="sticky top-0 z-20 flex h-[var(--header-h)] shrink-0 items-center gap-3 border-b border-line bg-[rgb(6_7_9/0.6)] px-[max(var(--gutter),env(safe-area-inset-left))] backdrop-blur-xl">
          <Logo size={34} />
          <h1 className="flex min-w-0 items-baseline gap-1.5 truncate"><span className="text-[15px] font-bold tracking-tight text-ink-soft uppercase">AI Futsal</span><span className="font-display text-[26px] leading-none text-accent italic">Arena</span></h1>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setSoundOn(!soundOn)} aria-label={soundOn ? 'Mute match sounds' : 'Unmute match sounds'} aria-pressed={!soundOn} className="btn-icon grid size-11 place-items-center overflow-hidden rounded-xl">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={soundOn ? 'on' : 'off'} initial={{ y: 16, opacity: 0, rotate: -20 }} animate={{ y: 0, opacity: 1, rotate: 0 }} exit={{ y: -16, opacity: 0, rotate: 20 }} transition={{ type: 'spring', stiffness: 500, damping: 28 }} className="grid place-items-center"><Icon name={soundOn ? 'volume' : 'mute'} /></motion.span>
              </AnimatePresence>
            </button>
            <button type="button" onClick={() => setSettingsOpen(true)} className="btn-icon group flex min-h-11 items-center gap-2 rounded-xl px-3">
              <Icon name="gear" className="transition-transform duration-700 ease-out group-hover:rotate-180" /><span className="hidden text-[14px] font-semibold sm:inline">Settings</span>
              {openRouterKey && <span className="pulse-dot size-2 rounded-full bg-signal" aria-label="OpenRouter key saved" />}
            </button>
          </div>
        </motion.header>

        <main className="arena flex-1">
          <motion.section className="pitch-column @container" aria-label="Pitch" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 160, damping: 22, delay: 0.08 }}>
            {bar('B')}
            <PitchView state={state} frameRef={frameRef} cam={cam} onCam={setCam} quality="medium" glow={glow} celebrate={celebrate} />
            {bar('A')}
          </motion.section>

          <motion.aside className="side-panel glass overflow-hidden rounded-3xl" aria-label={inMatch ? 'Match' : 'Match setup'} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 160, damping: 24, delay: 0.16 }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={inMatch ? 'match' : 'setup'} className="h-full" initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -16, filter: 'blur(6px)' }} transition={{ duration: 0.25 }}>
                {inMatch ? (
                  <MatchPanel state={state} onPause={session.pause} onResume={session.resume} onEnd={session.stop} onNewMatch={() => { session.close(); dispatch({ type: 'reset' }); }} onReview={() => setDismissed(null)} />
                ) : (
                  <SetupPanel players={state.players} providers={providers} hasOpenRouterKey={Boolean(openRouterKey)} minutes={safeMinutes} onMinutesChange={setMinutes} onChange={(t, p) => dispatch({ type: 'configure', team: t, player: p })} onSwap={() => dispatch({ type: 'swap' })} onStart={() => begin(state.players)} onRefreshProviders={refresh} error={state.error} />
                )}
              </motion.div>
            </AnimatePresence>
          </motion.aside>
        </main>

        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} openRouterKey={openRouterKey} onSaveKey={setOpenRouterKey} soundOn={soundOn} onSoundChange={setSoundOn} />
        <GameOverDialog open={state.status === 'over' && state.summary !== null && dismissed !== state.summary} onClose={() => setDismissed(state.summary)} summary={state.summary} players={state.players} names={state.names} headline={resultHeadline(state)}
          onRematch={() => begin(state.players)} onSwapRematch={() => { dispatch({ type: 'swap' }); begin({ A: state.players.B, B: state.players.A }); }} onNewSetup={() => { session.close(); dispatch({ type: 'reset' }); }} />
        <AnimatePresence>{introRun !== null && <MatchIntro key={introRun} players={state.players} names={names} onDone={endIntro} />}</AnimatePresence>
      </div>
    </MotionConfig>
  );
}

