/**
 * Snapshot interpolation track. The simulation streams positions at ~20 Hz; the scene renders at the display rate, a fixed delay behind the newest sample,
 * and blends the two samples around the render time. Motion is therefore exactly what the simulation computed (no chasing, no overshoot).
 * Angle channels are blended along the shortest arc.
 */
export class Track {
  private t: number[] = [];
  private v: number[][] = [];
  private ang: boolean[] = [];
  constructor(private n: number) {}
  reset() { this.t = []; this.v = []; }
  push(time: number, values: number[], angle: boolean[] = []) {
    this.ang = angle; this.t.push(time); this.v.push(values.slice(0, this.n));
    if (this.t.length > 12) { this.t.shift(); this.v.shift(); }
  }
  sample(time: number): number[] {
    const n = this.t.length;
    if (n === 0) return new Array(this.n).fill(0);
    if (n === 1 || time <= this.t[0]) return this.v[0];
    if (time >= this.t[n - 1]) return this.v[n - 1];
    let i = n - 2;
    while (i > 0 && this.t[i] > time) i--;
    const span = this.t[i + 1] - this.t[i] || 1; const k = (time - this.t[i]) / span; const a = this.v[i], b = this.v[i + 1];
    return a.map((x, j) => {
      if (this.ang[j]) { let d = b[j] - x; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return x + d * k; }
      return x + (b[j] - x) * k;
    });
  }
}
