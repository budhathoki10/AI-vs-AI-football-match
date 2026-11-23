import type { DB } from './db';
import type { Runner } from './runner';
import type { TeamInput, MatchInput } from './schemas';

type Dur = 1 | 2 | 3 | 4 | 5 | 6;
export interface PlayedMatch { id: number; scoreA: number; scoreB: number; winner: 'A' | 'B'; decidedBy: 'regulation' | 'shootout'; shootout?: [number, number] }

export const TIE_BREAK_POLICY = 'A drawn regulation is always settled by the physics-based penalty shootout (5 each, then sudden death). League points: regulation win 3, shootout win 2, shootout loss 1, loss 0. Standings order: points, goal difference (regulation goals), goals for, then name.';

export async function playHeadless(db: DB, runner: Runner, userId: number, a: TeamInput, b: TeamInput, minutes: Dur, seed: number, o: { tournamentId?: number; benchmarkId?: number; swapSides?: boolean; squadSeed?: number } = {}): Promise<PlayedMatch> {
  const input: MatchInput = { teamA: a, teamB: b, realDurationMinutes: minutes, seed, swapSides: o.swapSides, shootoutOnDraw: true, paced: false };
  const { id, done } = runner.start(userId, input, { headless: true, tournamentId: o.tournamentId, benchmarkId: o.benchmarkId, squadSeed: o.squadSeed });
  await done;
  const m = db.prepare('SELECT status, reg_score_a AS a, reg_score_b AS b, winner, decided_by AS d FROM matches WHERE id=?').get(id) as any;
  if (m.status !== 'finished') throw new Error(`match ${id} failed`);
  const so = db.prepare('SELECT winner, score_a AS a, score_b AS b FROM penalty_shootouts WHERE match_id=?').get(id) as any;
  return { id, scoreA: m.a, scoreB: m.b, winner: m.winner ?? so.winner, decidedBy: so ? 'shootout' : 'regulation', shootout: so ? [so.a, so.b] : undefined };
}

interface Row { name: string; played: number; won: number; wonSO: number; lostSO: number; lost: number; gf: number; ga: number; gd: number; points: number }
export function standings(names: string[], results: { home: string; away: string; m: PlayedMatch }[]): Row[] {
  const t = new Map<string, Row>(names.map((n) => [n, { name: n, played: 0, won: 0, wonSO: 0, lostSO: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }]));
  for (const { home, away, m } of results) {
    const h = t.get(home)!, a = t.get(away)!; h.played++; a.played++; h.gf += m.scoreA; h.ga += m.scoreB; a.gf += m.scoreB; a.ga += m.scoreA;
    const homeWon = m.winner === 'A'; const [w, l] = homeWon ? [h, a] : [a, h];
    if (m.decidedBy === 'shootout') { w.wonSO++; w.points += 2; l.lostSO++; l.points += 1; } else { w.won++; w.points += 3; l.lost++; }
  }
  for (const r of t.values()) r.gd = r.gf - r.ga;
  return [...t.values()].sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name));
}

