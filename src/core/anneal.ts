import type { Instance } from "./model.ts";
import { greedy, packOrThrow } from "./construct.ts";
import { objective } from "./score.ts";
import { mulberry32, randInt, type Rng } from "./rng.ts";

export interface Progress {
  /** 0..1 across all restarts. */
  fraction: number;
  best: number;
  current: number;
  temperature: number;
  restart: number;
}

export interface AnnealOptions {
  seed?: number;
  /** Proposals per restart. Default scales with problem size. */
  iterations?: number;
  restarts?: number;
  /** Warm start, e.g. the seating after a manual edit. Must be feasible. */
  initial?: ArrayLike<number>;
  /** Called every `progressEvery` proposals; return false to stop early. */
  onProgress?: (p: Progress) => boolean | void;
  progressEvery?: number;
}

export interface AnnealResult {
  assign: Int32Array;
  /** Objective value (soft score minus HARD per violation). */
  score: number;
  iterations: number;
  accepted: number;
  /** Best objective at each progress tick (for convergence plots). */
  history: number[];
}

/**
 * Incremental state. S[u*T + t] caches the sum of weights from unit u to the
 * units currently at table t, so the score change of any move or swap costs
 * O(1) to evaluate and O(U) to apply.
 */
export class State {
  readonly S: Float64Array;
  readonly load: Int32Array;
  constructor(
    readonly inst: Instance,
    readonly assign: Int32Array,
  ) {
    const { U, T, W, size } = inst;
    this.S = new Float64Array(U * T);
    this.load = new Int32Array(T);
    for (let u = 0; u < U; u++) {
      this.load[assign[u]] += size[u];
      for (let v = 0; v < U; v++) if (v !== u) this.S[u * T + assign[v]] += W[u * U + v];
    }
  }
  moveDelta(u: number, b: number): number {
    const T = this.inst.T;
    return this.S[u * T + b] - this.S[u * T + this.assign[u]];
  }
  swapDelta(u: number, v: number): number {
    const { T, U, W } = this.inst;
    const a = this.assign[u];
    const b = this.assign[v];
    return (
      this.S[u * T + b] - this.S[u * T + a] + this.S[v * T + a] - this.S[v * T + b] - 2 * W[u * U + v]
    );
  }
  move(u: number, b: number): void {
    const { T, U, W, size } = this.inst;
    const a = this.assign[u];
    if (a === b) return;
    for (let w = 0; w < U; w++) {
      const x = W[w * U + u];
      if (x === 0) continue;
      this.S[w * T + a] -= x;
      this.S[w * T + b] += x;
    }
    this.load[a] -= size[u];
    this.load[b] += size[u];
    this.assign[u] = b;
  }
  canMove(u: number, b: number): boolean {
    return this.load[b] + this.inst.size[u] <= this.inst.cap[b];
  }
  canSwap(u: number, v: number): boolean {
    const { size, cap } = this.inst;
    const a = this.assign[u];
    const b = this.assign[v];
    const d = size[v] - size[u];
    return this.load[a] + d <= cap[a] && this.load[b] - d <= cap[b];
  }
}

/** Steepest-ascent local search over all moves and swaps until no improvement. */
export function polish(inst: Instance, assign: Int32Array): number {
  const st = new State(inst, assign);
  const { U, T, lock } = inst;
  let gained = 0;
  for (;;) {
    let bestD = 1e-9;
    let bu = -1;
    let bv = -1;
    let bt = -1;
    for (let u = 0; u < U; u++) {
      if (lock[u] >= 0) continue;
      for (let t = 0; t < T; t++) {
        if (t === assign[u] || !st.canMove(u, t)) continue;
        const d = st.moveDelta(u, t);
        if (d > bestD) [bestD, bu, bv, bt] = [d, u, -1, t];
      }
      for (let v = u + 1; v < U; v++) {
        if (lock[v] >= 0 || assign[v] === assign[u] || !st.canSwap(u, v)) continue;
        const d = st.swapDelta(u, v);
        if (d > bestD) [bestD, bu, bv, bt] = [d, u, v, -1];
      }
    }
    if (bu < 0) return gained;
    if (bv < 0) st.move(bu, bt);
    else {
      const a = assign[bu];
      st.move(bu, assign[bv]);
      st.move(bv, a);
    }
    gained += bestD;
  }
}

