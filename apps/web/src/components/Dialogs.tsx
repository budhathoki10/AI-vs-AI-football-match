import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { sideLabel, type MatchSummary, type PlayerConfig, type TeamId } from '@futsal/shared';
import { PROVIDER_STYLES } from '../lib/providerStyle';
import { Confetti, DrawMark, TrophyMark } from './Celebration';
import { Icon } from './Icon';
import { ProviderAvatar } from './ProviderAvatar';

const DIALOG_EXIT_MS = 440;

/** Keeps dialog content mounted until the close transition finishes, so the panel fades out with its content instead of collapsing empty. */
export function useDialogPresence(open: boolean): boolean {
  const [lingering, setLingering] = useState(false); const [previousOpen, setPreviousOpen] = useState(open);
  if (previousOpen !== open) { setPreviousOpen(open); setLingering(!open); }
  useEffect(() => { if (!lingering) return; const t = window.setTimeout(() => setLingering(false), DIALOG_EXIT_MS); return () => window.clearTimeout(t); }, [lingering]);
  return open || lingering;
}

/** Native modal dialog (focus trap, Escape, top layer); enter and exit transitions live in index.css under dialog.modal. */
export function Modal({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={labelledBy} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} className="modal glass m-auto max-h-[calc(100dvh-24px)] w-[min(460px,calc(100vw-24px))] overflow-x-hidden overflow-y-auto rounded-3xl p-0 text-ink">{children}</dialog>
  );
}

