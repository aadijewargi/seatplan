import { SeatplanError, type Instance } from "./model.ts";
import { shuffle, type Rng } from "./rng.ts";

/**
 * Find any assignment of units to tables that respects capacities and locks.
 * Packing parties into tables is bin packing (NP-hard), but best-fit
 * decreasing almost always succeeds on real seating problems; randomised
 * retries cover the rest. Returns null if every attempt fails.
 */
export function pack(inst: Instance, rng: Rng, attempts = 200): Int32Array | null {
  const { U, T, size, cap, lock } = inst;
  const free = Array.from({ length: U }, (_, u) => u).filter((u) => lock[u] < 0);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const assign = new Int32Array(U).fill(-1);
    const load = new Int32Array(T);
    for (let u = 0; u < U; u++) {
      if (lock[u] >= 0) {
        assign[u] = lock[u];
        load[lock[u]] += size[u];
      }
    }
    const order = attempt === 0 ? free.slice() : shuffle(rng, free.slice());
    // Big parties first; random tie-breaking on later attempts.
    order.sort((a, b) => size[b] - size[a]);
    let ok = true;
    for (const u of order) {
      let best = -1;
      let bestRoom = Infinity;
      for (let t = 0; t < T; t++) {
        const room = cap[t] - load[t] - size[u];
        if (room < 0) continue;
        // Attempt 0: best fit. Later: random fit among feasible tables.
        const k = attempt === 0 ? room : rng();
        if (k < bestRoom) {
          bestRoom = k;
          best = t;
        }
      }
      if (best < 0) {
        ok = false;
        break;
      }
      assign[u] = best;
      load[best] += size[u];
    }
    if (ok) return assign;
  }
  return null;
}

export function packOrThrow(inst: Instance, rng: Rng): Int32Array {
  const a = pack(inst, rng);
  if (!a) {
    throw new SeatplanError(
      "Could not fit the parties into the tables. Try adding a table or splitting a large party.",
    );
  }
  return a;
}

/**
 * Greedy baseline: seat units one by one (largest, most-connected first) at
 * the table where they gain the most. Used for benchmarks and as a quick
 * starting point. Falls back to plain packing if greedy paints itself into a corner.
 */
export function greedy(inst: Instance, rng: Rng): Int32Array {
  const { U, T, size, cap, lock, W } = inst;
  const assign = new Int32Array(U).fill(-1);
  const load = new Int32Array(T);
  for (let u = 0; u < U; u++) {
    if (lock[u] >= 0) {
      assign[u] = lock[u];
      load[lock[u]] += size[u];
    }
  }
  const degree = new Float64Array(U);
  for (let u = 0; u < U; u++) for (let v = 0; v < U; v++) degree[u] += Math.abs(W[u * U + v]);
  const order = Array.from({ length: U }, (_, u) => u)
    .filter((u) => lock[u] < 0)
    .sort((a, b) => size[b] - size[a] || degree[b] - degree[a]);
  for (const u of order) {
    let best = -1;
    let bestGain = -Infinity;
    for (let t = 0; t < T; t++) {
      if (load[t] + size[u] > cap[t]) continue;
      let gain = 0;
      for (let v = 0; v < U; v++) if (assign[v] === t) gain += W[u * U + v];
      // Prefer emptier tables on ties so that later units still fit.
      gain -= 1e-9 * load[t];
      if (gain > bestGain) {
        bestGain = gain;
        best = t;
      }
    }
    if (best < 0) return packOrThrow(inst, rng);
    assign[u] = best;
    load[best] += size[u];
  }
  return assign;
}
