import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, type Problem } from "../src/core/model.ts";
import { anneal, polish, State } from "../src/core/anneal.ts";
import { solveExact } from "../src/core/exact.ts";
import { greedy, pack } from "../src/core/construct.ts";
import { evaluateGuests, objective, unitToGuest, toPlan } from "../src/core/score.ts";
import { generateProblem } from "../src/core/generate.ts";
import { solve } from "../src/core/index.ts";
import { mulberry32, randInt } from "../src/core/rng.ts";
import { bruteForce, close } from "./helpers.ts";

/** Small random instances with every feature switched on. */
function smallProblems(count: number): Problem[] {
  const out: Problem[] = [];
  for (let s = 1; out.length < count; s++) {
    const rng = mulberry32(s * 7919);
    const p = generateProblem(s, {
      guests: 5 + randInt(rng, 5), // 5..9 guests
      tableSize: 2 + randInt(rng, 3), // 2..4 seats
      slack: randInt(rng, 3),
      partyRate: 0.25,
      likesPerGuest: 1 + randInt(rng, 2),
      avoidsPerGuest: 0.5,
      nevers: randInt(rng, 3),
      circles: 3,
    });
    // Unequal capacities and an occasional lock.
    if (s % 3 === 0) p.tables[0].capacity += 1;
    if (s % 4 === 0) p.guests[randInt(rng, p.guests.length)].table = p.tables[randInt(rng, p.tables.length)].name;
    try {
      const inst = compile(p);
      if (pack(inst, rng)) out.push(p);
    } catch {
      // generator occasionally makes an impossible problem (e.g. locked party too big); skip it
    }
  }
  return out;
}

const cases = smallProblems(60);

test("unit-level objective agrees with an independent guest-level evaluation", () => {
  for (const p of cases) {
    const inst = compile(p);
    const rng = mulberry32(3);
    for (let k = 0; k < 20; k++) {
      const a = pack(inst, rng)!;
      const ev = evaluateGuests(inst, unitToGuest(inst, a));
      assert.ok(close(objective(inst, a), ev.soft - inst.HARD * ev.neverViolations));
      assert.equal(ev.problems.filter((m) => !m.includes("must not share")).length, 0, "packing is feasible");
    }
  }
});

test("incremental move/swap deltas match full recomputation", () => {
  for (const p of cases.slice(0, 30)) {
    const inst = compile(p);
    const rng = mulberry32(11);
    const assign = pack(inst, rng)!;
    const st = new State(inst, assign);
    let cur = objective(inst, assign);
    for (let k = 0; k < 300; k++) {
      const u = randInt(rng, inst.U);
      if (inst.lock[u] >= 0) continue;
      if (rng() < 0.5) {
        const b = randInt(rng, inst.T);
        if (b === assign[u] || !st.canMove(u, b)) continue;
        cur += st.moveDelta(u, b);
        st.move(u, b);
      } else {
        const v = randInt(rng, inst.U);
        if (inst.lock[v] >= 0 || assign[v] === assign[u] || !st.canSwap(u, v)) continue;
        cur += st.swapDelta(u, v);
        const a = assign[u];
        st.move(u, assign[v]);
        st.move(v, a);
      }
      assert.ok(close(cur, objective(inst, assign)));
      for (let t = 0; t < inst.T; t++) {
        let load = 0;
        for (let w = 0; w < inst.U; w++) if (assign[w] === t) load += inst.size[w];
        assert.equal(st.load[t], load);
        assert.ok(load <= inst.cap[t]);
      }
    }
  }
});

test("branch and bound matches brute force exactly", () => {
  for (const p of cases) {
    const inst = compile(p);
    const ref = bruteForce(inst);
    const ex = solveExact(inst);
    assert.equal(ex.optimal, true);
    assert.ok(close(ex.score, ref.score), `exact ${ex.score} vs brute ${ref.score}`);
    assert.ok(close(objective(inst, ex.assign!), ex.score));
  }
});

test("branch and bound with a good incumbent still proves the same optimum", () => {
  for (const p of cases.slice(0, 20)) {
    const inst = compile(p);
    const ref = bruteForce(inst);
    const ex = solveExact(inst, { incumbent: ref.assign! });
    assert.equal(ex.optimal, true);
    assert.ok(close(ex.score, ref.score));
  }
});

test("simulated annealing finds the brute-force optimum on every small case", () => {
  let hit = 0;
  for (const p of cases) {
    const inst = compile(p);
    const ref = bruteForce(inst);
    const res = anneal(inst, { seed: 5, iterations: 20_000, restarts: 2 });
    assert.ok(close(objective(inst, res.assign), res.score));
    assert.ok(res.score <= ref.score + 1e-6, "cannot beat the optimum");
    if (close(res.score, ref.score)) hit++;
  }
  assert.equal(hit, cases.length);
});

test("annealing respects capacities, parties and locks, and avoids never-pairs when possible", () => {
  for (const p of cases) {
    const inst = compile(p);
    const res = anneal(inst, { seed: 9, iterations: 10_000, restarts: 1 });
    const ev = evaluateGuests(inst, unitToGuest(inst, res.assign));
    const ref = bruteForce(inst);
    const optimumViolations = Math.round((objective(inst, ref.assign!) < -inst.HARD / 2 ? 1 : 0));
    assert.deepEqual(ev.problems.filter((m) => !m.includes("must not share")), []);
    if (optimumViolations === 0) assert.equal(ev.neverViolations, 0);
  }
});