function calibrate(st: State, movable: number[], rng: Rng): { t0: number; tEnd: number } {
  const { T, HARD } = st.inst;
  const worse: number[] = [];
  for (let k = 0; k < 400; k++) {
    const u = movable[randInt(rng, movable.length)];
    const b = randInt(rng, T);
    if (b === st.assign[u]) continue;
    const d = st.moveDelta(u, b);
    if (d < 0 && -d < HARD / 2) worse.push(-d);
  }
  if (worse.length === 0) return { t0: 1, tEnd: 1e-3 };
  worse.sort((x, y) => x - y);
  const mean = worse.reduce((s, x) => s + x, 0) / worse.length;
  const small = worse[Math.floor(worse.length * 0.1)];
  // Start where an average worsening move is accepted half the time; end where
  // even a small one is accepted ~0.1% of the time.
  const t0 = mean / Math.LN2;
  const tEnd = Math.min(t0 / 10, small / Math.log(1000));
  return { t0, tEnd };
}

export function anneal(inst: Instance, opts: AnnealOptions = {}): AnnealResult {
  const rng = mulberry32(opts.seed ?? 1);
  const { U, T, lock } = inst;
  const movable = Array.from({ length: U }, (_, u) => u).filter((u) => lock[u] < 0);
  const restarts = Math.max(1, opts.restarts ?? 4);
  const iterations = opts.iterations ?? Math.min(2_000_000, Math.max(20_000, 4_000 * U));
  const every = opts.progressEvery ?? Math.max(1, Math.floor(iterations / 50));

  const start = opts.initial ? Int32Array.from(opts.initial) : greedy(inst, rng);
  let best = start.slice();
  let bestScore = objective(inst, best);
  const history: number[] = [];
  let totalIters = 0;
  let accepted = 0;

  if (movable.length === 0 || T < 2) {
    return { assign: best, score: bestScore, iterations: 0, accepted: 0, history: [bestScore] };
  }

  let stop = false;
  for (let r = 0; r < restarts && !stop; r++) {
    // Restart 0 starts from the warm start/greedy; later restarts alternate
    // between a perturbed copy of the best seating and a fresh random packing.
    let assign: Int32Array;
    if (r === 0) assign = start.slice();
    else if (r % 2 === 1) {
      assign = best.slice();
      const st0 = new State(inst, assign);
      for (let k = 0; k < Math.max(2, movable.length >> 3); k++) {
        const u = movable[randInt(rng, movable.length)];
        const b = randInt(rng, T);
        if (st0.canMove(u, b)) st0.move(u, b);
      }
    } else assign = packOrThrow(inst, rng);

    const st = new State(inst, assign);
    let cur = objective(inst, assign);
    const { t0, tEnd } = calibrate(st, movable, rng);
    const alpha = Math.pow(tEnd / t0, 1 / iterations);
    let temp = t0;

    for (let it = 0; it < iterations; it++, temp *= alpha) {
      if (it > 0 && it % every === 0) {
        totalIters = r * iterations + it;
        history.push(bestScore);
        const keepGoing = opts.onProgress?.({
          fraction: totalIters / (restarts * iterations),
          best: bestScore,
          current: cur,
          temperature: temp,
          restart: r,
        });
        if (keepGoing === false) {
          stop = true;
          break;
        }
      }
      const u = movable[randInt(rng, movable.length)];
      let delta: number;
      let v = -1;
      let b = -1;
      if (rng() < 0.5) {
        b = randInt(rng, T - 1);
        if (b >= assign[u]) b++;
        if (!st.canMove(u, b)) continue;
        delta = st.moveDelta(u, b);
      } else {
        v = movable[randInt(rng, movable.length)];
        if (assign[v] === assign[u] || !st.canSwap(u, v)) continue;
        delta = st.swapDelta(u, v);
      }
      if (delta >= 0 || rng() < Math.exp(delta / temp)) {
        if (v < 0) st.move(u, b);
        else {
          const a = assign[u];
          st.move(u, assign[v]);
          st.move(v, a);
        }
        cur += delta;
        accepted++;
        if (cur > bestScore + 1e-9) {
          bestScore = cur;
          best = assign.slice();
        }
      }
    }
    if (!stop) totalIters = (r + 1) * iterations;
  }

  polish(inst, best);
  bestScore = objective(inst, best);
  history.push(bestScore);
  return { assign: best, score: bestScore, iterations: totalIters, accepted, history };
}
