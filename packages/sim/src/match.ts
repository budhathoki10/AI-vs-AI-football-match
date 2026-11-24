import { COURT, MATCH, PHYS } from './config';
import { AdaptiveClock, type ClockMode } from './clock';
import { PhysicsWorld, initPhysics } from './physics';
import { Rng } from './rng';
import { FORMATION_ANCHORS } from './formations';
import { defaultTactics, validateTactics } from './tactics';
import { xgOf } from './xg';
import { ballSpeedFor, ballTimeAt, dribbleValue, evaluatePasses, nearestOpp, reachTime, type PassOption, type PV } from './play';
import { HoldAgent, type CompactState, type DecisionMeta, type TeamAgent } from './agents';
import type { Attributes, EventType, Instruction, MatchConfig, MatchEvent, Phase, PlayerConfig, Snapshot, TeamConfig, TeamId, TeamTactics } from './types';

const { halfL, halfW, goalWidth, goalHeight } = COURT;
const OTHER = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const A01 = (v: number) => v / 100;
/** An agent answer older than this (real milliseconds) is discarded as stale; a goal or red card also invalidates pending answers. */
const STALE_RESPONSE_MS = 120_000;
const ADVANTAGE_SECONDS = 3; // physics seconds the referee waits before the advantage counts as played

export interface TeamStats {
  goals: number; shots: number; onTarget: number; offTarget: number; blocked: number; saves: number; passes: number; passesOk: number;
  dribbles: number; dribblesOk: number; tackles: number; interceptions: number; corners: number; kickIns: number; goalClearances: number;
  fouls: number; accumulatedFouls: number; yellow: number; red: number; distance: number; recoveries: number; possessionSeconds: number; xg: number;
  freeKicks: number; penalties: number;
}
export interface PlayerStats {
  goals: number; assists: number; shots: number; onTarget: number; passes: number; passesOk: number; tackles: number; interceptions: number;
  saves: number; fouls: number; distance: number; recoveries: number; yellow: number; red: number; secondsOnCourt: number; rating: number;
}
const newTS = (): TeamStats => ({ goals: 0, shots: 0, onTarget: 0, offTarget: 0, blocked: 0, saves: 0, passes: 0, passesOk: 0, dribbles: 0, dribblesOk: 0, tackles: 0, interceptions: 0, corners: 0, kickIns: 0, goalClearances: 0, fouls: 0, accumulatedFouls: 0, yellow: 0, red: 0, distance: 0, recoveries: 0, possessionSeconds: 0, xg: 0, freeKicks: 0, penalties: 0 });
const newPS = (): PlayerStats => ({ goals: 0, assists: 0, shots: 0, onTarget: 0, passes: 0, passesOk: 0, tackles: 0, interceptions: 0, saves: 0, fouls: 0, distance: 0, recoveries: 0, yellow: 0, red: 0, secondsOnCourt: 0, rating: 6 });

/** Transparent rating formula (documented in docs/SIMULATION_ENGINE.md). */
export function playerRating(s: PlayerStats): number {
  const r = 6 + 1.0 * s.goals + 0.6 * s.assists + 0.1 * s.onTarget + 0.03 * s.passesOk - 0.03 * (s.passes - s.passesOk) + 0.15 * s.tackles + 0.15 * s.interceptions + 0.3 * s.saves - 0.3 * s.fouls - 0.8 * s.yellow - 2.5 * s.red;
  return Math.round(clamp(r, 3, 10) * 10) / 10;
}

type PlanType = 'pass' | 'shoot' | 'dribble' | 'clear' | 'tackle';
interface Plan { type: PlanType; tx: number; tz: number; speed: number; lift: number; toId?: string; until: number; xg?: number }
interface RP {
  cfg: PlayerConfig; team: TeamId; idx: number; onCourt: boolean; stamina: number; heading: number;
  tx: number; tz: number; sf: number; plan: Plan | null; kickCd: number; touchCd: number; diveCd: number;
  yellow: number; red: boolean; instr: Instruction; state: string; act: string; actState: string; actUntil: number; tackleCd: number; lastTouchRt: number; diveDelay: number; diveTarget: number | null; diveBurst: number; gkHold: number;
}
interface TeamRT {
  id: TeamId; cfg: TeamConfig; players: RP[]; tactics: TeamTactics; dir: 1 | -1; agent: TeamAgent;
  fouls: number; chaser: string | null; second: string | null; passTarget: { id: string; until: number; tx: number; tz: number; eta: number } | null;
  lastDecisionVt: number; pending: { promise: Promise<void>; trigger: string } | null; trigger: string | null; version: number;
  queuedSubs: { out: string; in: string }[]; dismissedAt: number[]; flyingActive: boolean; plan: Map<string, { tx: number; tz: number; sf: number; act: string }>;
  cost: { calls: number; tokensIn: number; tokensOut: number; tokensCached: number; costUsd: number; latencyMs: number; retries: number; failures: number; unknownCost: boolean };
}
interface Restart {
  type: 'kickoff' | 'kick_in' | 'corner' | 'goal_clearance' | 'free_kick' | 'penalty_kick';
  team: TeamId; x: number; z: number; takerId: string; timer: number; minWait: number; indirect: boolean; noWall: boolean; readyAt: number | null; touches: Set<string>; kicked: boolean; /** unit vector of the intended pass, chosen before the kick so the taker can stand behind the ball */ aim?: [number, number];
  /** ids of the defenders forming the 5 m wall (direct/indirect free kicks in shooting range, unless the accumulated-foul rule removes it) */
  wall: string[]; wallPoint: [number, number] | null;
}
interface PendingFreeKick { atk: TeamId; x: number; z: number; noWall: boolean; accumulated: boolean }
interface Advantage extends PendingFreeKick { startRt: number; until: number
}
export interface ShotRec { dx?: number; id: number; playerId: string; team: TeamId; vt: number; rt: number; onTarget: boolean; xg: number; pos: [number, number]; target: number | null; resolved: boolean; outcome?: string; ghost?: boolean }
interface PassRec { from: string; to?: string; team: TeamId; rt: number }

export interface AiDecisionRecord {
  id: number; vt: number; team: TeamId; trigger: string; architecture: string; state: Pick<CompactState, 'minute' | 'scoreOwn' | 'scoreOpp' | 'possession' | 'avgStamina'>;
  tactics: TeamTactics | null; objective: string; accepted: boolean; rejectReason?: string; meta: DecisionMeta; outcome?: string; scoreDiffAtDecision: number;
}

/** Lets a caller pause or stop a running match; checked between physics steps. */
export interface RunControl { paused: boolean; stopped: boolean }

export interface MatchResult {
  regulationScore: [number, number]; winner: TeamId | null; decidedBy: 'regulation' | 'shootout' | 'draw';
  shootout?: import('./shootout').ShootoutResult;
  shootoutWinner?: TeamId | null;
}

export class Match {
  readonly cfg: MatchConfig;
  readonly rng: Rng;
  readonly phys: PhysicsWorld;
  readonly clock: AdaptiveClock;
  readonly teams: Record<TeamId, TeamRT>;
  readonly byId = new Map<string, RP>();
  events: MatchEvent[] = [];
  snapshots: Snapshot[] = [];
  decisions: AiDecisionRecord[] = [];
  shotLog: ShotRec[] = [];
  teamStats: Record<TeamId, TeamStats> = { A: newTS(), B: newTS() };
  playerStats = new Map<string, PlayerStats>();
  phase: Phase = 'pre';
  half: 1 | 2 = 1;
  score: [number, number] = [0, 0];
  rt = 0; tick = 0;
  play: 'restart' | 'live' | 'halftime' | 'over' = 'restart';
  restart: Restart | null = null;
  lastTouch: { pid: string; team: TeamId; rt: number } | null = null;
  prevTouch: { pid: string; team: TeamId; rt: number } | null = null;
  lastPass: PassRec | null = null;
  /** The player who controls the ball (it is at his feet and he is the only one who may carry it); null = the ball is loose or in flight. */
  owner: string | null = null;
  /** the most recent completed pass, used to stop pointless back-and-forth */
  recentPass: { from: string; to: string; t: number } | null = null;
  /** debugging: what each team's passer last considered, the physical bumps between players, and counters */
  lastOptions: Record<TeamId, PassOption[]> = { A: [], B: [] };
  bumps: { t: number; a: string; b: string; v: number }[] = []; bumpCount = 0;
  halftimeTimer = 0;
  private eventSeq = 0; private shotSeq = 0; private decSeq = 0;
  private foulCd = 0;
  private dribbleWatch: { pid: string; team: TeamId; rt: number }[] = [];
  private lastAssist: { pid: string; scorer: string; rt: number } | null = null;
  momentum: { vt: number; a: number; b: number }[] = [];
  /** successful passes per (passer>receiver) pair: the data behind the passing network */
  passPairs = new Map<string, number>();
  possessionTimeline: { vt: number; a: number; b: number }[] = [];
  private momentumAcc = { a: 0, b: 0 };
  /** whether non-active-play time is currently compressed more strongly */
  clockMode: ClockMode = 'inactive';
  pendingErrors: string[] = [];
  private waitScale = 1;
  /** seconds each team has kept possession in the opposing half without shooting (drives shot patience) */
  private attackClock: Record<TeamId, number> = { A: 0, B: 0 };
  shootout: import('./shootout').ShootoutResult | null = null;

  private constructor(cfg: MatchConfig, agents?: Partial<Record<TeamId, TeamAgent>>) {
    this.cfg = cfg; this.rng = new Rng(cfg.seed);
    if (!(MATCH.allowedRealDurationsMin as readonly number[]).includes(cfg.realDurationMinutes)) throw new Error('realDurationMinutes must be one of 1..6');
    this.phys = new PhysicsWorld();
    this.clock = new AdaptiveClock(cfg.realDurationMinutes * 60);
    // dead-time (restart waiting) shrinks with the real-time budget: clock/scheduling compression of non-play, physics is untouched
    this.waitScale = 0.25 + 0.75 * clamp((cfg.realDurationMinutes - 1) / 3, 0, 1);
    const mk = (tc: TeamConfig, dir: 1 | -1): TeamRT => ({
      id: tc.id, cfg: tc, dir, players: [], tactics: defaultTactics(tc), agent: agents?.[tc.id] ?? new HoldAgent(),
      fouls: 0, chaser: null, second: null, passTarget: null, lastDecisionVt: -1e9, pending: null, trigger: 'start', version: 0,
      queuedSubs: [], dismissedAt: [], flyingActive: false, plan: new Map(),
      cost: { calls: 0, tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0, latencyMs: 0, retries: 0, failures: 0, unknownCost: false },
    });
    const dA: 1 | -1 = cfg.swapSides ? -1 : 1;
    this.teams = { A: mk(cfg.teamA, dA), B: mk(cfg.teamB, (dA * -1) as 1 | -1) };
    for (const t of [this.teams.A, this.teams.B]) {
      if (t.cfg.players.length < 8) throw new Error(`team ${t.id} needs a squad of at least 8 (5 starters + 3 bench)`);
      if (t.cfg.players[0].role !== 'GK') throw new Error(`team ${t.id}: first player must be the goalkeeper`);
      t.cfg.players.forEach((pc, i) => {
        const rp: RP = { cfg: pc, team: t.id, idx: i, onCourt: i < 5, stamina: 1, heading: t.dir > 0 ? 0 : Math.PI, tx: 0, tz: 0, sf: 0, plan: null, kickCd: 0, touchCd: 0, diveCd: 0, yellow: 0, red: false, instr: 'hold_position', state: 'idle', act: 'idle', actState: 'idle', actUntil: 0, tackleCd: 0, lastTouchRt: -9, diveDelay: 0, diveTarget: null, diveBurst: 0, gkHold: 0 };
        t.players.push(rp); this.byId.set(pc.id, rp); this.playerStats.set(pc.id, newPS());
      });
    }
  }

  static async create(cfg: MatchConfig, agents?: Partial<Record<TeamId, TeamAgent>>): Promise<Match> {
    await initPhysics();
    const m = new Match(cfg, agents);
    m.setup();
    return m;
  }

  get vt() { return this.clock.vt; }
  private onCourt(t: TeamId) { return this.teams[t].players.filter((p) => p.onCourt); }
  private outfield(t: TeamId) { return this.onCourt(t).filter((p) => !this.isKeeper(p)); }
  private isKeeper(p: RP) { return p.cfg.role === 'GK' && !this.teams[p.team].flyingActive; }
  private gk(t: TeamId) { return this.onCourt(t).find((p) => p.cfg.role === 'GK') ?? null; }
  ownGoalX(t: TeamId) { return -this.teams[t].dir * halfL; }
  private toTeam(t: TeamId, x: number, z: number): [number, number] { const d = this.teams[t].dir; return [d * x, d * z]; }
  private toWorld(t: TeamId, u: number, v: number): [number, number] { const d = this.teams[t].dir; return [d * u, d * v]; }

  private setup() {
    this.phase = 'first_half';
    for (const t of [this.teams.A, this.teams.B]) {
      const outf = t.players.filter((p) => p.onCourt && p.cfg.role !== 'GK');
      outf.forEach((p, i) => { const [x, z] = this.toWorld(t.id, ...this.anchor(t, i, true)); this.phys.addPlayer(p.cfg.id, x, z); this.setStart(p, x, z); });
      const g = t.players[0]; const [gx, gz] = this.toWorld(t.id, -halfL + 1.2, 0); this.phys.addPlayer(g.cfg.id, gx, gz, true); this.setStart(g, gx, gz);
    }
    this.startRestart('kickoff', this.cfg.swapSides ? 'B' : 'A', 0, 0, 2);
    this.push('kickoff', { team: this.restart!.team });
    this.runAgents('kickoff', true);
  }
  private setStart(p: RP, x: number, z: number) { p.tx = x; p.tz = z; }

