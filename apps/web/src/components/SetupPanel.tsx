import { AnimatePresence, motion, useAnimate } from 'motion/react';
import { useId, useState } from 'react';
import { DEFAULT_OPENROUTER_MODEL, EFFORT_LEVELS, MATCH_MINUTES, MODEL_ID_PATTERN, PROVIDERS, PROVIDER_IDS, sideLabel, type MatchMinutes, type PlayerConfig, type ProviderId, type TeamId } from '@futsal/shared';
import { useOpenRouterModels, type ProvidersState } from '../hooks/useProviders';
import { PROVIDER_STYLES } from '../lib/providerStyle';
import { Icon } from './Icon';
import { ModelCombobox } from './ModelCombobox';
import { ProviderAvatar } from './ProviderAvatar';
import { Segmented } from './Segmented';

const EFFORT_OPTIONS = EFFORT_LEVELS.map((level) => ({ value: level, label: level }));
const MINUTE_OPTIONS = MATCH_MINUTES.map((m) => ({ value: m as number, label: `${m}` }));

export type Readiness = { ready: true } | { ready: false; reason: string };

export function playerReadiness(player: PlayerConfig, providers: ProvidersState, hasOpenRouterKey: boolean): Readiness {
  if (player.provider === 'openrouter') {
    const serverKey = providers.kind === 'ready' && providers.byId.openrouter.ready;
    if (!hasOpenRouterKey && !serverKey) return { ready: false, reason: 'Add an OpenRouter API key in Settings' };
    if (!MODEL_ID_PATTERN.test(player.model)) return { ready: false, reason: 'Pick an OpenRouter model' };
    return { ready: true };
  }
  if (providers.kind === 'loading') return { ready: false, reason: 'Checking sign-in…' };
  if (providers.kind === 'error') return { ready: false, reason: providers.message };
  const status = providers.byId[player.provider];
  if (!status.ready) return { ready: false, reason: `${PROVIDERS[player.provider].label}: ${status.detail}${status.fixHint ? `. ${status.fixHint}` : ''}` };
  if (!player.model) return { ready: false, reason: 'Pick a model' };
  return { ready: true };
}

export function defaultModelFor(provider: ProviderId, providers: ProvidersState): string {
  if (provider === 'openrouter') return DEFAULT_OPENROUTER_MODEL;
  return providers.kind === 'ready' ? providers.byId[provider].defaultModel : '';
}

