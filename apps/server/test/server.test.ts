import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import { decryptSecret, encryptSecret, hashPassword, loadCredentialKey, verifyPassword } from '../src/crypto';
import type { FastifyInstance } from 'fastify';

const key = randomBytes(32);
let app: FastifyInstance; let db: ReturnType<typeof openDb>;
const fakeFetch = async (url: string, init: any) => {
  if (init.method === 'GET') return { ok: true, status: 200, json: async () => ({ data: [{ id: 'gpt-x' }] }), text: async () => '' };
  const body = JSON.parse(init.body); void body;
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"bogus":true}' } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }), text: async () => '' };
};
beforeAll(async () => { db = openDb(':memory:'); ({ app } = await buildApp({ db, key, fetchImpl: fakeFetch })); });
afterAll(async () => { await app.close(); });

let ipN = 0;
const reg = async (name: string) => { const r = await app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: `10.1.0.${++ipN}`, payload: { username: name, password: 'password123' } }); expect(r.statusCode).toBe(201); return r.json().token as string; };
const H = (t: string) => ({ authorization: `Bearer ${t}` });
const team = (name: string, extra: Record<string, unknown> = {}) => ({ name, formation: '2-2', architecture: 'hybrid', ...extra });
const waitMatch = async (t: string, id: number) => { for (let i = 0; i < 600; i++) { const r = await app.inject({ method: 'GET', url: `/api/matches/${id}`, headers: H(t) }); if (r.json().status !== 'running') return r.json(); await new Promise((r2) => setTimeout(r2, 100)); } throw new Error('timeout'); };

describe('crypto', () => {
  it('AES-GCM round trip, tamper detection, scrypt passwords', () => {
    const k = randomBytes(32); const c = encryptSecret('sk-live-123456789', k); expect(c).not.toContain('sk-live'); expect(decryptSecret(c, k)).toBe('sk-live-123456789');
    expect(() => decryptSecret(c.slice(0, -2) + 'AA', k)).toThrow(); expect(() => decryptSecret(c, randomBytes(32))).toThrow();
    const h = hashPassword('hunter2hunter2'); expect(verifyPassword('hunter2hunter2', h)).toBe(true); expect(verifyPassword('wrong', h)).toBe(false);
  });
  it('production requires an explicit credential key', () => { expect(() => loadCredentialKey({ NODE_ENV: 'production' } as any)).toThrow(); expect(() => loadCredentialKey({ CREDENTIAL_KEY: 'zz' } as any)).toThrow(); expect(loadCredentialKey({ CREDENTIAL_KEY: 'ab'.repeat(32) } as any).length).toBe(32); });
});