  // ---------------------------------------------------------------- events & stats
  private push(type: EventType, o: Partial<MatchEvent> = {}): MatchEvent {
    const e: MatchEvent = { id: ++this.eventSeq, type, vt: Math.round(this.vt * 10) / 10, half: this.half, ...o };
    this.events.push(e); return e;
  }
  private ps(pid: string) { return this.playerStats.get(pid)!; }

  // ---------------------------------------------------------------- derived attribute helpers
  private maxSpeed(p: RP) { const a = p.cfg.attributes; return (4.6 + 2.6 * A01(a.maxSpeed)) * (0.72 + 0.28 * p.stamina); }
  private accelMax(p: RP) { const a = p.cfg.attributes; return (3.6 + 3.6 * A01(a.acceleration)) * (0.8 + 0.2 * p.stamina); }
  private staminaFactor(p: RP) { return 0.75 + 0.25 * p.stamina; }
  private pstate(p: RP) { return this.phys.playerState(p.cfg.id); }

  // ---------------------------------------------------------------- formation / positions
  private anchor(t: TeamRT, slot: number, kickoff = false): [number, number] {
    const a = FORMATION_ANCHORS[t.tactics.formation];
    const [u, v] = a[slot % a.length];
    return kickoff ? [Math.min(u, -1.5), v] : [u, v];
  }
  private slotOf(t: TeamRT, p: RP): number { return this.outfield(t.id).indexOf(p); }

  private roleTarget(t: TeamRT, p: RP, attacking: boolean): [number, number] {
    const ball = this.phys.ballState(); const [bu, bv] = this.toTeam(t.id, ball.x, ball.z);
    const slot = Math.max(0, this.slotOf(t, p));
    let [u, v] = this.anchor(t, slot);
    const tac = t.tactics; const press = tac.pressingIntensity, risk = tac.riskLevel;
    u += clamp(bu * 0.35, -6, 9); v += clamp(bv * 0.25, -4, 4);
    if (attacking) u += 2 + 3 * risk + (tac.teamStrategy === 'all_out_attack' ? 3 : 0);
    else u -= 1.5 + 4 * (1 - press) + (tac.teamStrategy === 'park_the_bus' ? 3 : 0);
    if (tac.attackingStyle === 'wing_play' && attacking) v = Math.sign(v || 1) * Math.max(Math.abs(v), 6.5);
    switch (p.instr) {
      case 'support_build_up': u = u * 0.7 + bu * 0.3; v = v * 0.7 + bv * 0.3; break;
      case 'protect_central_area': v *= 0.3; u -= 1.5; break;
      case 'stay_wide': v = Math.sign(v || 1) * 8; break;
      case 'press_high': u += 4; break;
      case 'drop_deep': u -= 4; break;
      case 'make_forward_run': u = Math.max(u, bu + 6); break;
      case 'pivot_hold_up': u = Math.max(u, 7); v *= 0.2; break;
      case 'mark_nearest': {
        const opp = this.outfield(OTHER(t.id)); let best: RP | null = null, bd = 1e9;
        for (const o of opp) { const s = this.pstate(o); const [ou, ov] = this.toTeam(t.id, s.x, s.z); const d = dist(ou, ov, u, v); if (d < bd) { bd = d; best = o; } }
        if (best) { const s = this.pstate(best); const [ou, ov] = this.toTeam(t.id, s.x, s.z); u = ou - 1.2; v = ov * 0.9; }
        break;
      }
      default: break;
    }
    return [clamp(u, -18.5, 18.5), clamp(v, -9, 9)];
  }

  // ---------------------------------------------------------------- restarts
  private startRestart(type: Restart['type'], team: TeamId, x: number, z: number, minWait = 1.6, indirect = false, noWall = false) {
    this.performSubs(team); this.performSubs(OTHER(team));
    minWait *= this.waitScale;
    this.play = 'restart'; this.owner = null;
    // rules engine places the dead ball at the restart mark (no player is teleported)
    this.phys.placeBall(x, PHYS.ballRadius + 0.002, z);
    let taker: RP | null = null; let bd = 1e9;
    const pool = type === 'goal_clearance' ? [this.gk(team)!].filter(Boolean) : type === 'kickoff' ? this.outfield(team) : this.onCourt(team).filter((p) => !this.isKeeper(p));
    for (const p of pool) { const s = this.pstate(p); const d = dist(s.x, s.z, x, z) + (p.cfg.attributes.passing < 40 ? 4 : 0); if (d < bd) { bd = d; taker = p; } }
    if (type === 'penalty_kick' || (type === 'free_kick' && noWall)) { // best shooter takes it
      const best = pool.slice().sort((a, b) => b.cfg.attributes.shooting - a.cfg.attributes.shooting)[0]; if (best) taker = best;
    }
    taker ??= this.onCourt(team)[0];
    this.restart = { type, team, x, z, takerId: taker.cfg.id, timer: 0, minWait, indirect, noWall, readyAt: null, touches: new Set(), kicked: false, wall: [], wallPoint: null };
    if (type === 'free_kick' && !noWall) this.buildWall(this.restart);
    this.lastPass = null; this.dribbleWatch = [];
    for (const t of [this.teams.A, this.teams.B]) { t.passTarget = null; for (const p of t.players) p.plan = null; }
  }

  /** Wall of two defenders, 5 m (rule: >= 5 m) from the ball on the line to the goal; they walk there like everyone else. */
  private buildWall(r: Restart) {
    const goalX = this.teams[r.team].dir * halfL; const d = dist(r.x, r.z, goalX, 0);
    if (d > 22 || d < 5.5) return;
    const ux = (goalX - r.x) / d, uz = (0 - r.z) / d; const wx = r.x + ux * 5.2, wz = r.z + uz * 5.2;
    const opp = this.outfield(OTHER(r.team)).slice().sort((a, b) => dist(this.pstate(a).x, this.pstate(a).z, wx, wz) - dist(this.pstate(b).x, this.pstate(b).z, wx, wz)).slice(0, 2);
    r.wall = opp.map((p) => p.cfg.id); r.wallPoint = [wx, wz];
    // the wall always forms a line perpendicular to the shot line; remember its orientation through the ball->goal vector
    (r as Restart & { ux?: number; uz?: number }).ux = ux; (r as Restart & { ux?: number; uz?: number }).uz = uz;
  }

  private restartTargetFor(p: RP): [number, number, number] {
    const r = this.restart!; const t = this.teams[p.team];
    if (r.wallPoint && r.wall.includes(p.cfg.id)) {
      const o = r as Restart & { ux: number; uz: number }; const i = r.wall.indexOf(p.cfg.id) === 0 ? -1 : 1;
      return [clamp(r.wallPoint[0] - o.uz * 0.46 * i, -halfL + 0.8, halfL - 0.8), clamp(r.wallPoint[1] + o.ux * 0.46 * i, -halfW + 0.8, halfW - 0.8), 0.9];
    }
    const lb = this.phys.ballState(); const ball = { x: lb.x, z: lb.z };
    if (p.cfg.id === r.takerId) {
      const dirX = this.teams[r.team].dir;
      // approach from behind the ball relative to the opponent goal; clearances/corners from the field side
      let ox = -dirX * 0.45, oz = 0; // the taker's centre must sit outside player radius + ball radius (0.4 m) or he shoves the ball while waiting
      if (r.aim && r.type !== 'penalty_kick' && dist(ball.x, ball.z, r.x, r.z) < 1.2) { // behind the ball, opposite the intended pass: nothing of him is in the way
        const me = this.pstate(p); const rx = me.x - ball.x, rz = me.z - ball.z; const along = rx * r.aim[0] + rz * r.aim[1];
        if (along > -0.25 && Math.hypot(rx, rz) < 4) { // he is level with or beyond the ball: go round it (never through it, that would push it away)
          const px = -r.aim[1], pz = r.aim[0]; const sgn = rx * px + rz * pz >= 0 ? 1 : -1;
          return [ball.x + px * sgn * 1.1 - r.aim[0] * 0.7, ball.z + pz * sgn * 1.1 - r.aim[1] * 0.7, 1];
        }
        return [ball.x - r.aim[0] * 0.45, ball.z - r.aim[1] * 0.45, 1];
      }
      if (r.type === 'kick_in') { ox = 0; oz = -Math.sign(r.z) * 0.45; } // pitch side of the ball: walking in from the pitch must not push it over the line
      if (r.type === 'corner') { ox = -Math.sign(r.x) * 0.32; oz = -Math.sign(r.z) * 0.32; }
      if (r.type === 'goal_clearance') { ox = -dirX * 0.45; }
      return [ball.x + ox, ball.z + oz, 1];
    }
    if (this.isKeeper(p)) {
      const gx = this.ownGoalX(p.team);
      if (r.type === 'penalty_kick' && r.team !== p.team) return [gx - Math.sign(gx) * -0.4 + 0, 0, 0.7];
      return [gx + (gx > 0 ? -1.2 : 1.2), clamp(r.z * 0.12, -1.2, 1.2), 0.7];
    }
    const attackingSide = r.team === p.team;
    const [u, v] = this.roleTarget(t, p, attackingSide);
    let [x, z] = this.toWorld(p.team, u, v);
    if (attackingSide && r.type !== 'kickoff') { // support the taker within 5–9m
      const ang = (p.idx * 2.1) + 0.6; x = clamp(r.x + Math.cos(ang) * 6 * -this.teams[r.team].dir * -1, -halfL + 2, halfL - 2); z = clamp(r.z - Math.sign(r.z || 1) * (3 + (p.idx % 3) * 3), -halfW + 1, halfW - 1);
    }
    if (r.type === 'kickoff') { const [uu, vv] = this.toTeam(p.team, x, z); const cap = attackingSide ? -1.5 : -3.8; [x, z] = this.toWorld(p.team, Math.min(uu, cap), vv); }
    if (r.type === 'penalty_kick') {
      const gx = r.x > 0 ? halfL : -halfL; // area around the goal being attacked
      const away = dist(x, z, gx, 0);
      if (away < 7.5) { const k = 7.5 / Math.max(away, 0.1); x = gx + (x - gx) * k; z = z * k; }
      if (Math.abs(x) > halfL - 1) x = Math.sign(x) * (halfL - 8);
      // keep behind the ball line (not between ball and goal)
      if (gx > 0 ? x > r.x : x < r.x) x = r.x - Math.sign(gx) * 2;
    } else if (!attackingSide) {
      const d = dist(x, z, r.x, r.z); // 5 m clearance for the defending side
      if (d < 5.2) { const k = 5.2 / Math.max(d, 0.1); x = r.x + (x - r.x) * k; z = r.z + (z - r.z) * k; }
    }
    return [clamp(x, -halfL + 0.8, halfL - 0.8), clamp(z, -halfW + 0.8, halfW - 0.8), 0.8];
  }

  private performRestartKick() {
    const r = this.restart!; const p = this.byId.get(r.takerId)!; const t = this.teams[p.team];
    const s = this.pstate(p); const oppGoalX = t.dir * halfL;
    r.minWait = 0;
    switch (r.type) {
      case 'penalty_kick': this.planShot(p, true); break;
      case 'free_kick': {
        const d = dist(r.x, r.z, oppGoalX, 0);
        if (d < 13 && !r.indirect) this.planShot(p, true); else this.planBestPass(p, true) || this.planClear(p);
        break;
      }
      case 'corner': { // cross towards the penalty spot area
        const mate = this.outfield(p.team).filter((m) => m !== p).sort((a, b) => dist(this.pstate(a).x, this.pstate(a).z, oppGoalX - Math.sign(oppGoalX) * 6, 0) - dist(this.pstate(b).x, this.pstate(b).z, oppGoalX - Math.sign(oppGoalX) * 6, 0))[0];
        if (mate) { const ms = this.pstate(mate); p.plan = { type: 'pass', tx: ms.x, tz: ms.z, speed: 10, lift: 1.5, toId: mate.cfg.id, until: this.rt + 1 }; t.passTarget = { id: mate.cfg.id, until: this.rt + 2.5, tx: ms.x, tz: ms.z, eta: this.rt + 1 }; }
        else this.planClear(p);
        break;
      }
      case 'goal_clearance': this.planBestPass(p, true) || this.planClear(p); break;
      case 'kick_in': this.planBestPass(p, true) || this.planClear(p); break;
      case 'kickoff': this.planBestPass(p, true, true) || this.planClear(p); break;
    }
    void s;
    this.tryExecutePlan(p, true);
  }