export async function runTournament(db: DB, runner: Runner, userId: number, tid: number, inp: { format: string; teams: TeamInput[]; realDurationMinutes: Dur; seed?: number }) {
  const seed0 = inp.seed ?? 1000; const squadSeed = seed0 + 1; let n = 0; const names = inp.teams.map((t) => t.name);
  const play = (home: TeamInput, away: TeamInput) => playHeadless(db, runner, userId, home, away, inp.realDurationMinutes, seed0 + n++, { tournamentId: tid, squadSeed });
  const log: { home: string; away: string; m: PlayedMatch; round?: string }[] = [];
  const teamByName = new Map(inp.teams.map((t) => [t.name, t]));
  let result: Record<string, unknown> = {};
  if (inp.format === 'single') {
    const m = await play(inp.teams[0], inp.teams[1]); log.push({ home: names[0], away: names[1], m }); result = { champion: m.winner === 'A' ? names[0] : names[1] };
  } else if (inp.format === 'best_of_three') {
    const w = [0, 0];
    for (let g = 0; g < 3 && w[0] < 2 && w[1] < 2; g++) {
      const swap = g % 2 === 1; const home = inp.teams[swap ? 1 : 0], away = inp.teams[swap ? 0 : 1];
      const m = await play(home, away); const homeWon = m.winner === 'A'; const winnerIdx = (homeWon ? (swap ? 1 : 0) : swap ? 0 : 1); w[winnerIdx]++;
      log.push({ home: home.name, away: away.name, m, round: `game ${g + 1}` });
    }
    result = { seriesScore: w, champion: w[0] > w[1] ? names[0] : names[1] };
  } else if (inp.format === 'round_robin' || inp.format === 'league') {
    const legs = inp.format === 'league' ? 2 : 1;
    for (let leg = 0; leg < legs; leg++) for (let i = 0; i < inp.teams.length; i++) for (let j = i + 1; j < inp.teams.length; j++) {
      const [h, a] = leg === 0 ? [inp.teams[i], inp.teams[j]] : [inp.teams[j], inp.teams[i]]; const m = await play(h, a); log.push({ home: h.name, away: a.name, m, round: `leg ${leg + 1}` });
    }
    const table = standings(names, log); result = { table, champion: table[0].name };
  } else { // knockout with byes for non-power-of-two fields
    let alive = [...names]; let round = 1;
    while (alive.length > 1) {
      const next: string[] = []; const pairs: [string, string | null][] = [];
      for (let i = 0; i < alive.length; i += 2) pairs.push([alive[i], alive[i + 1] ?? null]);
      for (const [x, y] of pairs) {
        if (!y) { next.push(x); continue; }
        const m = await play(teamByName.get(x)!, teamByName.get(y)!); log.push({ home: x, away: y, m, round: `round ${round}` }); next.push(m.winner === 'A' ? x : y);
      }
      alive = next; round++;
    }
    result = { champion: alive[0] };
  }
  const full = { ...result, policy: TIE_BREAK_POLICY, matches: log.map((x) => ({ matchId: x.m.id, home: x.home, away: x.away, round: x.round, regulation: [x.m.scoreA, x.m.scoreB], shootout: x.m.shootout ?? null, winner: x.m.winner === 'A' ? x.home : x.away })) };
  db.prepare("UPDATE tournaments SET status='finished', result_json=? WHERE id=?").run(JSON.stringify(full), tid);
}

export const METRIC_DOCS: Record<string, string> = {
  winRate: 'Overall wins (regulation or shootout) divided by matches played.',
  regulationRecord: 'Wins/draws/losses after the 90:00 regulation only (a regulation draw is later settled by shootout).',
  avgGoalsFor: 'Mean regulation goals scored per match.', avgGoalsAgainst: 'Mean regulation goals conceded per match.',
  shotConversion: 'Goals / shots across all matches (real simulation data).',
  coordination: 'Pass accuracy (successful passes / passes) — a proxy for team coordination, not a direct measure.',
  possessionPct: 'Share of live ball time attributed to the team of the last touch.',
  discipline: 'Fouls plus 3x red cards per match (lower is better) — rule-compliance proxy.',
  decisionValidity: 'Share of agent decisions accepted by the validator without falling back (structured-output reliability).',
  decisionEffectiveness: 'Mean goal difference in the 5 virtual minutes after each accepted decision (noisy; needs many matches).',
  adaptability: 'Share of trigger-driven decisions (goal, red card, halftime, late match) that changed the team strategy.',
  latencyMsAvg: 'Mean provider latency per decision (0 for local algorithms).', tokensPerMatch: 'Mean input+output tokens per match.',
  costPerMatchUsd: 'Mean estimated API cost per match; null when pricing is unknown (never guessed).',
  pointsPerUsd: 'League-style points per estimated USD; null when cost is unknown or zero.',
};

