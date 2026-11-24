import { AnimatePresence, motion } from 'motion/react';
import { PROVIDERS, sideLabel, type PlayerConfig, type TeamId } from '@futsal/shared';
import { PROVIDER_STYLES } from '../lib/providerStyle';
import { Icon } from './Icon';
import { ProviderAvatar } from './ProviderAvatar';

interface TeamBarProps {
  team: TeamId; player: PlayerConfig | null; label: string; goals: number; possession: number; thinking: boolean; tactic: string | null; hasBall: boolean; isWinner: boolean; running: boolean;
}

/** The chess app's player bar, for a futsal side: who the coach is, what it is doing, and the goals box. */
export function TeamBar({ team, player, label, goals, possession, thinking, tactic, hasBall, isWinner, running }: TeamBarProps) {
  const glow = player ? PROVIDER_STYLES[player.provider].glow : 'var(--accent)';
  return (
    <div className="flex h-[60px] items-center gap-3 px-0.5" aria-label={`${sideLabel(team)} team`}>
      <ProviderAvatar provider={player?.provider ?? null} size={40} thinking={thinking} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ring-1 ${team === 'A' ? 'bg-[#f5f0e6] ring-white/40' : 'bg-[#15161b] ring-white/25'}`} />
          <span className="truncate text-[15px] font-semibold tracking-tight text-ink" title={label}>{label}</span>
          {player && <span className="hidden shrink-0 text-[12px] text-faint @sm:inline">{PROVIDERS[player.provider].label} · {sideLabel(team)}</span>}
          <AnimatePresence>
            {isWinner && (
              <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-accent-ink uppercase shadow-[0_0_18px_rgb(233_180_76/0.6)]"><Icon name="crown" size={11} /> Winner</motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="relative mt-0.5 flex h-5 min-w-0 items-center overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {thinking ? (
              <motion.span key="thinking" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="flex items-center gap-2 text-[13px] font-medium" role="status">
                <span className="wave flex h-3.5 items-center gap-[2px]" aria-hidden="true"><span /><span /><span /><span /></span>
                <span className="thinking-text">Thinking about tactics</span>
              </motion.span>
            ) : (
              <motion.span key={tactic ?? 'idle'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted">
                {tactic ? <><span className="rounded-md bg-white/[0.06] px-1.5 py-px font-semibold text-ink-soft capitalize">{tactic}</span>{running && hasBall && <span className="text-signal">on the ball</span>}</> : <span>{running ? 'Waiting for first instructions' : 'Ready'}</span>}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
      <motion.div
        animate={{ backgroundColor: hasBall && running ? '#f5f0e6' : 'rgba(0,0,0,0.35)', color: hasBall && running ? '#0a0b0e' : '#c9c3b6', boxShadow: hasBall && running ? `0 0 0 1px rgba(255,255,255,0.6), 0 0 28px -4px ${glow}` : '0 0 0 1px rgba(255,255,255,0.06), 0 0 0 0 rgba(0,0,0,0)', scale: hasBall && running ? 1.04 : 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="flex h-11 min-w-[70px] shrink-0 items-center justify-end gap-2 rounded-xl px-2.5 @sm:min-w-[104px] @sm:px-3" aria-label={`${sideLabel(team)} goals`}>
        {running || goals > 0 || possession !== 50 ? <span className="hidden font-mono text-[11px] font-semibold opacity-60 @sm:block">{possession}%</span> : null}
        <span className="relative h-[30px] w-[22px] overflow-hidden font-mono text-[24px] leading-[30px] font-bold tabular-nums @sm:text-[26px]">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={goals} initial={{ y: 26, opacity: 0, scale: 1.4 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -26, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 24 }} className="absolute inset-0 text-center">{goals}</motion.span>
          </AnimatePresence>
        </span>
      </motion.div>
    </div>
  );
}
