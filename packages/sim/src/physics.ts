import RAPIER from '@dimforge/rapier3d-compat';
import { COURT, PHYS } from './config';

let ready: Promise<void> | null = null;
/** Initialise the Rapier WASM module (idempotent). */
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

export interface Contact { playerId: string; speed: number }

interface Body { body: RAPIER.RigidBody; collider: RAPIER.Collider; id: string }

/**
 * Thin wrapper over a Rapier world: floor, ceiling, containment walls, two goals (posts, crossbar, nets),
 * one ball and N player bodies. Nothing here teleports dynamic bodies during play: players are driven by
 * acceleration-limited impulses, the ball only changes velocity through contacts, kicks (impulses) and rolling resistance.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private queue = new RAPIER.EventQueue(true);
  private ball: Body;
  private players = new Map<string, Body>();
  private byCollider = new Map<number, string>();
  contacts: Contact[] = [];
  /** collisions between two players in the last step: who, and the closing speed (m/s) */
  bumps: { a: string; b: string; v: number }[] = [];
  /** colliders (posts/crossbar) the ball hit this step — for rules/tests */
  woodwork = false;
  private woodHandles = new Set<number>();
  steps = 0;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: PHYS.gravity, z: 0 });
    this.world.timestep = PHYS.dt;
    this.buildArena();
    const bb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, PHYS.ballRadius + 0.001, 0)
        .setLinearDamping(PHYS.ballLinearDamping).setAngularDamping(PHYS.ballAngularDamping).setCcdEnabled(true));
    const bc = this.world.createCollider(
      RAPIER.ColliderDesc.ball(PHYS.ballRadius).setMass(PHYS.ballMass).setRestitution(PHYS.ballRestitution)
        .setFriction(PHYS.ballFriction).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), bb);
    this.ball = { body: bb, collider: bc, id: 'ball' };
  }

  private fixed(x: number, y: number, z: number, hx: number, hy: number, hz: number, rest = 0.3, wood = false) {
    const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    const c = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setRestitution(rest).setFriction(0.4)
        .setRestitutionCombineRule(rest < 0.1 ? RAPIER.CoefficientCombineRule.Min : RAPIER.CoefficientCombineRule.Average)
        .setActiveEvents(wood ? RAPIER.ActiveEvents.COLLISION_EVENTS : RAPIER.ActiveEvents.NONE), b);
    if (wood) this.woodHandles.add(c.handle);
    return c;
  }

  private buildArena() {
    const { halfL, halfW, margin, goalWidth, goalHeight, goalDepth, postRadius, ceiling } = COURT;
    // floor (top surface at y = 0), restitution tuned for a futsal ball
    this.fixed(0, -0.5, 0, halfL + margin + 5, 0.5, halfW + margin + 5, 0.6);
    this.fixed(0, ceiling + 0.5, 0, halfL + margin + 5, 0.5, halfW + margin + 5, 0.4);
    const wl = halfL + margin, ww = halfW + margin;
    this.fixed(wl + 0.5, 3.5, 0, 0.5, 4, ww + 1, 0.3); this.fixed(-wl - 0.5, 3.5, 0, 0.5, 4, ww + 1, 0.3);
    this.fixed(0, 3.5, ww + 0.5, wl + 1, 4, 0.5, 0.3); this.fixed(0, 3.5, -ww - 0.5, wl + 1, 4, 0.5, 0.3);
    const gz = goalWidth / 2;
    for (const s of [1, -1]) {
      const gx = s * halfL;
      this.fixed(gx, goalHeight / 2, gz + postRadius, postRadius, goalHeight / 2, postRadius, 0.5, true); // posts
      this.fixed(gx, goalHeight / 2, -gz - postRadius, postRadius, goalHeight / 2, postRadius, 0.5, true);
      this.fixed(gx, goalHeight + postRadius, 0, postRadius, postRadius, gz + 2 * postRadius, 0.5, true); // crossbar
      const nx = gx + s * (goalDepth + 0.05);
      this.fixed(nx, goalHeight / 2, 0, 0.05, goalHeight / 2 + 0.1, gz + 0.1, 0.05); // back net (dead)
      for (const t of [1, -1]) this.fixed(gx + (s * goalDepth) / 2, goalHeight / 2, t * (gz + 0.1), goalDepth / 2, goalHeight / 2 + 0.1, 0.05, 0.05); // side nets
      this.fixed(gx + (s * goalDepth) / 2, goalHeight + 0.1, 0, goalDepth / 2, 0.05, gz + 0.1, 0.05); // top net
    }
  }

  addPlayer(id: string, x: number, z: number, keeper = false) {
    const hh = (keeper ? 1.9 : PHYS.playerHeight) / 2;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, hh + 0.01, z).setLinearDamping(0.3)
        .lockRotations().setCanSleep(false));
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(hh, keeper ? 0.45 : PHYS.playerRadius).setMass(PHYS.playerMass).setRestitution(0.1)
        .setFriction(0.1).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    const b = { body, collider, id };
    this.players.set(id, b); this.byCollider.set(collider.handle, id);
  }

  removePlayer(id: string) {
    const b = this.players.get(id); if (!b) return;
    this.byCollider.delete(b.collider.handle);
    this.world.removeRigidBody(b.body); this.players.delete(id);
  }
  hasPlayer(id: string) { return this.players.has(id); }

  /** Place a body at rest (used only by the rules engine for restart set-up, never during live play). */
  placeBall(x: number, y: number, z: number) {
    this.ball.body.setTranslation({ x, y, z }, true);
    this.ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  placePlayer(id: string, x: number, z: number) { // used only for pre-kickoff / shootout set-up
    const b = this.players.get(id)!; b.body.setTranslation({ x, y: PHYS.playerHeight / 2 + 0.01, z }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  ballState() {
    const p = this.ball.body.translation(), v = this.ball.body.linvel(), w = this.ball.body.angvel();
    return { x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, wx: w.x, wy: w.y, wz: w.z };
  }
  playerState(id: string) {
    const b = this.players.get(id)!; const p = b.body.translation(), v = b.body.linvel();
    return { x: p.x, z: p.z, vx: v.x, vz: v.z };
  }

  /** Impulse that changes the ball velocity by (dvx,dvy,dvz): a kick. Speed is capped at maxBallSpeed. */
  kickBall(dvx: number, dvy: number, dvz: number) {
    const v = this.ball.body.linvel();
    let nx = v.x + dvx, ny = v.y + dvy, nz = v.z + dvz;
    const sp = Math.hypot(nx, ny, nz);
    if (sp > PHYS.maxBallSpeed) { const k = PHYS.maxBallSpeed / sp; nx *= k; ny *= k; nz *= k; dvx = nx - v.x; dvy = ny - v.y; dvz = nz - v.z; }
    this.ball.body.applyImpulse({ x: dvx * PHYS.ballMass, y: dvy * PHYS.ballMass, z: dvz * PHYS.ballMass }, true);
    // add backspin-free roll consistency
  }

  /** Accelerate a player: impulse = m * a * dt (acceleration-limited; no teleporting). */
  accelPlayer(id: string, ax: number, az: number, dt = PHYS.dt) {
    const b = this.players.get(id); if (!b) return;
    b.body.applyImpulse({ x: ax * PHYS.playerMass * dt, y: 0, z: az * PHYS.playerMass * dt }, true);
  }
  /** Goalkeeper dive: lateral + vertical-free impulse, bounded by caller. */
  impulsePlayer(id: string, dvx: number, dvz: number) {
    const b = this.players.get(id); if (!b) return;
    b.body.applyImpulse({ x: dvx * PHYS.playerMass, y: 0, z: dvz * PHYS.playerMass }, true);
  }

  step() {
    // rolling resistance only when the ball is on the floor
    const bs = this.ballState();
    if (bs.y < PHYS.ballRadius + 0.03) {
      const sp = Math.hypot(bs.vx, bs.vz);
      if (sp > 1e-3) {
        const d = Math.min(PHYS.rollingDecel * PHYS.dt, sp);
        this.ball.body.applyImpulse({ x: (-bs.vx / sp) * d * PHYS.ballMass, y: 0, z: (-bs.vz / sp) * d * PHYS.ballMass }, true);
      }
    }
    this.contacts = []; this.woodwork = false; this.bumps = [];
    this.world.step(this.queue);
    this.queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const ia = this.byCollider.get(h1), ib = this.byCollider.get(h2);
      if (ia && ib) { const va = this.players.get(ia)!.body.linvel(), vb = this.players.get(ib)!.body.linvel(); this.bumps.push({ a: ia, b: ib, v: Math.hypot(va.x - vb.x, va.z - vb.z) }); return; }
      const other = h1 === this.ball.collider.handle ? h2 : h2 === this.ball.collider.handle ? h1 : -1;
      if (other < 0) return;
      const pid = this.byCollider.get(other);
      if (pid) { const v = this.ball.body.linvel(); this.contacts.push({ playerId: pid, speed: Math.hypot(v.x, v.y, v.z) }); }
      else if (this.woodHandles.has(other)) this.woodwork = true;
    });
    this.steps++;
  }

  free() { this.world.free(); this.queue.free(); }
}
