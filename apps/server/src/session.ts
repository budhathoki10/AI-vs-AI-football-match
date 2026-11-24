import { randomUUID } from 'node:crypto';
import { Match, runShootout, type AiDecisionRecord, type MatchConfig, type PenaltyAttempt, type RunControl, type TeamAgent } from '@futsal/sim';
import type { MatchEventMsg, MatchSummary, PenaltyKickMsg, PenaltyResultMsg, RosterEntry, ServerMsg, StateDebug, TeamId, TeamStatsLite, ThoughtMsg } from '@futsal/shared';

class Stopped extends Error { constructor() { super('stopped'); } }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const lite = (s: Match['teamStats']['A']): TeamStatsLite => ({ goals: s.goals, shots: s.shots, onTarget: s.onTarget, passes: s.passes, passesOk: s.passesOk, saves: s.saves, fouls: s.fouls, corners: s.corners, recoveries: s.recoveries, possessionSeconds: s.possessionSeconds, xg: s.xg });

export interface SessionOptions { cfg: MatchConfig; agents: Partial<Record<TeamId, TeamAgent>>; names: Record<TeamId, string>; paced?: boolean; onClose?: () => void }

/**
 * One match, simulated entirely on the server. Browsers only subscribe to the message stream (and may pause or stop it);
 * they never submit scores. Nothing is stored: a finished match lives in memory for a few minutes so a page refresh can re-attach.
 */
export class MatchSession {
  readonly id = randomUUID();
  status: 'starting' | 'running' | 'shootout' | 'finished' | 'stopped' | 'failed' = 'starting';
  readonly control: RunControl = { paused: false, stopped: false };
  readonly abort = new AbortController();
  private subs = new Set<(m: ServerMsg) => void>();
  private events: MatchEventMsg[] = []; private thoughts: ThoughtMsg[] = []; private shootoutMsgs: ServerMsg[] = [];
  private lastState: ServerMsg | null = null; private doneMsg: ServerMsg | null = null; private fullTime: ServerMsg | null = null;
  private readonly roster: Record<TeamId, RosterEntry[]>;
  private match: Match | null = null;
  readonly finished: Promise<void>;

  constructor(private o: SessionOptions) {
    const r = (t: TeamId) => (t === 'A' ? o.cfg.teamA : o.cfg.teamB).players.map((p) => ({ id: p.id, number: p.number, name: p.name, role: p.role }));
    this.roster = { A: r('A'), B: r('B') };
    this.finished = this.run().catch((e) => { this.status = 'failed'; this.emit({ t: 'error', message: String((e as Error)?.message ?? e).slice(0, 300) }); }).finally(() => { this.o.onClose?.(); });
  }

  // ------------------------------------------------------------------------------------------------ subscribers
  private emit(m: ServerMsg) {
    if (m.t === 'event') { this.events.push(m.event); if (this.events.length > 120) this.events.shift(); }
    else if (m.t === 'thought') this.thoughts.push(m);
    else if (m.t === 'penalty_kick' || m.t === 'penalty_result') this.shootoutMsgs.push(m);
    else if (m.t === 'state') this.lastState = m;
    else if (m.t === 'done') this.doneMsg = m;
    else if (m.t === 'full_time') this.fullTime = m;
    for (const s of this.subs) { try { s(m); } catch { /* subscriber gone */ } }
  }
  subscribe(cb: (m: ServerMsg) => void): () => void {
    cb({ t: 'hello', matchId: this.id, status: this.status, roster: this.roster, names: this.o.names, minutes: this.o.cfg.realDurationMinutes });
    for (const e of this.events) cb({ t: 'event', event: e }); for (const t of this.thoughts) cb(t);
    if (this.lastState) cb(this.lastState); if (this.fullTime) cb(this.fullTime);
    for (const m of this.shootoutMsgs) cb(m); // a re-attaching client sees kicks and only the results that were already revealed
    if (this.control.paused) cb({ t: 'paused', paused: true });
    if (this.doneMsg) cb(this.doneMsg);
    this.subs.add(cb); return () => this.subs.delete(cb);
  }
  get live() { return this.status === 'starting' || this.status === 'running' || this.status === 'shootout'; }

