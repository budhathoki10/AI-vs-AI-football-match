import { describe, it, expect } from 'vitest';
import { HoldAgent, makeTeam, validateTactics, defaultTactics, Match, makeMatchConfig, initPhysics, type CompactState, type TeamAgent, type AgentDecision } from '../src';

const team = makeTeam('A', 'Test', { seed: 3 });
const mkState = (o: Partial<CompactState> = {}): CompactState => ({
  team: 'A', trigger: 'interval', vt: 4000, minute: 66, half: 2, minutesLeft: 24, scoreOwn: 0, scoreOpp: 1, possession: 'own', ballU: 3, ballV: 0,
  possessionPct: 50, shotsOwn: 3, shotsOpp: 4, onTargetOwn: 1, onTargetOpp: 2, foulsOwnHalf: 2, redOwn: 0, redOpp: 0, avgStamina: 0.7,
  onCourt: team.players.slice(0, 5).map((p, i) => ({ id: p.id, role: p.role, u: i, v: 0, stamina: 0.8, yellow: false })),
  bench: team.players.slice(5).map((p) => ({ id: p.id, role: p.role, stamina: 1 })), opponent: [], current: defaultTactics(team), ...o,
});
const on = team.players.slice(0, 5).map((p) => p.id), bench = team.players.slice(5).map((p) => p.id);

describe('no built-in tactical AI', () => {
  it('a team without a model keeps the default tactics and never decides on its own', async () => {
    await initPhysics();
    const m = await Match.create(makeMatchConfig({ seed: 5, minutes: 1 })); await m.runRegulation();
    expect(m.teams.A.tactics.teamStrategy).toBe(defaultTactics(team).teamStrategy); expect(m.decisions.every((d) => !d.accepted || d.meta.source === 'none')).toBe(true);
    expect(m.teams.A.tactics.formation).toBe(defaultTactics(team).formation);
  });
  it('HoldAgent decides nothing new', async () => {
    const d = await new HoldAgent().decide(mkState()); expect(validateTactics(d.tactics, team, on, bench).ok).toBe(true); expect((d.tactics as any).formation).toBe(defaultTactics(team).formation);
  });
});

describe('structured output validation', () => {
  const good = () => ({ formation: '2-2', teamStrategy: 'balanced', attackingStyle: 'possession', defensiveStyle: 'high_press', pressingIntensity: 0.75, riskLevel: 0.6, playerInstructions: [{ playerId: 'A2', instruction: 'support_build_up' }], reasonSummary: 'ok' });
  it('accepts the documented example', () => expect(validateTactics(good(), team, on, bench).ok).toBe(true));
  it('rejects invalid player ids', () => { const g: any = good(); g.playerInstructions[0].playerId = 'B2'; expect(validateTactics(g, team, on, bench).ok).toBe(false); });
  it('rejects bench players given on-court instructions', () => { const g: any = good(); g.playerInstructions[0].playerId = 'A7'; expect(validateTactics(g, team, on, bench).ok).toBe(false); });
  it('rejects unsupported instructions, formations and unsafe numbers', () => {
    for (const mut of [(g: any) => (g.playerInstructions[0].instruction = 'teleport_to_goal'), (g: any) => (g.formation = '5-0'), (g: any) => (g.riskLevel = 7), (g: any) => (g.pressingIntensity = NaN), (g: any) => (g.teamStrategy = 'rm -rf'), (g: any) => (g.flyingGoalkeeper = 'yes')]) {
      const g = good(); mut(g); expect(validateTactics(g, team, on, bench).ok).toBe(false);
    }
  });
  it('rejects duplicates, illegal substitutions and non-objects', () => {
    const g: any = good(); g.playerInstructions.push({ playerId: 'A2', instruction: 'hold_position' }); expect(validateTactics(g, team, on, bench).ok).toBe(false);
    const s: any = good(); s.substitutions = [{ out: 'A2', in: 'B7' }]; expect(validateTactics(s, team, on, bench).ok).toBe(false);
    for (const x of [null, 'x', 3, [], undefined]) expect(validateTactics(x, team, on, bench).ok).toBe(false);
  });
  it('never executes code: unknown extra fields are dropped', () => {
    const g: any = good(); g.run = 'process.exit(1)'; const v = validateTactics(g, team, on, bench); expect(v.ok).toBe(true); expect((v.tactics as any).run).toBeUndefined();
  });
});

describe('team-agent orchestration inside the match', () => {
  it('invalid / failing / hanging LLM-style agents never crash or block; the team keeps its current tactics and the failure is logged', async () => {
    await initPhysics();
    const invalid: TeamAgent = { architecture: 'llm', cooldownVirtual: 60, intervalVirtual: 300, decide: () => ({ tactics: { formation: 'bogus' }, meta: { source: 'llm:test' } }) };
    const hang: TeamAgent = { architecture: 'llm', cooldownVirtual: 60, intervalVirtual: 300, decide: () => new Promise<AgentDecision>(() => {}) };
    const m = await Match.create(makeMatchConfig({ seed: 2, minutes: 1 }), { A: invalid, B: hang });
    await m.runRegulation();
    expect(m.phase).toBe('full_time'); expect(m.vt).toBe(5400);
    const a = m.decisions.filter((d) => d.team === 'A'); expect(a.length).toBeGreaterThan(2);
    expect(a.every((d) => !d.accepted && d.rejectReason && d.tactics === null)).toBe(true); expect(m.teams.A.tactics.formation).toBe(defaultTactics(team).formation);
    expect(m.teams.A.cost.failures).toBeGreaterThan(0);
    expect(m.decisions.filter((d) => d.team === 'B').length).toBe(0); // hanging agent: still only its cached initial tactics
  });
  it('rejects stale asynchronous responses after the state changed', async () => {
    await initPhysics();
    let release!: (d: AgentDecision) => void;
    const slow: TeamAgent = { architecture: 'llm', cooldownVirtual: 60, intervalVirtual: 100000, decide: () => new Promise<AgentDecision>((r) => { release = r; }) };
    const m = await Match.create(makeMatchConfig({ seed: 2, minutes: 1 }), { A: slow });
    const cur = defaultTactics(m.cfg.teamA);
    m.teams.A.version++; // a goal / red card happened while the request was in flight
    release({ tactics: { ...cur, instructionsIgnored: 1 }, meta: { source: 'llm:test' } });
    await new Promise((r) => setTimeout(r, 5));
    const d = m.decisions.find((x) => x.team === 'A' && x.rejectReason?.includes('stale'));
    expect(d).toBeTruthy();
  });
  it('records decision review data with outcomes and cost/token meta', async () => {
    await initPhysics();
    const tracked: TeamAgent = { architecture: 'llm', cooldownVirtual: 60, intervalVirtual: 240, decide: (s) => { return { tactics: { ...s.current, riskLevel: 0.6, reasonSummary: 'test decision' }, meta: { source: 'llm:test', tokensIn: 400, tokensOut: 90, costUsd: 0.001, latencyMs: 800 } }; } };
    const m = await Match.create(makeMatchConfig({ seed: 4, minutes: 1 }), { A: tracked }); await m.runRegulation();
    const acc = m.decisions.filter((d) => d.team === 'A' && d.accepted); expect(acc.length).toBeGreaterThan(5);
    expect(acc[0].outcome).toMatch(/next 5 virtual min/); expect(acc[0].state.minute).toBeGreaterThanOrEqual(0);
    expect(m.teams.A.cost.tokensIn).toBe(400 * m.teams.A.cost.calls); expect(m.teams.A.cost.costUsd).toBeCloseTo(0.001 * m.teams.A.cost.calls, 6);
  });
});