  // ---------------------------------------------------------------- kicking
  private kickTo(p: RP, tx: number, tz: number, speed: number, lift: number, kind: 'pass' | 'shoot' | 'clear' | 'touch', errScale = 1): boolean {
    const b = this.phys.ballState(); const s = this.pstate(p);
    const a = p.cfg.attributes; const sf = this.staminaFactor(p);
    const acc = kind === 'shoot' ? A01(a.shooting) : kind === 'pass' ? A01(a.passing) : A01(a.ballControl);
    const sigma = ((1 - acc * sf) * (kind === 'shoot' ? 0.055 : kind === 'pass' ? 0.075 : 0.11) + 0.01) * errScale;
    let ang = Math.atan2(tz - b.z, tx - b.x) + this.rng.gauss() * sigma;
    const sp = Math.min(speed, kind === 'shoot' ? 14 + 16 * A01(a.shooting) * sf : 8 + 10 * (0.5 + 0.5 * A01(a.passing)) + (kind === 'clear' ? 4 : 0));
    const vy = kind === 'pass' ? 0 : lift + this.rng.gauss() * sigma * 2;
    // a dead-ball kick is struck by the foot, so the ball starts just beyond the taker's body in the kick direction (otherwise it is driven into his own legs)
    if (this.restart && this.restart.takerId === p.cfg.id && Math.hypot(b.vx, b.vz) < 0.3 && dist(s.x, s.z, b.x, b.z) < 0.64) this.nudgeBall(s.x + Math.cos(ang) * 0.66, s.z + Math.sin(ang) * 0.66);
    else if (!this.isKeeper(p) && dist(s.x, s.z, b.x, b.z) < 0.64 && (b.x - s.x) * Math.cos(ang) + (b.z - s.z) * Math.sin(ang) < 0) this.nudgeBall(s.x + Math.cos(ang) * 0.5, s.z + Math.sin(ang) * 0.5); // kicking back across his own body: the foot swings round the ball
    const b2 = this.phys.ballState();
    const dvx = Math.cos(ang) * sp - b2.vx, dvz = Math.sin(ang) * sp - b2.vz;
    this.phys.kickBall(dvx, Math.max(0, vy), dvz);
    p.kickCd = 0.35; p.touchCd = 0.3; p.heading = ang; this.setAct(p, kind === 'shoot' ? 'shoot' : kind === 'pass' ? 'pass' : 'kick', 0.4); this.owner = null;
    if (this.restart && this.restart.takerId === p.cfg.id) this.restart.kicked = true;
    this.registerTouch(p, true);
    void s; ang = 0;
    return true;
  }

  /** The foot swings round the ball at the instant of a kick: move the (stationary or slow) ball at most 0.45 m towards the clear spot, never further. */
  private nudgeBall(x: number, z: number) {
    const b = this.phys.ballState(); const dx = x - b.x, dz = z - b.z, L = Math.hypot(dx, dz); if (L < 1e-6) return; const k = Math.min(1, 0.45 / L);
    this.phys.placeBall(b.x + dx * k, b.y, b.z + dz * k);
  }

  private tryExecutePlan(p: RP, force = false) {
    const plan = p.plan; if (!plan) return;
    if (this.rt > plan.until && !force) { p.plan = null; return; }
    const b = this.phys.ballState(); const s = this.pstate(p);
    const reach = PHYS.kickReach + (this.isKeeper(p) ? 0.35 : 0);
    if (dist(s.x, s.z, b.x, b.z) > reach || b.y > 1.1 || (p.kickCd > 0 && !force)) return;
    switch (plan.type) {
      case 'shoot': {
        const lift = plan.lift;
        this.recordShot(p, plan);
        this.kickTo(p, plan.tx, plan.tz, plan.speed, lift, 'shoot');
        break;
      }
      case 'pass': {
        const d = dist(b.x, b.z, plan.tx, plan.tz);
        const sp = clamp(4.2 + 0.62 * d, 5.5, 15);
        this.lastPass = { from: p.cfg.id, to: plan.toId, team: p.team, rt: this.rt };
        this.teamStats[p.team].passes++; this.ps(p.cfg.id).passes++;
        this.kickTo(p, plan.tx, plan.tz, plan.speed > 0 ? plan.speed : sp, plan.lift, 'pass');
        break;
      }
      case 'clear': this.kickTo(p, plan.tx, plan.tz, plan.speed, plan.lift, 'clear', 1.4); break;
      case 'dribble': {
        if (p.touchCd > 0) return;
        const dirx = plan.tx - s.x, dirz = plan.tz - s.z, n = Math.hypot(dirx, dirz) || 1;
        const sp = Math.hypot(s.vx, s.vz) + 1.6 + 1.4 * A01(p.cfg.attributes.dribbling);
        const ca = A01(p.cfg.attributes.ballControl);
        const ang = Math.atan2(dirz, dirx) + this.rng.gauss() * (1 - ca) * 0.15;
        this.phys.kickBall(Math.cos(ang) * sp - b.vx, 0, Math.sin(ang) * sp - b.vz);
        p.touchCd = 0.24; p.heading = ang; this.registerTouch(p, false); this.owner = p.cfg.id; this.setAct(p, 'dribble', 0.3); void n; return;
      }
      case 'tackle': {
        if (p.touchCd > 0) return;
        const carrier = this.lastTouch && this.byId.get(this.lastTouch.pid);
        const cr = carrier && carrier.team !== p.team && this.rt - this.lastTouch!.rt < 0.6 ? carrier : null;
        const win = cr ? 0.28 + 0.5 * (A01(p.cfg.attributes.tackling) - A01(cr.cfg.attributes.ballControl) * 0.6) : 1;
        p.touchCd = 0.5;
        if (this.rng.next() < win) {
          const [ou, ov] = this.toTeam(p.team, b.x, b.z); void ou; void ov;
          const t = this.teams[p.team]; const mates = this.outfield(p.team).filter((m) => m !== p);
          const m = mates.sort((a1, a2) => dist(this.pstate(a1).x, this.pstate(a1).z, s.x, s.z) - dist(this.pstate(a2).x, this.pstate(a2).z, s.x, s.z))[0];
          const tgt = m ? this.pstate(m) : { x: t.dir * halfL, z: 0 };
          if (cr) { this.markTackle = { pid: p.cfg.id }; }
          this.kickTo(p, tgt.x, tgt.z, 7, 0, 'touch');
        }
        break;
      }
    }
    p.plan = null;
  }
  markTackle: { pid: string } | null = null;

  private recordShot(p: RP, plan: Plan) {
    const b = this.phys.ballState(); const t = this.teams[p.team];
    const goalX = t.dir * halfL;
    const xg = xgOf(Math.abs(goalX - b.x), b.z, goalWidth); // logistic model fitted on simulated shots (src/xg.ts)
    const rec: ShotRec = { id: ++this.shotSeq, playerId: p.cfg.id, team: p.team, vt: this.vt, rt: this.rt, onTarget: false, xg, pos: [b.x, b.z], target: plan.tz, resolved: false, dx: Math.abs(goalX - b.x) };
    this.shotLog.push(rec);
    this.teamStats[p.team].shots++; this.ps(p.cfg.id).shots++; this.teamStats[p.team].xg += xg;
    this.push('shot', { team: p.team, playerId: p.cfg.id, pos: [b.x, b.z], detail: `xg=${xg.toFixed(2)}` });
  }
  /** after kick velocity is known, classify on-target by projecting the ball onto the goal line (called next step) */
  private classifyShot(rec: ShotRec) {
    const b = this.phys.ballState(); const t = this.teams[rec.team]; const gx = t.dir * halfL;
    const vx = b.vx * t.dir; if (vx <= 0.5) { rec.onTarget = false; return; }
    const tt = (gx - b.x) / b.vx; if (tt <= 0) { rec.onTarget = false; return; }
    const zc = b.z + b.vz * tt, yc = b.y + b.vy * tt - 0.5 * 9.81 * tt * tt;
    rec.onTarget = Math.abs(zc) < goalWidth / 2 + 0.05 && yc < goalHeight + 0.05 && yc > -0.2;
    if (rec.onTarget) { this.teamStats[rec.team].onTarget++; this.ps(rec.playerId).onTarget++; }
    else this.teamStats[rec.team].offTarget++;
  }

  private registerTouch(p: RP, intentional: boolean) {
    const prev = this.lastTouch;
    const nowT = this.rt;
    p.lastTouchRt = nowT;
    if (this.restart) this.restart.touches.add(p.cfg.id);
    if (!prev || prev.pid !== p.cfg.id) {
      // pass resolution
      if (this.lastPass && prev && prev.pid === this.lastPass.from && nowT - this.lastPass.rt < 6) {
        const lp = this.lastPass;
        if (p.team === lp.team) { this.teamStats[lp.team].passesOk++; this.ps(lp.from).passesOk++; const key = `${lp.from}>${p.cfg.id}`; this.passPairs.set(key, (this.passPairs.get(key) ?? 0) + 1); this.lastAssist = { pid: lp.from, scorer: p.cfg.id, rt: nowT }; if (lp.from !== p.cfg.id) this.recentPass = { from: lp.from, to: p.cfg.id, t: nowT }; }
        else if (nowT - lp.rt < 3) { this.teamStats[p.team].interceptions++; this.ps(p.cfg.id).interceptions++; }
        this.lastPass = null;
      }
      if (prev && prev.team !== p.team) {
        this.teamStats[p.team].recoveries++; this.ps(p.cfg.id).recoveries++;
        if (this.markTackle?.pid === p.cfg.id) { this.teamStats[p.team].tackles++; this.ps(p.cfg.id).tackles++; this.markTackle = null; }
        this.momentumAcc[p.team === 'A' ? 'a' : 'b'] += 0.3;
      }
      this.prevTouch = prev;
    }
    this.lastTouch = { pid: p.cfg.id, team: p.team, rt: nowT };
    void intentional;
  }

  // ---------------------------------------------------------------- behaviour
  /** The team with the ball: the owner's, or (while it is loose or in flight) the side that touched it last. */
  private possessionTeam(): TeamId | null {
    if (this.owner) return this.byId.get(this.owner)?.team ?? null;
    return this.lastTouch ? this.lastTouch.team : null;
  }

  private pv(p: RP): PV {
    const s = this.pstate(p); const a = p.cfg.attributes;
    return { id: p.cfg.id, x: s.x, z: s.z, vx: s.vx, vz: s.vz, maxSpeed: this.maxSpeed(p), role: p.cfg.role, gk: this.isKeeper(p), control: A01(a.ballControl) };
  }
  private setAct(p: RP, name: string, seconds: number) { p.actState = name; p.actUntil = this.rt + seconds; }

  // ---------------------------------------------------------------- team plan (who presses, covers, marks, supports)
  private updateTeamContext() {
    const b = this.phys.ballState(); const ownerP = this.owner ? this.byId.get(this.owner) ?? null : null;
    for (const t of [this.teams.A, this.teams.B]) {
      // the chaser is whoever can reach the ball (or the opposing carrier) first; while OUR pass is in flight only the receiver moves for it
      const passInFlight = !!t.passTarget && t.passTarget.until > this.rt && this.possessionTeam() === t.id && !ownerP;
      const ref = ownerP && ownerP.team !== t.id ? this.pstate(ownerP) : { x: b.x + b.vx * 0.25, z: b.z + b.vz * 0.25, vx: b.vx, vz: b.vz };
      const cands = this.outfield(t.id).filter((p) => p !== ownerP).map((p) => ({ p, tt: reachTime(this.pv(p), ref.x, ref.z, 0.4) })).sort((a, c) => a.tt - c.tt);
      t.chaser = passInFlight ? null : cands[0]?.p.cfg.id ?? null; t.second = passInFlight ? null : cands[1]?.p.cfg.id ?? null;
      this.planTeam(t, ownerP);
    }
  }

