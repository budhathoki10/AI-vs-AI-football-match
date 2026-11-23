import { describe, it, expect } from 'vitest';
import { AdaptiveClock, MATCH, PHYS } from '../src';
import { Rng } from '../src/rng';

function simulate(minutes: number, seed: number) {
  const c = new AdaptiveClock(minutes * 60); const r = new Rng(seed);
  let mode: 'active' | 'important' | 'inactive' = 'active'; let left = 0; let half = 1;
  let guard = 0;
  while (true) {
    if (left <= 0) { const x = r.next(); mode = x < 0.45 ? 'active' : x < 0.6 ? 'important' : 'inactive'; left = 60 + r.next() * 400; }
    left--; const limit = half === 1 ? 2700 : 5400;
    c.tick(PHYS.dt, mode, limit);
    if (c.vt >= limit) { if (half === 1) half = 2; else break; }
    if (++guard > 60 * 3600) throw new Error('did not finish');
  }
  return c;
}

describe('adaptive virtual clock', () => {
  it('offers exactly the six real-world durations 1..6 minutes', () => {
    expect([...MATCH.allowedRealDurationsMin]).toEqual([1, 2, 3, 4, 5, 6]);
  });
  for (const min of [1, 2, 3, 4, 5, 6]) {
    it(`reaches exactly 45:00 and 90:00 virtual for a ${min}-minute real duration`, () => {
      const c = simulate(min, min);
      expect(c.vt).toBe(5400);
      const rep = c.report();
      expect(rep.selectedRealSeconds).toBe(min * 60);
      expect(Math.abs(rep.actualRealSeconds - min * 60) / (min * 60)).toBeLessThan(0.2);
    });
  }
  it('compresses inactive time harder than active, and important least', () => {
    const c = new AdaptiveClock(180);
    expect(c.rate('inactive')).toBeGreaterThan(c.rate('active')); expect(c.rate('active')).toBeGreaterThan(c.rate('important'));
  });
  it('snaps to the half limit and never overshoots', () => {
    const c = new AdaptiveClock(60); for (let i = 0; i < 100000 && c.vt < 2700; i++) c.tick(PHYS.dt, 'inactive', 2700);
    expect(c.vt).toBe(2700); expect(c.tick(PHYS.dt, 'inactive', 2700)).toBe(0);
  });
  it('reports overruns instead of hiding them', () => {
    const c = new AdaptiveClock(10); for (let i = 0; i < 60 * 30; i++) c.tick(PHYS.dt, 'active', 5400, true);
    expect(c.report().overrunSeconds).toBeGreaterThan(5); expect(c.report().note).toContain('overrun');
  });
  it('rejects invalid budgets', () => { expect(() => new AdaptiveClock(0)).toThrow(); expect(() => new AdaptiveClock(NaN)).toThrow(); });
  it('does not alter the physics timestep (clock only returns virtual seconds)', () => {
    const c = new AdaptiveClock(60); const dv = c.tick(PHYS.dt, 'active', 5400);
    expect(PHYS.dt).toBeCloseTo(1 / 60, 10); expect(dv).toBeGreaterThan(PHYS.dt);
  });
});
