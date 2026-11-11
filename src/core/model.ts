/**
 * Problem model.
 *
 * A seating problem is a set of guests, a set of tables with capacities, and
 * pairwise preferences between guests. We maximise the total "happiness"
 *
 *     score = sum over pairs {i, j} seated at the same table of w(i, j)
 *
 * subject to hard constraints:
 *   - a table never holds more guests than its capacity,
 *   - members of the same party (couple, family) sit at the same table,
 *   - "never" pairs do not share a table,
 *   - locked guests stay at their table.
 *
 * Parties are contracted into atomic *units* before optimisation, so the
 * "same party" constraint holds by construction and the search space shrinks.
 */

export type RelationKind = "like" | "avoid" | "never";

export interface Guest {
  name: string;
  /** Guests with the same non-empty party label must share a table. */
  party?: string;
  /** Free-form tags ("college", "work", "kids"); sharing a tag earns `weights.tag`. */
  tags?: string[];
  /** Lock the guest (and their party) to the table with this name. */
  table?: string;
}

export interface Relation {
  a: string;
  b: string;
  kind: RelationKind;
}

export interface TableSpec {
  name: string;
  capacity: number;
}

export interface Weights {
  /** Added for each "a likes b" statement (mutual likes count twice). */
  like: number;
  /** Subtracted for each "a avoids b" statement. */
  avoid: number;
  /** Added for each tag two guests share. */
  tag: number;
}

export const DEFAULT_WEIGHTS: Weights = { like: 3, avoid: 5, tag: 1 };

export interface Problem {
  guests: Guest[];
  tables: TableSpec[];
  relations: Relation[];
  weights?: Partial<Weights>;
}

export class SeatplanError extends Error {
  override name = "SeatplanError";
}

/** Compiled, index-based form of a problem used by the solvers. */
export interface Instance {
  guestNames: string[];
  tableNames: string[];
  /** Number of guests, units and tables. */
  N: number;
  U: number;
  T: number;
  cap: Int32Array;
  /** units[u] = guest indices in unit u (a party, or a single guest). */
  units: number[][];
  size: Int32Array;
  unitOf: Int32Array;
  /** Guest-level soft weights, N*N symmetric, zero diagonal. */
  G: Float64Array;
  /** Unit-level soft weights, U*U symmetric, zero diagonal. */
  Ws: Float64Array;
  /** Unit-level objective weights: Ws minus HARD for every "never" pair. */
  W: Float64Array;
  /** 1 where two units contain a "never" pair. */
  hard: Uint8Array;
  /** Penalty per hard violation; larger than any achievable soft score swing. */
  HARD: number;
  /** Table index a unit is locked to, or -1. */
  lock: Int32Array;
  /** Soft score earned inside units (constant for every seating). */
  intra: number;
  /** Guest-level "never" pairs. */
  neverPairs: Array<[number, number]>;
}

const key = (s: string) => s.trim().toLowerCase();

export function resolveWeights(w?: Partial<Weights>): Weights {
  return { ...DEFAULT_WEIGHTS, ...(w ?? {}) };
}

