import { describe, it, expect, beforeAll } from 'vitest';
import { PhysicsWorld, initPhysics } from '../src/physics';
import { PHYS } from '../src/config';

beforeAll(async () => { await initPhysics(); });
const run = (w: PhysicsWorld, s: number) => { for (let i = 0; i < s / PHYS.dt; i++) w.step(); };

describe('player physics', () => {
  it('accelerates gradually, never instantly', () => {
    const w = new PhysicsWorld(); w.addPlayer('p', 0, 0);
    for (let i = 0; i < 6; i++) { w.accelPlayer('p', 4, 0); w.step(); }
    const s = w.playerState('p');
    expect(s.vx).toBeGreaterThan(0.2); expect(s.vx).toBeLessThan(0.6); // ~ a*t = 0.4 m/s after 0.1s
    expect(s.x).toBeLessThan(0.05);
  });
  it('decelerates through damping + braking, momentum persists briefly', () => {
    const w = new PhysicsWorld(); w.addPlayer('p', 0, 0);
    for (let i = 0; i < 120; i++) { w.accelPlayer('p', 4, 0); w.step(); }
    const v0 = w.playerState('p').vx; expect(v0).toBeGreaterThan(3);
    run(w, 0.5); const v1 = w.playerState('p').vx;
    expect(v1).toBeGreaterThan(0); expect(v1).toBeLessThan(v0);
  });
  it('players collide and do not overlap', () => {
    const w = new PhysicsWorld(); w.addPlayer('a', -1, 0); w.addPlayer('b', 1, 0);
    for (let i = 0; i < 180; i++) { w.accelPlayer('a', 4, 0); w.accelPlayer('b', -4, 0); w.step(); }
    const a = w.playerState('a'), b = w.playerState('b');
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(PHYS.playerRadius * 2 - 0.05);
  });
});

describe('ball physics', () => {
  it('rolls and slows to a stop (rolling resistance)', () => {
    const w = new PhysicsWorld(); w.placeBall(0, PHYS.ballRadius, 0); w.kickBall(8, 0, 0);
    run(w, 1); const v1 = w.ballState().vx; expect(v1).toBeLessThan(8); expect(v1).toBeGreaterThan(3); // sliding->rolling transition loses speed via floor friction
    run(w, 15); expect(Math.hypot(w.ballState().vx, w.ballState().vz)).toBeLessThan(0.2);
  });
  it('bounces with energy loss', () => {
    const w = new PhysicsWorld(); w.placeBall(0, 3, 0);
    let maxAfter = 0, hit = false, prevVy = 0;
    for (let i = 0; i < 300; i++) { w.step(); const b = w.ballState(); if (prevVy < -1 && b.vy > 0) hit = true; if (hit) maxAfter = Math.max(maxAfter, b.y); prevVy = b.vy; }
    expect(hit).toBe(true); expect(maxAfter).toBeLessThan(3); expect(maxAfter).toBeGreaterThan(0.3);
  });
  it('hits the crossbar and reports woodwork', () => {
    const w = new PhysicsWorld(); w.placeBall(16, 1.95, 0); w.kickBall(20, 2, 0);
    let wood = false; for (let i = 0; i < 120; i++) { w.step(); wood ||= w.woodwork; }
    expect(wood).toBe(true);
  });
  it('is blocked by the goalpost', () => {
    const w = new PhysicsWorld(); w.placeBall(15, 0.1, 1.54); w.kickBall(18, 0, 0);
    let wood = false; for (let i = 0; i < 90; i++) { w.step(); wood ||= w.woodwork; }
    expect(wood).toBe(true);
  });
  it('stays inside the net behind the goal line after a goal', () => {
    const w = new PhysicsWorld(); w.placeBall(10, 0.3, 0); w.kickBall(20, 0, 0);
    run(w, 3); const b = w.ballState(); expect(b.x).toBeGreaterThan(20); expect(b.x).toBeLessThan(21.2);
  });
  it('fixed-step simulation of 10 minutes is stable (no NaN, bounded)', () => {
    const w = new PhysicsWorld(); for (let i = 0; i < 10; i++) w.addPlayer('p' + i, i - 5, i % 2);
    for (let i = 0; i < 36000; i++) {
      if (i % 90 === 0) w.kickBall(Math.sin(i), 0, Math.cos(i));
      for (let k = 0; k < 10; k++) w.accelPlayer('p' + k, Math.sin(i / 50 + k) * 4, Math.cos(i / 40 + k) * 4);
      w.step();
    }
    const b = w.ballState(); expect(Number.isFinite(b.x + b.y + b.z)).toBe(true);
    expect(Math.abs(b.x)).toBeLessThan(30); expect(b.y).toBeLessThan(8);
    for (let k = 0; k < 10; k++) { const s = w.playerState('p' + k); expect(Math.abs(s.x)).toBeLessThan(30); }
  });
  it('is deterministic for identical inputs', () => {
    const go = () => { const w = new PhysicsWorld(); w.addPlayer('p', 0, 0); w.placeBall(1, 0.1, 0);
      for (let i = 0; i < 300; i++) { w.accelPlayer('p', 3, 0.5); if (i === 50) w.kickBall(5, 1, 2); w.step(); } return w.ballState().x; };
    expect(go()).toBe(go());
  });
});
