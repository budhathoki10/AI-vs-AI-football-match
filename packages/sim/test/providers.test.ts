import { describe, it, expect } from 'vitest';
import { buildRequest, parseResponse, extractJson, callProvider, discoverModels, estimateCost, LlmAgent, makeTeam, defaultTactics, type FetchLike, type CompactState } from '../src';

const resp = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const base = { apiKey: 'sk-SECRET', model: 'm', system: 's', user: 'u' };

describe('provider abstraction', () => {
  it('builds provider-specific requests; the key travels in headers only', () => {
    for (const kind of ['openai', 'anthropic', 'gemini', 'deepseek', 'openrouter', 'custom'] as const) {
      const r = buildRequest({ ...base, kind, baseUrl: kind === 'custom' ? 'http://localhost:1234/v1/' : undefined });
      expect(r.url).not.toContain('sk-SECRET'); expect(JSON.stringify(r.body)).not.toContain('sk-SECRET'); expect(JSON.stringify(r.headers)).toContain('sk-SECRET');
    }
    expect(buildRequest({ ...base, kind: 'custom', baseUrl: 'http://x/v1/' }).url).toBe('http://x/v1/chat/completions');
    expect(buildRequest({ ...base, kind: 'anthropic' }).url).toContain('/messages');
    expect(buildRequest({ ...base, kind: 'gemini' }).url).toContain(':generateContent');
  });
  it('parses text and token usage for each wire format', () => {
    expect(parseResponse('openai', { choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } })).toEqual({ text: '{}', tokensIn: 5, tokensOut: 2 });
    expect(parseResponse('anthropic', { content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 7, output_tokens: 3 } })).toEqual({ text: 'x', tokensIn: 7, tokensOut: 3 });
    expect(parseResponse('gemini', { candidates: [{ content: { parts: [{ text: 'g' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 } })).toEqual({ text: 'g', tokensIn: 4, tokensOut: 1 });
  });
  it('extracts JSON from prose / fenced responses and rejects garbage', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }); expect(extractJson('Sure! {"a":2} bye')).toEqual({ a: 2 }); expect(() => extractJson('no json')).toThrow();
  });
  it('retries on 429/5xx, then succeeds; reports retry count; never leaks the key in errors', async () => {
    let n = 0; const f: FetchLike = async () => (++n < 2 ? (resp({}, 503) as any) : (resp({ choices: [{ message: { content: '{"ok":1}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) as any));
    const r = await callProvider({ ...base, kind: 'openai', retries: 2 }, f); expect(r.retries).toBe(1); expect(n).toBe(2);
    const bad: FetchLike = async () => resp({}, 401) as any;
    await expect(callProvider({ ...base, kind: 'openai' }, bad)).rejects.toThrow(/401/); await callProvider({ ...base, kind: 'openai' }, bad).catch((e) => expect(String(e.message)).not.toContain('SECRET'));
  });
  it('times out hanging providers', async () => {
    const hang: FetchLike = (_u, init) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))));
    await expect(callProvider({ ...base, kind: 'openai', timeoutMs: 30, retries: 0 }, hang)).rejects.toThrow(/timeout/);
  });
  it('discovers models; pricing is only known when the provider supplies it', async () => {
    const or = await discoverModels('openrouter', 'k', undefined, async () => resp({ data: [{ id: 'a/b', name: 'AB', context_length: 8000, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['response_format'] }] }) as any);
    expect(or[0]).toMatchObject({ id: 'a/b', contextWindow: 8000, inputPricePerM: 1, outputPricePerM: 2 });
    const oa = await discoverModels('openai', 'k', undefined, async () => resp({ data: [{ id: 'x' }] }) as any); expect(oa[0].inputPricePerM).toBeNull();
    expect(estimateCost(1000, 1000, oa[0])).toBeNull(); expect(estimateCost(1_000_000, 500_000, { inputPricePerM: 1, outputPricePerM: 2 })).toBe(2);
  });
  it('LlmAgent: returns tactics+meta, dedups duplicate in-flight requests, caches, and degrades to tactics=null on failure', async () => {
    const team = makeTeam('A', 'T', { seed: 1 }); let calls = 0;
    const tactics = { ...defaultTactics(team), reasonSummary: 'x' };
    const f: FetchLike = async () => { calls++; return resp({ choices: [{ message: { content: JSON.stringify(tactics) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) as any; };
    const ag = new LlmAgent({ kind: 'openai', apiKey: 'k', model: 'm', fetchImpl: f, price: { inputPricePerM: 1, outputPricePerM: 2 } });
    const st = { team: 'A', trigger: 'interval', minute: 10, scoreOwn: 0, scoreOpp: 0, possession: 'own', current: tactics, onCourt: [], bench: [], opponent: [] } as unknown as CompactState;
    const [a, b] = await Promise.all([ag.decide(st, team), ag.decide(st, team)]);
    expect(calls).toBe(1); expect(a.meta.tokensIn).toBe(100); expect(a.meta.costUsd).toBeCloseTo(0.00014, 8); expect(b).toBe(a);
    const c = await ag.decide(st, team); expect(calls).toBe(1); expect(c.meta.source).toContain('cache');
    const bad = new LlmAgent({ kind: 'openai', apiKey: 'k', model: 'm', retries: 0, fetchImpl: async () => resp({}, 500) as any });
    const d = await bad.decide(st, team); expect(d.tactics).toBeNull(); expect(d.meta.error).toBeTruthy();
  });
});