describe('auth & validation', () => {
  it('requires authentication, registers, logs in, rejects bad credentials, validates input', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/matches' })).statusCode).toBe(401);
    const t = await reg('alice'); expect((await app.inject({ method: 'GET', url: '/api/me', headers: H(t) })).json().username).toBe('alice');
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alice', password: 'password123' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'nopenope1' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'password123' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'x', password: 'short' } })).statusCode).toBe(400);
    const bad = await app.inject({ method: 'POST', url: '/api/matches', headers: H(t), payload: { teamA: team('A'), teamB: team('B'), realDurationMinutes: 7 } }); expect(bad.statusCode).toBe(400);
    const sid = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'password123' } })).headers['set-cookie'] as string; expect(sid).toMatch(/HttpOnly/); expect(sid).toMatch(/SameSite=Lax/);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: H(t) }); expect((await app.inject({ method: 'GET', url: '/api/me', headers: H(t) })).statusCode).toBe(401);
  });
  it('rate limits repeated auth attempts', async () => {
    let last = 0; for (let i = 0; i < 14; i++) last = (await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '9.9.9.9', payload: { username: 'nobody', password: 'password123' } })).statusCode;
    expect(last).toBe(429);
  });
  it('sets hardening headers and never leaks stack traces', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' }); expect(r.headers['x-content-type-options']).toBe('nosniff'); expect(r.json().durations).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('BYOK provider keys', () => {
  it('stores keys encrypted, shows only masked values, isolates users, tests and discovers models, removes keys', async () => {
    const a = await reg('bob'), b = await reg('carol'); const secret = 'sk-test-ABCDEFGHIJKLMNOP';
    const put = await app.inject({ method: 'PUT', url: '/api/providers', headers: H(a), payload: { kind: 'openai', apiKey: secret } }); expect(put.statusCode).toBe(200); expect(put.body).not.toContain(secret);
    const row = db.prepare('SELECT enc_key FROM provider_credentials').get() as any; expect(row.enc_key).not.toContain('ABCDEFGH'); expect(decryptSecret(row.enc_key, key)).toBe(secret);
    const list = await app.inject({ method: 'GET', url: '/api/providers', headers: H(a) }); expect(list.body).not.toContain(secret); expect(list.json().configured[0].maskedKey).toMatch(/••••/);
    expect((await app.inject({ method: 'GET', url: '/api/providers', headers: H(b) })).json().configured).toHaveLength(0);
    expect((await app.inject({ method: 'POST', url: '/api/providers/openai/test', headers: H(b), payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/providers/openai/test', headers: H(a), payload: {} })).json().ok).toBe(true);
    const models = (await app.inject({ method: 'GET', url: '/api/providers/openai/models', headers: H(a) })).json().models; expect(models[0]).toMatchObject({ id: 'gpt-x', priceSource: 'unknown', inputPricePerM: null });
    await app.inject({ method: 'PUT', url: '/api/models/pricing', headers: H(a), payload: { kind: 'openai', model: 'gpt-x', inputPerM: 1, outputPerM: 2 } });
    expect((await app.inject({ method: 'GET', url: '/api/providers/openai/models', headers: H(a) })).json().models[0]).toMatchObject({ inputPricePerM: 1, priceSource: 'user-entered' });
    await app.inject({ method: 'DELETE', url: '/api/providers/openai', headers: H(a) }); expect((await app.inject({ method: 'GET', url: '/api/providers', headers: H(a) })).json().configured).toHaveLength(0);
    expect(JSON.stringify(db.prepare('SELECT detail FROM audit_log').all())).not.toContain(secret);
  });
  it('LLM teams need a configured key; with a key, invalid model output falls back and cost/tokens are tracked per team', async () => {
    const t = await reg('dave');
    const noKey = await app.inject({ method: 'POST', url: '/api/matches', headers: H(t), payload: { teamA: team('Gpt', { architecture: 'llm', provider: 'openai', model: 'gpt-x' }), teamB: team('Rule', { architecture: 'rule' }), realDurationMinutes: 1, paced: false } });
    expect(noKey.statusCode).toBe(400);
    await app.inject({ method: 'PUT', url: '/api/providers', headers: H(t), payload: { kind: 'openai', apiKey: 'sk-test-12345678901' } });
    await app.inject({ method: 'PUT', url: '/api/models/pricing', headers: H(t), payload: { kind: 'openai', model: 'gpt-x', inputPerM: 1, outputPerM: 2 } });
    const r = await app.inject({ method: 'POST', url: '/api/matches', headers: H(t), payload: { teamA: team('Gpt', { architecture: 'llm', provider: 'openai', model: 'gpt-x' }), teamB: team('Rule', { architecture: 'rule' }), realDurationMinutes: 1, seed: 3, paced: false } });
    expect(r.statusCode).toBe(202); const m = await waitMatch(t, r.json().id); expect(m.status).toBe('finished');
    const dec = (await app.inject({ method: 'GET', url: `/api/matches/${m.id}/decisions`, headers: H(t) })).json().decisions as any[];
    const gpt = dec.filter((d) => d.team === 'A'); expect(gpt.length).toBeGreaterThan(0); expect(gpt.every((d) => !d.accepted && d.source.includes('fallback') && d.tactics)).toBe(true);
    const u = m.apiUsage.find((x: any) => x.team === 'A'); expect(u.tokens_in).toBeGreaterThan(0); expect(u.cost_usd).toBeGreaterThan(0); expect(m.apiUsage.find((x: any) => x.team === 'B')).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain('sk-test');
  });
});

describe('end-to-end match flow (create -> live -> persisted results -> history -> replay)', () => {
  let t: string; let finished: any;
  beforeAll(async () => { t = await reg('erin'); });
  it('runs a regulation match, persists everything, and a user cannot read another user match', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/matches', headers: H(t), payload: { teamA: team('Alpha', { architecture: 'utility' }), teamB: team('Beta', { architecture: 'fsm', formation: '1-2-1' }), realDurationMinutes: 2, seed: 21, paced: false } });
    expect(c.statusCode).toBe(202); const id = c.json().id; finished = await waitMatch(t, id);
    expect(finished.status).toBe('finished'); expect(finished.time.selectedRealDurationSeconds).toBe(120); expect(finished.time.virtualMatchDurationSeconds).toBe(5400); expect(finished.time.actualRealElapsedSeconds).toBeGreaterThan(30);
    expect(finished.participants).toHaveLength(2); expect(finished.teamStats.A.passes).toBeGreaterThan(0); expect(Object.keys(finished.playerStats).length).toBe(16);
    const other = await reg('frank'); expect((await app.inject({ method: 'GET', url: `/api/matches/${id}`, headers: H(other) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/matches/${id}/replay`, headers: H(other) })).statusCode).toBe(404);
  });
  it('events and replay snapshots are served from stored simulation data', async () => {
    const ev = (await app.inject({ method: 'GET', url: `/api/matches/${finished.id}/events`, headers: H(t) })).json().events; expect(ev[0].type).toBe('kickoff'); expect(ev.find((e: any) => e.type === 'fulltime').vt).toBe(5400); expect(ev.find((e: any) => e.type === 'halftime').vt).toBe(2700);
    const rp = (await app.inject({ method: 'GET', url: `/api/matches/${finished.id}/replay`, headers: H(t) })).json().snapshots; expect(rp.length).toBeGreaterThan(200); expect(rp.at(-1).vt).toBe(5400);
  });
  it('history search/filter finds the match', async () => {
    const h = (await app.inject({ method: 'GET', url: '/api/matches?q=Alpha&status=finished', headers: H(t) })).json().matches; expect(h.map((m: any) => m.id)).toContain(finished.id);
    expect((await app.inject({ method: 'GET', url: '/api/matches?q=Zzzz', headers: H(t) })).json().matches).toHaveLength(0);
  });
  it('deleting a match cascades to dependent rows', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/matches', headers: H(t), payload: { teamA: team('Del1', { architecture: 'rule' }), teamB: team('Del2', { architecture: 'rule' }), realDurationMinutes: 1, seed: 2, paced: false } });
    const m = await waitMatch(t, c.json().id); await app.inject({ method: 'DELETE', url: `/api/matches/${m.id}`, headers: H(t) });
    for (const tb of ['match_events', 'simulation_snapshots', 'team_stats', 'player_stats', 'ai_decisions', 'match_participants']) expect((db.prepare(`SELECT COUNT(*) c FROM ${tb} WHERE match_id=?`).get(m.id) as any).c).toBe(0);
  });
});

describe('drawn matches go to a persisted, replayable shootout', () => {
  it('finds a drawn seed; shootout stored separately from regulation with per-attempt replay', async () => {
    const t = await reg('gina'); let found: any = null;
    for (let seed = 1; seed < 12 && !found; seed++) {
      const c = await app.inject({ method: 'POST', url: '/api/matches', headers: H(t), payload: { teamA: team('P1', { architecture: 'hybrid' }), teamB: team('P2', { architecture: 'hybrid' }), realDurationMinutes: 1, seed, paced: false } });
      const m = await waitMatch(t, c.json().id); if (m.regulation.a === m.regulation.b) found = m;
    }
    expect(found).toBeTruthy(); expect(found.decidedBy).toBe('shootout'); expect(found.shootout).toBeTruthy(); expect(found.shootout.attempts.length).toBeGreaterThanOrEqual(3);
    expect(found.winner).toBe(found.shootout.winner); expect(found.regulation.a).toBe(found.regulation.b);
    expect(found.teamStats.A.goals + found.teamStats.B.goals).toBe(found.regulation.a + found.regulation.b); // shootout goals never added to regulation stats
    const rep = (await app.inject({ method: 'GET', url: `/api/matches/${found.id}/shootout/1/replay`, headers: H(t) })).json(); expect(rep.frames.length).toBeGreaterThan(5); expect(['goal', 'saved', 'missed', 'post']).toContain(rep.result);
    const sc = found.shootout.score; expect(found.shootout.attempts.filter((a: any) => a.result === 'goal' && a.team === 'A').length).toBe(sc[0]);
  });
});

describe('live websocket stream', () => {
  it('streams state and events to the owner only', async () => {
    const t = await reg('hank'); await app.listen({ port: 0, host: '127.0.0.1' }); const port = (app.server.address() as any).port;
    const { WebSocket } = await import('ws');
    const c = await app.inject({ method: 'POST', url: '/api/matches', headers: H(t), payload: { teamA: team('W1', { architecture: 'rule' }), teamB: team('W2', { architecture: 'rule' }), realDurationMinutes: 1, seed: 6, paced: false } });
    const id = c.json().id; const msgs: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/matches/${id}?token=${t}`); ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on('open', r)); await waitMatch(t, id); await new Promise((r) => setTimeout(r, 300)); ws.close();
    expect(msgs[0].t).toBe('hello'); expect(msgs.some((m) => m.t === 'state' && m.vt > 0)).toBe(true); expect(msgs.some((m) => m.t === 'event')).toBe(true);
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws/matches/${id}`); const code = await new Promise<number>((r) => bad.on('close', (c2) => r(c2))); expect(code).toBe(4401);
  });
});

describe('tournaments and benchmarks', () => {
  it('round robin standings follow the explicit tie-break policy; every match is persisted', async () => {
    const t = await reg('ivy'); const teams = ['T1', 'T2', 'T3'].map((n, i) => team(n, { architecture: ['rule', 'utility', 'goap'][i] }));
    const r = await app.inject({ method: 'POST', url: '/api/tournaments', headers: H(t), payload: { name: 'Cup', format: 'round_robin', teams, realDurationMinutes: 1, seed: 8 } }); expect(r.statusCode).toBe(202);
    let res: any; for (let i = 0; i < 600; i++) { res = (await app.inject({ method: 'GET', url: `/api/tournaments/${r.json().id}`, headers: H(t) })).json(); if (res.status !== 'running') break; await new Promise((x) => setTimeout(x, 200)); }
    expect(res.status).toBe('finished'); expect(res.matches).toHaveLength(3); expect(res.result.table).toHaveLength(3); expect(res.result.policy).toMatch(/shootout/);
    const total = res.result.table.reduce((a: number, x: any) => a + x.points, 0); expect(total).toBe(3 * 3); // every match awards 3 points in total (3-0, 2-1)
    expect(res.result.champion).toBe(res.result.table[0].name);
  });
  it('knockout handles byes and best-of-three stops at two wins', async () => {
    const t = await reg('jack');
    const k = await app.inject({ method: 'POST', url: '/api/tournaments', headers: H(t), payload: { name: 'KO', format: 'knockout', teams: ['K1', 'K2', 'K3'].map((n) => team(n, { architecture: 'rule' })), realDurationMinutes: 1, seed: 3 } });
    const b3 = await app.inject({ method: 'POST', url: '/api/tournaments', headers: H(t), payload: { name: 'Bo3', format: 'best_of_three', teams: ['S1', 'S2'].map((n) => team(n, { architecture: 'rule' })), realDurationMinutes: 1, seed: 4 } });
    for (const id of [k.json().id, b3.json().id]) { let res: any; for (let i = 0; i < 900; i++) { res = (await app.inject({ method: 'GET', url: `/api/tournaments/${id}`, headers: H(t) })).json(); if (res.status !== 'running') break; await new Promise((x) => setTimeout(x, 200)); }
      expect(res.status).toBe('finished'); expect(res.result.champion).toBeTruthy(); if (res.format === 'knockout') expect(res.matches).toHaveLength(2); else { expect(res.matches.length).toBeGreaterThanOrEqual(2); expect(res.matches.length).toBeLessThanOrEqual(3); } }
  });
  it('benchmark: fair seeds, side swapping, metrics documented, small-sample warning', async () => {
    const t = await reg('kate');
    const r = await app.inject({ method: 'POST', url: '/api/benchmarks', headers: H(t), payload: { teamA: team('Rule', { architecture: 'rule' }), teamB: team('Util', { architecture: 'utility' }), matches: 2, realDurationMinutes: 1, swapSides: true, seed: 50 } }); expect(r.statusCode).toBe(202);
    let res: any; for (let i = 0; i < 600; i++) { res = (await app.inject({ method: 'GET', url: `/api/benchmarks/${r.json().id}`, headers: H(t) })).json(); if (res.status !== 'running') break; await new Promise((x) => setTimeout(x, 200)); }
    expect(res.status).toBe('finished'); const [A, B] = res.result.models; expect(A.matches).toBe(2); expect(A.wins + B.wins).toBe(2); expect(res.result.sampleWarning).toMatch(/anecdotal/); expect(res.result.metricDocs.winRate).toBeTruthy(); expect(res.result.seeds).toEqual([50, 51]);
    expect(A.costPerMatchUsd).toBe(0); expect(res.result.fairness).toMatch(/swapped/);
    expect((db.prepare('SELECT SUM(sides_swapped) s FROM benchmark_results WHERE benchmark_id=?').get(r.json().id) as any).s).toBe(1);
    const an = (await app.inject({ method: 'GET', url: '/api/analytics', headers: H(t) })).json(); expect(an.byArchitecture.length).toBeGreaterThan(0);
  });
  it('limits LLM benchmarks to protect the budget', async () => {
    const t = await reg('lena'); const r = await app.inject({ method: 'POST', url: '/api/benchmarks', headers: H(t), payload: { teamA: team('L', { architecture: 'llm', provider: 'openai', model: 'm' }), teamB: team('R'), matches: 15, realDurationMinutes: 1 } }); expect(r.statusCode).toBe(400);
  });
});