/** A little shirt: ivory for Home, black for Away. */
export function ShirtMark({ team, size = 22 }: { team: TeamId; size?: number }) {
  const home = team === 'A';
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M8.2 3.2 3 5.6l1.6 4.1 2.4-.9V20h10V8.8l2.4.9L21 5.6l-5.2-2.4C15.4 4.6 13.9 5.4 12 5.4s-3.4-.8-3.8-2.2z" fill={home ? '#f5f0e6' : '#17181d'} stroke={home ? 'rgb(0 0 0 / 0.35)' : 'rgb(255 255 255 / 0.45)'} strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M9.6 3.6c.5 1.2 1.3 1.8 2.4 1.8s1.9-.6 2.4-1.8" fill="none" stroke={home ? '#14151a' : '#e9b44c'} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

interface PlayerCardProps { team: TeamId; player: PlayerConfig; providers: ProvidersState; readiness: Readiness; onChange: (p: PlayerConfig) => void }

function PlayerCard({ team, player, providers, readiness, onChange }: PlayerCardProps) {
  const groupId = useId();
  const openRouter = useOpenRouterModels(player.provider === 'openrouter');
  const status = providers.kind === 'ready' ? providers.byId[player.provider] : null;
  const showWarning = !readiness.ready && providers.kind !== 'loading';
  const sideWord = sideLabel(team);

  return (
    <section className="card relative overflow-hidden rounded-2xl p-3.5 sm:p-4" aria-labelledby={`${groupId}-title`}>
      <span aria-hidden="true" className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full opacity-40 blur-2xl transition-colors duration-700" style={{ background: PROVIDER_STYLES[player.provider].glow }} />
      <header className="relative mb-3 flex items-center gap-2.5">
        <ShirtMark team={team} />
        <h3 id={`${groupId}-title`} className="font-display text-[22px] leading-none text-ink">{sideWord}</h3>
        <span className={`ml-auto flex min-w-0 items-center gap-1.5 truncate text-[12px] font-medium ${readiness.ready ? 'text-signal' : 'text-faint'}`}>
          <span className={`size-1.5 shrink-0 rounded-full ${readiness.ready ? 'pulse-dot bg-signal' : 'bg-faint'}`} aria-hidden="true" />
          <span className="truncate">{readiness.ready ? 'Ready' : player.provider !== 'openrouter' && status ? status.detail : 'Not ready'}</span>
        </span>
      </header>

      <div role="radiogroup" aria-label={`${sideWord} provider`} className="relative grid grid-cols-4 gap-1.5">
        {PROVIDER_IDS.map((id) => {
          const selected = player.provider === id;
          return (
            <motion.button key={id} type="button" role="radio" aria-checked={selected} whileHover={{ y: -2 }} whileTap={{ scale: 0.95 }}
              onClick={() => !selected && onChange({ provider: id, model: defaultModelFor(id, providers), effort: player.effort })}
              className={`relative flex min-h-[68px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl px-0.5 text-[11.5px] leading-tight font-semibold transition-colors sm:text-[12.5px] ${selected ? 'text-ink' : 'well text-muted hover:text-ink'}`}>
              {selected && (
                <motion.span layoutId={`${groupId}-provider`} className="absolute inset-0 rounded-xl border" transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  style={{ borderColor: PROVIDER_STYLES[id].glow, background: `linear-gradient(180deg, color-mix(in srgb, ${PROVIDER_STYLES[id].glow} 18%, transparent), color-mix(in srgb, ${PROVIDER_STYLES[id].glow} 4%, transparent))`, boxShadow: `0 0 24px -8px ${PROVIDER_STYLES[id].glow}` }} />
              )}
              <motion.span className="relative" animate={{ scale: selected ? 1.12 : 1, rotate: selected ? [0, -8, 6, 0] : 0 }} transition={{ duration: 0.45 }}><ProviderAvatar provider={id} size={24} /></motion.span>
              <span className="relative max-w-full truncate">{PROVIDERS[id].shortLabel}</span>
            </motion.button>
          );
        })}
      </div>

      <label className="eyebrow relative mt-4 mb-1.5 block" htmlFor={`${groupId}-model`}>Model</label>
      {player.provider === 'openrouter' ? (
        <ModelCombobox key={`${team}-openrouter`} label={`${sideWord} OpenRouter model`} value={player.model} onChange={(model) => onChange({ ...player, model })} options={openRouter.models} loading={openRouter.loading} error={openRouter.error} />
      ) : (
        <select id={`${groupId}-model`} value={player.model} onChange={(e) => onChange({ ...player, model: e.target.value })} disabled={!status || status.models.length === 0} className="field relative">
          {!status && <option value={player.model}>Loading…</option>}
          {status?.models.length === 0 && <option value="">No models available</option>}
          {status?.models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.hint ? ` · ${m.hint}` : ''}</option>)}
        </select>
      )}

      <AnimatePresence initial={false}>
        {PROVIDERS[player.provider].supportsEffort && (
          <motion.div key="effort" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className="relative overflow-hidden">
            <span className="eyebrow mt-4 mb-1.5 block" id={`${groupId}-effort`}>Thinking effort</span>
            <Segmented options={EFFORT_OPTIONS} value={player.effort} onChange={(effort) => onChange({ ...player, effort })} labelledBy={`${groupId}-effort`} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {showWarning && (
          <motion.p key="warning" initial={{ height: 0, opacity: 0, marginTop: 0 }} animate={{ height: 'auto', opacity: 1, marginTop: 12 }} exit={{ height: 0, opacity: 0, marginTop: 0 }} role="note"
            className="relative overflow-hidden rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[13px] leading-snug text-warning">{readiness.reason}</motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}

interface SetupPanelProps {
  players: Record<TeamId, PlayerConfig>; providers: ProvidersState; hasOpenRouterKey: boolean; minutes: MatchMinutes;
  onMinutesChange: (m: MatchMinutes) => void; onChange: (team: TeamId, p: PlayerConfig) => void; onSwap: () => void; onStart: () => void; onRefreshProviders: () => void; error?: string | null;
}

const stagger = { hidden: {}, shown: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } };
const rise = { hidden: { opacity: 0, y: 18, filter: 'blur(4px)' }, shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { type: 'spring' as const, stiffness: 260, damping: 26 } } };

export function SetupPanel({ players, providers, hasOpenRouterKey, minutes, onMinutesChange, onChange, onSwap, onStart, onRefreshProviders, error }: SetupPanelProps) {
  const [scope, animate] = useAnimate(); const [swaps, setSwaps] = useState(0); const [refreshes, setRefreshes] = useState(0);
  const readiness = { A: playerReadiness(players.A, providers, hasOpenRouterKey), B: playerReadiness(players.B, providers, hasOpenRouterKey) };
  const blocker = !readiness.A.ready ? readiness.A : !readiness.B.ready ? readiness.B : null;

  // Each card arrives from the other card's slot, so the swap reads as the two coaches trading ends.
  const swap = () => {
    onSwap(); setSwaps((n) => n + 1);
    animate("[data-card='A']", { y: [56, 0], opacity: [0.2, 1], scale: [0.96, 1] }, { type: 'spring', stiffness: 260, damping: 22 });
    animate("[data-card='B']", { y: [-56, 0], opacity: [0.2, 1], scale: [0.96, 1] }, { type: 'spring', stiffness: 260, damping: 22 });
  };

  return (
    <motion.div className="flex h-full flex-col" variants={stagger} initial="hidden" animate="shown">
      <motion.div variants={rise} className="flex items-start gap-2 px-5 pt-5 pb-3">
        <div className="min-w-0"><p className="eyebrow">New match</p><h2 className="font-display mt-1 text-[34px] leading-[0.95] tracking-tight">Pick the <em className="text-accent">coaches.</em></h2></div>
        <motion.button type="button" onClick={() => { setRefreshes((n) => n + 1); onRefreshProviders(); }} animate={{ rotate: refreshes * 360 }} transition={{ type: 'spring', stiffness: 120, damping: 14 }}
          className="btn-icon ml-auto grid size-11 shrink-0 place-items-center rounded-xl" aria-label="Re-check CLI sign-in" title="Re-check CLI sign-in"><Icon name="refresh" size={18} /></motion.button>
      </motion.div>

      <div ref={scope} className="flex-1 overflow-y-auto overscroll-contain px-3 pb-3 sm:px-4">
        <motion.div variants={rise} data-card="A"><PlayerCard team="A" player={players.A} providers={providers} readiness={readiness.A} onChange={(p) => onChange('A', p)} /></motion.div>
        <motion.div variants={rise} className="relative z-10 -my-3 flex items-center justify-center">
          <motion.button type="button" onClick={swap} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }} animate={{ rotate: swaps * 180 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="group grid size-12 place-items-center rounded-full border border-line-strong bg-[radial-gradient(circle_at_30%_25%,#2a2d36,#101116)] text-ink shadow-[0_8px_24px_-6px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_255_255/0.08)]" aria-label="Swap sides" title="Swap sides">
            <span className="font-display text-[19px] italic group-hover:hidden">vs</span><Icon name="swap" size={18} className="hidden text-accent group-hover:block" />
          </motion.button>
        </motion.div>
        <motion.div variants={rise} data-card="B"><PlayerCard team="B" player={players.B} providers={providers} readiness={readiness.B} onChange={(p) => onChange('B', p)} /></motion.div>

        <motion.div variants={rise} className="pt-4">
          <span className="eyebrow mb-1.5 block" id="minutes-label">Watch time (real minutes)</span>
          <Segmented options={MINUTE_OPTIONS} value={minutes as number} onChange={(m) => onMinutesChange(m as MatchMinutes)} labelledBy="minutes-label" />
          <p className="mt-2 text-[12.5px] leading-snug text-muted">The match clock always runs the full <span className="font-mono text-ink-soft">00:00 → 90:00</span>. Only dead time is compressed; players and ball move at natural speed. A draw goes to a penalty shootout.</p>
        </motion.div>
      </div>

      <motion.div variants={rise} className="border-t border-line p-3 sm:p-4">
        <motion.button type="button" onClick={onStart} disabled={Boolean(blocker)} whileTap={blocker ? undefined : { scale: 0.97 }} className="btn-primary group flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl text-[19px] font-extrabold tracking-tight">
          <Icon name="bolt" size={20} />Kick off<Icon name="arrowRight" size={20} className="transition-transform duration-300 group-hover:translate-x-1.5" />
        </motion.button>
        <AnimatePresence>
          {(error || (blocker && !blocker.ready && providers.kind !== 'loading')) && (
            <motion.p key={error ?? (blocker && !blocker.ready ? blocker.reason : '')} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`mt-3 text-center text-[13px] ${error ? 'text-danger' : 'text-muted'}`} role={error ? 'alert' : undefined}>
              {error ?? (blocker && !blocker.ready ? blocker.reason : '')}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
