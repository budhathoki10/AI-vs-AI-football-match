import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { discoverModels, callProvider, PROVIDER_KINDS, type ProviderKind, MATCH } from '@futsal/sim';
import { audit, openDb, tx, type DB } from './db';
import { encryptSecret, hashPassword, loadCredentialKey, maskKey, newToken, sha256, verifyPassword, decryptSecret } from './crypto';
import { HttpError, Runner, readFrames, readSnapshots } from './runner';
import { benchmarkInput, matchInput, pricingInput, providerInput, registerInput, tournamentInput, type TeamInput } from './schemas';
import { runBenchmark, runTournament, METRIC_DOCS, TIE_BREAK_POLICY } from './compete';

declare module 'fastify' { interface FastifyRequest { userId?: number } }
const SESSION_MS = 7 * 24 * 3600 * 1000;

export interface AppOptions { db?: DB; key?: Buffer; fetchImpl?: any; production?: boolean }

/** Simple fixed-window in-memory rate limiter (single-process deployment; swap for Redis when scaling out). */
class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();
  check(key: string, max: number, windowMs: number): boolean {
    const now = Date.now(); const h = this.hits.get(key);
    if (!h || h.reset < now) { this.hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    h.n++; if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    return h.n <= max;
  }
}

export async function buildApp(opts: AppOptions = {}): Promise<{ app: FastifyInstance; db: DB; runner: Runner }> {
  const db = opts.db ?? openDb(); const key = opts.key ?? loadCredentialKey(); const prod = opts.production ?? process.env.NODE_ENV === 'production';
  const runner = new Runner(db, key, opts.fetchImpl); const limiter = new Limiter();
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, trustProxy: true });
  await app.register(websocket, { options: { maxPayload: 4096 } });
  const origin = process.env.WEB_ORIGIN;

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff').header('x-frame-options', 'DENY').header('referrer-policy', 'no-referrer').header('cache-control', 'no-store');
    if (origin) { reply.header('access-control-allow-origin', origin).header('access-control-allow-credentials', 'true').header('access-control-allow-headers', 'content-type,authorization').header('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS').header('vary', 'origin'); if (req.method === 'OPTIONS') return reply.code(204).send(); }
    if (!limiter.check(`ip:${req.ip}`, 600, 60_000)) return reply.code(429).send({ error: 'rate limit exceeded' });
  });
  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid input', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err?.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    return reply.code(500).send({ error: 'internal error' }); // never leak stack traces / secrets
  });

  // ---- auth helpers
  const sessionUser = (req: FastifyRequest): number | undefined => {
    const h = req.headers.authorization; const cookie = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const tok = h?.startsWith('Bearer ') ? h.slice(7) : cookie; if (!tok) return undefined;
    const r = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash=?').get(sha256(tok)) as { user_id: number; expires_at: number } | undefined;
    if (!r || r.expires_at < Date.now()) return undefined; return r.user_id;
  };
  const auth = async (req: FastifyRequest, reply: FastifyReply) => { const u = sessionUser(req); if (!u) return reply.code(401).send({ error: 'authentication required' }); req.userId = u; };
  const issue = (userId: number, reply: FastifyReply) => {
    const tok = newToken(); db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sha256(tok), userId, Date.now() + SESSION_MS);
    reply.header('set-cookie', `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${prod ? '; Secure' : ''}`); return tok;
  };

  app.get('/api/health', async () => ({ ok: true, durations: MATCH.allowedRealDurationsMin }));

  app.post('/api/auth/register', async (req, reply) => {
    if (!limiter.check(`auth:${req.ip}`, 10, 60_000)) return reply.code(429).send({ error: 'too many attempts' });
    const b = registerInput.parse(req.body);
    try { const r = db.prepare('INSERT INTO users (username, pw_hash) VALUES (?,?)').run(b.username, hashPassword(b.password)); audit(db, Number(r.lastInsertRowid), 'register', '', req.ip); const token = issue(Number(r.lastInsertRowid), reply); return reply.code(201).send({ id: Number(r.lastInsertRowid), username: b.username, token }); }
    catch (e: any) { if (String(e.message).includes('UNIQUE')) return reply.code(409).send({ error: 'username taken' }); throw e; }
  });
  app.post('/api/auth/login', async (req, reply) => {
    if (!limiter.check(`auth:${req.ip}`, 10, 60_000)) return reply.code(429).send({ error: 'too many attempts' });
    const b = registerInput.pick({ username: true }).extend({ password: registerInput.shape.password }).parse(req.body);
    const u = db.prepare('SELECT id, pw_hash FROM users WHERE username=?').get(b.username) as { id: number; pw_hash: string } | undefined;
    if (!u || !verifyPassword(b.password, u.pw_hash)) { audit(db, u?.id ?? null, 'login_failed', b.username, req.ip); return reply.code(401).send({ error: 'invalid credentials' }); }
    audit(db, u.id, 'login', '', req.ip); return { id: u.id, username: b.username, token: issue(u.id, reply) };
  });
  app.post('/api/auth/logout', { preHandler: auth }, async (req, reply) => {
    const tok = req.headers.authorization?.slice(7) ?? /sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]; if (tok) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(tok));
    reply.header('set-cookie', 'sid=; HttpOnly; Path=/; Max-Age=0'); return { ok: true };
  });
  app.get('/api/me', { preHandler: auth }, async (req) => {
    const u = db.prepare('SELECT id, username, settings_json s, created_at FROM users WHERE id=?').get(req.userId!) as any; return { id: u.id, username: u.username, createdAt: u.created_at, settings: JSON.parse(u.s) };
  });
  app.put('/api/me/settings', { preHandler: auth }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>; const s = JSON.stringify({ defaultDurationMinutes: [1, 2, 3, 4, 5, 6].includes(b.defaultDurationMinutes as number) ? b.defaultDurationMinutes : 3, quality: ['low', 'medium', 'high'].includes(b.quality as string) ? b.quality : 'medium' });
    db.prepare('UPDATE users SET settings_json=? WHERE id=?').run(s, req.userId!); return JSON.parse(s);
  });

  // ---- providers (BYOK)
  app.get('/api/providers', { preHandler: auth }, async (req) => {
    const rows = db.prepare('SELECT kind, label, base_url, key_hint, created_at FROM provider_credentials WHERE user_id=?').all(req.userId!) as any[];
    return { kinds: PROVIDER_KINDS, configured: rows.map((r) => ({ kind: r.kind, label: r.label, baseUrl: r.base_url, maskedKey: r.key_hint, createdAt: r.created_at })) };
  });
  app.put('/api/providers', { preHandler: auth }, async (req, reply) => {
    const b = providerInput.parse(req.body); if (b.kind === 'custom' && !b.baseUrl) return reply.code(400).send({ error: 'custom providers need baseUrl' });
    if (b.baseUrl && prod && !b.baseUrl.startsWith('https://')) return reply.code(400).send({ error: 'baseUrl must be https in production' });
    db.prepare('INSERT INTO provider_credentials (user_id,kind,label,base_url,enc_key,key_hint) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET label=excluded.label, base_url=excluded.base_url, enc_key=excluded.enc_key, key_hint=excluded.key_hint')
      .run(req.userId!, b.kind, b.label ?? null, b.baseUrl ?? null, encryptSecret(b.apiKey, key), maskKey(b.apiKey));
    audit(db, req.userId!, 'provider_key_set', b.kind, req.ip); return { kind: b.kind, maskedKey: maskKey(b.apiKey) };
  });
  app.delete('/api/providers/:kind', { preHandler: auth }, async (req) => {
    const { kind } = req.params as { kind: string }; db.prepare('DELETE FROM provider_credentials WHERE user_id=? AND kind=?').run(req.userId!, kind);
    audit(db, req.userId!, 'provider_key_removed', kind, req.ip); return { ok: true };
  });
  const cred = (userId: number, kind: string) => {
    const r = db.prepare('SELECT enc_key, base_url FROM provider_credentials WHERE user_id=? AND kind=?').get(userId, kind) as { enc_key: string; base_url: string | null } | undefined;
    if (!r) throw new HttpError(404, 'no key configured for this provider'); return { apiKey: decryptSecret(r.enc_key, key), baseUrl: r.base_url ?? undefined };
  };
  app.post('/api/providers/:kind/test', { preHandler: auth }, async (req, reply) => {
    if (!limiter.check(`ptest:${req.userId}`, 20, 60_000)) return reply.code(429).send({ error: 'too many tests' });
    const { kind } = req.params as { kind: ProviderKind }; const model = String((req.body as any)?.model ?? '').slice(0, 120); const c = cred(req.userId!, kind);
    try { if (!model) { await discoverModels(kind, c.apiKey, c.baseUrl, opts.fetchImpl); return { ok: true, method: 'model discovery' }; }
      const r = await callProvider({ kind, ...c, model, system: 'Reply with {"ok":true}', user: 'ping', maxTokens: 20, timeoutMs: 10000, retries: 0 }, opts.fetchImpl); return { ok: true, method: 'completion', latencyMs: r.latencyMs, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
    } catch (e: any) { return reply.code(200).send({ ok: false, error: String(e.message).slice(0, 160) }); }
  });
  app.get('/api/providers/:kind/models', { preHandler: auth }, async (req, reply) => {
    const { kind } = req.params as { kind: ProviderKind }; const c = cred(req.userId!, kind);
    let models; try { models = await discoverModels(kind, c.apiKey, c.baseUrl, opts.fetchImpl); } catch (e: any) { return reply.code(502).send({ error: String(e.message).slice(0, 160) }); }
    const ov = db.prepare('SELECT model, input_per_m a, output_per_m b FROM ai_models WHERE user_id=? AND kind=?').all(req.userId!, kind) as any[]; const m = new Map(ov.map((o) => [o.model, o]));
    return { models: models.map((x) => { const o = m.get(x.id); return o ? { ...x, inputPricePerM: o.a, outputPricePerM: o.b, priceSource: 'user-entered' } : { ...x, priceSource: x.inputPricePerM != null ? 'provider' : 'unknown' }; }) };
  });
  app.put('/api/models/pricing', { preHandler: auth }, async (req) => {
    const b = pricingInput.parse(req.body);
    db.prepare('INSERT INTO ai_models (user_id,kind,model,input_per_m,output_per_m,price_source) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,kind,model) DO UPDATE SET input_per_m=excluded.input_per_m, output_per_m=excluded.output_per_m, price_source=excluded.price_source').run(req.userId!, b.kind, b.model, b.inputPerM, b.outputPerM, 'user-entered'); return { ok: true };
  });
  app.get('/api/usage', { preHandler: auth }, async (req) => {
    const rows = db.prepare('SELECT provider, model, SUM(calls) calls, SUM(tokens_in) tokens_in, SUM(tokens_out) tokens_out, SUM(cost_usd) cost_usd, MIN(cost_known) cost_known, SUM(latency_ms)*1.0/NULLIF(SUM(calls),0) avg_latency_ms, SUM(failures) failures, SUM(retries) retries FROM api_usage WHERE user_id=? GROUP BY provider, model').all(req.userId!);
    return { usage: rows };
  });

  // ---- teams
  app.get('/api/teams', { preHandler: auth }, async (req) => ({ teams: (db.prepare('SELECT id, name, config_json c FROM teams WHERE user_id=? ORDER BY id DESC').all(req.userId!) as any[]).map((t) => ({ id: t.id, name: t.name, config: JSON.parse(t.c) })) }));
  app.post('/api/teams', { preHandler: auth }, async (req, reply) => {
    const { teamInput } = await import('./schemas'); const t = teamInput.parse(req.body);
    try { const r = db.prepare('INSERT INTO teams (user_id,name,config_json) VALUES (?,?,?)').run(req.userId!, t.name, JSON.stringify(t)); return reply.code(201).send({ id: Number(r.lastInsertRowid) }); }
    catch (e: any) { if (String(e.message).includes('UNIQUE')) return reply.code(409).send({ error: 'team name already exists' }); throw e; }
  });
  app.delete('/api/teams/:id', { preHandler: auth }, async (req) => { db.prepare('DELETE FROM teams WHERE id=? AND user_id=?').run(Number((req.params as any).id), req.userId!); return { ok: true }; });

  // ---- matches
  const ownMatch = (req: FastifyRequest) => {
    const id = Number((req.params as any).id); const m = db.prepare('SELECT * FROM matches WHERE id=? AND user_id=?').get(id, req.userId!) as any;
    if (!m) throw new HttpError(404, 'match not found'); return { id, m };
  };
  app.post('/api/matches', { preHandler: auth }, async (req, reply) => {
    if (!limiter.check(`mk:${req.userId}`, 30, 3600_000)) return reply.code(429).send({ error: 'match creation limit reached' });
    const input = matchInput.parse(req.body); const { id } = runner.start(req.userId!, input);
    return reply.code(202).send({ id, status: 'running', note: `Virtual regulation runs 00:00-90:00 in about ${input.realDurationMinutes} real minute(s); a drawn match continues to a penalty shootout.` });
  });
  app.get('/api/matches', { preHandler: auth }, async (req) => {
    const q = req.query as { q?: string; status?: string; limit?: string; offset?: string };
    const rows = db.prepare(`SELECT m.id, m.status, m.created_at, m.reg_score_a, m.reg_score_b, m.winner, m.decided_by, m.selected_real_duration_seconds, a.name AS team_a, b.name AS team_b, a.architecture arch_a, b.architecture arch_b, a.model model_a, b.model model_b, m.tournament_id, m.benchmark_id
      FROM matches m JOIN match_participants a ON a.match_id=m.id AND a.team='A' JOIN match_participants b ON b.match_id=m.id AND b.team='B' WHERE m.user_id=? AND (? = '' OR a.name LIKE ? OR b.name LIKE ?) AND (? = '' OR m.status=?) ORDER BY m.id DESC LIMIT ? OFFSET ?`)
      .all(req.userId!, q.q ? `%${q.q}%` : '', q.q ? `%${q.q}%` : '', q.q ? `%${q.q}%` : '', q.status ?? '', q.status ?? '', Math.min(Number(q.limit ?? 50) || 50, 200), Number(q.offset ?? 0) || 0);
    return { matches: rows };
  });
  app.get('/api/matches/:id', { preHandler: auth }, async (req) => {
    const { id, m } = ownMatch(req); const parts = db.prepare('SELECT * FROM match_participants WHERE match_id=?').all(id);
    const ts = db.prepare('SELECT team, stats_json j FROM team_stats WHERE match_id=?').all(id) as any[]; const ps = db.prepare('SELECT player_id, team, stats_json j FROM player_stats WHERE match_id=?').all(id) as any[];
    const so = db.prepare('SELECT * FROM penalty_shootouts WHERE match_id=?').get(id) as any;
    const attempts = so ? (db.prepare('SELECT idx, round, team, sudden_death, taker_id, keeper_id, result, shot_json, keeper_json FROM penalty_attempts WHERE match_id=? ORDER BY idx').all(id) as any[]).map((a) => ({ index: a.idx, round: a.round, team: a.team, suddenDeath: !!a.sudden_death, takerId: a.taker_id, keeperId: a.keeper_id, result: a.result, shot: JSON.parse(a.shot_json), keeper: JSON.parse(a.keeper_json) })) : [];
    const usage = db.prepare('SELECT team, provider, model, calls, tokens_in, tokens_out, cost_usd, cost_known, latency_ms, retries, failures FROM api_usage WHERE match_id=?').all(id);
    const cfg = JSON.parse(m.config_json); const rosters = { A: cfg.teamA.players.map((p: any) => ({ id: p.id, number: p.number, name: p.name, role: p.role })), B: cfg.teamB.players.map((p: any) => ({ id: p.id, number: p.number, name: p.name, role: p.role })) };
    return { id, status: m.status, error: m.error, createdAt: m.created_at, finishedAt: m.finished_at, participants: parts, rosters, colors: { A: [cfg.teamA.primaryColor, cfg.teamA.secondaryColor], B: [cfg.teamB.primaryColor, cfg.teamB.secondaryColor] },
      time: { selectedRealDurationSeconds: m.selected_real_duration_seconds, actualRealElapsedSeconds: m.actual_real_elapsed_seconds, virtualMatchDurationSeconds: m.virtual_match_duration_seconds, clock: m.clock_report_json ? JSON.parse(m.clock_report_json) : null },
      regulation: { a: m.reg_score_a, b: m.reg_score_b }, winner: m.winner ?? so?.winner ?? null, decidedBy: m.decided_by,
      shootout: so ? { winner: so.winner, score: [so.score_a, so.score_b], firstTeam: so.first_team, decidedBy: so.decided_by, rounds: so.rounds, suddenDeathRounds: so.sudden_death_rounds, stats: JSON.parse(so.stats_json), note: so.note, attempts } : null,
      teamStats: Object.fromEntries(ts.map((r) => [r.team, JSON.parse(r.j)])), playerStats: Object.fromEntries(ps.map((r) => [r.player_id, { team: r.team, ...JSON.parse(r.j) }])), apiUsage: usage };
  });
  app.get('/api/matches/:id/events', { preHandler: auth }, async (req) => {
    const { id } = ownMatch(req); const q = req.query as { type?: string };
    const rows = db.prepare(`SELECT type, vt, half, team, player_id, data_json FROM match_events WHERE match_id=? ${q.type ? 'AND type=?' : ''} ORDER BY seq`).all(...(q.type ? [id, q.type] : [id])) as any[];
    return { events: rows.map((r) => ({ type: r.type, vt: r.vt, half: r.half, team: r.team, playerId: r.player_id, ...JSON.parse(r.data_json) })) };
  });
  app.get('/api/matches/:id/replay', { preHandler: auth }, async (req) => { const { id } = ownMatch(req); return { snapshots: readSnapshots(db, id) }; });
  app.get('/api/matches/:id/shootout/:idx/replay', { preHandler: auth }, async (req) => {
    const { id } = ownMatch(req); const idx = Number((req.params as any).idx);
    const a = db.prepare('SELECT frames, result, taker_id, keeper_id, team, shot_json, keeper_json FROM penalty_attempts WHERE match_id=? AND idx=?').get(id, idx) as any; if (!a) throw new HttpError(404, 'attempt not found');
    return { index: idx, team: a.team, result: a.result, takerId: a.taker_id, keeperId: a.keeper_id, shot: JSON.parse(a.shot_json), keeper: JSON.parse(a.keeper_json), frames: readFrames(a.frames) };
  });
  app.get('/api/matches/:id/decisions', { preHandler: auth }, async (req) => {
    const { id } = ownMatch(req);
    const rows = db.prepare('SELECT team, vt, trigger, architecture, accepted, reject_reason, tactics_json, state_json, objective, outcome, source, tokens_in, tokens_out, latency_ms, cost_usd FROM ai_decisions WHERE match_id=? ORDER BY vt').all(id) as any[];
    return { decisions: rows.map((r) => ({ team: r.team, vt: r.vt, trigger: r.trigger, architecture: r.architecture, accepted: !!r.accepted, rejectReason: r.reject_reason, tactics: r.tactics_json ? JSON.parse(r.tactics_json) : null, state: JSON.parse(r.state_json), objective: r.objective, outcome: r.outcome, source: r.source, tokensIn: r.tokens_in, tokensOut: r.tokens_out, latencyMs: r.latency_ms, costUsd: r.cost_usd })) };
  });
  app.delete('/api/matches/:id', { preHandler: auth }, async (req) => { const { id } = ownMatch(req); db.prepare('DELETE FROM matches WHERE id=?').run(id); audit(db, req.userId!, 'match_deleted', String(id), req.ip); return { ok: true }; });

  // live websocket (same-origin cookie or ?token=)
  app.get('/ws/matches/:id', { websocket: true }, (socket, req) => {
    const u = sessionUser(req) ?? (() => { const t = (req.query as any)?.token; if (!t) return undefined; const r = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash=?').get(sha256(String(t))) as any; return r && r.expires_at > Date.now() ? (r.user_id as number) : undefined; })();
    if (!u) { socket.close(4401, 'unauthorized'); return; }
    const id = Number((req.params as any).id);
    const off = runner.subscribe(u, id, (m) => { if (socket.readyState === 1) socket.send(JSON.stringify(m)); });
    if (!off) { socket.send(JSON.stringify({ t: 'not_live' })); socket.close(1000); return; }
    socket.on('close', () => off());
  });

  // ---- tournaments & benchmarks (run in background)
  const teamNeedsKey = (t: TeamInput) => { if (t.architecture === 'llm' && (!t.provider || !t.model)) throw new HttpError(400, 'LLM teams need provider and model'); };
  app.post('/api/tournaments', { preHandler: auth }, async (req, reply) => {
    const b = tournamentInput.parse(req.body); if (new Set(b.teams.map((t) => t.name)).size !== b.teams.length) throw new HttpError(400, 'team names must be unique within a tournament');
    if (b.format === 'single' || b.format === 'best_of_three') { if (b.teams.length !== 2) throw new HttpError(400, `${b.format} needs exactly 2 teams`); } else if (b.teams.length < 3 && b.format !== 'knockout') throw new HttpError(400, 'needs at least 3 teams');
    b.teams.forEach(teamNeedsKey);
    const tid = Number(tx(db, () => { const r = db.prepare("INSERT INTO tournaments (user_id,name,format,status,config_json) VALUES (?,?,?,'running',?)").run(req.userId!, b.name, b.format, JSON.stringify({ ...b, policy: TIE_BREAK_POLICY })).lastInsertRowid; b.teams.forEach((t, i) => db.prepare('INSERT INTO tournament_participants VALUES (?,?,?,?)').run(r, i, t.name, JSON.stringify(t))); return r; }));
    const p = runTournament(db, runner, req.userId!, tid, b).catch(() => db.prepare("UPDATE tournaments SET status='failed' WHERE id=?").run(tid)); (app as any)._bg = ((app as any)._bg ?? new Set()).add(p);
    return reply.code(202).send({ id: tid, status: 'running', policy: TIE_BREAK_POLICY });
  });
  app.get('/api/tournaments', { preHandler: auth }, async (req) => ({ tournaments: db.prepare('SELECT id, name, format, status, created_at FROM tournaments WHERE user_id=? ORDER BY id DESC').all(req.userId!) }));
  app.get('/api/tournaments/:id', { preHandler: auth }, async (req) => {
    const t = db.prepare('SELECT * FROM tournaments WHERE id=? AND user_id=?').get(Number((req.params as any).id), req.userId!) as any; if (!t) throw new HttpError(404, 'tournament not found');
    return { id: t.id, name: t.name, format: t.format, status: t.status, config: JSON.parse(t.config_json), result: t.result_json ? JSON.parse(t.result_json) : null, matches: db.prepare('SELECT id, status, reg_score_a, reg_score_b, winner FROM matches WHERE tournament_id=? ORDER BY id').all(t.id) };
  });
  app.post('/api/benchmarks', { preHandler: auth }, async (req, reply) => {
    const b = benchmarkInput.parse(req.body); teamNeedsKey(b.teamA as TeamInput); teamNeedsKey(b.teamB as TeamInput);
    if ((b.teamA.architecture === 'llm' || b.teamB.architecture === 'llm') && b.matches > 10) throw new HttpError(400, 'benchmarks involving LLM agents are limited to 10 matches to protect your API budget');
    const bid = Number(db.prepare("INSERT INTO benchmark_runs (user_id,status,config_json) VALUES (?,'running',?)").run(req.userId!, JSON.stringify(b)).lastInsertRowid);
    const p = runBenchmark(db, runner, req.userId!, bid, b).catch(() => db.prepare("UPDATE benchmark_runs SET status='failed' WHERE id=?").run(bid)); (app as any)._bg = ((app as any)._bg ?? new Set()).add(p);
    return reply.code(202).send({ id: bid, status: 'running' });
  });
  app.get('/api/benchmarks', { preHandler: auth }, async (req) => ({ benchmarks: (db.prepare('SELECT id, status, config_json c, result_json r, created_at FROM benchmark_runs WHERE user_id=? ORDER BY id DESC').all(req.userId!) as any[]).map((b) => ({ id: b.id, status: b.status, createdAt: b.created_at, config: JSON.parse(b.c), result: b.r ? JSON.parse(b.r) : null })), metricDocs: METRIC_DOCS }));
  app.get('/api/benchmarks/:id', { preHandler: auth }, async (req) => {
    const b = db.prepare('SELECT * FROM benchmark_runs WHERE id=? AND user_id=?').get(Number((req.params as any).id), req.userId!) as any; if (!b) throw new HttpError(404, 'benchmark not found');
    return { id: b.id, status: b.status, config: JSON.parse(b.config_json), result: b.result_json ? JSON.parse(b.result_json) : null };
  });
  app.get('/api/analytics', { preHandler: auth }, async (req) => {
    const rows = db.prepare(`SELECT p.architecture, COALESCE(p.model,'-') model, COUNT(*) matches,
        SUM(CASE WHEN m.winner = p.team OR (m.winner IS NULL AND s.winner = p.team) THEN 1 ELSE 0 END) wins,
        SUM(CASE WHEN p.team='A' THEN m.reg_score_a ELSE m.reg_score_b END)*1.0/COUNT(*) avg_gf, SUM(CASE WHEN p.team='A' THEN m.reg_score_b ELSE m.reg_score_a END)*1.0/COUNT(*) avg_ga
      FROM match_participants p JOIN matches m ON m.id=p.match_id LEFT JOIN penalty_shootouts s ON s.match_id=m.id WHERE m.user_id=? AND m.status='finished' GROUP BY p.architecture, p.model`).all(req.userId!);
    const cost = db.prepare('SELECT provider, model, SUM(cost_usd) cost_usd, MIN(cost_known) known, SUM(tokens_in+tokens_out) tokens, SUM(latency_ms)*1.0/NULLIF(SUM(calls),0) avg_latency FROM api_usage WHERE user_id=? GROUP BY provider, model').all(req.userId!);
    return { byArchitecture: rows, cost, note: 'Aggregates over your finished matches. Small samples are anecdotal.' };
  });

  return { app, db, runner };
}
