import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { CLAUDE_MODELS, type ServerMsg, type StartMatchBody } from '@futsal/shared';
import { buildApp, isTrustedRequest } from '../src/app';
import { MatchSession } from '../src/session';
import { resolveCommand } from '../src/runCli';

// ---------------------------------------------------------------------------------------------- stand-in CLIs
const dir = mkdtempSync(join(tmpdir(), 'futsal-test-'));
const fakeClaude = join(dir, 'claude.cjs'); const fakeCodex = join(dir, 'codex.cjs'); const codexHome = join(dir, 'codex-home');
const TACTICS = `const tactics = (st, why) => ({ formation: '2-2', teamStrategy: 'attacking', attackingStyle: 'direct', defensiveStyle: 'mid_block', pressingIntensity: 0.7, riskLevel: 0.6, flyingGoalkeeper: false, playerInstructions: st.onCourt.filter((p) => p.role !== 'GK').map((p) => ({ playerId: p.id, instruction: 'support_build_up' })), reasonSummary: why });
const state = (prompt) => JSON.parse(/Match state \\(JSON\\): (.*)\\nTrigger/.exec(prompt)[1]);`;
writeFileSync(fakeClaude, `${TACTICS}
const a = process.argv.slice(2);
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: process.env.FAKE_LOGGED_IN !== '0', authMethod: 'test' })); process.exit(0); }
const prompt = a[a.indexOf('-p') + 1];
if (process.env.FAKE_RECORD_ARGS) require('fs').writeFileSync(process.env.FAKE_RECORD_ARGS, JSON.stringify(a));
console.log(JSON.stringify({ is_error: false, result: JSON.stringify(tactics(state(prompt), 'fake claude: push forward')) }));`);
writeFileSync(fakeCodex, `${TACTICS}
const a = process.argv.slice(2);
if (a[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
const mi = a.indexOf('-m'); if (mi >= 0 && a[mi + 1] === 'gpt-bad') { console.error('ERROR: {"type":"error","error":{"message":"The gpt-bad model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}'); process.exit(1); }
const out = a[a.indexOf('-o') + 1]; const prompt = a[a.length - 1];
if (prompt.startsWith('Reply with the single word')) { require('fs').writeFileSync(out, 'ok'); process.exit(0); }
require('fs').writeFileSync(out, JSON.stringify(tactics(state(prompt), 'fake codex: stay compact')));`);
mkdirSync(codexHome, { recursive: true });
writeFileSync(join(codexHome, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list' }, { slug: 'gpt-bad', display_name: 'GPT Bad', visibility: 'list' }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }] }));
writeFileSync(join(codexHome, 'config.toml'), 'model = "gpt-test"\n');

process.env.CLAUDE_BIN = fakeClaude; process.env.CODEX_BIN = fakeCodex; process.env.CODEX_HOME = codexHome; delete process.env.OPENROUTER_API_KEY;

// ---------------------------------------------------------------------------------------------- helpers
let app: FastifyInstance; let base = ''; let wsBase = '';
const pc = (provider: 'claude' | 'codex' | 'openrouter', model: string, effort: 'default' | 'low' | 'medium' | 'high' = 'default') => ({ provider, model, effort });
const body = (home: ReturnType<typeof pc>, away: ReturnType<typeof pc>, extra: Partial<StartMatchBody> = {}): StartMatchBody => ({ home, away, minutes: 1, seed: 21, names: { A: 'Home FC', B: 'Away FC' }, ...extra } as StartMatchBody);
const post = (path: string, b?: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: 'POST', headers: b === undefined ? headers : { 'content-type': 'application/json', ...headers }, body: b === undefined ? undefined : JSON.stringify(b) });
const start = async (b: StartMatchBody) => { const r = await post('/api/match', b); return { status: r.status, json: (await r.json()) as { id?: string; error?: string; issues?: unknown[] } }; };
/** Connects to the live stream and resolves with every message once the stream reports `done`/`error`, or after `maxMs`. */
const collect = (id: string, o: { until?: (m: ServerMsg, all: ServerMsg[]) => boolean; maxMs?: number } = {}) => new Promise<ServerMsg[]>((resolve) => {
  const all: ServerMsg[] = []; const ws = new WebSocket(`${wsBase}/ws/match/${id}`); const timer = setTimeout(() => { ws.close(); resolve(all); }, o.maxMs ?? 120000);
  ws.on('message', (d) => { const m = JSON.parse(String(d)) as ServerMsg; all.push(m); if (o.until ? o.until(m, all) : m.t === 'done' || m.t === 'error') { clearTimeout(timer); ws.close(); resolve(all); } });
});

beforeAll(async () => {
  ({ app } = await buildApp({ paced: false, fetchImpl: (async () => new Response(JSON.stringify({ data: [{ id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', pricing: { prompt: '0.00000015', completion: '0.0000006' } }, { id: 'free/model', name: 'Free', pricing: { prompt: '0', completion: '0' } }] }))) as typeof fetch,
    providerFetch: async (_u, init) => { const b = JSON.parse(init.body!) as { messages: { content: string }[] }; const st = JSON.parse(/Match state \(JSON\): (.*)\nTrigger/.exec(b.messages[1].content)![1]) as { onCourt: { id: string; role: string }[] };
      const t = { formation: '2-2', teamStrategy: 'balanced', attackingStyle: 'possession', defensiveStyle: 'mid_block', pressingIntensity: 0.5, riskLevel: 0.5, flyingGoalkeeper: false, playerInstructions: st.onCourt.filter((p) => p.role !== 'GK').map((p) => ({ playerId: p.id, instruction: 'hold_position' })), reasonSummary: 'fake openrouter reply' };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(t) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }), text: async () => '' } as never; } }));
  await app.listen({ port: 0, host: '127.0.0.1' }); const port = (app.server.address() as { port: number }).port; base = `http://127.0.0.1:${port}`; wsBase = `ws://127.0.0.1:${port}`;
}, 60000);
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------------------------- tests
describe('request safety', () => {
  it('only trusts this app\'s own pages and JSON bodies', () => {
    const h = (o: Record<string, string>) => ({ headers: o });
    expect(isTrustedRequest(h({ 'content-type': 'application/json', host: 'localhost:5173' }), true)).toBe(true);
    expect(isTrustedRequest(h({ 'content-type': 'application/json', host: 'localhost:5173', origin: 'http://localhost:5173' }), true)).toBe(true);
    expect(isTrustedRequest(h({ 'content-type': 'application/json', host: 'localhost:5173', origin: 'https://evil.example' }), true)).toBe(false);
    expect(isTrustedRequest(h({ 'content-type': 'text/plain', host: 'localhost:5173' }), true)).toBe(false);
    expect(isTrustedRequest(h({ host: 'a:1', 'x-forwarded-host': 'b:2', origin: 'http://b:2' }), false)).toBe(true); // reverse proxy / dev proxy
  });
  it('rejects cross-origin match starts and invalid input without starting anything', async () => {
    const evil = await post('/api/match', body(pc('codex', 'gpt-test'), pc('claude', 'claude-haiku-5-5')), { origin: 'https://evil.example' }); expect(evil.status).toBe(403);
    for (const bad of [{ ...body(pc('codex', 'gpt-test'), pc('claude', 'claude-haiku-5-5')), minutes: 7 }, body(pc('claude', 'x; rm -rf /'), pc('claude', 'claude-haiku-5-5')), { ...body(pc('codex', 'gpt-test'), pc('claude', 'claude-haiku-5-5')), names: { A: '', B: 'x' } }]) {
      expect((await post('/api/match', bad)).status).toBe(400);
    }
    expect((await post('/api/match/nope/stop')).status).toBe(404);
  });
});

describe('providers (how models are chosen, like the setup cards)', () => {
  it('reports exactly Claude Code, Codex and OpenRouter with models and readiness', async () => {
    const { providers } = (await (await fetch(`${base}/api/providers`)).json()) as { providers: { id: string; ready: boolean; detail: string; models: { id: string }[]; defaultModel: string }[] };
    const by = Object.fromEntries(providers.map((p) => [p.id, p]));
    expect(by.claude.ready).toBe(true); expect(by.claude.detail).toMatch(/Signed in/); expect(by.claude.models.map((m) => m.id)).toEqual(CLAUDE_MODELS.map((m) => m.id));
    expect(by.codex.ready).toBe(true); expect(by.codex.models.map((m) => m.id)).toEqual(['gpt-test', 'gpt-bad']); expect(by.codex.defaultModel).toBe('gpt-test'); // hidden models are not offered
    expect(by.openrouter.ready).toBe(false); expect(by.openrouter.detail).toMatch(/key/i);
    expect(Object.keys(by).sort()).toEqual(['claude', 'codex', 'openrouter']); // no built-in coach: only models
  });
  it('shows "Not signed in" when the CLI is not logged in', async () => {
    process.env.FAKE_LOGGED_IN = '0'; const { providers } = (await (await fetch(`${base}/api/providers`)).json()) as { providers: { id: string; ready: boolean; detail: string }[] }; delete process.env.FAKE_LOGGED_IN;
    expect(providers.find((p) => p.id === 'claude')).toMatchObject({ ready: false, detail: 'Not signed in' });
  });
  it('lists the OpenRouter catalogue with prices straight from OpenRouter', async () => {
    const r = (await (await fetch(`${base}/api/openrouter/models`)).json()) as { models: { id: string; hint?: string }[] };
    expect(r.models.map((m) => m.id)).toEqual(['openai/gpt-4o-mini', 'free/model']); expect(r.models[0].hint).toBe('$0.15 / $0.60 per 1M'); expect(r.models[1].hint).toBe('Free');
  });
  it('resolves script paths to node and never uses a shell', () => { expect(resolveCommand('/tmp/x.cjs')).toEqual({ file: process.execPath, prefix: ['/tmp/x.cjs'] }); });
});

describe('a match between two models', () => {
  it('Model vs model: streams state, events and thoughts; the clock runs 00:00 -> 90:00; ends with a full summary', async () => {
    const { status, json } = await start(body(pc('codex', 'gpt-test'), pc('claude', 'claude-haiku-5-5'))); expect(status).toBe(202);
    const msgs = await collect(json.id!); const done = msgs.find((m) => m.t === 'done'); expect(done).toBeTruthy();
    const hello = msgs[0]; expect(hello.t).toBe('hello'); if (hello.t === 'hello') { expect(hello.roster.A).toHaveLength(8); expect(hello.names.A).toBe('Home FC'); }
    const states = msgs.filter((m) => m.t === 'state'); expect(states.length).toBeGreaterThan(20);
    const last = states.at(-1)!; if (last.t === 'state') { expect(last.vt).toBe(5400); expect(typeof last.thinking.A).toBe('boolean'); }
    expect(msgs.some((m) => m.t === 'event')).toBe(true); expect(msgs.filter((m) => m.t === 'thought').length).toBeGreaterThan(4);
    if (done?.t === 'done') { expect(done.summary.time.virtualSeconds).toBe(5400); expect(done.summary.time.selectedSeconds).toBe(60); expect(done.summary.players).toHaveLength(16); expect(done.summary.teamStats.A.possessionPct + done.summary.teamStats.B.possessionPct).toBeGreaterThanOrEqual(99); expect(['regulation', 'shootout']).toContain(done.summary.decidedBy); }
  });

  it('Claude Code side: the coach is a real CLI call with the documented flags, and its answer is accepted as tactics', async () => {
    const rec = join(dir, 'args.json'); process.env.FAKE_RECORD_ARGS = rec;
    const { json } = await start(body(pc('claude', 'claude-haiku-5-5', 'high'), pc('codex', 'gpt-test')));
    const msgs = await collect(json.id!); delete process.env.FAKE_RECORD_ARGS;
    const thoughts = msgs.filter((m): m is Extract<ServerMsg, { t: 'thought' }> => m.t === 'thought' && m.team === 'A');
    expect(thoughts.length).toBeGreaterThan(0); expect(thoughts.some((t) => t.accepted)).toBe(true); expect(thoughts.every((t) => (t.accepted || /stale/.test(t.reason ?? '')) && t.source === 'llm:claude:claude-haiku-5-5')).toBe(true);
    const args = JSON.parse(readFileSync(rec, 'utf8')) as string[];
    expect(args).toEqual(expect.arrayContaining(['-p', '--model', 'claude-haiku-5-5', '--system-prompt', '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--effort', 'high'])); expect(args[args.indexOf('--tools') + 1]).toBe('');
  });

  it('Codex side: runs `codex exec` read-only and reads the final message from the output file', async () => {
    const { json } = await start(body(pc('codex', 'gpt-test'), pc('codex', 'gpt-test'))); const msgs = await collect(json.id!);
    const t = msgs.filter((m): m is Extract<ServerMsg, { t: 'thought' }> => m.t === 'thought' && m.team === 'B'); expect(t.length, JSON.stringify(msgs.filter((m) => m.t === 'error' || (m.t === 'thought' && m.team === 'B')).slice(0, 3))).toBeGreaterThan(0); expect(t.some((x) => x.accepted) && t.every((x) => (x.accepted || /stale/.test(x.reason ?? '')) && x.source === 'llm:codex:gpt-test')).toBe(true);
  });

  it('OpenRouter side needs a key (from Settings or the server); with one, the model coaches the team', async () => {
    const no = await start(body(pc('openrouter', 'openai/gpt-4o-mini'), pc('codex', 'gpt-test'))); expect(no.status).toBe(400); expect(no.json.error).toMatch(/OpenRouter API key/);
    const { json } = await start(body(pc('openrouter', 'openai/gpt-4o-mini'), pc('codex', 'gpt-test'), { openRouterKey: 'sk-or-test-123' })); const msgs = await collect(json.id!);
    const t = msgs.filter((m): m is Extract<ServerMsg, { t: 'thought' }> => m.t === 'thought' && m.team === 'A'); expect(t.length).toBeGreaterThan(0); expect(t.some((x) => x.accepted) && t.every((x) => x.source === 'llm:openrouter:openai/gpt-4o-mini' && x.tokens === 120 && (x.accepted || /stale/.test(x.reason ?? '')))).toBe(true);
    expect(JSON.stringify(msgs)).not.toContain('sk-or-test-123'); // the key never comes back to the browser
  });

  it('a failing provider never stops the match: the team keeps its tactics and the feed says why', async () => {
    process.env.FAKE_LOGGED_IN = '0'; process.env.CLAUDE_BIN = join(dir, 'missing.cjs');
    const { json } = await start(body(pc('claude', 'claude-haiku-5-5'), pc('codex', 'gpt-test'))); const msgs = await collect(json.id!); process.env.CLAUDE_BIN = fakeClaude; delete process.env.FAKE_LOGGED_IN;
    expect(msgs.some((m) => m.t === 'done')).toBe(true); const t = msgs.filter((m): m is Extract<ServerMsg, { t: 'thought' }> => m.t === 'thought' && m.team === 'A');
    expect(t.length).toBeGreaterThan(0); expect(t.every((x) => !x.accepted && x.reason)).toBe(true); expect(t.every((x) => x.summary.length > 0 && x.strategy === null)).toBe(true); // no built-in coach: the team keeps its current tactics and the thought says why
  });
});

describe('a Codex model the sign-in cannot run', () => {
  it('is refused before kick-off with a clear message, and the picker flags it and never defaults to it', async () => {
    const r = await start(body(pc('codex', 'gpt-bad'), pc('claude', 'claude-haiku-5-5')));
    expect(r.status).toBe(400); expect(r.json.error).toMatch(/cannot use "gpt-bad" with your ChatGPT sign-in/);
    const list = (await (await fetch(`${base}/api/providers`)).json()) as { providers: { id: string; defaultModel: string; models: { id: string; hint?: string }[] }[] } | { id: string; defaultModel: string; models: { id: string; hint?: string }[] }[];
    const codex = (Array.isArray(list) ? list : list.providers).find((p) => p.id === 'codex')!;
    expect(codex.models.find((m) => m.id === 'gpt-bad')?.hint).toMatch(/Not available/); expect(codex.defaultModel).toBe('gpt-test');
  });
});

describe('pause / resume / stop', () => {
  it('pausing freezes the clock, resuming continues, and stopping ends the match and kills pending work', async () => {
    const { app: paced } = await buildApp({ paced: true }); await paced.listen({ port: 0, host: '127.0.0.1' }); const port = (paced.server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`; const j = { 'content-type': 'application/json' };
    const { id } = (await (await fetch(`${url}/api/match`, { method: 'POST', headers: j, body: JSON.stringify(body(pc('codex', 'gpt-test'), pc('claude', 'claude-haiku-5-5'))) })).json()) as { id: string };
    const seen: ServerMsg[] = []; const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/match/${id}`); ws.on('message', (d) => seen.push(JSON.parse(String(d))));
    await new Promise((r) => setTimeout(r, 1500));
    await fetch(`${url}/api/match/${id}/pause`, { method: 'POST' }); await new Promise((r) => setTimeout(r, 300));
    const vtAt = () => { const s = seen.filter((m) => m.t === 'state').at(-1); return s && s.t === 'state' ? s.vt : -1; }; const v1 = vtAt(); await new Promise((r) => setTimeout(r, 700)); const v2 = vtAt();
    expect(v1).toBeGreaterThan(0); expect(v2).toBe(v1); expect(seen.some((m) => m.t === 'paused' && m.paused)).toBe(true);
    await fetch(`${url}/api/match/${id}/resume`, { method: 'POST' }); await new Promise((r) => setTimeout(r, 900)); expect(vtAt()).toBeGreaterThan(v2);
    const stop = await fetch(`${url}/api/match/${id}/stop`, { method: 'POST' }); expect(stop.status).toBe(200); await new Promise((r) => setTimeout(r, 200));
    const done = seen.find((m) => m.t === 'done'); expect(done && done.t === 'done' && done.summary.decidedBy).toBe('stopped'); ws.close(); await paced.close();
  });
});

describe('penalty kicks never spoil the result', () => {
  it('sends the kick without any outcome and the outcome only after the animation time', async () => {
    const s = Object.create(MatchSession.prototype) as unknown as { subs: Set<(m: ServerMsg) => void>; control: { paused: boolean; stopped: boolean }; events: unknown[]; thoughts: unknown[]; shootoutMsgs: unknown[]; playKick: (a: unknown, paced: boolean) => Promise<void> };
    s.subs = new Set(); s.control = { paused: false, stopped: false }; s.events = []; s.thoughts = []; s.shootoutMsgs = [];
    const log: { m: ServerMsg; at: number }[] = []; const t0 = Date.now(); s.subs.add((m) => log.push({ m, at: Date.now() - t0 }));
    const attempt = { index: 2, round: 1, team: 'B', suddenDeath: false, takerId: 'B5', keeperId: 'A1', shot: { side: 0.7, height: 0.2, power: 0.8, reason: 'low corner', usedFallback: false }, keeper: { dive: -1, reactDelay: 0.05, reason: 'guess', usedFallback: false }, result: 'goal', scoreAfter: [0, 1], woodwork: false, ballSpeed: 18, ballTarget: { z: 1, y: 0.3 }, frames: [{ t: 0, bx: 14, by: 0.1, bz: 0, kx: 19, kz: 0, tx: 11, tz: 0 }, { t: 0.4, bx: 16, by: 0.2, bz: 0.3, kx: 19, kz: 0.4, tx: 13, tz: 0 }] };
    const run = s.playKick(attempt, true); await new Promise((r) => setTimeout(r, 150));
    expect(log.map((x) => x.m.t)).toEqual(['penalty_kick']); // kick is out, result is not
    const kickJson = JSON.stringify(log[0].m); for (const secret of ['"result"', 'goal', 'saved', 'scoreAfter', 'ballTarget', 'woodwork']) expect(kickJson).not.toContain(secret);
    await run; const res = log.find((x) => x.m.t === 'penalty_result')!; expect(res.m).toMatchObject({ t: 'penalty_result', result: 'goal', score: [0, 1] }); expect(res.at).toBeGreaterThanOrEqual(1200); // 0.4 s of frames + 0.9 s hold
  });
});
