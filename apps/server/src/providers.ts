import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { LlmAgent, type FetchLike, type TeamAgent, type Transport } from '@futsal/sim';
import { CLAUDE_MODELS, DEFAULT_OPENROUTER_MODEL, type Effort, type ModelOption, type PlayerConfig, type ProviderStatus } from '@futsal/shared';
import { CliError, lastLines, runCli } from './runCli';

const STATUS_TIMEOUT_MS = 15_000;
const CLAUDE_TIMEOUT_MS = 180_000;
const CODEX_TIMEOUT_MS = 240_000;
/** Names of the CLI binaries (overridable so tests can point at a stand-in script). */
const bin = { claude: () => process.env.CLAUDE_BIN ?? 'claude', codex: () => process.env.CODEX_BIN ?? 'codex' };

// ------------------------------------------------------------------------------------------------ status (what the setup cards show)
async function claudeStatus(): Promise<ProviderStatus> {
  const base = { id: 'claude' as const, models: CLAUDE_MODELS, defaultModel: CLAUDE_MODELS[0].id };
  try {
    const { stdout } = await runCli({ command: bin.claude(), args: ['auth', 'status'], timeoutMs: STATUS_TIMEOUT_MS });
    const s = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string };
    if (s.loggedIn) return { ...base, ready: true, detail: `Signed in (${s.authMethod ?? 'account'})` };
    return { ...base, ready: false, detail: 'Not signed in', fixHint: 'Run `claude` in a terminal and log in' };
  } catch (e) {
    return { ...base, ready: false, detail: (e as Error).message, fixHint: 'Install Claude Code: npm i -g @anthropic-ai/claude-code' };
  }
}

interface CodexCacheEntry { slug?: string; display_name?: string; visibility?: string }
const codexHome = () => process.env.CODEX_HOME || path.join(homedir(), '.codex');

/** Reads the model list the codex CLI itself cached, so the picker matches what this account can run. */
async function codexModels(): Promise<{ models: ModelOption[]; configured: string | null }> {
  const [cacheText, configText] = await Promise.all([readFile(path.join(codexHome(), 'models_cache.json'), 'utf8').catch(() => ''), readFile(path.join(codexHome(), 'config.toml'), 'utf8').catch(() => '')]);
  const configured = /^model\s*=\s*"([^"]+)"/m.exec(configText)?.[1] ?? null;
  let entries: CodexCacheEntry[] = [];
  try { entries = (JSON.parse(cacheText) as { models?: CodexCacheEntry[] }).models ?? []; } catch { entries = []; }
  const models: ModelOption[] = entries.filter((e) => e.slug && e.visibility === 'list').map((e) => ({ id: e.slug!, label: e.display_name ?? e.slug! }));
  const def = models.find((m) => m.id === configured); if (def) def.hint = 'Your default';
  for (const m of models) { const bad = codexVerdict.get(m.id); if (bad && bad.status === 'unsupported') m.hint = 'Not available with your ChatGPT sign-in'; }
  return { models, configured: def && codexVerdict.get(def.id)?.status !== 'unsupported' ? def.id : null };
}

async function codexStatus(): Promise<ProviderStatus> {
  const { models, configured } = await codexModels();
  let defaultModel = configured ?? models[0]?.id ?? '';
  const base = { id: 'codex' as const, models, get defaultModel() { return defaultModel; } };
  try {
    const { stdout, stderr, exitCode } = await runCli({ command: bin.codex(), args: ['login', 'status'], timeoutMs: STATUS_TIMEOUT_MS });
    const line = `${stdout}\n${stderr}`.split('\n').find((l) => /logged in/i.test(l))?.trim();
    if (exitCode === 0 && line && !/not logged in/i.test(line) && models.length > 0 && !process.env.FUTSAL_SKIP_MODEL_PROBE) { // the CLI lists models this sign-in cannot run: settle on one that works
      const order = [...models.filter((x) => x.id === defaultModel), ...models.filter((x) => x.id !== defaultModel)].slice(0, 4); // probed together, so the first load costs one probe, not four
      const verdicts = await Promise.all(order.map((m) => probeCodexModel(m.id)));
      const first = order.find((_, i) => verdicts[i].status !== 'unsupported'); if (first) defaultModel = first.id;
      for (const m of models) if (codexVerdict.get(m.id)?.status === 'unsupported') m.hint = 'Not available with your ChatGPT sign-in';
    }
    if (exitCode === 0 && line && !/not logged in/i.test(line)) return { ...base, defaultModel, ready: models.length > 0, detail: models.length > 0 ? line : 'Signed in, but no model list was found', fixHint: models.length > 0 ? undefined : 'Run `codex` once so it can download its model list' };
    return { ...base, ready: false, detail: 'Not signed in', fixHint: 'Run `codex login` in a terminal' };
  } catch (e) {
    return { ...base, ready: false, detail: (e as Error).message, fixHint: 'Install Codex: npm i -g @openai/codex' };
  }
}

function openRouterStatus(): ProviderStatus {
  const has = Boolean(process.env.OPENROUTER_API_KEY);
  return { id: 'openrouter', ready: has, detail: has ? 'Using OPENROUTER_API_KEY from the server' : 'Needs an API key', models: [], defaultModel: DEFAULT_OPENROUTER_MODEL, fixHint: has ? undefined : 'Add your key in Settings' };
}
export async function getProviderStatuses(): Promise<ProviderStatus[]> { return Promise.all([claudeStatus(), codexStatus(), Promise.resolve(openRouterStatus())]); }

// ------------------------------------------------------------------------------------------------ transports (how a coach "thinks")
export class ProviderError extends Error { constructor(message: string) { super(message); } }

