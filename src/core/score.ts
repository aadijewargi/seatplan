import type { Instance } from "./model.ts";

/** Unit-level objective (soft score minus HARD per violated "never" pair). */
export function objective(inst: Instance, assign: ArrayLike<number>): number {
  const { U, W } = inst;
  let s = inst.intra;
  for (let u = 0; u < U; u++) {
    for (let v = u + 1; v < U; v++) {
      if (assign[u] === assign[v]) s += W[u * U + v];
    }
  }
  return s;
}

export interface Evaluation {
  /** Sum of soft weights over guest pairs sharing a table. */
  soft: number;
  /** Number of "never" pairs sharing a table. */
  neverViolations: number;
  /** All hard constraints (capacity, parties, locks, never) hold. */
  feasible: boolean;
  problems: string[];
}

/**
 * Independent, guest-level evaluation of a seating. It does not use the unit
 * contraction at all, which makes it a useful cross-check in tests.
 */
export function evaluateGuests(inst: Instance, guestTable: ArrayLike<number>): Evaluation {
  const { N, T, G, guestNames, tableNames } = inst;
  const problems: string[] = [];
  const load = new Int32Array(T);
  for (let i = 0; i < N; i++) {
    const t = guestTable[i];
    if (!(t >= 0 && t < T)) problems.push(`${guestNames[i]} is not seated.`);
    else load[t]++;
  }
  for (let t = 0; t < T; t++) {
    if (load[t] > inst.cap[t]) problems.push(`${tableNames[t]} is over capacity (${load[t]}/${inst.cap[t]}).`);
  }
  for (const members of inst.units) {
    const t0 = guestTable[members[0]];
    if (members.some((g) => guestTable[g] !== t0)) {
      problems.push(`Party ${members.map((g) => guestNames[g]).join(" + ")} is split up.`);
    }
    const lk = inst.lock[inst.unitOf[members[0]]];
    if (lk >= 0 && t0 !== lk) problems.push(`${guestNames[members[0]]} is not at locked table ${tableNames[lk]}.`);
  }
  let neverViolations = 0;
  for (const [a, b] of inst.neverPairs) {
    if (guestTable[a] === guestTable[b]) {
      neverViolations++;
      problems.push(`${guestNames[a]} and ${guestNames[b]} must not share a table.`);
    }
  }
  let soft = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (guestTable[i] === guestTable[j]) soft += G[i * N + j];
    }
  }
  return { soft, neverViolations, feasible: problems.length === 0, problems };
}

export function unitToGuest(inst: Instance, assign: ArrayLike<number>): Int32Array {
  const out = new Int32Array(inst.N);
  for (let i = 0; i < inst.N; i++) out[i] = assign[inst.unitOf[i]];
  return out;
}

export interface GuestReport {
  name: string;
  table: string;
  /** Sum of this guest's weights to tablemates. */
  happiness: number;
  /** Tablemates this guest has a positive weight with. */
  friends: string[];
  /** Tablemates with a negative weight or a "never" relation. */
  conflicts: string[];
}

export interface Plan {
  tables: Array<{ name: string; capacity: number; guests: string[] }>;
  score: number;
  feasible: boolean;
  problems: string[];
  guests: GuestReport[];
}

export function toPlan(inst: Instance, assign: ArrayLike<number>): Plan {
  const gt = unitToGuest(inst, assign);
  const ev = evaluateGuests(inst, gt);
  const { N, G, guestNames, tableNames } = inst;
  const never = new Set(inst.neverPairs.map(([a, b]) => a * N + b));
  const tables = tableNames.map((name, t) => ({ name, capacity: inst.cap[t], guests: [] as string[] }));
  for (let i = 0; i < N; i++) tables[gt[i]]?.guests.push(guestNames[i]);
  const guests: GuestReport[] = [];
  for (let i = 0; i < N; i++) {
    const r: GuestReport = { name: guestNames[i], table: tableNames[gt[i]], happiness: 0, friends: [], conflicts: [] };
    for (let j = 0; j < N; j++) {
      if (j === i || gt[j] !== gt[i]) continue;
      const w = G[i * N + j];
      r.happiness += w;
      const isNever = never.has(Math.min(i, j) * N + Math.max(i, j));
      if (isNever || w < 0) r.conflicts.push(guestNames[j]);
      else if (w > 0) r.friends.push(guestNames[j]);
    }
    guests.push(r);
  }
  return { tables, score: ev.soft, feasible: ev.feasible, problems: ev.problems, guests };
}
