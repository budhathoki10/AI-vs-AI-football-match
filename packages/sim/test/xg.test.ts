import { describe, it, expect } from 'vitest';
import { xgOf, XG_MODEL, goalMouthAngle, COURT } from '../src';

describe('xG model', () => {
  const w = COURT.goalWidth;
  it('is a probability and falls with distance along the goal axis', () => {
    let prev = 1;
    for (let d = 1; d <= 20; d += 1) { const x = xgOf(d, 0, w); expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1); expect(x).toBeLessThanOrEqual(prev + 1e-12); prev = x; }
  });
  it('a central shot is worth more than the same distance from a tight angle', () => {
    expect(goalMouthAngle(6, 0, w)).toBeGreaterThan(goalMouthAngle(6, 8, w));
    expect(xgOf(6, 0, w)).toBeGreaterThan(xgOf(6, 8, w));
  });
  it('records its training provenance', () => { expect(XG_MODEL.trainedOn).toHaveProperty('shots'); expect(XG_MODEL.trainedOn.shots).toBeGreaterThan(0); });
});