  private planTeam(t: TeamRT, ownerP: RP | null) {
    t.plan.clear(); if (this.play !== 'live') return;
    const b = this.phys.ballState(); const attacking = this.possessionTeam() === t.id; const outf = this.outfield(t.id);
    const ref = ownerP ? this.pstate(ownerP) : { x: b.x, z: b.z, vx: b.vx, vz: b.vz }; const [ru, rv] = this.toTeam(t.id, ref.x, ref.z);
    const carrierId = ownerP && ownerP.team === t.id ? ownerP.cfg.id : null; const rcvId = t.passTarget && t.passTarget.until > this.rt ? t.passTarget.id : null;
    const opp = this.outfield(OTHER(t.id)); const ownGoalU = -halfL; const tac = t.tactics;
    const put = (p: RP, u: number, v: number, sf: number, act: string) => { const [x, z] = this.toWorld(t.id, clamp(u, -halfL + 1.2, halfL - 1.2), clamp(v, -halfW + 1, halfW - 1)); t.plan.set(p.cfg.id, { tx: x, tz: z, sf, act }); };
    const dTo = (p: RP, x: number, z: number) => { const s = this.pstate(p); return dist(s.x, s.z, x, z); };

    if (attacking) {
      // --- support: give the carrier real options. Pivot high and central, wingers wide, the rest a diagonal option behind the ball.
      const slots: { p: RP; u: number; v: number; act: string }[] = [];
      for (const p of outf) {
        if (p.cfg.id === carrierId || p.cfg.id === rcvId) continue;
        const slot = Math.max(0, this.slotOf(t, p)); const [anchU, anchV] = this.anchor(t, slot); const [bu, bv] = this.roleTarget(t, p, true);
        const side = Math.abs(anchV) > 1 ? Math.sign(anchV) : -Math.sign(rv || 1); let du: number, dv: number, act = 'support';
        if (p.cfg.role === 'PIVOT') { du = clamp(Math.max(ru + 3.5, 7), -2, 15); dv = clamp(-Math.sign(rv || 1) * 2.4, -3.2, 3.2); act = 'pivot'; }
        else if (p.cfg.role === 'ALA') { du = clamp(ru + 1.8, -4, 14); dv = side * 6.4; act = 'width'; }
        else { du = clamp(ru - 3.0, -14, 10); dv = clamp(-rv * 0.4 + side * 3.2, -6.5, 6.5); }
        let u = 0.35 * bu + 0.65 * du, v = 0.35 * bv + 0.65 * dv;
        if (p.instr === 'make_forward_run') { u = Math.max(u, ru + 6); act = 'run'; } else if (p.instr === 'stay_wide') v = side * Math.max(Math.abs(v), 7); else if (p.instr === 'drop_deep') u -= 3;
        void anchU; slots.push({ p, u, v, act });
      }
      // keep the supporters apart from each other and from the carrier (3.4 m) — no crowding
      for (let it = 0; it < 3; it++) for (let i = 0; i < slots.length; i++) {
        const a = slots[i]; let dx = a.u - ru, dz = a.v - rv; let d = Math.hypot(dx, dz); if (d < 3.4) { if (d < 0.01) { dx = 1; dz = 0; d = 1; } a.u += (dx / d) * (3.4 - d); a.v += (dz / d) * (3.4 - d); }
        for (let j = i + 1; j < slots.length; j++) { const c = slots[j]; dx = c.u - a.u; dz = c.v - a.v; d = Math.hypot(dx, dz); if (d < 3.4) { if (d < 0.01) { dx = 0; dz = 1; d = 1; } const k = (3.4 - d) / 2; a.u -= (dx / d) * k; a.v -= (dz / d) * k; c.u += (dx / d) * k; c.v += (dz / d) * k; } }
      }
      for (const sl of slots) {
        // do not hide behind a defender: if one stands in the passing lane, slide sideways out of his shadow
        const [tx, tz] = this.toWorld(t.id, sl.u, sl.v);
        for (const o of opp) { const os = this.pstate(o); const lx = tx - ref.x, lz = tz - ref.z; const L2 = lx * lx + lz * lz || 1; const k = ((os.x - ref.x) * lx + (os.z - ref.z) * lz) / L2; if (k > 0.1 && k < 0.95) { const px = ref.x + lx * k, pz = ref.z + lz * k; const d = dist(os.x, os.z, px, pz); if (d < 1.1) { const sgn = (os.z - pz) * (lx) - (os.x - px) * (lz) >= 0 ? -1 : 1; sl.v += sgn * (1.3 - d) * Math.sign(this.teams[t.id].dir); } } }
        const far = dTo(sl.p, ...this.toWorld(t.id, sl.u, sl.v)); put(sl.p, sl.u, sl.v, far > 7 ? 1 : far > 2.5 ? 0.88 : 0.6, sl.act);
      }
      return;
    }

    // --- defending: presser, cover, then everyone else marks goal-side of an attacker (zone blend by defensive style)
    const presserId = t.chaser, coverId = t.second; const carrier = ownerP && ownerP.team !== t.id ? ownerP : null; const blend = tac.defensiveStyle === 'man_marking' ? 0.85 : tac.defensiveStyle === 'high_press' ? 0.7 : tac.defensiveStyle === 'mid_block' ? 0.6 : 0.4;
    const ownGoalPos = this.toWorld(t.id, ownGoalU, 0); const marks = new Set<string>(); const attackers = opp.filter((o) => o !== carrier);
    const lowLine = this.ballInOwnThird(t.id) ? 1.6 : 0;
    const pressing = (() => { const p = outf.find((q) => q.cfg.id === presserId); if (!p) return false; const d = dTo(p, ref.x, ref.z); return carrier ? d < 4 + 12 * tac.pressingIntensity || this.ballInOwnThird(t.id) : d < 14; })();
    for (const p of outf) {
      if (p.cfg.id === rcvId) continue;
      if (p.cfg.id === presserId && pressing) { // close the carrier down, arriving goal-side
        const gx = ownGoalPos[0] - ref.x, gz = ownGoalPos[1] - ref.z, gl = Math.hypot(gx, gz) || 1; const lead = carrier ? 0.25 : 0; const tx = ref.x + ref.vx * lead + (gx / gl) * 0.7, tz = ref.z + ref.vz * lead + (gz / gl) * 0.7;
        const [u, v] = this.toTeam(t.id, tx, tz); put(p, u, v, 1, carrier ? 'press' : 'chase'); continue;
      }
      if (p.cfg.id === coverId && (pressing || !carrier)) { // cover behind the presser, between ball and goal, leaning towards the most dangerous passing option
        const gx = ownGoalPos[0] - ref.x, gz = ownGoalPos[1] - ref.z, gl = Math.hypot(gx, gz) || 1; let tx = ref.x + (gx / gl) * 3.2, tz = ref.z + (gz / gl) * 3.2;
        let best: RP | null = null, bu = -99; for (const o of attackers) { const os = this.pstate(o); const [ou] = this.toTeam(t.id, os.x, os.z); const dd = dist(os.x, os.z, ref.x, ref.z); if (dd > 2 && dd < 13 && -ou > bu) { bu = -ou; best = o; } }
        if (best) { const os = this.pstate(best); tx = tx * 0.65 + (os.x + (ownGoalPos[0] - os.x) * 0.2) * 0.35; tz = tz * 0.65 + os.z * 0.35; }
        const [u, v] = this.toTeam(t.id, tx, tz); put(p, u, v, 0.95, 'cover'); continue;
      }
      // marker: nearest unmarked attacker; stand between him and our goal
      let tgt: RP | null = null, bd = 1e9; const ps = this.pstate(p);
      for (const o of attackers) { if (marks.has(o.cfg.id)) continue; const os = this.pstate(o); const d = dist(ps.x, ps.z, os.x, os.z); if (d < bd) { bd = d; tgt = o; } }
      const [zu, zv] = this.roleTarget(t, p, false);
      if (tgt) {
        marks.add(tgt.cfg.id); const os = this.pstate(tgt); const gx = ownGoalPos[0] - os.x, gz = ownGoalPos[1] - os.z, gl = Math.hypot(gx, gz) || 1; const mx = os.x + (gx / gl) * 1.7, mz = os.z + (gz / gl) * 1.7; const [mu, mv] = this.toTeam(t.id, mx, mz);
        put(p, blend * mu + (1 - blend) * (zu - lowLine), blend * mv + (1 - blend) * zv, bd > 6 ? 1 : 0.85, 'mark');
      } else put(p, zu - lowLine, zv, 0.8, 'hold');
    }
  }

  private decide(p: RP) {
    const t = this.teams[p.team]; const s = this.pstate(p); const b = this.phys.ballState();
    const ins = t.tactics.playerInstructions.find((i) => i.playerId === p.cfg.id); p.instr = ins?.instruction ?? 'hold_position';
    if (this.play === 'halftime') { const [u, v] = this.roleTarget(t, p, false); [p.tx, p.tz] = this.toWorld(p.team, Math.min(u, -2), v); p.sf = 0.6; p.act = 'walk'; if (this.isKeeper(p)) { [p.tx, p.tz] = this.toWorld(p.team, -halfL + 1.2, 0); } return; }
    if (this.play === 'restart') { const r = this.restartTargetFor(p); p.tx = r[0]; p.tz = r[1]; p.sf = r[2]; p.act = 'restart'; return; }
    if (this.isKeeper(p)) { p.act = 'gk'; return this.decideGK(p); }
    const dBall = dist(s.x, s.z, b.x, b.z); const mine = this.owner === p.cfg.id;
    const iAmTarget = t.passTarget && t.passTarget.id === p.cfg.id && t.passTarget.until > this.rt && this.possessionTeam() === p.team && this.owner !== p.cfg.id;
    // finishing a kick he has already decided on
    if (p.plan && this.rt < p.plan.until && dBall < PHYS.kickReach * 2.2) { p.tx = b.x; p.tz = b.z; p.sf = 1; p.act = p.plan.type; return; }
    // the player on the ball decides what to do with it
    if (mine) {
      if (this.restart !== null) return;
      if (dBall <= PHYS.kickReach + 0.25 && b.y < 0.8) { p.act = 'carry'; this.decideCarrier(p); return; }
      p.tx = b.x + b.vx * 0.15; p.tz = b.z + b.vz * 0.15; p.sf = 1; p.act = 'carry'; return; // go and take the next touch
    }
    // the intended receiver moves to where the pass will arrive, in time, and faces the ball
    if (iAmTarget && t.passTarget) {
      const pt = t.passTarget; const bsp = Math.hypot(b.vx, b.vz); let mx = pt.tx, mz = pt.tz;
      if (bsp > 0.8) { // meet the ball: the first point on its path the receiver can reach before it does, instead of waiting for it
        const ux = b.vx / bsp, uz = b.vz / bsp; const me = this.pv(p); const maxS = Math.max(0, dist(b.x, b.z, pt.tx, pt.tz));
        for (let k = 0.6; k <= maxS + 0.01; k += 0.3) { const px = b.x + ux * k, pz = b.z + uz * k; if (reachTime(me, px, pz, 0.3) + 0.1 <= ballTimeAt(k, bsp)) { mx = px; mz = pz; break; } }
      }
      const dd = dist(s.x, s.z, mx, mz);
      if (dd > 0.35) { p.tx = mx; p.tz = mz; p.sf = 1; } else { p.tx = s.x; p.tz = s.z; p.sf = 0.3; }
      p.act = 'receive'; return;
    }
    // everyone else follows the team plan (support / press / cover / mark)
    const pl = t.plan.get(p.cfg.id);
    if (pl) {
      p.tx = pl.tx; p.tz = pl.tz; p.sf = pl.sf; p.act = pl.act;
      const owner = this.owner ? this.byId.get(this.owner) ?? null : null;
      if (owner && owner.team !== p.team && pl.act === 'press' && dist(s.x, s.z, this.pstate(owner).x, this.pstate(owner).z) < 1.15 && p.tackleCd <= 0) this.tackle(p, owner);
      if (!owner && (pl.act === 'chase')) { const pt = this.interceptPoint(p, b); p.tx = pt[0]; p.tz = pt[1]; }
      return;
    }
    const attacking = this.possessionTeam() === p.team && !this.ballInOwnThird(p.team);
    const [u, v] = this.roleTarget(t, p, attacking); [p.tx, p.tz] = this.toWorld(p.team, u, v); p.sf = 0.8; p.act = 'hold';
  }
  private ballInOwnThird(t: TeamId) { const b = this.phys.ballState(); return (b.x - this.ownGoalX(t)) * this.teams[t].dir < 9; }

  private interceptPoint(p: RP, b: { x: number; z: number; vx: number; vz: number }): [number, number] {
    const s = this.pstate(p); const d = dist(s.x, s.z, b.x, b.z); const tt = clamp(d / (this.maxSpeed(p) + 1e-3), 0, 1.2);
    return [clamp(b.x + b.vx * tt * 0.7, -halfL - 1, halfL + 1), clamp(b.z + b.vz * tt * 0.7, -halfW - 1, halfW + 1)];
  }

  private laneClear(fx: number, fz: number, tx: number, tz: number, opp: RP[]): number {
    let min = 9; const dx = tx - fx, dz = tz - fz; const l2 = dx * dx + dz * dz || 1;
    for (const o of opp) {
      const s = this.pstate(o); const k = clamp(((s.x - fx) * dx + (s.z - fz) * dz) / l2, 0.05, 0.98);
      const d = dist(s.x, s.z, fx + dx * k, fz + dz * k); if (d < min) min = d;
    }
    return min;
  }

  private passOptions(p: RP): PassOption[] {
    const t = this.teams[p.team]; const opps = this.onCourt(OTHER(p.team)).map((o) => this.pv(o)); const mates = this.onCourt(p.team).filter((m) => m !== p).map((m) => this.pv(m));
    const opts = evaluatePasses({ carrier: this.pv(p), mates, opps, dir: t.dir, risk: t.tactics.riskLevel, style: t.tactics.attackingStyle, now: this.rt, recent: this.recentPass });
    // a weaker decision-maker misjudges the ranking a little (noise on the scores, never on the geometry)
    const sigma = (1 - A01(p.cfg.attributes.decisionMaking)) * 0.07; if (sigma > 0) for (const o of opts) o.score += this.rng.gauss() * sigma; opts.sort((a, c) => c.score - a.score);
    this.lastOptions[p.team] = opts.slice(0, 3); return opts;
  }

  private decideCarrier(p: RP) {
    const t = this.teams[p.team]; const s = this.pstate(p); const a = p.cfg.attributes; const tac = t.tactics;
    const oppGoalX = t.dir * halfL; const opp = this.outfield(OTHER(p.team));
    const dGoal = dist(s.x, s.z, oppGoalX, 0);
    const press = opp.reduce((m, o) => Math.min(m, dist(s.x, s.z, this.pstate(o).x, this.pstate(o).z)), 9);
    // shooting
    const clr = this.laneClear(s.x, s.z, oppGoalX, 0, opp);
    // shot quality: distance + attribute + lane (a defender standing in the shot line blocks it); patience lowers the bar the longer a team holds the ball in the opposing half
    const laneFactor = clr < (dGoal < 5 ? 0.45 : 0.7) ? 0.12 : clr < 1.0 ? 0.6 : 1;
    const q = clamp(1.25 - dGoal / 14, 0, 1) * (0.55 + 0.45 * A01(a.shooting)) * laneFactor;
    const patience = Math.min(0.2, 0.025 * this.attackClock[p.team]);
    const thr = 0.26 - 0.2 * tac.riskLevel - patience + 0.12 * (1 - A01(a.decisionMaking)) * (this.rng.next() - 0.3);
    if (dGoal < 17 && q > thr && !this.isKeeper(p)) { this.attackClock[p.team] = 0; this.planShot(p, false); return; }
    // pass, dribble or clear: the options are judged on arrival times, interception risk, gain, space and the shot they create
    const opts = this.passOptions(p); const best = opts[0]; const dv = dribbleValue(this.pv(p), this.onCourt(OTHER(p.team)).map((o) => this.pv(o)), t.dir, A01(a.dribbling), tac.riskLevel);
    if (best && best.score > dv - (press < 1.7 ? 0.25 : 0) && best.score > -0.02) { this.commitPass(p, best); return; }
    if (press < 1.5 && this.ballInOwnThird(p.team)) { this.planClear(p); return; }
    // dribble towards goal avoiding the nearest defender
    let dx = oppGoalX - s.x, dz = -s.z * 0.6; const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    for (const o of opp) { const os = this.pstate(o); const d = dist(s.x, s.z, os.x, os.z); if (d < 3) { const k = (3 - d) / 3; dx += ((s.x - os.x) / (d || 1)) * k * 1.4; dz += ((s.z - os.z) / (d || 1)) * k * 1.4; } }
    // stay off the lines: a carrier near the touchline turns inward, and the push target is clamped inside the playing area
    if (Math.abs(s.z) > 7) dz -= Math.sign(s.z) * (Math.abs(s.z) - 7) * 0.7;
    if (Math.abs(s.x) > halfL - 4 && Math.sign(s.x) !== t.dir) dx += Math.sign(s.x) * -0.8;
    const m = Math.hypot(dx, dz) || 1;
    p.plan = { type: 'dribble', tx: clamp(s.x + (dx / m) * 5, -halfL + 1.2, halfL - 1.2), tz: clamp(s.z + (dz / m) * 5, -halfW + 1.6, halfW - 1.6), speed: 0, lift: 0, until: this.rt + 0.5 };
    p.tx = p.plan.tx; p.tz = p.plan.tz; p.sf = 0.85 + 0.1 * A01(a.dribbling); p.act = 'dribble';
    if (press < 2 && !this.dribbleWatch.some((d) => d.pid === p.cfg.id)) { this.teamStats[p.team].dribbles++; this.dribbleWatch.push({ pid: p.cfg.id, team: p.team, rt: this.rt }); }
  }

