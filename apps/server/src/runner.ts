import { gzipSync, gunzipSync } from 'node:zlib';
import { Match, runShootout, LlmAgent, type TeamAgent, type TeamId, type MatchConfig, type MatchEvent, type PenaltyAttempt, type TeamConfig } from '@futsal/sim';
import { decryptSecret } from './crypto';
import { tx, type DB } from './db';
import { toMatchConfig, type MatchInput } from './schemas';

export type LiveMsg = Record<string, unknown> & { t: string };
interface Live { id: number; userId: number; match: Match | null; subs: Set<(m: LiveMsg) => void>; status: string; backlog: MatchEvent[]; lastState: LiveMsg | null; shootout: PenaltyAttempt[]; done: boolean }
export class HttpError extends Error { constructor(readonly status: number, msg: string) { super(msg); } }

export class Runner {
  live = new Map<number, Live>();
  maxConcurrent = Number(process.env.MAX_CONCURRENT_MATCHES ?? 4);
  constructor(private db: DB, private key: Buffer, private fetchImpl?: any) {}

  private agentFor(userId: number, t: TeamConfig): TeamAgent | undefined {
    if (t.architecture !== 'llm') return undefined;
    if (!t.provider || !t.model) throw new HttpError(400, `team ${t.name}: LLM architecture needs provider and model`);
    const row = this.db.prepare('SELECT enc_key, base_url FROM provider_credentials WHERE user_id=? AND kind=?').get(userId, t.provider) as { enc_key: string; base_url: string | null } | undefined;
    if (!row) throw new HttpError(400, `team ${t.name}: no API key configured for provider ${t.provider}`);
    const price = this.db.prepare('SELECT input_per_m AS inputPricePerM, output_per_m AS outputPricePerM FROM ai_models WHERE user_id=? AND kind=? AND model=?').get(userId, t.provider, t.model) as { inputPricePerM: number | null; outputPricePerM: number | null } | undefined;
    return new LlmAgent({ kind: t.provider as any, apiKey: decryptSecret(row.enc_key, this.key), model: t.model, baseUrl: row.base_url ?? undefined, price: price ?? null, fetchImpl: this.fetchImpl });
  }

  /** Validates, inserts the match row and starts it in the background. Returns immediately with the match id. */
  start(userId: number, input: MatchInput, o: { tournamentId?: number; benchmarkId?: number; squadSeed?: number; headless?: boolean } = {}): { id: number; done: Promise<void> } {
    const cfg = toMatchConfig(input, o.squadSeed);
    const agents: Partial<Record<TeamId, TeamAgent>> = {};
    for (const t of [cfg.teamA, cfg.teamB]) { const a = this.agentFor(userId, t); if (a) agents[t.id] = a; }
    if ([...this.live.values()].filter((l) => !l.done).length >= this.maxConcurrent) throw new HttpError(429, 'too many concurrent matches; try again shortly');
    const id = Number(tx(this.db, () => {
      const r = this.db.prepare('INSERT INTO matches (user_id,status,config_json,seed,selected_real_duration_seconds,tournament_id,benchmark_id) VALUES (?,?,?,?,?,?,?)').run(userId, 'running', JSON.stringify(cfg), cfg.seed, cfg.realDurationMinutes * 60, o.tournamentId ?? null, o.benchmarkId ?? null).lastInsertRowid;
      for (const t of [cfg.teamA, cfg.teamB]) this.db.prepare('INSERT INTO match_participants VALUES (?,?,?,?,?,?,?)').run(r, t.id, t.name, t.architecture, t.provider ?? null, t.model ?? null, t.formation);
      return r;
    }));
    const live: Live = { id, userId, match: null, subs: new Set(), status: 'running', backlog: [], lastState: null, shootout: [], done: false };
    this.live.set(id, live);
    const paced = !o.headless && input.paced;
    const done = this.execute(live, cfg, agents, paced).catch((e) => {
      this.db.prepare("UPDATE matches SET status='failed', error=?, finished_at=datetime('now') WHERE id=?").run(String(e?.message ?? e).slice(0, 300), id);
      this.emit(live, { t: 'error', message: 'match failed' });
    }).finally(() => { live.done = true; live.status = live.status === 'running' ? 'failed' : live.status; setTimeout(() => this.live.delete(id), 60_000).unref?.(); });
    return { id, done };
  }

