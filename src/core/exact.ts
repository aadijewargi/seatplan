import type { Instance } from "./model.ts";
import { objective } from "./score.ts";

export interface ExactOptions {
  /** A known feasible seating (e.g. from annealing) to prune against. */
  incumbent?: ArrayLike<number>;
  /** Give up after this many search nodes; the result is then not proven optimal. */
  nodeLimit?: number;
}

export interface ExactResult {
  assign: Int32Array | null;
  score: number;
  /** True if the search finished, i.e. `score` is the proven optimum. */
  optimal: boolean;
  nodes: number;
}

/**
 * Exact branch and bound. Units are placed one at a time (locked units first,
 * then the most strongly connected). A node is pruned when either upper bound
 * cannot beat the best seating found so far:
 *
 *   1. current score + every positive weight on a pair not yet decided
 *      (precomputed suffix sums, O(1));
 *   2. current score + for each unplaced unit, its best gain at a table with
 *      room plus half its top-K positive weights, K = seats it could still
 *      share (O(U*T), much tighter when tables are small).
 *
 * Interchangeable empty
 * tables (same capacity, nothing locked there) are tried only once, which
 * removes the factorial table-relabelling symmetry.
 *
 * Practical up to roughly 15-25 units depending on structure; used to certify
 * the annealer on small instances and by the "prove optimal" button.
 */
export function solveExact(inst: Instance, opts: ExactOptions = {}): ExactResult {
  const { U, T, W, size, cap, lock } = inst;
  const nodeLimit = opts.nodeLimit ?? 5_000_000;

  const strength = new Float64Array(U);
  for (let u = 0; u < U; u++) for (let v = 0; v < U; v++) strength[u] += Math.abs(W[u * U + v]);
  const order = Array.from({ length: U }, (_, u) => u).sort((a, b) => {
    const la = lock[a] >= 0 ? 1 : 0;
    const lb = lock[b] >= 0 ? 1 : 0;
    return lb - la || strength[b] - strength[a] || size[b] - size[a];
  });

  // B[k] = positive weight on pairs whose later member is at position >= k.
  const B = new Float64Array(U + 1);
  for (let k = U - 1; k >= 0; k--) {
    const u = order[k];
    let s = 0;
    for (let j = 0; j < k; j++) s += Math.max(0, W[u * U + order[j]]);
    B[k] = B[k + 1] + s;
  }

  // Per-unit prefix sums of positive weights, largest first: pref[u][k] is the
  // most u can gain from k tablemates.
  const pref: Float64Array[] = [];
  for (let u = 0; u < U; u++) {
    const ws: number[] = [];
    for (let v = 0; v < U; v++) if (v !== u && W[u * U + v] > 0) ws.push(W[u * U + v]);
    ws.sort((x, y) => y - x);
    const p = new Float64Array(ws.length + 1);
    ws.forEach((w, i) => (p[i + 1] = p[i] + w));
    pref.push(p);
  }
  // gt[u*T + t] = weight from unit u to the units already placed at table t.
  const gt = new Float64Array(U * T);
  const place = (v: number, t: number, sign: 1 | -1) => {
    for (let u = 0; u < U; u++) gt[u * T + t] += sign * W[u * U + v];
  };

  /**
   * Tighter bound: every unplaced unit u gains at most
   *   max over tables with room of gt[u, t]          (pairs with placed units)
   *   + half the sum of its best K positive weights   (pairs with unplaced units)
   * where K is the most tablemates it could still get. Returns -Infinity if
   * some unit no longer fits anywhere.
   */
  const unitBound = (k: number): number => {
    let maxRoom = 0;
    for (let t = 0; t < T; t++) maxRoom = Math.max(maxRoom, cap[t] - load[t]);
    let s = 0;
    for (let j = k; j < U; j++) {
      const u = order[j];
      let bestT = -Infinity;
      for (let t = 0; t < T; t++) {
        if (lock[u] >= 0 && t !== lock[u]) continue;
        if (load[t] + size[u] > cap[t]) continue;
        if (gt[u * T + t] > bestT) bestT = gt[u * T + t];
      }
      if (bestT === -Infinity) return -Infinity;
      const K = Math.min(maxRoom - size[u], pref[u].length - 1);
      s += bestT + (K > 0 ? 0.5 * pref[u][K] : 0);
    }
    return s;
  };

  const tableHasLock = new Uint8Array(T);
  for (let u = 0; u < U; u++) if (lock[u] >= 0) tableHasLock[lock[u]] = 1;

  const assign = new Int32Array(U).fill(-1);
  const load = new Int32Array(T);
  let best: Int32Array | null = opts.incumbent ? Int32Array.from(opts.incumbent) : null;
  let bestScore = best ? objective(inst, best) : -Infinity;
  let nodes = 0;
  let aborted = false;

  const recurse = (k: number, cur: number): void => {
    if (aborted) return;
    if (++nodes > nodeLimit) {
      aborted = true;
      return;
    }
    if (k === U) {
      if (cur > bestScore + 1e-9) {
        bestScore = cur;
        best = assign.slice();
      }
      return;
    }
    if (cur + B[k] <= bestScore + 1e-9) return;
    if (cur + unitBound(k) <= bestScore + 1e-9) return;
    const u = order[k];
    const triedEmptyCap = new Set<number>();
    for (let t = 0; t < T; t++) {
      if (lock[u] >= 0 && t !== lock[u]) continue;
      if (load[t] + size[u] > cap[t]) continue;
      if (load[t] === 0 && !tableHasLock[t]) {
        if (triedEmptyCap.has(cap[t])) continue;
        triedEmptyCap.add(cap[t]);
      }
      const gain = gt[u * T + t];
      assign[u] = t;
      load[t] += size[u];
      place(u, t, 1);
      recurse(k + 1, cur + gain);
      place(u, t, -1);
      load[t] -= size[u];
      assign[u] = -1;
      if (aborted) return;
    }
  };

  recurse(0, inst.intra);
  return { assign: best, score: bestScore, optimal: !aborted && best !== null, nodes };
}
