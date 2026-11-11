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
 * then the most strongly connected). At depth k the upper bound is
 *
 *     current score + sum of positive weights on every pair not yet decided,
 *
 * which is cheap (precomputed suffix sums) and valid. Interchangeable empty
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
    const u = order[k];
    const triedEmptyCap = new Set<number>();
    for (let t = 0; t < T; t++) {
      if (lock[u] >= 0 && t !== lock[u]) continue;
      if (load[t] + size[u] > cap[t]) continue;
      if (load[t] === 0 && !tableHasLock[t]) {
        if (triedEmptyCap.has(cap[t])) continue;
        triedEmptyCap.add(cap[t]);
      }
      let gain = 0;
      for (let j = 0; j < k; j++) {
        const v = order[j];
        if (assign[v] === t) gain += W[u * U + v];
      }
      assign[u] = t;
      load[t] += size[u];
      recurse(k + 1, cur + gain);
      load[t] -= size[u];
      assign[u] = -1;
      if (aborted) return;
    }
  };

  recurse(0, inst.intra);
  return { assign: best, score: bestScore, optimal: !aborted && best !== null, nodes };
}