  // ------------------------------------------------------------------------------------------------ controls
  pause(paused: boolean) { if (!this.live || this.control.paused === paused) return; this.control.paused = paused; this.emit({ t: 'paused', paused }); }
  stop() { if (!this.live) return; this.control.stopped = true; this.control.paused = false; this.abort.abort(); }

  /** Waits in real time, pausing when the match is paused and aborting when it is stopped. */
  private async wait(ms: number) {
    let left = ms;
    while (left > 0) {
      if (this.control.stopped) throw new Stopped();
      if (this.control.paused) { await sleep(60); continue; }
      const step = Math.min(left, 60); await sleep(step); left -= step;
    }
    if (this.control.stopped) throw new Stopped();
  }

  // ------------------------------------------------------------------------------------------------ the match
  private debugOf(m: Match): StateDebug {
    const acts: Record<string, string> = {}, speeds: Record<string, number> = {};
    for (const t of [m.teams.A, m.teams.B]) for (const p of t.players) if (p.onCourt) { const s = m.playerWorld(p.cfg.id); acts[p.cfg.id] = p.act; speeds[p.cfg.id] = +Math.hypot(s.vx, s.vz).toFixed(1); }
    const b = m.ballWorld(); const opt = (t: TeamId) => m.lastOptions[t].map((o) => ({ to: o.toId, kind: o.kind, risk: +o.intercept.toFixed(2), score: +o.score.toFixed(2) }));
    return { tick: m.tick, dt: 1 / 60, owner: m.owner, ballSpeed: +Math.hypot(b.vx, b.vz).toFixed(1), acts, speeds, options: { A: opt('A'), B: opt('B') }, bumps: m.bumpCount, lastBump: m.bumps.length ? m.bumps[m.bumps.length - 1] : null };
  }
  private stateMsg(m: Match): ServerMsg {
    const b = m.ballWorld(); const players: [string, number, number, number, string, number][] = [];
    for (const t of [m.teams.A, m.teams.B]) for (const p of t.players) if (p.onCourt) { const s = m.playerWorld(p.cfg.id); players.push([p.cfg.id, +s.x.toFixed(2), +s.z.toFixed(2), +p.heading.toFixed(2), p.state, +p.stamina.toFixed(2)]); }
    const tot = m.teamStats.A.possessionSeconds + m.teamStats.B.possessionSeconds || 1;
    return { t: 'state', vt: m.vt, half: m.half, phase: m.phase, play: m.play, restart: m.restart?.type ?? null, clockMode: m.clockMode, score: [m.score[0], m.score[1]], rt: +m.rt.toFixed(1),
      ball: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)], players, possession: [Math.round((100 * m.teamStats.A.possessionSeconds) / tot), Math.round((100 * m.teamStats.B.possessionSeconds) / tot)], holder: m.lastTouch?.team ?? null, own: m.owner, dbg: this.debugOf(m),
      stats: { A: lite(m.teamStats.A), B: lite(m.teamStats.B) }, thinking: { A: m.isThinking('A'), B: m.isThinking('B') }, dirs: [m.teams.A.dir, m.teams.B.dir] };
  }

  private thoughtOf(d: AiDecisionRecord): ThoughtMsg {
    return { t: 'thought', team: d.team, vt: d.vt, trigger: d.trigger, accepted: d.accepted, strategy: d.tactics?.teamStrategy ?? null, summary: (d.objective || d.rejectReason || '').slice(0, 280), source: d.meta.source, latencyMs: Math.round(d.meta.latencyMs ?? 0), tokens: (d.meta.tokensIn ?? 0) + (d.meta.tokensOut ?? 0), reason: d.accepted ? undefined : d.rejectReason?.slice(0, 200) };
  }

  private async run() {
    const { cfg, agents } = this.o; const paced = this.o.paced ?? true;
    const m = await Match.create(cfg, agents); this.match = m; this.status = 'running';
    let seenEvents = 0, seenDecisions = 0;
    const flush = (mm: Match) => {
      for (; seenEvents < mm.events.length; seenEvents++) this.emit({ t: 'event', event: mm.events[seenEvents] as MatchEventMsg });
      for (; seenDecisions < mm.decisions.length; seenDecisions++) this.emit(this.thoughtOf(mm.decisions[seenDecisions]));
    };
    await m.runRegulation({ realtime: paced, awaitAgents: !paced, yieldEveryTicks: 300, control: this.control, onStep: (mm) => {
      flush(mm);
      if (this.subs.size && (paced ? mm.tick % 3 === 0 : mm.tick % 18 === 0)) this.emit(this.stateMsg(mm));
    } });
    if (this.control.stopped) { this.status = 'stopped'; this.emit({ t: 'done', summary: this.summary(m, 'stopped') }); return; }
    if (!paced) { await m.settleAgents(); flush(m); } // fast mode outruns slow providers: record their answers before wrapping up
    this.emit(this.stateMsg(m)); this.emit({ t: 'full_time', score: [m.score[0], m.score[1]] });
    try {
      if (m.score[0] === m.score[1] && cfg.shootoutOnDraw) {
        this.status = 'shootout'; await this.wait(paced ? 1800 : 0); this.emit({ t: 'shootout_start', score: [m.score[0], m.score[1]] });
        await runShootout(m, { onAttempt: (a) => this.playKick(a, paced) });
      } else m.phase = 'finished';
    } catch (e) { if (!(e instanceof Stopped)) throw e; this.status = 'stopped'; this.emit({ t: 'done', summary: this.summary(m, 'stopped') }); return; }
    this.status = 'finished'; this.emit({ t: 'done', summary: this.summary(m) });
  }

  /**
   * One penalty. The kick message carries the decisions and the ball/keeper frames but NOT the outcome; the outcome is sent as a
   * separate message only after the animation has had time to play, so the interface can never announce "GOAL" or "SAVED" early.
   */
  private async playKick(a: PenaltyAttempt, paced: boolean) {
    const lastT = a.frames.at(-1)?.t ?? 2; const durationMs = Math.round((lastT + 0.9) * 1000);
    if (paced && a.index === 1) await this.wait(1200);
    const kick: PenaltyKickMsg = { t: 'penalty_kick', index: a.index, round: a.round, team: a.team, suddenDeath: a.suddenDeath, takerId: a.takerId, keeperId: a.keeperId,
      shot: { reason: a.shot.reason, usedFallback: a.shot.usedFallback }, keeper: { reason: a.keeper.reason, usedFallback: a.keeper.usedFallback }, frames: a.frames, durationMs };
    this.emit(kick);
    if (paced) await this.wait(durationMs);
    const res: PenaltyResultMsg = { t: 'penalty_result', index: a.index, team: a.team, result: a.result, score: a.scoreAfter };
    this.emit(res);
    if (paced) await this.wait(1500); // breathing space before the next taker
  }

  private summary(m: Match, forced?: 'stopped'): MatchSummary {
    const r = m.result(); const so = m.shootout; const tot = m.teamStats.A.possessionSeconds + m.teamStats.B.possessionSeconds || 1;
    const team = (t: TeamId) => ({ ...lite(m.teamStats[t]), possessionPct: Math.round((100 * m.teamStats[t].possessionSeconds) / tot) });
    const players = [...m.byId.values()].map((p) => { const s = m.playerStats.get(p.cfg.id)!; return { id: p.cfg.id, team: p.team, name: p.cfg.name, number: p.cfg.number, role: p.cfg.role, rating: s.rating, goals: s.goals, assists: s.assists, shots: s.shots, saves: s.saves, passes: s.passes, passesOk: s.passesOk, tackles: s.tackles, distance: Math.round(s.distance) }; }).sort((x, y) => y.rating - x.rating);
    return { regulation: [m.score[0], m.score[1]], winner: forced ? null : r.winner, decidedBy: forced ?? r.decidedBy,
      shootout: so ? { score: so.score, winner: so.winner, decidedBy: so.decidedBy, rounds: so.rounds } : undefined,
      teamStats: { A: team('A'), B: team('B') }, players, time: { selectedSeconds: this.o.cfg.realDurationMinutes * 60, actualSeconds: +m.clock.report().actualRealSeconds.toFixed(1), virtualSeconds: m.vt } };
  }
}