  /** Plan a pass to a chosen option: the ball leaves at the speed that makes it arrive controllable, and the receiver is told where and when. */
  private commitPass(p: RP, o: PassOption, restart = false) {
    p.plan = { type: 'pass', tx: o.tx, tz: o.tz, speed: o.speed, lift: 0, toId: o.toId, until: this.rt + (restart ? 3 : 0.6) };
    this.teams[p.team].passTarget = { id: o.toId, until: this.rt + o.eta + 1.6, tx: o.tx, tz: o.tz, eta: this.rt + 0.15 + o.eta };
    this.passKind = o.kind; p.tx = this.pstate(p).x; p.tz = this.pstate(p).z; p.sf = 0.3; p.act = 'pass';
  }
  passKind = 'short';
  private planBestPass(p: RP, restart: boolean, backwards = false): boolean {
    void backwards; const opts = this.passOptions(p); let o = opts[0];
    if (!o) { // nobody is a clean option (e.g. a restart with everyone marked): play to the nearest teammate who is not behind the taker
      const s = this.pstate(p); let best: RP | null = null, bd = 1e9; for (const m of this.onCourt(p.team)) { if (m === p) continue; const ms = this.pstate(m); const d = dist(s.x, s.z, ms.x, ms.z); if (d > 2 && d < bd) { bd = d; best = m; } }
      if (!best) return false; const ms = this.pstate(best); const d = dist(s.x, s.z, ms.x, ms.z); const v0 = ballSpeedFor(d, 3.6);
      o = { toId: best.cfg.id, tx: ms.x, tz: ms.z, speed: v0, arrive: 3.6, kind: 'short', score: 0, intercept: 0, eta: d / (v0 * 0.7), progress: 0, threat: 0, space: 0, recvMargin: 0, why: 'fallback' };
    }
    this.commitPass(p, o, restart); return true;
  }
  private planClear(p: RP) {
    const t = this.teams[p.team]; const s = this.pstate(p);
    p.plan = { type: 'clear', tx: t.dir * (halfL - 9), tz: (s.z >= 0 ? 1 : -1) * 3.5, speed: 16, lift: 1.0, until: this.rt + 3 };
  }
  private planShot(p: RP, force: boolean) {
    const t = this.teams[p.team]; const s = this.pstate(p); const a = p.cfg.attributes;
    const goalX = t.dir * halfL; const keeper = this.gk(OTHER(p.team)); const ks = keeper ? this.pstate(keeper) : { z: 0 };
    const side = ks.z > 0.15 ? -1 : ks.z < -0.15 ? 1 : this.rng.next() < 0.5 ? -1 : 1;
    const zt = side * (goalWidth / 2 - 0.5 - 0.35 * (1 - A01(a.shooting)));
    const yt = 0.25 + this.rng.next() * 0.9;
    const d = dist(s.x, s.z, goalX, zt); const speed = 15 + 13 * A01(a.shooting) * this.staminaFactor(p);
    const tt = d / speed; const vy = (yt - 0.12 + 0.5 * 9.81 * tt * tt) / tt;
    p.plan = { type: 'shoot', tx: goalX, tz: zt, speed, lift: clamp(vy, 0, 6), until: this.rt + (force ? 3 : 0.5) };
    if (!force) { p.tx = s.x; p.tz = s.z; p.sf = 0.4; }
  }

  private decideGK(p: RP) {
    const t = this.teams[p.team]; const s = this.pstate(p); const b = this.phys.ballState(); const gx = this.ownGoalX(p.team); const inw = gx > 0 ? -1 : 1;
    const a = p.cfg.attributes; const gkSkill = A01(a.goalkeeping);
    // incoming shot -> dive (one real impulse, bounded by agility)
    const towards = (b.vx * inw * -1) > 3 && Math.abs(b.x - gx) < 14;
    if (towards && p.diveCd <= 0 && p.diveTarget === null) {
      const tt = (gx - b.x) / b.vx; const zc = b.z + b.vz * tt; const yc = b.y + b.vy * tt - 0.5 * 9.81 * tt * tt;
      if (tt > 0 && tt < 1.4 && Math.abs(zc) < goalWidth / 2 + 0.8 && yc < goalHeight + 0.3) { p.diveTarget = zc + this.rng.gauss() * (1 - gkSkill) * 0.7; p.diveDelay = 0.2 + 0.4 * (1 - gkSkill) * (0.5 + this.rng.next()); }
    }
    const dBall = dist(s.x, s.z, b.x, b.z); const speedBall = Math.hypot(b.vx, b.vz);
    const ballInBox = Math.abs(b.x - gx) < COURT.penaltyAreaRadius && Math.abs(b.z) < COURT.penaltyAreaRadius;
    if (ballInBox && speedBall < 2 && b.y < 0.5 && this.restart === null && (this.lastTouch?.team !== p.team || dBall < 2.5)) {
      // collect / distribute
      if (dBall < PHYS.kickReach + 0.4) { this.owner = p.cfg.id; this.decideDistribution(p); return; }
      p.tx = b.x; p.tz = b.z; p.sf = 0.9; return;
    }
    if (p.plan && this.rt < p.plan.until && dBall < 1.5) { p.tx = b.x; p.tz = b.z; p.sf = 0.9; return; }
    // positioning on the shot-angle bisector
    const rbx = (b.x - gx) * -inw; const depth = clamp(0.9 + 0.045 * rbx * 2, 0.9, 2.6) + (t.tactics.teamStrategy === 'attacking' ? 0.8 : 0);
    const zc = clamp((b.z * 1.3 / Math.max(Math.abs(b.x - gx), 3)) * depth * 2.2, -1.3, 1.3);
    p.tx = gx + inw * depth; p.tz = zc; p.sf = 0.7;
  }
  private decideDistribution(p: RP) {
    if (p.plan) return;
    if (!this.planBestPass(p, true)) this.planClear(p);
    p.plan!.until = this.rt + 1.5;
  }

