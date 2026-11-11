import type { Instance } from "../src/core/model.ts";
import { objective } from "../src/core/score.ts";

/**
 * Reference solver: enumerate every assignment of units to tables (T^U),
 * keep the feasible ones (capacity + locks) and return the best objective.
 * Only for tiny instances, but obviously correct.
 */
export function bruteForce(inst: Instance): { score: number; assign: Int32Array | null; feasibleCount: number } {
  const { U, T, size, cap, lock } = inst;
  const assign = new Int32Array(U);
  const load = new Int32Array(T);
  let best = -Infinity;
  let bestAssign: Int32Array | null = null;
  let feasibleCount = 0;
  const rec = (u: number) => {
    if (u === U) {
      feasibleCount++;
      const s = objective(inst, assign);
      if (s > best) {
        best = s;
        bestAssign = assign.slice();
      }
      return;
    }
    for (let t = 0; t < T; t++) {
      if (lock[u] >= 0 && lock[u] !== t) continue;
      if (load[t] + size[u] > cap[t]) continue;
      assign[u] = t;
      load[t] += size[u];
      rec(u + 1);
      load[t] -= size[u];
    }
  };
  rec(0);
  return { score: best, assign: bestAssign, feasibleCount };
}

export const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