  private emit(l: Live, m: LiveMsg) { for (const s of l.subs) { try { s(m); } catch { /* subscriber gone */ } } }
  subscribe(userId: number, id: number, cb: (m: LiveMsg) => void): (() => void) | null {
    const l = this.live.get(id); if (!l || l.userId !== userId) return null;
    cb({ t: 'hello', matchId: id, status: l.status });
    if (l.lastState) cb(l.lastState); for (const e of l.backlog.slice(-60)) cb({ t: 'event', event: e }); for (const a of l.shootout) cb({ t: 'penalty', attempt: a });
    l.subs.add(cb); return () => l.subs.delete(cb);
  }

  private stateMsg(m: Match): LiveMsg {
    const b = m.ballWorld(); const players: unknown[] = [];
    for (const t of [m.teams.A, m.teams.B]) for (const p of t.players) if (p.onCourt) { const s = m.playerWorld(p.cfg.id); players.push([p.cfg.id, +s.x.toFixed(2), +s.z.toFixed(2), +p.heading.toFixed(2), p.state, +p.stamina.toFixed(2)]); }
    const tot = m.teamStats.A.possessionSeconds + m.teamStats.B.possessionSeconds || 1;
    return { t: 'state', vt: m.vt, half: m.half, phase: m.phase, play: m.play, restart: m.restart?.type ?? null, clockMode: m.clockMode, score: m.score, rt: +m.rt.toFixed(1),
      ball: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)], players, possession: [Math.round((100 * m.teamStats.A.possessionSeconds) / tot), Math.round((100 * m.teamStats.B.possessionSeconds) / tot)],
      stats: { A: m.teamStats.A, B: m.teamStats.B }, dirs: [m.teams.A.dir, m.teams.B.dir] };
  }

  private async execute(l: Live, cfg: MatchConfig, agents: Partial<Record<TeamId, TeamAgent>>, paced: boolean) {
    const m = await Match.create(cfg, agents); l.match = m; let seenEvents = 0; let lastWall = 0;
    await m.runRegulation({ realtime: paced, yieldEveryTicks: 300, onStep: (mm) => {
      if (l.subs.size === 0 && mm.events.length === seenEvents) return;
      for (; seenEvents < mm.events.length; seenEvents++) { const e = mm.events[seenEvents]; l.backlog.push(e); this.emit(l, { t: 'event', event: e }); }
      const now = Date.now(); if ((paced ? mm.tick % 6 === 0 : now - lastWall > 150) && l.subs.size) { lastWall = now; l.lastState = this.stateMsg(mm); this.emit(l, l.lastState); }
    } });
    l.lastState = this.stateMsg(m); this.emit(l, l.lastState); this.emit(l, { t: 'full_time', score: m.score });
    if (m.score[0] === m.score[1] && cfg.shootoutOnDraw) {
      l.status = 'shootout'; this.emit(l, { t: 'shootout_start', score: m.score });
      await runShootout(m, { onAttempt: async (a) => { l.shootout.push(a); this.emit(l, { t: 'penalty', attempt: a }); if (paced) await new Promise((r) => setTimeout(r, Math.max(1500, (a.frames.at(-1)?.t ?? 2) * 1000 + 1500))); } });
    } else m.phase = 'finished';
    this.persist(l, m, cfg);
    l.status = 'finished'; this.emit(l, { t: 'done', result: m.result() === undefined ? null : { ...m.result(), shootout: m.shootout ? { ...m.shootout, attempts: undefined } : undefined } });
  }

  private persist(l: Live, m: Match, cfg: MatchConfig) {
    const rep = m.clock.report(); const res = m.result(); const db = this.db;
    tx(db, () => {
      db.prepare("UPDATE matches SET status='finished', actual_real_elapsed_seconds=?, virtual_match_duration_seconds=?, reg_score_a=?, reg_score_b=?, winner=?, decided_by=?, clock_report_json=?, finished_at=datetime('now') WHERE id=?")
        .run(rep.actualRealSeconds, rep.virtualSeconds, m.score[0], m.score[1], res.winner, res.decidedBy, JSON.stringify(rep), l.id);
      const ie = db.prepare('INSERT INTO match_events (match_id,seq,type,vt,half,team,player_id,data_json) VALUES (?,?,?,?,?,?,?,?)');
      m.events.forEach((e, i) => ie.run(l.id, i, e.type, e.vt, e.half, e.team ?? null, e.playerId ?? null, JSON.stringify({ assistId: e.assistId, detail: e.detail, pos: e.pos })));
      const CH = 200;
      for (let i = 0; i * CH < m.snapshots.length; i++) db.prepare('INSERT INTO simulation_snapshots VALUES (?,?,?)').run(l.id, i, gzipSync(JSON.stringify(m.snapshots.slice(i * CH, (i + 1) * CH))));
      const id = db.prepare('INSERT INTO ai_decisions (match_id,team,vt,trigger,architecture,accepted,reject_reason,tactics_json,state_json,objective,outcome,source,tokens_in,tokens_out,latency_ms,cost_usd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const d of m.decisions) id.run(l.id, d.team, d.vt, d.trigger, d.architecture, d.accepted ? 1 : 0, d.rejectReason ?? null, d.tactics ? JSON.stringify(d.tactics) : null, JSON.stringify(d.state), d.objective, d.outcome ?? null, d.meta.source, d.meta.tokensIn ?? 0, d.meta.tokensOut ?? 0, Math.round(d.meta.latencyMs ?? 0), d.meta.costUsd ?? null);
      for (const t of ['A', 'B'] as const) {
        db.prepare('INSERT INTO team_stats VALUES (?,?,?)').run(l.id, t, JSON.stringify(m.teamStats[t]));
        for (const p of m.teams[t].players) db.prepare('INSERT INTO player_stats VALUES (?,?,?,?)').run(l.id, p.cfg.id, t, JSON.stringify(m.playerStats.get(p.cfg.id)));
        const c = m.teams[t].cost; const tc = t === 'A' ? cfg.teamA : cfg.teamB;
        if (tc.architecture === 'llm') db.prepare('INSERT INTO api_usage (user_id,match_id,team,provider,model,calls,tokens_in,tokens_out,cost_usd,cost_known,latency_ms,retries,failures) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(l.userId, l.id, t, tc.provider ?? null, tc.model ?? null, c.calls, c.tokensIn, c.tokensOut, c.costUsd, c.unknownCost ? 0 : 1, Math.round(c.latencyMs), c.retries, c.failures);
      }
      const so = m.shootout;
      if (so) {
        db.prepare('INSERT INTO penalty_shootouts VALUES (?,?,?,?,?,?,?,?,?,?)').run(l.id, so.winner, so.score[0], so.score[1], so.firstTeam, so.decidedBy, so.rounds, so.suddenDeathRounds, JSON.stringify(so.stats), so.fallbackNote ?? null);
        for (const a of so.attempts) db.prepare('INSERT INTO penalty_attempts (match_id,idx,round,team,sudden_death,taker_id,keeper_id,result,shot_json,keeper_json,frames) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(l.id, a.index, a.round, a.team, a.suddenDeath ? 1 : 0, a.takerId, a.keeperId, a.result, JSON.stringify(a.shot), JSON.stringify(a.keeper), gzipSync(JSON.stringify(a.frames)));
      }
    });
  }
}
export const readSnapshots = (db: DB, id: number): unknown[] => (db.prepare('SELECT data FROM simulation_snapshots WHERE match_id=? ORDER BY seq').all(id) as { data: Uint8Array }[]).flatMap((r) => JSON.parse(gunzipSync(r.data).toString()));
export const readFrames = (blob: Uint8Array) => JSON.parse(gunzipSync(blob).toString());
