import type { Guest, Problem, Relation, TableSpec } from "./model.ts";
import { mulberry32, randInt } from "./rng.ts";

export interface GenOptions {
  guests: number;
  /** Seats per table; tables are added until everyone fits plus `slack` seats. */
  tableSize: number;
  slack?: number;
  /** Probability that a guest starts a party with the next guest (couples). */
  partyRate?: number;
  likesPerGuest?: number;
  avoidsPerGuest?: number;
  nevers?: number;
  /** Number of friend circles (tags). */
  circles?: number;
}

/** Random but realistic-ish seating problems for tests and benchmarks. */
export function generateProblem(seed: number, o: GenOptions): Problem {
  const rng = mulberry32(seed);
  const n = o.guests;
  const guests: Guest[] = [];
  let party = 0;
  for (let i = 0; i < n; i++) {
    const g: Guest = { name: `G${i + 1}` };
    if (o.circles) g.tags = [`c${randInt(rng, o.circles)}`];
    guests.push(g);
  }
  for (let i = 0; i + 1 < n; i++) {
    if (!guests[i].party && rng() < (o.partyRate ?? 0)) {
      guests[i].party = guests[i + 1].party = `p${party++}`;
      if (guests[i].tags) guests[i + 1].tags = guests[i].tags;
      i++;
    }
  }
  const relations: Relation[] = [];
  const pick = (i: number) => {
    let j = randInt(rng, n - 1);
    if (j >= i) j++;
    return j;
  };
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < (o.likesPerGuest ?? 0); k++) relations.push({ a: `G${i + 1}`, b: `G${pick(i) + 1}`, kind: "like" });
    for (let k = 0; k < (o.avoidsPerGuest ?? 0); k++) {
      if (rng() < (o.avoidsPerGuest ?? 0) - k) relations.push({ a: `G${i + 1}`, b: `G${pick(i) + 1}`, kind: "avoid" });
    }
  }
  for (let k = 0; k < (o.nevers ?? 0); k++) {
    const i = randInt(rng, n);
    const j = pick(i);
    if (guests[i].party && guests[i].party === guests[j].party) continue;
    relations.push({ a: `G${i + 1}`, b: `G${j + 1}`, kind: "never" });
  }
  const seats = n + (o.slack ?? 0);
  const tables: TableSpec[] = [];
  for (let t = 0; t * o.tableSize < seats; t++) tables.push({ name: `T${t + 1}`, capacity: o.tableSize });
  return { guests, tables, relations };
}