  // ---------------------------------------------------------------- steering
  private steer(p: RP) {
    const s = this.pstate(p); const dt = PHYS.dt;
    if (!this.isKeeper(p) && this.play !== 'restart') p.tx = clamp(p.tx, -halfL + 0.5, halfL - 0.5); // outfield players do not run into the goal frame or net after a ball that is in it
    let dx = p.tx - s.x, dz = p.tz - s.z; const d = Math.hypot(dx, dz);
    const vmax = this.maxSpeed(p) * p.sf; const am = this.accelMax(p);
    let desired = vmax;
    const brakeDist = (Math.hypot(s.vx, s.vz) ** 2) / (2 * am * 1.4);
    if (d < Math.max(0.15, brakeDist)) desired = Math.min(vmax, d * 2.2);
    if (d < 0.08) desired = 0;
    if (d > 1e-6) { dx /= d; dz /= d; }
    // light teammate separation to avoid stacking
    let sx = 0, sz = 0;
    for (const m of this.onCourt(p.team)) { if (m === p) continue; const ms = this.pstate(m); const dd = dist(s.x, s.z, ms.x, ms.z); if (dd < 1.1 && dd > 1e-3) { sx += (s.x - ms.x) / dd * (1.1 - dd); sz += (s.z - ms.z) / dd * (1.1 - dd); } }
    // sidestep anyone (opponents included) who is in the way: without this two players walking head-on lock in a physical standoff
    for (const o of this.onCourt(OTHER(p.team))) {
      const os = this.pstate(o); const ox = os.x - s.x, oz = os.z - s.z; const dd = Math.hypot(ox, oz);
      if (dd < 1.6 && dd > 1e-3 && (ox * dx + oz * dz) / dd > 0.2) {
        const side = dx * oz - dz * ox >= 0 ? 1 : -1; // pass on the side that is already open
        const k = (1.6 - dd) / 1.6 * 2.2; sx += -dz * side * -1 * k; sz += dx * side * -1 * k;
      }
    }
    let vdx = dx * desired + sx * 1.5, vdz = dz * desired + sz * 1.5;
    // edge containment
    if (Math.abs(s.x) > halfL + 1) vdx -= Math.sign(s.x) * 3.5; if (Math.abs(s.z) > halfW + 0.8) vdz -= Math.sign(s.z) * 3.5;
    let ax = (vdx - s.vx) / 0.22, az = (vdz - s.vz) / 0.22; const am2 = Math.hypot(ax, az);
    const turnPenalty = 0.7 + 0.3 * A01(p.cfg.attributes.agility); // sharp reversals limited by agility
    const cap = am * (desired < Math.hypot(s.vx, s.vz) ? 1.5 : turnPenalty + 0.3);
    if (am2 > cap) { ax *= cap / am2; az *= cap / am2; }
    this.phys.accelPlayer(p.cfg.id, ax, az, dt);
    // heading follows velocity with a turn-rate limit
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 0.4) { const want = Math.atan2(s.vz, s.vx); let da = want - p.heading; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; const maxTurn = (4 + 6 * A01(p.cfg.attributes.agility)) * dt; p.heading += clamp(da, -maxTurn, maxTurn); }
    let err = 0; if (d > 0.6) { let e = Math.atan2(dz, dx) - p.heading; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; err = Math.abs(e); }
    let st = sp > this.maxSpeed(p) * 0.8 ? 'sprint' : sp > 3.2 ? 'run' : sp > 0.6 ? 'walk' : 'idle';
    if (err > 0.9 && sp < 2.6 && d > 0.6) st = 'turn'; else if (this.owner === p.cfg.id && sp > 0.5) st = 'dribble'; else if ((p.act === 'press' || p.act === 'mark' || p.act === 'cover') && sp < 3.2) st = 'defend';
    p.state = p.actUntil > this.rt ? p.actState : st;
  }

  // ---------------------------------------------------------------- rules
  private checkGoalAndBounds() {
    const b = this.phys.ballState();
    // ---- goal
    if (Math.abs(b.x) > halfL + PHYS.ballRadius && Math.abs(b.z) < goalWidth / 2 && b.y < goalHeight) {
      const attackTeam: TeamId = this.teams.A.dir * Math.sign(b.x) > 0 ? 'A' : 'B';
      const rst = this.restart; // not used while live
      void rst;
      this.resolveGoal(attackTeam, b.x); return;
    }
    // ---- out of play
    if (Math.abs(b.z) > halfW + PHYS.ballRadius) { this.outOfPlay('touch', b); return; }
    if (Math.abs(b.x) > halfL + PHYS.ballRadius) { this.outOfPlay('goal_line', b); return; }
  }

  private resolveGoal(attackTeam: TeamId, bx: number) {
    const lt = this.lastTouch;
    if (this.advantage) { this.push('advantage_over', { team: this.advantage.atk, detail: attackTeam === this.advantage.atk ? 'advantage converted: goal' : 'goal against; foul still recorded' }); this.advantage = null; }
    // indirect restart: goal not valid unless touched by a second player
    const r = this.restartLive;
    if (r && r.indirect && r.touches.size < 2) { // goal disallowed -> goal clearance for defenders
      this.push('goal_clearance', { team: OTHER(attackTeam), detail: 'goal disallowed (indirect kick, no second touch)' });
      this.teamStats[OTHER(attackTeam)].goalClearances++;
      this.startRestart('goal_clearance', OTHER(attackTeam), Math.sign(bx) * (halfL - 2.5), 0); this.restartLive = null; return;
    }
    this.restartLive = null;
    const scorerId = lt?.pid; const scorer = scorerId ? this.byId.get(scorerId) : undefined;
    const own = scorer ? scorer.team !== attackTeam : false;
    const idx = attackTeam === 'A' ? 0 : 1; this.score[idx]++;
    this.teamStats[attackTeam].goals++;
    let assistId: string | undefined;
    if (!own && scorer && this.lastAssist && this.lastAssist.scorer === scorer.cfg.id && this.rt - this.lastAssist.rt < 6 && this.lastAssist.pid !== scorer.cfg.id) assistId = this.lastAssist.pid;
    if (!own && scorer) { this.ps(scorer.cfg.id).goals++; if (assistId) this.ps(assistId).assists++; }
    const e = this.push('goal', { team: attackTeam, playerId: scorerId, assistId, detail: own ? 'own goal' : this.shotLog.filter((s) => !s.resolved && s.team === attackTeam).length ? 'shot' : 'play', pos: [bx, 0] });
    void e;
    // resolve open shots
    for (const s of this.shotLog) if (!s.resolved) { s.resolved = true; s.outcome = s.team === attackTeam ? 'goal' : 'other'; }
    this.momentumAcc[attackTeam === 'A' ? 'a' : 'b'] += 3;
    const conceding = OTHER(attackTeam);
    // a dismissed player's team may restore the fifth player after a goal
    this.teams[conceding].dismissedAt = this.teams[conceding].dismissedAt.map((x) => Math.min(x, this.vt));
    for (const t of [this.teams.A, this.teams.B]) { t.trigger = 'goal'; t.version++; }
    this.startRestart('kickoff', conceding, 0, 0, 5);
    this.push('kickoff', { team: conceding });
  }
  restartLive: Restart | null = null;

  private outOfPlay(kind: 'touch' | 'goal_line', b: { x: number; z: number }) {
    if (this.advantage) { const a = this.advantage; this.advantage = null; this.push('advantage_over', { team: a.atk, detail: 'ball out of play: free kick awarded' }); this.awardFreeKick(a); return; }
    const lt = this.lastTouch; const last: TeamId = lt?.team ?? 'A'; const opp = OTHER(last);
    for (const s of this.shotLog) if (!s.resolved) { s.resolved = true; s.outcome = 'off_target'; }
    if (this.lastPass && this.rt - this.lastPass.rt < 6) this.lastPass = null;
    this.restartLive = null;
    if (kind === 'touch') {
      const x = clamp(b.x, -halfL + 0.5, halfL - 0.5);
      this.push('kick_in', { team: opp, pos: [x, Math.sign(b.z) * halfW] }); this.teamStats[opp].kickIns++;
      this.startRestart('kick_in', opp, x, Math.sign(b.z) * halfW, 1.4, true); return;
    }
    const lineX = Math.sign(b.x) * halfL;
    const defending: TeamId = this.teams.A.dir * Math.sign(b.x) > 0 ? 'B' : 'A'; // team defending the goal at this end
    if (last === defending) { // corner for attackers
      const att = OTHER(defending); const z = b.z >= 0 ? halfW : -halfW;
      this.push('corner', { team: att, pos: [lineX, z] }); this.teamStats[att].corners++;
      this.startRestart('corner', att, lineX - Math.sign(lineX) * 0.2, z - Math.sign(z) * 0.2, 1.8);
    } else {
      this.push('goal_clearance', { team: defending, pos: [lineX, 0] }); this.teamStats[defending].goalClearances++;
      this.startRestart('goal_clearance', defending, lineX - Math.sign(lineX) * 2.2, 0, 1.2, true);
    }
  }

  /** Rules-engine entry point for a foul committed by `def` on `car` with the given closing speed (m/s). Also used by tests. */
  callFoul(defId: string, carId: string, closing: number) { this.cardOrFoul(this.byId.get(defId)!, this.byId.get(carId)!, closing); }
  private cardOrFoul(def: RP, car: RP, closing: number) {
    const dt = this.teams[def.team]; const sx = this.pstate(car);
    const x = clamp(sx.x, -halfL + 1, halfL - 1), z = clamp(sx.z, -halfW + 1, halfW - 1);
    this.push('foul', { team: def.team, playerId: def.cfg.id, detail: `on ${car.cfg.id}`, pos: [x, z] });
    this.teamStats[def.team].fouls++; this.ps(def.cfg.id).fouls++; dt.fouls++;
    let red = false;
    if (closing > 6.3) red = true;
    else if (closing > 5.3) { def.yellow++; this.teamStats[def.team].yellow++; this.ps(def.cfg.id).yellow++; this.push('yellow_card', { team: def.team, playerId: def.cfg.id }); if (def.yellow >= 2) red = true; }
    if (red) this.sendOff(def);
    this.foulCd = 1.2;
    // restart type
    const atk = car.team; const defGoalX = this.ownGoalX(def.team);
    const inArea = dist(x, z, defGoalX, 0) < COURT.penaltyAreaRadius;
    const accumulated = dt.fouls > MATCH.foulsBeforePenaltyFK;
    this.momentumAcc[atk === 'A' ? 'a' : 'b'] += 0.4;
    if (inArea) { // penalty kick (regulation) - separate from the post-match shootout system
      this.push('penalty_kick', { team: atk, pos: [Math.sign(defGoalX) * (halfL - COURT.penaltyMark), 0] }); this.teamStats[atk].penalties++;
      this.startRestart('penalty_kick', atk, Math.sign(defGoalX) * (halfL - COURT.penaltyMark), 0, 3, false, true);
      return;
    }
    let sx2 = x, sz2 = z, noWall = false;
    if (accumulated) {
      noWall = true; this.teamStats[def.team].accumulatedFouls++;
      this.push('accumulated_foul', { team: def.team, detail: `foul #${dt.fouls} in half ${this.half}` });
      if (Math.abs(defGoalX - x) < COURT.secondPenaltyMark && Math.abs(defGoalX - x) > COURT.penaltyAreaRadius - 0.5) { sx2 = defGoalX - Math.sign(defGoalX) * COURT.secondPenaltyMark; sz2 = 0; }
    }
    const pending: PendingFreeKick = { atk, x: sx2, z: sz2, noWall, accumulated };
    if (!red && this.advantageApplies(car)) { // referee plays on: the free kick is only awarded if the fouled team loses the ball
      this.advantage = { ...pending, startRt: this.rt, until: this.rt + ADVANTAGE_SECONDS };
      this.push('advantage', { team: atk, playerId: car.cfg.id, detail: 'play on', pos: [x, z] });
      return;
    }
    this.awardFreeKick(pending);
  }

  private awardFreeKick(f: PendingFreeKick) {
    this.push('free_kick', { team: f.atk, pos: [f.x, f.z], detail: f.accumulated ? 'direct, no wall (accumulated fouls)' : 'direct' }); this.teamStats[f.atk].freeKicks++;
    this.startRestart('free_kick', f.atk, f.x, f.z, 2, false, f.noWall);
  }

  advantage: Advantage | null = null;
  /** The fouled carrier keeps the ball, is not in his own third and is moving on: the referee lets play continue. */
  private advantageApplies(car: RP): boolean {
    const s = this.pstate(car); const b = this.phys.ballState();
    if (dist(s.x, s.z, b.x, b.z) > 1.3) return false;
    const [u] = this.toTeam(car.team, s.x, s.z); const fwd = s.vx * this.teams[car.team].dir;
    return u > -2 && fwd > 1.2;
  }
  private checkAdvantage() {
    const a = this.advantage; if (!a) return;
    const lt = this.lastTouch;
    if (lt && lt.team !== a.atk && lt.rt > a.startRt) { this.advantage = null; this.push('advantage_over', { team: a.atk, detail: 'advantage lost: free kick awarded' }); this.awardFreeKick(a); return; }
    if (this.rt > a.until) { this.advantage = null; this.push('advantage_over', { team: a.atk, detail: 'advantage played' }); }
  }

  private sendOff(p: RP) {
    const t = this.teams[p.team]; p.red = true; p.onCourt = false; this.phys.removePlayer(p.cfg.id);
    this.teamStats[p.team].red++; this.ps(p.cfg.id).red++;
    this.push('red_card', { team: p.team, playerId: p.cfg.id });
    t.dismissedAt.push(this.vt + MATCH.dismissalVirtualSeconds); t.trigger = 'red_card'; t.version++; this.teams[OTHER(p.team)].trigger = 'red_card_opp';
    if (p.cfg.role === 'GK') { // best remaining goalkeeper takes over by substitution of an outfield player
      const bench = t.players.filter((q) => !q.onCourt && !q.red).sort((a, b) => b.cfg.attributes.goalkeeping - a.cfg.attributes.goalkeeping)[0];
      const off = this.outfield(p.team).sort((a, b) => a.cfg.attributes.shooting - b.cfg.attributes.shooting)[0];
      if (bench && off) { this.subNow(off, bench, true); }
    }
  }

  private subNow(out: RP, inn: RP, isEmergencyKeeper = false) {
    const t = this.teams[out.team];
    out.onCourt = false; this.phys.removePlayer(out.cfg.id);
    inn.onCourt = true; inn.stamina = Math.max(inn.stamina, 0.0 + inn.stamina);
    const zone = t.dir; const [x, z] = [-zone * (isEmergencyKeeper ? halfL - 1.2 : 2), halfW - 0.4];
    this.phys.addPlayer(inn.cfg.id, x, isEmergencyKeeper ? 0 : z, inn.cfg.role === 'GK');
    inn.tx = x; inn.tz = z; inn.plan = null;
    this.push('substitution', { team: out.team, playerId: inn.cfg.id, detail: `${out.cfg.id} off` });
  }

  private performSubs(team: TeamId) {
    const t = this.teams[team];
    for (const s of t.queuedSubs) {
      const out = this.byId.get(s.out), inn = this.byId.get(s.in);
      if (out?.onCourt && inn && !inn.onCourt && !inn.red && out.team === team && inn.team === team) this.subNow(out, inn);
    }
    t.queuedSubs = [];
    // restore the fifth player after the 2-minute dismissal window
    const need = 5 - this.onCourt(team).length;
    if (need > 0) {
      t.dismissedAt = t.dismissedAt.filter((x) => x > this.vt || (this.restore(team), false));
    }
  }
  private restore(team: TeamId) {
    const bench = this.teams[team].players.filter((q) => !q.onCourt && !q.red && q.cfg.role !== 'GK').sort((a, b) => b.stamina - a.stamina)[0];
    if (!bench || this.onCourt(team).length >= 5) return;
    bench.onCourt = true; const t = this.teams[team];
    this.phys.addPlayer(bench.cfg.id, -t.dir * 2, halfW - 0.4); this.push('substitution', { team, playerId: bench.cfg.id, detail: 'replacement after dismissal period' });
  }

  private checkFouls() {
    if (this.foulCd > 0 || this.play !== 'live' || this.advantage) return;
    const poss = this.possessionTeam(); if (!poss) return;
    const b = this.phys.ballState();
    const carriers = this.outfield(poss).filter((c) => { const s = this.pstate(c); return dist(s.x, s.z, b.x, b.z) < 1.2; });
    for (const c of carriers) {
      const cs = this.pstate(c);
      for (const d of this.onCourt(OTHER(poss))) {
        const ds = this.pstate(d); const dd = dist(cs.x, cs.z, ds.x, ds.z);
        if (dd > PHYS.playerRadius * 2 + 0.12) continue;
        if (this.rt - d.lastTouchRt < 0.6) continue; // played the ball first: legal tackle
        const nx = (cs.x - ds.x) / (dd || 1), nz = (cs.z - ds.z) / (dd || 1);
        const closing = (ds.vx - cs.vx) * nx + (ds.vz - cs.vz) * nz;
        const threshold = 3.6 + 1.2 * A01(d.cfg.attributes.defensiveAwareness);
        if (closing > threshold) { this.cardOrFoul(d, c, closing); return; }
      }
    }
  }

  private checkGkHold() {
    for (const t of [this.teams.A, this.teams.B]) {
      const g = this.gk(t.id); if (!g || this.play !== 'live') continue;
      const b = this.phys.ballState(); const s = this.pstate(g);
      const holding = dist(s.x, s.z, b.x, b.z) < 0.9 && Math.hypot(b.vx, b.vz) < 1.5 && Math.abs(b.x - this.ownGoalX(t.id)) < COURT.penaltyAreaRadius;
      g.gkHold = holding ? g.gkHold + PHYS.dt : 0;
      if (g.gkHold > MATCH.gkHoldLimitSeconds) {
        g.gkHold = 0; const opp = OTHER(t.id);
        this.push('four_second_violation', { team: t.id, playerId: g.cfg.id });
        const gx = this.ownGoalX(t.id); const x = gx - Math.sign(gx) * COURT.penaltyAreaRadius;
        this.push('free_kick', { team: opp, pos: [x, clamp(b.z, -5, 5)], detail: 'indirect (four-second rule)' }); this.teamStats[opp].freeKicks++;
        this.startRestart('free_kick', opp, x, clamp(b.z, -5, 5), 1.6, true); return;
      }
    }
  }

  // ---------------------------------------------------------------- shot resolution & saves
  private updateShots(contacts: { playerId: string }[]) {
    for (const s of this.shotLog) {
      if (s.resolved) continue;
      if (this.tick - Math.round(s.rt / PHYS.dt) === 1) this.classifyShot(s);
      for (const c of contacts) {
        const p = this.byId.get(c.playerId)!;
        if (p.cfg.id === s.playerId && this.rt - s.rt < 0.4) continue;
        if (p.team !== s.team) {
          s.resolved = true;
          if (this.isKeeper(p)) { s.outcome = s.onTarget ? 'saved' : 'caught'; if (s.onTarget) { this.teamStats[p.team].saves++; this.ps(p.cfg.id).saves++; this.push('save', { team: p.team, playerId: p.cfg.id, detail: `shot by ${s.playerId}` }); } }
          else { s.outcome = 'blocked'; this.teamStats[s.team].blocked++; if (s.onTarget) { this.teamStats[s.team].onTarget--; this.ps(s.playerId).onTarget--; } }
        }
      }
      if (this.phys.woodwork && !s.resolved && this.rt - s.rt < 2) s.outcome = 'woodwork';
      if (this.rt - s.rt > 4) s.resolved = true;
    }
  }

  // ---------------------------------------------------------------- step
  step(): void {
    if (this.phase === 'full_time' || this.phase === 'finished' || this.phase === 'shootout' || this.phase === 'pre') return;
    this.tick++; this.rt += PHYS.dt; const dt = PHYS.dt;
    for (const t of [this.teams.A, this.teams.B]) for (const p of t.players) { p.kickCd = Math.max(0, p.kickCd - dt); p.touchCd = Math.max(0, p.touchCd - dt); p.diveCd = Math.max(0, p.diveCd - dt); p.tackleCd = Math.max(0, p.tackleCd - dt); }
    this.foulCd = Math.max(0, this.foulCd - dt);
    if (this.tick % MATCH.decisionEveryTicks === 0) this.updateTeamContext();
    // behaviour
    for (const t of [this.teams.A, this.teams.B]) for (const p of t.players) {
      if (!p.onCourt) continue;
      if ((this.tick + p.idx + (t.id === 'A' ? 0 : 3)) % MATCH.decisionEveryTicks === 0) this.decide(p);
      this.executeDive(p);
      if (this.play === 'live') this.tryExecutePlan(p);
      if (this.play === 'restart' && this.restart && p.cfg.id !== this.restart.takerId && p.plan) p.plan = null;
      if (p.diveBurst === 0) this.steer(p); if (this.isKeeper(p)) this.passiveControl(p); else this.tryControl(p);
    }
    // restart handling
    if (this.play === 'restart' && this.restart) this.tickRestart();
    this.phys.step();
    // touches via physical contacts
    for (const c of this.phys.contacts) {
      const p = this.byId.get(c.playerId)!;
      if (this.play === 'live' || this.play === 'restart') this.registerTouch(p, false);
    }
    const b = this.phys.ballState();
    this.updateShots(this.phys.contacts); this.updateOwner(); this.drainBumps();
    // stats: distance, stamina, possession
    const dv = this.advanceClock();
    for (const t of [this.teams.A, this.teams.B]) for (const p of t.players) {
      if (!p.onCourt) { p.stamina = Math.min(1, p.stamina + 0.00025 * dv * 0.02 + 0.00002); continue; }
      const s = this.pstate(p); const sp = Math.hypot(s.vx, s.vz); const stat = this.ps(p.cfg.id);
      const step = sp * dt; stat.distance += step; this.teamStats[t.id].distance += step; stat.secondsOnCourt += dv;
      const intensity = (sp / (4.6 + 2.6 * A01(p.cfg.attributes.maxSpeed))) ** 2;
      p.stamina = clamp(p.stamina - (intensity * dv / 2600) * (1.6 - 0.9 * A01(p.cfg.attributes.stamina)) + (sp < 1 ? 0.00004 * dv : 0), 0.05, 1);
    }
    if (this.play === 'live') {
      const poss = this.possessionTeam(); if (poss) this.teamStats[poss].possessionSeconds += dt;
      this.updateAttackClock(poss);
      this.checkAdvantage(); this.checkGkHold(); this.checkFouls();
      this.checkDribbles();
      this.checkGoalAndBounds();
    }
    if (this.phys.woodwork) this.momentumAcc.a += 0; // wood hits are recorded through shot outcome
    this.sampleMomentum();
    if (this.tick % MATCH.snapshotEveryTicks === 0) this.snapshot();
    this.scheduleAgents();
    this.checkPhase();
    void b;
  }

  /** soft trap: cushion an incoming ball when a player is receiving it (real velocity change, bounded by control) */
  private passiveControl(p: RP) {
    if (this.play !== 'live' || p.plan || p.touchCd > 0) return;
    const t = this.teams[p.team]; const b = this.phys.ballState(); const s = this.pstate(p);
    const d = dist(s.x, s.z, b.x, b.z); if (d > PHYS.kickReach + (this.isKeeper(p) ? 0.3 : 0) || b.y > 0.9) return;
    const rel = Math.hypot(b.vx - s.vx, b.vz - s.vz);
    const receiving = (t.passTarget && t.passTarget.id === p.cfg.id) || this.possessionTeam() === p.team;
    if (!receiving && !this.isKeeper(p)) return;
    if (rel > 2.5) { const k = (0.45 + 0.4 * A01(p.cfg.attributes.ballControl)) * this.staminaFactor(p); this.phys.kickBall(-(b.vx - s.vx) * k, 0, -(b.vz - s.vz) * k); p.touchCd = 0.15; this.registerTouch(p, false); if (t.passTarget?.id === p.cfg.id) t.passTarget = null; }
  }

  /** Goalkeeper dive: explosive but acceleration-limited (<= 32 m/s^2 for a short burst), not an instant velocity change. */
  private executeDive(p: RP) {
    if (p.diveTarget === null) return;
    if (p.diveBurst === 0) { p.diveDelay -= PHYS.dt; if (p.diveDelay > 0) return; p.diveBurst = 0.4; p.state = 'dive'; this.setAct(p, 'dive', 0.7); p.diveCd = 1.6; }
    const s = this.pstate(p); const a = p.cfg.attributes;
    const maxV = 3.2 + 3.4 * A01(a.agility) * (0.5 + 0.5 * A01(a.goalkeeping));
    const want = clamp((p.diveTarget - s.z) * 4.5, -maxV, maxV);
    this.phys.accelPlayer(p.cfg.id, 0, clamp((want - s.vz) / PHYS.dt, -32, 32), PHYS.dt);
    p.diveBurst -= PHYS.dt; if (p.diveBurst <= 0) { p.diveBurst = 0; p.diveTarget = null; }
  }

  private updateAttackClock(poss: TeamId | null) {
    const b = this.phys.ballState();
    for (const t of ['A', 'B'] as TeamId[]) {
      const inOppHalf = (b.x * this.teams[t].dir) > 0;
      this.attackClock[t] = poss === t && inOppHalf ? this.attackClock[t] + PHYS.dt : poss === t ? this.attackClock[t] : 0;
    }
  }

  /** The owner keeps the ball only while it stays at his feet. */
  private updateOwner() {
    if (!this.owner) return; const p = this.byId.get(this.owner); const b = this.phys.ballState();
    if (!p || !p.onCourt || b.y > 0.9 || this.play === 'restart') { this.owner = null; return; }
    const s = this.pstate(p); if (dist(s.x, s.z, b.x, b.z) > 1.6) this.owner = null;
  }
  private drainBumps() { for (const k of this.phys.bumps) { this.bumpCount++; this.bumps.push({ t: this.rt, ...k }); if (this.bumps.length > 40) this.bumps.shift(); } }

  /**
   * Controlling a ball is a skill, not magnetism. A player whose feet meet the ball tries to cushion it: success depends on ball control,
   * how hard it arrives, pressure and tiredness. Success makes him the owner (the ball moves with him); failure is a heavy touch that squirts the ball away.
   * Hard shots and clearances are left to the physics (block / deflection).
   */
  private tryControl(p: RP) {
    if (this.play !== 'live' || p.touchCd > 0) return; if (p.plan && p.plan.type !== 'dribble' && this.rt < p.plan.until) return;
    const b = this.phys.ballState(); if (b.y > 0.6) return; const s = this.pstate(p);
    if (dist(s.x, s.z, b.x, b.z) > 0.66 || this.owner === p.cfg.id) return;
    const holder = this.owner ? this.byId.get(this.owner) : null; if (holder && holder !== p) { const hs = this.pstate(holder); if (dist(hs.x, hs.z, b.x, b.z) < 1.0) return; } // someone else is in control: take it by tackling, not by magnetism
    const rvx = b.vx - s.vx, rvz = b.vz - s.vz; const rel = Math.hypot(rvx, rvz); if (rel > 9.5) return;
    const t = this.teams[p.team]; const intended = !!t.passTarget && t.passTarget.id === p.cfg.id && t.passTarget.until > this.rt;
    const pr = nearestOpp(this.pv(p), this.onCourt(OTHER(p.team)).map((o) => this.pv(o)));
    const prob = clamp(0.94 - 0.1 * Math.max(0, rel - 2.6) + 0.34 * (A01(p.cfg.attributes.ballControl) - 0.55) - (pr < 1.1 ? 0.12 : 0) + (intended ? 0.06 : 0) - (1 - this.staminaFactor(p)) * 0.15, 0.18, 0.97);
    p.touchCd = 0.3;
    if (this.rng.next() < prob) {
      const hx = Math.cos(p.heading), hz = Math.sin(p.heading);
      this.phys.kickBall(s.vx + hx * 0.7 - b.vx, -b.vy * 0.9, s.vz + hz * 0.7 - b.vz);
      this.owner = p.cfg.id; this.ownerSince = this.rt; this.registerTouch(p, false); this.setAct(p, 'receive', 0.4); p.touchCd = intended ? 0.1 : 0.2;
      if (intended) t.passTarget = null;
    } else {
      this.phys.kickBall(-rvx * 0.45 + this.rng.gauss() * 1.1, 0, -rvz * 0.45 + this.rng.gauss() * 1.1);
      this.registerTouch(p, false); this.setAct(p, 'miscontrol', 0.3); p.touchCd = 0.5;
    }
  }
  private ownerSince = 0;

  /** A tackle is a contest, not a collision: skill, timing (facing, closing speed) against the carrier's control and dribbling. */
  private tackle(d: RP, c: RP) {
    d.tackleCd = 1.4; const ds = this.pstate(d), cs = this.pstate(c), b = this.phys.ballState();
    const dx = cs.x - ds.x, dz = cs.z - ds.z, L = Math.hypot(dx, dz) || 1;
    let e = Math.atan2(dz, dx) - d.heading; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    const closing = ((ds.vx - cs.vx) * dx + (ds.vz - cs.vz) * dz) / L; const skillC = 0.5 * A01(c.cfg.attributes.ballControl) + 0.5 * A01(c.cfg.attributes.dribbling);
    const win = clamp(0.3 + 0.5 * (A01(d.cfg.attributes.tackling) - 0.65 * skillC) + 0.03 * clamp(closing, 0, 5) - (Math.abs(e) < 1.2 ? 0 : 0.18), 0.08, 0.82);
    this.setAct(d, 'tackle', 0.55); d.heading = Math.atan2(dz, dx);
    if (this.rng.next() >= win) return;
    const ux = -dx / L * 0.6 + this.teams[d.team].dir * 0.8, uz = -dz / L * 0.6; const un = Math.hypot(ux, uz) || 1;
    this.phys.kickBall((ux / un) * 3.4 - b.vx, 0, (uz / un) * 3.4 - b.vz);
    this.owner = null; c.touchCd = 0.7; d.touchCd = 0; this.teamStats[d.team].tackles++; this.ps(d.cfg.id).tackles++; this.registerTouch(d, true);
    this.push('tackle', { team: d.team, playerId: d.cfg.id, detail: `from ${c.cfg.id}` });
  }

  private checkDribbles() {
    this.dribbleWatch = this.dribbleWatch.filter((d) => {
      if (this.rt - d.rt < 1.5) return true;
      if (this.lastTouch && this.lastTouch.team === d.team) this.teamStats[d.team].dribblesOk++;
      return false;
    });
  }

  private tickRestart() {
    const r = this.restart!; r.timer += PHYS.dt;
    const taker = this.byId.get(r.takerId)!;
    if (!taker.onCourt) { // taker substituted/dismissed: pick another
      const alt = this.onCourt(r.team).find((p) => !this.isKeeper(p)); if (alt) r.takerId = alt.cfg.id; return;
    }
    // a kick that was planned but not struck (the ball was knocked away, or the taker lost his footing) is re-planned from scratch instead of waiting for the timeout
    if (taker.plan && !r.kicked && r.readyAt !== null && r.timer - r.readyAt > 0.6) { taker.plan = null; r.readyAt = null; r.aim = undefined; }
    if (!this.takerSetDone(r)) {
      const s = this.pstate(taker); const b = this.phys.ballState();
      if (!r.aim && r.type !== 'penalty_kick' && !(r.type === 'free_kick' && dist(r.x, r.z, this.teams[r.team].dir * halfL, 0) < 13 && !r.indirect) && dist(s.x, s.z, b.x, b.z) < 5) {
        const o = this.passOptions(taker)[0]; if (o) { const dx = o.tx - b.x, dz = o.tz - b.z, L = Math.hypot(dx, dz) || 1; r.aim = [dx / L, dz / L]; }
      }
      const near = dist(s.x, s.z, b.x, b.z) < PHYS.kickReach - 0.02;
      // the referee waits until the wall is set (bounded by the restart timeout so a blocked wall can never freeze play)
      const wallSet = r.wall.length === 0 || r.wall.every((id) => { const q = this.byId.get(id)!; const ws = this.pstate(q); return !q.onCourt || dist(ws.x, ws.z, q.tx, q.tz) < 1.0; }) || r.timer > r.minWait + 3 * this.waitScale + 1;
      const ready = near && r.timer >= r.minWait && wallSet;
      if (ready && r.readyAt === null) r.readyAt = r.timer;
      if (r.readyAt !== null || r.timer > r.minWait + (MATCH.restartTimeoutSeconds + 6) * this.waitScale) { if (!taker.plan) this.performRestartKick(); }
    }
    // kick done when the ball has moved
    const b = this.phys.ballState();
    if (this.takerSetDone(r) && (Math.hypot(b.vx, b.vz) > 0.4 || dist(b.x, b.z, r.x, r.z) > 0.5)) {
      this.restartLive = r.indirect || true ? r : null; this.restart = null; this.play = 'live'; this.restartKickTime = this.rt;
    }
  }
  restartKickTime = 0;
  private takerSetDone(r: Restart) { return r.kicked; }

  // ---------------------------------------------------------------- clock & phases
  private advanceClock(): number {
    const b = this.phys.ballState();
    let mode: ClockMode = 'inactive';
    if (this.play === 'live') {
      const nearGoal = Math.min(Math.abs(b.x - halfL), Math.abs(b.x + halfL)) < 9 && Math.abs(b.z) < 8;
      const shotOpen = this.shotLog.some((s) => !s.resolved);
      mode = nearGoal || shotOpen ? 'important' : 'active';
    }
    this.clockMode = mode;
    const limit = this.half === 1 ? MATCH.halfSeconds : MATCH.virtualMatchSeconds;
    if (this.play === 'halftime') { this.halftimeTimer += PHYS.dt; return 0; }
    return this.clock.tick(PHYS.dt, mode, limit, true);
  }

  private checkPhase() {
    if (this.play === 'halftime') {
      if (this.halftimeTimer >= MATCH.halftimePhysicsSeconds) { this.startSecondHalf(); }
      return;
    }
    const limit = this.half === 1 ? MATCH.halfSeconds : MATCH.virtualMatchSeconds;
    if (this.clock.vt >= limit - 1e-9) {
      if (this.half === 1) this.startHalftime(); else this.finishRegulation();
    }
  }
  private startHalftime() {
    this.phase = 'halftime'; this.play = 'halftime'; this.halftimeTimer = 0; this.restart = null; this.advantage = null;
    this.push('halftime'); this.finalizeShots();
    for (const t of [this.teams.A, this.teams.B]) { t.dir = (t.dir * -1) as 1 | -1; t.fouls = 0; t.trigger = 'halftime'; for (const p of t.players) { p.stamina = Math.min(1, p.stamina + 0.12); p.plan = null; } }
  }
  private startSecondHalf() {
    this.phase = 'second_half'; this.half = 2;
    const starter: TeamId = this.cfg.swapSides ? 'A' : 'B';
    this.startRestart('kickoff', starter, 0, 0, 6);
    this.push('kickoff', { team: starter, detail: 'second half' });
    this.lastTouch = null;
  }
  private finalizeShots() { for (const s of this.shotLog) if (!s.resolved) { s.resolved = true; s.outcome = s.outcome ?? 'unresolved'; } }
  private finishRegulation() {
    this.finalizeShots();
    this.phase = 'full_time'; this.play = 'over'; this.advantage = null;
    this.push('fulltime', { detail: `${this.score[0]}-${this.score[1]}` });
    this.snapshot();
    for (const [id, st] of this.playerStats) { st.rating = playerRating(st); void id; }
    for (const d of this.decisions) d.outcome = this.outcomeFor(d);
  }
  private outcomeFor(d: AiDecisionRecord): string {
    const goals = this.events.filter((e) => e.type === 'goal' && e.vt > d.vt && e.vt <= d.vt + 300);
    const own = goals.filter((g) => g.team === d.team).length, opp = goals.length - own;
    return `next 5 virtual min: scored ${own}, conceded ${opp}`;
  }

  // ---------------------------------------------------------------- AI scheduling
  private compact(t: TeamRT, trigger: string): CompactState {
    const o = OTHER(t.id); const b = this.phys.ballState(); const [bu, bv] = this.toTeam(t.id, b.x, b.z);
    const ts = this.teamStats; const tot = ts.A.possessionSeconds + ts.B.possessionSeconds || 1;
    const idx = t.id === 'A' ? 0 : 1;
    const poss = this.possessionTeam();
    return {
      team: t.id, trigger, vt: Math.round(this.vt), minute: Math.floor(this.vt / 60), half: this.half, minutesLeft: Math.max(0, Math.ceil((5400 - this.vt) / 60)),
      scoreOwn: this.score[idx], scoreOpp: this.score[1 - idx], possession: poss === null ? 'none' : poss === t.id ? 'own' : 'opp',
      ballU: Math.round(bu * 10) / 10, ballV: Math.round(bv * 10) / 10, possessionPct: Math.round((100 * ts[t.id].possessionSeconds) / tot),
      shotsOwn: ts[t.id].shots, shotsOpp: ts[o].shots, onTargetOwn: ts[t.id].onTarget, onTargetOpp: ts[o].onTarget,
      foulsOwnHalf: t.fouls, redOwn: ts[t.id].red, redOpp: ts[o].red,
      avgStamina: Math.round((this.onCourt(t.id).reduce((a, p) => a + p.stamina, 0) / Math.max(1, this.onCourt(t.id).length)) * 100) / 100,
      onCourt: this.onCourt(t.id).map((p) => { const s = this.pstate(p); const [u, v] = this.toTeam(t.id, s.x, s.z); return { id: p.cfg.id, role: p.cfg.role, u: Math.round(u * 10) / 10, v: Math.round(v * 10) / 10, stamina: Math.round(p.stamina * 100) / 100, yellow: p.yellow > 0 }; }),
      bench: t.players.filter((p) => !p.onCourt && !p.red).map((p) => ({ id: p.cfg.id, role: p.cfg.role, stamina: Math.round(p.stamina * 100) / 100 })),
      opponent: this.onCourt(o).map((p) => { const s = this.pstate(p); const [u, v] = this.toTeam(t.id, s.x, s.z); return { u: Math.round(u), v: Math.round(v) }; }),
      current: t.tactics,
    };
  }

  private scheduleAgents() {
    if (this.tick % 30 !== 0) return;
    for (const t of [this.teams.A, this.teams.B]) {
      if (t.pending) continue;
      const since = this.vt - t.lastDecisionVt;
      const minute = this.vt / 60;
      let trigger: string | null = null;
      if (t.trigger && since >= t.agent.cooldownVirtual) trigger = t.trigger;
      else if (since >= t.agent.intervalVirtual) trigger = 'interval';
      else if (t.trigger === null && ((minute >= 75 && t.lastDecisionVt < 75 * 60) || (minute >= 85 && t.lastDecisionVt < 85 * 60))) trigger = 'late_match';
      if (trigger) this.runAgents(trigger, false, t);
    }
  }

  private runAgents(trigger: string, both: boolean, only?: TeamRT) {
    const list = both ? [this.teams.A, this.teams.B] : only ? [only] : [];
    for (const t of list) {
      t.trigger = null; t.lastDecisionVt = this.vt;
      const state = this.compact(t, trigger); const version = t.version;
      const issuedVt = this.vt; const started = Date.now();
      let res: ReturnType<TeamAgent['decide']>;
      try { res = t.agent.decide(state, t.cfg); } catch (e) { res = { tactics: null, meta: { source: t.agent.architecture, error: String(e) } }; }
      if (res instanceof Promise) {
        t.pending = { trigger, promise: res.then((d) => { t.pending = null; this.applyDecision(t, d, state, trigger, version, issuedVt, Date.now() - started); }, (e) => { t.pending = null; this.applyDecision(t, { tactics: null, meta: { source: t.agent.architecture, error: String(e) } }, state, trigger, version, issuedVt, Date.now() - started); }) };
      } else this.applyDecision(t, res, state, trigger, version, issuedVt, 0);
    }
  }

  private applyDecision(t: TeamRT, d: { tactics: unknown; meta: DecisionMeta }, state: CompactState, trigger: string, version: number, issuedVt: number, latency: number) {
    const onIds = this.onCourt(t.id).map((p) => p.cfg.id); const benchIds = t.players.filter((p) => !p.onCourt && !p.red).map((p) => p.cfg.id);
    const meta: DecisionMeta = { ...d.meta, latencyMs: d.meta.latencyMs ?? latency };
    t.cost.calls++; t.cost.tokensIn += meta.tokensIn ?? 0; t.cost.tokensOut += meta.tokensOut ?? 0; t.cost.tokensCached += meta.tokensCached ?? 0; t.cost.latencyMs += meta.latencyMs ?? 0; t.cost.retries += meta.retries ?? 0;
    if (meta.costUsd === null) t.cost.unknownCost = true; else t.cost.costUsd += meta.costUsd ?? 0;
    const rec: AiDecisionRecord = { id: ++this.decSeq, vt: this.vt, team: t.id, trigger, architecture: t.agent.architecture, state: { minute: state.minute, scoreOwn: state.scoreOwn, scoreOpp: state.scoreOpp, possession: state.possession, avgStamina: state.avgStamina }, tactics: null, objective: '', accepted: false, meta, scoreDiffAtDecision: state.scoreOwn - state.scoreOpp };
    const v = d.tactics === null ? { ok: false, errors: [meta.error ?? 'no tactics returned'], tactics: undefined } : validateTactics(d.tactics, t.cfg, onIds, benchIds);
    if (v.ok && (t.version !== version || latency > STALE_RESPONSE_MS)) { rec.rejectReason = 'stale response (match state changed)'; this.decisions.push(rec); t.trigger = t.trigger ?? 'stale_retry'; return; }
    if (!v.ok) { // no built-in tactical AI: a failed or invalid answer changes nothing, the team keeps its current tactics
      rec.rejectReason = `invalid/failed: ${v.errors.slice(0, 3).join('; ')} (keeping current tactics)`; t.cost.failures++; this.decisions.push(rec); return;
    } else rec.accepted = true;
    if (!v.ok || !v.tactics) { this.decisions.push(rec); return; }
    const nt = v.tactics; const old = t.tactics;
    rec.tactics = nt; rec.objective = nt.reasonSummary; this.decisions.push(rec);
    if (nt.formation !== old.formation) this.push('formation_change', { team: t.id, detail: `${old.formation} -> ${nt.formation}` });
    if (nt.teamStrategy !== old.teamStrategy || nt.pressingIntensity !== old.pressingIntensity) this.push('tactical_change', { team: t.id, detail: `${nt.teamStrategy}: ${nt.reasonSummary}` });
    if (nt.flyingGoalkeeper !== old.flyingGoalkeeper) { t.flyingActive = nt.flyingGoalkeeper && this.gk(t.id) !== null; this.push('flying_gk', { team: t.id, detail: nt.flyingGoalkeeper ? 'on' : 'off' }); }
    t.tactics = nt;
    for (const s of nt.substitutions ?? []) t.queuedSubs.push(s);
  }

  // ---------------------------------------------------------------- snapshots / momentum
  private snapshot() {
    const b = this.phys.ballState(); const poss = this.possessionTeam();
    const players: Snapshot['players'] = [];
    for (const t of [this.teams.A, this.teams.B]) for (const p of t.players) {
      if (!p.onCourt) continue; const s = this.pstate(p);
      players.push({ id: p.cfg.id, x: +s.x.toFixed(2), z: +s.z.toFixed(2), vx: +s.vx.toFixed(2), vz: +s.vz.toFixed(2), h: +p.heading.toFixed(2), stamina: +p.stamina.toFixed(2), state: p.state });
    }
    this.snapshots.push({ vt: +this.vt.toFixed(1), rt: +this.rt.toFixed(2), phase: this.phase, play: this.play, ball: { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), vx: +b.vx.toFixed(2), vy: +b.vy.toFixed(2), vz: +b.vz.toFixed(2) }, players, score: [this.score[0], this.score[1]], possession: poss, own: this.owner });
  }
  private sampleMomentum() {
    if (this.tick % 600 !== 0) return;
    this.momentum.push({ vt: this.vt, a: this.momentumAcc.a, b: this.momentumAcc.b }); this.momentumAcc = { a: 0, b: 0 };
    this.possessionTimeline.push({ vt: this.vt, a: this.teamStats.A.possessionSeconds, b: this.teamStats.B.possessionSeconds });
  }

  // ---------------------------------------------------------------- driving
  /** Run the full regulation (and optionally the shootout). Yields to the event loop periodically so async AI responses can arrive. */
  async runRegulation(opts: { yieldEveryTicks?: number; realtime?: boolean; /** fast mode only: pause the simulation until each model answer has arrived, so no answer goes stale while the run races ahead of real time */ awaitAgents?: boolean; onStep?: (m: Match) => void; control?: RunControl } = {}) {
    const y = opts.yieldEveryTicks ?? 600; let n = 0;
    const startWall = Date.now(); let pausedMs = 0;
    while (this.phase !== 'full_time') {
      const c = opts.control;
      if (c?.stopped) return;
      if (c?.paused) { const t0 = Date.now(); while (c.paused && !c.stopped) await new Promise((r) => setTimeout(r, 40)); pausedMs += Date.now() - t0; continue; }
      this.step(); opts.onStep?.(this);
      if (opts.awaitAgents && this.tick % 30 === 0) await this.settleAgents(60_000);
      if (opts.realtime && this.tick % 6 === 0) { const target = this.rt * 1000; const el = Date.now() - startWall - pausedMs; if (target > el) await new Promise((r) => setTimeout(r, target - el)); }
      if (++n % y === 0) await new Promise((r) => setImmediate(r));
      if (this.tick > 6 * 60 * 60 * 60 * 2) throw new Error('simulation runaway guard tripped');
    }
  }

  result(): MatchResult {
    const [a, b] = this.score; const winner = a > b ? 'A' : b > a ? 'B' : null;
    if (!winner && this.shootout) return { regulationScore: [a, b], winner: this.shootout.winner, decidedBy: 'shootout', shootout: this.shootout, shootoutWinner: this.shootout.winner };
    return { regulationScore: [a, b], winner, decidedBy: winner ? 'regulation' : 'draw' };
  }
  /** Waits (bounded) for agent requests that are still in flight, e.g. so a fast, un-paced run records every answer. */
  async settleAgents(timeoutMs = 10_000) {
    const ps = [this.teams.A.pending?.promise, this.teams.B.pending?.promise].filter(Boolean) as Promise<void>[]; if (!ps.length) return;
    await Promise.race([Promise.allSettled(ps), new Promise((r) => setTimeout(r, timeoutMs))]);
  }
  /** True while this team's agent has a request in flight (an LLM is "thinking"). */
  isThinking(t: TeamId) { return this.teams[t].pending !== null; }
  ballWorld() { return this.phys.ballState(); }
  playerWorld(id: string) { return this.phys.playerState(id); }
  teamCost(t: TeamId) { return this.teams[t].cost; }
  dispose() { this.phys.free(); }
  attrs(id: string): Attributes { return this.byId.get(id)!.cfg.attributes; }
}