function DialogHeader({ id, title, icon, onClose, closeLabel }: { id: string; title: string; icon?: ReactNode; onClose: () => void; closeLabel: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">{icon}<h2 id={id} className="font-display text-[26px] leading-none">{title}</h2>
      <button type="button" onClick={onClose} aria-label={closeLabel} className="btn-icon ml-auto grid size-11 place-items-center rounded-xl"><Icon name="close" /></button></div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors duration-300 ${checked ? 'border-accent/60 bg-accent/80' : 'border-line-strong bg-black/40'}`}>
      <motion.span className="absolute top-0.5 size-[22px] rounded-full bg-ink shadow-[0_2px_6px_rgb(0_0_0/0.5)]" animate={{ left: checked ? 22 : 2 }} transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
    </button>
  );
}

// ------------------------------------------------------------------------------------------------------ settings
interface SettingsDialogProps { open: boolean; onClose: () => void; openRouterKey: string; onSaveKey: (key: string) => void; soundOn: boolean; onSoundChange: (on: boolean) => void }

export function SettingsDialog(props: SettingsDialogProps) {
  const mounted = useDialogPresence(props.open);
  return <Modal open={props.open} onClose={props.onClose} labelledBy="settings-title">{mounted && <SettingsForm {...props} />}</Modal>;
}

function SettingsForm({ onClose, openRouterKey, onSaveKey, soundOn, onSoundChange }: SettingsDialogProps) {
  const [draft, setDraft] = useState(openRouterKey); const [reveal, setReveal] = useState(false);
  return (
    <form method="dialog" onSubmit={(e) => { e.preventDefault(); onSaveKey(draft.trim()); onClose(); }}>
      <DialogHeader id="settings-title" title="Settings" onClose={onClose} closeLabel="Close settings" icon={<Icon name="gear" className="text-accent" />} />
      <div className="space-y-5 px-5 py-5">
        <div>
          <label htmlFor="openrouter-key" className="eyebrow mb-1.5 block">OpenRouter API key</label>
          <div className="flex gap-2">
            <input id="openrouter-key" type={reveal ? 'text' : 'password'} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="sk-or-v1-…" autoComplete="off" spellCheck={false} className="field min-w-0 flex-1 font-mono text-[14px]" />
            <button type="button" onClick={() => setReveal((v) => !v)} aria-label={reveal ? 'Hide key' : 'Show key'} className="btn-glass grid size-[46px] shrink-0 place-items-center rounded-xl"><Icon name={reveal ? 'eyeOff' : 'eye'} size={18} /></button>
          </div>
          <p className="mt-2 text-[13px] leading-snug text-muted">Stored only in this browser and sent only to this app&apos;s local server, which forwards it to OpenRouter. Get one at{' '}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">openrouter.ai/keys</a>. One key reaches GPT, Gemini, DeepSeek and hundreds more.</p>
        </div>
        <div className="well rounded-2xl p-4 text-[13px] leading-snug text-muted">
          <p className="flex items-center gap-2 font-semibold text-ink-soft"><span className="flex -space-x-1.5"><ProviderAvatar provider="claude" size={20} /><ProviderAvatar provider="codex" size={20} /></span>Claude Code and Codex use your subscriptions</p>
          <p className="mt-1.5">No key needed. The server runs the <code className="text-ink-soft">claude</code> and <code className="text-ink-soft">codex</code> CLIs you are already signed in to. If a side shows &ldquo;Not signed in&rdquo;, run <code className="text-ink-soft">claude</code> or <code className="text-ink-soft">codex login</code> in a terminal, then press refresh. The model alone decides the tactics: there is no built-in coach.</p>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3"><span className="text-[14px] font-semibold">Match sounds</span><Toggle checked={soundOn} onChange={onSoundChange} label="Match sounds" /></div>
      </div>
      <div className="flex gap-2 border-t border-line px-5 py-4">
        {openRouterKey && <button type="button" onClick={() => { onSaveKey(''); onClose(); }} className="min-h-11 rounded-xl px-4 font-semibold text-danger transition-colors hover:bg-danger/10">Remove key</button>}
        <button type="submit" className="btn-primary ml-auto min-h-11 rounded-xl px-7 font-bold">Save</button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------------ full time
interface GameOverDialogProps {
  open: boolean; onClose: () => void; summary: MatchSummary | null; players: Record<TeamId, PlayerConfig>; names: Record<TeamId, string>; headline: string;
  onRematch: () => void; onSwapRematch: () => void; onNewSetup: () => void;
}

function StaggeredHeadline({ text }: { text: string }) {
  return (
    <h2 id="game-over-title" className="font-display text-[42px] leading-none tracking-tight" aria-label={text}>
      {text.split(' ').map((word, i) => (
        <motion.span key={`${word}-${i}`} aria-hidden="true" className="mr-[0.25em] inline-block last:mr-0" initial={{ opacity: 0, y: 26, rotateX: -80, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)' }} transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.25 + i * 0.08 }}>{word}</motion.span>
      ))}
    </h2>
  );
}

export function GameOverDialog({ open, onClose, summary, players, names, headline, onRematch, onSwapRematch, onNewSetup }: GameOverDialogProps) {
  const mounted = useDialogPresence(open);
  if (!summary) return null;
  const winner = summary.winner; const stopped = summary.decidedBy === 'stopped';
  const confettiColors = winner ? ['#e9b44c', '#f5f0e6', PROVIDER_STYLES[players[winner].provider].glow, '#6ff0c0'] : [];
  const top = summary.players[0];
  return (
    <Modal open={open} onClose={onClose} labelledBy="game-over-title">
      {mounted && (
        <>
          <div className="relative overflow-hidden px-5 pt-7 pb-5 text-center">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-24 mx-auto size-72 rounded-full opacity-50 blur-3xl" style={{ background: winner ? PROVIDER_STYLES[players[winner].provider].glow : '#6f8b84' }} />
            {winner && <Confetti colors={confettiColors} />}
            <button type="button" onClick={onClose} aria-label="Close" className="btn-icon absolute top-3 right-3 z-10 grid size-11 place-items-center rounded-xl"><Icon name="close" /></button>
            <div className="relative flex justify-center">{winner ? <TrophyMark /> : <DrawMark />}</div>
            <div className="relative mt-3 [perspective:600px]"><StaggeredHeadline text={headline} /></div>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="relative mt-2 text-[14px] text-muted">
              {stopped ? 'Stopped by you' : summary.decidedBy === 'shootout' && summary.shootout ? `Level after 90:00 · shootout ${summary.shootout.score[0]}–${summary.shootout.score[1]}${summary.shootout.decidedBy === 'sudden_death' ? ' (sudden death)' : ''}` : 'Full time'}
            </motion.p>
            <div className="relative mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              {(['A', 'B'] as const).map((team, index) => {
                const won = winner === team;
                return (
                  <motion.div key={team} initial={{ opacity: 0, x: index === 0 ? -40 : 40 }} animate={{ opacity: winner && !won ? 0.55 : 1, x: 0, scale: won ? 1.05 : 1 }} transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.35 }} className={`flex min-w-0 flex-col items-center gap-2 ${index === 1 ? 'col-start-3' : ''}`}>
                    <div className={`relative rounded-[20px] p-1 ${won ? 'bg-[linear-gradient(145deg,#fde7b0,#d49a35)] shadow-[0_0_40px_-6px_rgb(233_180_76/0.9)]' : ''}`}>
                      {won && <motion.span className="absolute -top-4 left-1/2 -translate-x-1/2 text-accent" initial={{ y: -16, opacity: 0, rotate: -25 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.8 }}><Icon name="crown" size={22} /></motion.span>}
                      <ProviderAvatar provider={players[team].provider} size={60} />
                    </div>
                    <span className="w-full truncate text-[13px] font-semibold" title={names[team]}>{names[team]}</span>
                    <span className="text-[11px] font-bold tracking-wider text-faint uppercase">{sideLabel(team)}</span>
                  </motion.div>
                );
              })}
              <motion.span initial={{ scale: 2.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 16, delay: 0.55 }} className="font-display col-start-2 row-start-1 text-[38px] text-ink">{summary.regulation[0]}–{summary.regulation[1]}</motion.span>
            </div>
            {!stopped && top && (
              <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }} className="relative mt-5 text-[13px] text-muted">
                Player of the match <span className="font-semibold text-ink-soft">#{top.number} {top.role.toLowerCase()}</span> ({names[top.team]}) · rating <span className="font-mono text-accent">{top.rating.toFixed(1)}</span>
              </motion.p>
            )}
          </div>
          <motion.div className="grid gap-2 border-t border-line p-4" initial="hidden" animate="shown" variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.06, delayChildren: 0.6 } } }}>
            {[
              <button key="rematch" type="button" onClick={onRematch} className="btn-primary min-h-12 w-full rounded-2xl text-[17px] font-extrabold">Rematch</button>,
              <div key="more" className="grid grid-cols-2 gap-2"><button type="button" onClick={onSwapRematch} className="btn-glass min-h-11 rounded-xl font-semibold">Swap sides</button><button type="button" onClick={onNewSetup} className="btn-glass min-h-11 rounded-xl font-semibold">New setup</button></div>,
              <button key="review" type="button" onClick={onClose} className="min-h-11 w-full rounded-xl font-semibold text-muted transition-colors hover:text-ink">Review match</button>,
            ].map((node, i) => <motion.div key={i} variants={{ hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } }}>{node}</motion.div>)}
          </motion.div>
        </>
      )}
    </Modal>
  );
}
