import { MATCH } from './config';

export type ClockMode = 'active' | 'important' | 'inactive';

const WEIGHT: Record<ClockMode, number> = { active: 1, important: 0.45, inactive: 6 };
const MIN_FINISH_RATE = 60; // virtual s per physics s
const MAX_RATE = 1500; // virtual s per physics s; hard ceiling so dead time is never skipped instantly

/**
 * Adaptive virtual clock. Physics always runs at its fixed natural timestep; this only decides how many
 * virtual match seconds each physics step is worth. Inactive periods are compressed hardest, important
 * sequences (shots in flight, final-third attacks) least. The base rate is re-solved every step from the
 * remaining virtual time and the remaining real-time budget (physics seconds == real seconds when played at 1x).
 */
export class AdaptiveClock {
  vt = 0; // virtual seconds since kickoff
  physT = 0; // regulation physics seconds consumed (halftime excluded)
  private frac: Record<ClockMode, number> = { active: 0.55, important: 0.15, inactive: 0.3 };
  private acc: Record<ClockMode, { phys: number; virt: number }> = {
    active: { phys: 0, virt: 0 }, important: { phys: 0, virt: 0 }, inactive: { phys: 0, virt: 0 },
  };
  constructor(
    readonly realBudgetSeconds: number,
    readonly matchSeconds = MATCH.virtualMatchSeconds,
  ) {
    if (!Number.isFinite(realBudgetSeconds) || realBudgetSeconds <= 0) throw new Error('realBudgetSeconds must be > 0');
  }

  /**
   * Deadline pressure in [0,1]. While there is plenty of real time left the mode weights apply in full (important sequences
   * keep the slowest clock, dead time the fastest). As the real-time budget runs out the weights are blended towards 1 so the
   * remaining virtual time is spread evenly over whatever physics time is left: only the *clock* is squeezed, never movement.
   */
  pressure(): number {
    const pRem = this.realBudgetSeconds * 0.97 - this.physT;
    const lead = Math.max(5, this.realBudgetSeconds * 0.18);
    return Math.min(1, Math.max(0, 1 - pRem / lead));
  }
  private weight(mode: ClockMode, lambda = this.pressure()): number { return (1 - lambda) * WEIGHT[mode] + lambda; }

  baseRate(): number {
    const vRem = Math.max(0, this.matchSeconds - this.vt);
    const pRem = Math.max(this.realBudgetSeconds * 0.97 - this.physT, 0.5); // aim slightly early to absorb estimate error
    // a minimum finishing rate keeps the clock linear at the deadline (otherwise vRem/pRem decays asymptotically and never reaches 90:00)
    const overdue = this.physT > this.realBudgetSeconds * 0.97 - 0.5;
    const needed = overdue ? Math.max(vRem / pRem, vRem > 0 ? MIN_FINISH_RATE : 0) : vRem / pRem;
    const f = this.frac; const lam = this.pressure();
    const w = f.active * this.weight('active', lam) + f.important * this.weight('important', lam) + f.inactive * this.weight('inactive', lam);
    return needed / w;
  }

  rate(mode: ClockMode): number { return Math.min(MAX_RATE, this.baseRate() * this.weight(mode)); }

  /** Advance by one physics step. `limit` caps the virtual time (45:00 / 90:00). Returns virtual seconds advanced. */
  tick(dt: number, mode: ClockMode, limit: number, countsAgainstBudget = true): number {
    const want = this.rate(mode) * dt; const room = Math.max(0, limit - this.vt);
    const dv = want >= room - 1e-6 ? room : want;
    this.vt = want >= room - 1e-6 ? limit : this.vt + dv; // snap exactly onto 45:00 / 90:00
    if (countsAgainstBudget) this.physT += dt;
    const a = this.acc[mode]; a.phys += dt; a.virt += dv;
    const k = 0.002; // slow EMA of mode occupancy
    for (const m of Object.keys(this.frac) as ClockMode[]) this.frac[m] += k * ((m === mode ? 1 : 0) - this.frac[m]);
    return dv;
  }

  report() {
    const r = (m: ClockMode) => (this.acc[m].phys > 0 ? this.acc[m].virt / this.acc[m].phys : 0);
    const overrun = Math.max(0, this.physT - this.realBudgetSeconds);
    return {
      selectedRealSeconds: this.realBudgetSeconds,
      actualRealSeconds: this.physT,
      virtualSeconds: this.vt,
      meanActiveRate: r('active'), meanImportantRate: r('important'), meanInactiveRate: r('inactive'),
      overrunSeconds: overrun,
      note:
        'Physics runs at its natural fixed timestep. Virtual seconds per physics second is higher than 1 even in active play because a ' +
        `${this.matchSeconds / 60}-minute match is shown in ${this.realBudgetSeconds / 60} minutes; only the clock is compressed, never movement or forces.` +
        (overrun > 0.5 ? ` Budget overrun of ${overrun.toFixed(1)}s: natural play could not complete in the selected duration.` : ''),
    };
  }
}