/** `claude -p`: the signed-in Claude subscription pays. No tools, no user settings, no MCP: each call is a pure text completion. */
export function claudeTransport(model: string, effort: Effort, signal: AbortSignal): Transport {
  return async (system, user) => {
    const args = ['-p', user, '--model', model, '--system-prompt', system, '--tools', '', '--output-format', 'json', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config'];
    if (effort !== 'default') args.push('--effort', effort);
    try {
      const { stdout, stderr, exitCode } = await runCli({ command: bin.claude(), args, timeoutMs: CLAUDE_TIMEOUT_MS, signal });
      let parsed: { is_error?: boolean; result?: string } | null = null; try { parsed = JSON.parse(stdout); } catch { parsed = null; }
      if (parsed?.is_error || exitCode !== 0) throw new ProviderError(`Claude Code error: ${parsed?.result || lastLines(stderr) || lastLines(stdout) || `exit code ${exitCode}`}`);
      return { text: parsed?.result ?? stdout };
    } catch (e) { throw e instanceof CliError ? new ProviderError(e.message) : e; }
  };
}

/** `codex exec`: the signed-in ChatGPT plan pays. Read-only sandbox in an empty temp folder; the final message is read from `-o`. */
export function codexTransport(model: string, effort: Effort, signal: AbortSignal): Transport {
  return async (system, user) => {
    const workDir = await mkdtemp(path.join(tmpdir(), 'ai-futsal-codex-')); const out = path.join(workDir, 'last-message.txt');
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only', '--color', 'never', '-C', workDir, '-o', out, '-m', model];
    if (effort !== 'default') args.push('-c', `model_reasoning_effort="${effort}"`);
    args.push(`${system}\n\n${user}`);
    try {
      const { stderr, exitCode } = await runCli({ command: bin.codex(), args, timeoutMs: CODEX_TIMEOUT_MS, signal });
      const reply = await readFile(out, 'utf8').catch(() => '');
      if (reply.trim()) return { text: reply };
      const err = stderr.split('\n').reverse().find((l: string) => l.startsWith('ERROR:'))?.replace(/^ERROR:\s*/, '');
      if (UNSUPPORTED_CODEX.test(stderr)) throw new ProviderError(`Codex cannot use "${model}" with your ChatGPT sign-in. Pick another Codex model.`);
      throw new ProviderError(`Codex returned no answer: ${err ?? (lastLines(stderr) || `exit code ${exitCode}`)}`);
    } catch (e) { throw e instanceof CliError ? new ProviderError(e.message) : e; } finally { await rm(workDir, { recursive: true, force: true }); }
  };
}

/** What the codex CLI said when asked to run a model once: the model list it caches can include models the signed-in plan cannot use. */
const codexVerdict = new Map<string, { status: 'ok' | 'unsupported'; message: string }>();
export const UNSUPPORTED_CODEX = /not supported when using codex|model_not_found/i;
export async function probeCodexModel(model: string, signal?: AbortSignal): Promise<{ status: 'ok' | 'unsupported' | 'unknown'; message: string }> {
  const known = codexVerdict.get(model); if (known) return known;
  const workDir = await mkdtemp(path.join(tmpdir(), 'ai-futsal-probe-')); const out = path.join(workDir, 'last-message.txt');
  try {
    const { stderr } = await runCli({ command: bin.codex(), args: ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only', '--color', 'never', '-C', workDir, '-o', out, '-m', model, 'Reply with the single word ok'], timeoutMs: 60_000, signal });
    if ((await readFile(out, 'utf8').catch(() => '')).trim()) { const v = { status: 'ok' as const, message: '' }; codexVerdict.set(model, v); return v; }
    if (UNSUPPORTED_CODEX.test(stderr)) { const v = { status: 'unsupported' as const, message: `Codex cannot use "${model}" with your ChatGPT sign-in. Pick another Codex model.` }; codexVerdict.set(model, v); return v; }
    return { status: 'unknown', message: lastLines(stderr) }; // network hiccup, odd CLI: do not block, do not remember
  } catch { return { status: 'unknown', message: '' }; } finally { await rm(workDir, { recursive: true, force: true }); }
}
/** Throws a clear error (shown before kick-off) when the CLI is known to refuse this model. */
export async function assertCodexModelUsable(model: string, signal?: AbortSignal) { const r = await probeCodexModel(model, signal); if (r.status === 'unsupported') throw new ProviderError(r.message); }

export interface BuiltCoach { architecture: string; agent?: TeamAgent }

/**
 * Turns a player card into the engine's team agent: always a model-backed LLM team agent with the matching transport. Decisions are infrequent (one call per tactical decision for
 * the whole team), so even a slow CLI never blocks the physics.
 */
export function buildCoach(player: PlayerConfig, o: { openRouterKey?: string; signal: AbortSignal; fetchImpl?: FetchLike }): BuiltCoach {
  const cadence = { cooldownVirtual: 180, intervalVirtual: 600 };
  if (player.provider === 'claude') return { architecture: 'llm', agent: new LlmAgent({ kind: 'custom', label: 'claude', model: player.model, apiKey: '', transport: claudeTransport(player.model, player.effort, o.signal), ...cadence }) };
  if (player.provider === 'codex') return { architecture: 'llm', agent: new LlmAgent({ kind: 'custom', label: 'codex', model: player.model, apiKey: '', transport: codexTransport(player.model, player.effort, o.signal), ...cadence }) };
  const key = o.openRouterKey || process.env.OPENROUTER_API_KEY;
  if (!key) throw new ProviderError('Add your OpenRouter API key in Settings');
  return { architecture: 'llm', agent: new LlmAgent({ kind: 'openrouter', label: 'openrouter', model: player.model, apiKey: key, timeoutMs: 60_000, retries: 1, cooldownVirtual: 120, intervalVirtual: 400, fetchImpl: o.fetchImpl }) };
}
