/**
 * Definitions shared by the server and the browser. Pure data and types only (no physics, no Node APIs),
 * so the web bundle never has to import the simulation engine.
 */

// ---------------------------------------------------------------------------------------------------- players & providers
/** Each side is controlled by one provider: two use your subscriptions through their CLIs, one uses an OpenRouter key. There is no built-in tactical AI: a model decides everything. */
export const PROVIDER_IDS = ['claude', 'codex', 'openrouter'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const EFFORT_LEVELS = ['default', 'low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

/** 'A' kicks off on the left and plays in ivory ("Home"); 'B' plays in black ("Away"). */
export type TeamId = 'A' | 'B';
export const sideLabel = (t: TeamId) => (t === 'A' ? 'Home' : 'Away');
export const otherTeam = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');

export interface PlayerConfig { provider: ProviderId; model: string; effort: Effort }
export interface ModelOption { id: string; label: string; hint?: string }
export interface ProviderInfo { id: ProviderId; label: string; shortLabel: string; supportsEffort: boolean }

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  claude: { id: 'claude', label: 'Claude Code', shortLabel: 'Claude', supportsEffort: true },
  codex: { id: 'codex', label: 'Codex', shortLabel: 'Codex', supportsEffort: true },
  openrouter: { id: 'openrouter', label: 'OpenRouter', shortLabel: 'OpenRouter', supportsEffort: false },
};

export const CLAUDE_MODELS: ModelOption[] = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'Fastest' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'Balanced' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'Strongest' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2', hint: 'Needs usage credits' },
];

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
/** Model ids reach a CLI argv and an HTTP body, so only plain identifier characters are accepted. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@-]{1,120}$/;

export const DEFAULT_PLAYERS: Record<TeamId, PlayerConfig> = {
  A: { provider: 'claude', model: 'claude-sonnet-5-5', effort: 'default' },
  B: { provider: 'codex', model: '', effort: 'default' }, // filled with the Codex CLI's own default once it has been read
};

export const MATCH_MINUTES = [1, 2, 3, 4, 5, 6] as const;
export type MatchMinutes = (typeof MATCH_MINUTES)[number];

export interface ProviderStatus { id: ProviderId; ready: boolean; detail: string; models: ModelOption[]; defaultModel: string; fixHint?: string }

// ---------------------------------------------------------------------------------------------------- protocol
export interface StartMatchBody {
  home: PlayerConfig; away: PlayerConfig; minutes: MatchMinutes; seed?: number;
  /** display names, derived from the chosen models */
  names: Record<TeamId, string>;
  openRouterKey?: string;
}

export interface RosterEntry { id: string; number: number; name: string; role: string }
export interface MatchEventMsg { type: string; vt: number; half: 1 | 2; team?: TeamId; playerId?: string; assistId?: string; detail?: string; pos?: [number, number] }
export interface TeamStatsLite { goals: number; shots: number; onTarget: number; passes: number; passesOk: number; saves: number; fouls: number; corners: number; recoveries: number; possessionSeconds: number; xg: number }
export interface ThoughtMsg { t: 'thought'; team: TeamId; vt: number; trigger: string; accepted: boolean; strategy: string | null; summary: string; source: string; latencyMs: number; tokens: number; reason?: string }

export interface PenaltyFrame { t: number; bx: number; by: number; bz: number; kx: number; kz: number; tx: number; tz: number }
/** Sent when a kick starts. It deliberately carries NO result: the outcome is revealed by `penalty_result` once the animation has played. */
export interface PenaltyKickMsg {
  t: 'penalty_kick'; index: number; round: number; team: TeamId; suddenDeath: boolean; takerId: string; keeperId: string;
  shot: { reason: string; usedFallback: boolean }; keeper: { reason: string; usedFallback: boolean }; frames: PenaltyFrame[]; durationMs: number;
}
export type PenaltyOutcome = 'goal' | 'saved' | 'missed' | 'post';
export interface PenaltyResultMsg { t: 'penalty_result'; index: number; team: TeamId; result: PenaltyOutcome; score: [number, number] }

export interface PlayerSummary { id: string; team: TeamId; name: string; number: number; role: string; rating: number; goals: number; assists: number; shots: number; saves: number; passes: number; passesOk: number; tackles: number; distance: number }
export interface MatchSummary {
  regulation: [number, number]; winner: TeamId | null; decidedBy: 'regulation' | 'shootout' | 'draw' | 'stopped';
  shootout?: { score: [number, number]; winner: TeamId; decidedBy: string; rounds: number };
  teamStats: Record<TeamId, TeamStatsLite & { possessionPct: number; xg: number }>;
  players: PlayerSummary[];
  time: { selectedSeconds: number; actualSeconds: number; virtualSeconds: number };
}

/** Simulation internals for the debug overlay (not needed for play). */
export interface StateDebug {
  tick: number; dt: number; owner: string | null; ballSpeed: number;
  acts: Record<string, string>; speeds: Record<string, number>;
  options: Record<TeamId, { to: string; kind: string; risk: number; score: number }[]>;
  bumps: number; lastBump: { a: string; b: string; v: number } | null;
}

export type ServerMsg =
  | { t: 'hello'; matchId: string; status: string; roster: Record<TeamId, RosterEntry[]>; names: Record<TeamId, string>; minutes: number }
  | { t: 'state'; vt: number; half: 1 | 2; phase: string; play: string; restart: string | null; clockMode: string; score: [number, number]; rt: number; ball: [number, number, number]; players: [string, number, number, number, string, number][]; possession: [number, number]; /** who touched the ball last (the side "on the ball") */ holder: TeamId | null; /** player in control of the ball (null = loose or in flight) */ own: string | null; dbg?: StateDebug; stats: Record<TeamId, TeamStatsLite>; thinking: Record<TeamId, boolean>; dirs: [number, number] }
  | { t: 'event'; event: MatchEventMsg }
  | ThoughtMsg
  | { t: 'paused'; paused: boolean }
  | { t: 'full_time'; score: [number, number] }
  | { t: 'shootout_start'; score: [number, number] }
  | PenaltyKickMsg
  | PenaltyResultMsg
  | { t: 'done'; summary: MatchSummary }
  | { t: 'error'; message: string };

export const fmtClock = (vt: number) => { const s = Math.floor(vt); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