test("known answer: two cliques go to their own tables", () => {
  const names = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"];
  const relations: Problem["relations"] = [];
  for (const grp of ["a", "b"]) {
    for (let i = 1; i <= 4; i++) for (let j = i + 1; j <= 4; j++) relations.push({ a: `${grp}${i}`, b: `${grp}${j}`, kind: "like" });
  }
  // Interleave the input order so the answer isn't just "keep the order".
  const order = [0, 4, 1, 5, 2, 6, 3, 7].map((i) => ({ name: names[i] }));
  const p: Problem = {
    guests: order,
    tables: [
      { name: "X", capacity: 4 },
      { name: "Y", capacity: 4 },
    ],
    relations,
    weights: { like: 1 },
  };
  const r = solve(p, { seed: 1, prove: true });
  assert.equal(r.plan.score, 12);
  assert.equal(r.optimal, true);
  const sets = r.plan.tables.map((t) => t.guests.map((g) => g[0]).join(""));
  assert.deepEqual(sets.sort(), ["aaaa", "bbbb"]);
});

test("known answer: feuding guests are separated even at a soft cost", () => {
  const p: Problem = {
    guests: [{ name: "Uncle Rob" }, { name: "Uncle Tim" }, { name: "Gran" }, { name: "Kid" }],
    tables: [
      { name: "1", capacity: 3 },
      { name: "2", capacity: 3 },
    ],
    relations: [
      { a: "Uncle Rob", b: "Uncle Tim", kind: "never" },
      { a: "Uncle Rob", b: "Gran", kind: "like" },
      { a: "Uncle Tim", b: "Gran", kind: "like" },
      { a: "Kid", b: "Gran", kind: "like" },
    ],
  };
  const r = solve(p, { seed: 2, prove: true });
  assert.equal(r.plan.feasible, true);
  const rob = r.plan.guests.find((g) => g.name === "Uncle Rob")!;
  const tim = r.plan.guests.find((g) => g.name === "Uncle Tim")!;
  assert.notEqual(rob.table, tim.table);
  assert.equal(r.plan.score, 6); // Gran + one uncle + Kid
});

test("never constraints that cannot all be met are reported, not hidden", () => {
  const p: Problem = {
    guests: [{ name: "A" }, { name: "B" }, { name: "C" }],
    tables: [
      { name: "1", capacity: 3 },
      { name: "2", capacity: 1 },
    ],
    relations: [
      { a: "A", b: "B", kind: "never" },
      { a: "B", b: "C", kind: "never" },
      { a: "A", b: "C", kind: "never" },
    ],
  };
  const r = solve(p, { seed: 1, prove: true });
  assert.equal(r.plan.feasible, false);
  assert.equal(r.plan.problems.length, 1); // best possible: one violated pair
});

test("edge cases: single table, exact fit, all locked, zero weights", () => {
  const one = solve({ guests: [{ name: "A" }, { name: "B" }], tables: [{ name: "T", capacity: 2 }], relations: [] });
  assert.deepEqual(one.plan.tables[0].guests, ["A", "B"]);

  const allLocked = solve({
    guests: [
      { name: "A", table: "1" },
      { name: "B", table: "2" },
    ],
    tables: [
      { name: "1", capacity: 1 },
      { name: "2", capacity: 1 },
    ],
    relations: [{ a: "A", b: "B", kind: "like" }],
  });
  assert.equal(allLocked.plan.guests[0].table, "1");
  assert.equal(allLocked.plan.score, 0);

  const p = generateProblem(4, { guests: 24, tableSize: 6 });
  const r = solve(p, { seed: 3 });
  assert.equal(r.plan.score, 0);
  assert.equal(r.plan.feasible, true);
  assert.equal(r.plan.tables.reduce((s, t) => s + t.guests.length, 0), 24);
});

test("deterministic for a fixed seed; early stop via onProgress", () => {
  const p = generateProblem(77, { guests: 40, tableSize: 8, partyRate: 0.3, likesPerGuest: 2, avoidsPerGuest: 0.5, circles: 4 });
  const inst = compile(p);
  const a = anneal(inst, { seed: 42, iterations: 30_000, restarts: 2 });
  const b = anneal(inst, { seed: 42, iterations: 30_000, restarts: 2 });
  assert.deepEqual(Array.from(a.assign), Array.from(b.assign));
  let calls = 0;
  const c = anneal(inst, { seed: 42, iterations: 30_000, restarts: 4, progressEvery: 1000, onProgress: () => ++calls < 3 });
  assert.equal(calls, 3);
  assert.equal(c.iterations, 3000);
});

test("warm start is never made worse, and locks survive re-optimisation", () => {
  const p = generateProblem(8, { guests: 30, tableSize: 6, partyRate: 0.2, likesPerGuest: 2, circles: 3 });
  p.guests[0].table = "T3";
  const inst = compile(p);
  const g = greedy(inst, mulberry32(1));
  const res = anneal(inst, { initial: g, seed: 1, iterations: 5_000, restarts: 1 });
  assert.ok(res.score >= objective(inst, g) - 1e-9);
  assert.equal(toPlan(inst, res.assign).guests[0].table, "T3");
});

test("polish reaches a local optimum (no improving move or swap left)", () => {
  const p = generateProblem(13, { guests: 20, tableSize: 5, likesPerGuest: 2, avoidsPerGuest: 1 });
  const inst = compile(p);
  const a = pack(inst, mulberry32(2))!;
  const before = objective(inst, a);
  const gained = polish(inst, a);
  assert.ok(close(objective(inst, a), before + gained));
  assert.equal(polish(inst, a), 0);
});

test("exact solver reports when it runs out of budget", () => {
  const p = generateProblem(21, { guests: 30, tableSize: 6, likesPerGuest: 2, avoidsPerGuest: 1 });
  const ex = solveExact(compile(p), { nodeLimit: 1000 });
  assert.equal(ex.optimal, false);
});