export async function runBenchmark(db: DB, runner: Runner, userId: number, bid: number, inp: { teamA: TeamInput; teamB: TeamInput; matches: number; realDurationMinutes: Dur; swapSides: boolean; seed?: number }) {
  const seed0 = inp.seed ?? 5000; const squadSeed = seed0 + 1; const labels = { A: inp.teamA.name, B: inp.teamB.name };
  const agg = { A: init(), B: init() };
  for (let i = 0; i < inp.matches; i++) {
    const swapped = inp.swapSides && i % 2 === 1; const home = swapped ? inp.teamB : inp.teamA, away = swapped ? inp.teamA : inp.teamB;
    const m = await playHeadless(db, runner, userId, home, away, inp.realDurationMinutes, seed0 + i, { benchmarkId: bid, swapSides: false, squadSeed });
    db.prepare('INSERT INTO benchmark_results (benchmark_id,match_id,sides_swapped,label_a,label_b) VALUES (?,?,?,?,?)').run(bid, m.id, swapped ? 1 : 0, labels.A, labels.B);
    for (const side of ['A', 'B'] as const) {
      const lab: 'A' | 'B' = swapped ? (side === 'A' ? 'B' : 'A') : side; const a = agg[lab]; const mine = side === 'A' ? m.scoreA : m.scoreB, theirs = side === 'A' ? m.scoreB : m.scoreA;
      a.n++; a.gf += mine; a.ga += theirs; if (mine > theirs) a.rw++; else if (mine === theirs) a.rd++; else a.rl++;
      if (m.winner === side) { a.w++; a.points += m.decidedBy === 'shootout' ? 2 : 3; } else if (m.decidedBy === 'shootout') a.points += 1;
      const ts = JSON.parse((db.prepare('SELECT stats_json j FROM team_stats WHERE match_id=? AND team=?').get(m.id, side) as any).j);
      a.shots += ts.shots; a.goals += ts.goals; a.passes += ts.passes; a.passesOk += ts.passesOk; a.poss += ts.possessionSeconds; a.fouls += ts.fouls + 3 * ts.red;
      const ds = db.prepare('SELECT accepted, trigger, tactics_json t, outcome, latency_ms l, tokens_in ti, tokens_out to_, cost_usd c FROM ai_decisions WHERE match_id=? AND team=?').all(m.id, side) as any[];
      let last = ''; for (const d of ds) { a.dec++; if (d.accepted) a.decOk++; a.lat += d.l ?? 0; a.tok += (d.ti ?? 0) + (d.to_ ?? 0); if (d.c == null) a.costUnknown = true; else a.cost += d.c;
        if (d.accepted && d.outcome) { const mm = /scored (\d+), conceded (\d+)/.exec(d.outcome); if (mm) { a.eff += Number(mm[1]) - Number(mm[2]); a.effN++; } }
        if (['goal', 'red_card', 'red_card_opp', 'halftime', 'late_match'].includes(d.trigger) && d.accepted && d.t) { a.trig++; const strat = JSON.parse(d.t).teamStrategy; if (last && strat !== last) a.adapt++; last = strat; } else if (d.t) last = JSON.parse(d.t).teamStrategy; }
    }
  }
  const out = (k: 'A' | 'B') => { const a = agg[k]; const n = Math.max(1, a.n); const llm = (k === 'A' ? inp.teamA : inp.teamB).architecture === 'llm';
    return { label: labels[k], architecture: (k === 'A' ? inp.teamA : inp.teamB).architecture, model: (k === 'A' ? inp.teamA : inp.teamB).model ?? null, matches: a.n, wins: a.w, winRate: a.w / n, regulationRecord: { w: a.rw, d: a.rd, l: a.rl }, avgGoalsFor: a.gf / n, avgGoalsAgainst: a.ga / n,
      shotConversion: a.shots ? a.goals / a.shots : null, coordination: a.passes ? a.passesOk / a.passes : null, possessionPct: null as number | null, discipline: a.fouls / n, decisionValidity: a.dec ? a.decOk / a.dec : null,
      decisionEffectiveness: a.effN ? a.eff / a.effN : null, adaptability: a.trig ? a.adapt / a.trig : null, latencyMsAvg: llm && a.dec ? a.lat / a.dec : 0, tokensPerMatch: a.tok / n,
      costPerMatchUsd: llm ? (a.costUnknown ? null : a.cost / n) : 0, pointsPerUsd: llm && !a.costUnknown && a.cost > 0 ? a.points / a.cost : null, points: a.points, possessionSeconds: a.poss / n }; };
  const A = out('A'), B = out('B'); const tot = A.possessionSeconds + B.possessionSeconds || 1; A.possessionPct = (100 * A.possessionSeconds) / tot; B.possessionPct = 100 - A.possessionPct;
  const result = { models: [A, B], matches: inp.matches, sampleWarning: inp.matches < 10 ? `Only ${inp.matches} match(es): results are anecdotal and do not establish that one agent is better.` : 'Sample is moderate; treat differences within noise margins as inconclusive.',
    fairness: 'Same court, physics, rules, squad attributes, formations and starting positions for both sides; seeds are recorded; sides are swapped on odd matches when enabled.', seeds: Array.from({ length: inp.matches }, (_, i) => seed0 + i), metricDocs: METRIC_DOCS };
  db.prepare("UPDATE benchmark_runs SET status='finished', result_json=? WHERE id=?").run(JSON.stringify(result), bid);
}
const init = () => ({ n: 0, w: 0, rw: 0, rd: 0, rl: 0, gf: 0, ga: 0, shots: 0, goals: 0, passes: 0, passesOk: 0, poss: 0, fouls: 0, dec: 0, decOk: 0, lat: 0, tok: 0, cost: 0, costUnknown: false, eff: 0, effN: 0, trig: 0, adapt: 0, points: 0 });