export function compile(problem: Problem): Instance {
  const weights = resolveWeights(problem.weights);
  const guests = problem.guests;
  const N = guests.length;
  const T = problem.tables.length;
  if (N === 0) throw new SeatplanError("No guests.");
  if (T === 0) throw new SeatplanError("No tables.");

  const index = new Map<string, number>();
  guests.forEach((g, i) => {
    const k = key(g.name);
    if (!k) throw new SeatplanError(`Guest #${i + 1} has an empty name.`);
    if (index.has(k)) throw new SeatplanError(`Duplicate guest name "${g.name}".`);
    index.set(k, i);
  });

  const tableIndex = new Map<string, number>();
  const cap = new Int32Array(T);
  problem.tables.forEach((t, i) => {
    if (!Number.isInteger(t.capacity) || t.capacity < 1) {
      throw new SeatplanError(`Table "${t.name}" needs a positive whole-number capacity.`);
    }
    const k = key(t.name);
    if (tableIndex.has(k)) throw new SeatplanError(`Duplicate table name "${t.name}".`);
    tableIndex.set(k, i);
    cap[i] = t.capacity;
  });

  const find = (name: string): number => {
    const i = index.get(key(name));
    if (i === undefined) throw new SeatplanError(`Unknown guest "${name}".`);
    return i;
  };

  // Guest-level soft weights.
  const G = new Float64Array(N * N);
  const addG = (i: number, j: number, v: number) => {
    G[i * N + j] += v;
    G[j * N + i] += v;
  };
  const tagSets = guests.map((g) => new Set((g.tags ?? []).map(key).filter(Boolean)));
  for (let i = 0; i < N; i++) {
    const ti = tagSets[i];
    if (ti.size === 0) continue;
    for (let j = i + 1; j < N; j++) {
      let shared = 0;
      for (const t of tagSets[j]) if (ti.has(t)) shared++;
      if (shared) addG(i, j, shared * weights.tag);
    }
  }
  const neverPairs: Array<[number, number]> = [];
  const neverSeen = new Set<number>();
  for (const r of problem.relations) {
    const a = find(r.a);
    const b = find(r.b);
    if (a === b) throw new SeatplanError(`"${r.a}" has a relation with themself.`);
    if (r.kind === "like") addG(a, b, weights.like);
    else if (r.kind === "avoid") addG(a, b, -weights.avoid);
    else {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (!neverSeen.has(lo * N + hi)) {
        neverSeen.add(lo * N + hi);
        neverPairs.push([lo, hi]);
      }
    }
  }

  // Contract parties into units.
  const unitOf = new Int32Array(N).fill(-1);
  const units: number[][] = [];
  const partyUnit = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const p = key(guests[i].party ?? "");
    if (p) {
      let u = partyUnit.get(p);
      if (u === undefined) {
        u = units.length;
        units.push([]);
        partyUnit.set(p, u);
      }
      units[u].push(i);
      unitOf[i] = u;
    } else {
      unitOf[i] = units.length;
      units.push([i]);
    }
  }
  const U = units.length;
  const size = new Int32Array(U);
  units.forEach((m, u) => (size[u] = m.length));

  // Locks.
  const lock = new Int32Array(U).fill(-1);
  for (let i = 0; i < N; i++) {
    const tname = guests[i].table;
    if (!tname || !tname.trim()) continue;
    const t = tableIndex.get(key(tname));
    if (t === undefined) throw new SeatplanError(`"${guests[i].name}" is locked to unknown table "${tname}".`);
    const u = unitOf[i];
    if (lock[u] !== -1 && lock[u] !== t) {
      throw new SeatplanError(
        `Party "${guests[i].party}" is locked to two different tables.`,
      );
    }
    lock[u] = t;
  }

  // Unit-level weights.
  const Ws = new Float64Array(U * U);
  let intra = 0;
  let absTotal = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const v = G[i * N + j];
      if (v === 0) continue;
      absTotal += Math.abs(v);
      const ui = unitOf[i];
      const uj = unitOf[j];
      if (ui === uj) intra += v;
      else {
        Ws[ui * U + uj] += v;
        Ws[uj * U + ui] += v;
      }
    }
  }
  const HARD = 2 * absTotal + 1;
  const hard = new Uint8Array(U * U);
  for (const [a, b] of neverPairs) {
    const ua = unitOf[a];
    const ub = unitOf[b];
    if (ua === ub) {
      throw new SeatplanError(
        `"${guests[a].name}" and "${guests[b].name}" are in the same party but marked "never".`,
      );
    }
    hard[ua * U + ub] = 1;
    hard[ub * U + ua] = 1;
  }
  const W = new Float64Array(U * U);
  for (let k = 0; k < U * U; k++) W[k] = Ws[k] - (hard[k] ? HARD : 0);

  // Cheap feasibility checks (full bin-packing feasibility is NP-hard and is
  // left to the constructive heuristic, which reports failure clearly).
  const total = size.reduce((s, x) => s + x, 0);
  const totalCap = cap.reduce((s, x) => s + x, 0);
  if (total > totalCap) {
    throw new SeatplanError(`${total} guests but only ${totalCap} seats.`);
  }
  const maxCap = Math.max(...cap);
  for (let u = 0; u < U; u++) {
    const limit = lock[u] >= 0 ? cap[lock[u]] : maxCap;
    if (size[u] > limit) {
      throw new SeatplanError(
        `Party of ${size[u]} (${units[u].map((g) => guests[g].name).join(", ")}) does not fit at any table.`,
      );
    }
  }
  const lockedLoad = new Int32Array(T);
  for (let u = 0; u < U; u++) if (lock[u] >= 0) lockedLoad[lock[u]] += size[u];
  for (let t = 0; t < T; t++) {
    if (lockedLoad[t] > cap[t]) {
      throw new SeatplanError(`Too many guests locked to table "${problem.tables[t].name}".`);
    }
  }

  return {
    guestNames: guests.map((g) => g.name),
    tableNames: problem.tables.map((t) => t.name),
    N,
    U,
    T,
    cap,
    units,
    size,
    unitOf,
    G,
    Ws,
    W,
    hard,
    HARD,
    lock,
    intra,
    neverPairs,
  };
}
