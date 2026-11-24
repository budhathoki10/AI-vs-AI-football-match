import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import type { TeamId } from '@futsal/shared';
import type { FetchLike, TeamAgent } from '@futsal/sim';
import { getOpenRouterModels } from './catalog';
import { assertCodexModelUsable, buildCoach, getProviderStatuses, ProviderError } from './providers';
import { startMatchInput, toMatchConfig } from './schemas';
import { MatchSession } from './session';

const MAX_LIVE_MATCHES = 3;
const KEEP_FINISHED_MS = 10 * 60_000;

class HttpError extends Error { constructor(readonly status: number, msg: string) { super(msg); } }

/**
 * A browser-sent Origin must be this server's own page. Starting a match can spend the user's Claude / ChatGPT / OpenRouter quota,
 * so another website open in the same browser must not be able to trigger one (JSON content-type forces a CORS preflight, the Origin check rejects the rest).
 */
export function isTrustedRequest(req: { headers: Record<string, string | string[] | undefined> }, needJson: boolean): boolean {
  if (needJson && !String(req.headers['content-type'] ?? '').startsWith('application/json')) return false;
  const origin = req.headers.origin; if (!origin) return true;
  try { const o = new URL(String(origin)); const fwd = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim(); return o.host === req.headers.host || (!!fwd && o.host === fwd); } catch { return false; }
}

export interface AppOptions { paced?: boolean; fetchImpl?: typeof fetch; /** HTTP client for OpenRouter completions (tests inject a fake) */ providerFetch?: FetchLike }

export async function buildApp(opts: AppOptions = {}): Promise<{ app: FastifyInstance; sessions: Map<string, MatchSession> }> {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 });
  await app.register(websocket, { options: { maxPayload: 1024 } });
  const sessions = new Map<string, MatchSession>();

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff').header('x-frame-options', 'DENY').header('referrer-policy', 'no-referrer').header('cache-control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD' && !isTrustedRequest(req, req.method === 'POST' && !!req.headers['content-length'] && req.headers['content-length'] !== '0')) return reply.code(403).send({ error: 'request rejected: not from this app' });
  });
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid input', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ProviderError) return reply.code(400).send({ error: err.message });
    const status = (err as { statusCode?: number })?.statusCode; if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    return reply.code(500).send({ error: 'internal error' }); // never leak stack traces
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/providers', async () => ({ providers: await getProviderStatuses() }));
  app.get('/api/openrouter/models', async (_req, reply) => {
    try { return { models: await getOpenRouterModels(opts.fetchImpl) }; } catch (e) { return reply.code(502).send({ models: [], error: `Could not load OpenRouter models: ${(e as Error).message}` }); }
  });

  app.post('/api/match', async (req, reply) => {
    const input = startMatchInput.parse(req.body);
    if ([...sessions.values()].filter((s) => s.live).length >= MAX_LIVE_MATCHES) throw new HttpError(429, 'Too many matches are running. Stop one first.');
    const abortHolder = new AbortController();
    for (const side of [input.home, input.away]) if (side.provider === 'codex') await assertCodexModelUsable(side.model, abortHolder.signal); // a clear message before kick-off instead of a match with a silent coach
    const coaches: Record<TeamId, ReturnType<typeof buildCoach>> = { A: buildCoach(input.home, { openRouterKey: input.openRouterKey, signal: abortHolder.signal, fetchImpl: opts.providerFetch }), B: buildCoach(input.away, { openRouterKey: input.openRouterKey, signal: abortHolder.signal, fetchImpl: opts.providerFetch }) };
    const cfg = toMatchConfig(input, { A: coaches.A.architecture, B: coaches.B.architecture });
    const agents: Partial<Record<TeamId, TeamAgent>> = {}; for (const t of ['A', 'B'] as const) if (coaches[t].agent) agents[t] = coaches[t].agent;
    const session = new MatchSession({ cfg, agents, names: input.names, paced: opts.paced ?? true, onClose: () => { setTimeout(() => sessions.delete(session.id), KEEP_FINISHED_MS).unref?.(); } });
    // killing the CLIs when the session stops: the coaches were built with abortHolder.signal, so tie it to the session
    session.abort.signal.addEventListener('abort', () => abortHolder.abort(), { once: true });
    sessions.set(session.id, session);
    return reply.code(202).send({ id: session.id });
  });

  const own = (req: FastifyRequest) => { const s = sessions.get(String((req.params as { id: string }).id)); if (!s) throw new HttpError(404, 'match not found'); return s; };
  app.post('/api/match/:id/pause', async (req) => { own(req).pause(true); return { ok: true }; });
  app.post('/api/match/:id/resume', async (req) => { own(req).pause(false); return { ok: true }; });
  app.post('/api/match/:id/stop', async (req) => { const s = own(req); s.stop(); await s.finished; return { ok: true }; });

  app.get('/ws/match/:id', { websocket: true }, (socket, req) => {
    if (!isTrustedRequest(req, false)) { socket.close(4403, 'bad origin'); return; }
    const s = sessions.get(String((req.params as { id: string }).id)); if (!s) { socket.send(JSON.stringify({ t: 'error', message: 'match not found' })); socket.close(1000); return; }
    const off = s.subscribe((m) => { if (socket.readyState === 1) socket.send(JSON.stringify(m)); });
    socket.on('close', off);
  });

  app.addHook('onClose', async () => { for (const s of sessions.values()) s.stop(); await Promise.all([...sessions.values()].map((s) => s.finished)); });
  return { app, sessions };
}
