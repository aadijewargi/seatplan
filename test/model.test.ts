import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, SeatplanError, type Problem } from "../src/core/model.ts";

const base = (): Problem => ({
  guests: [{ name: "Ann" }, { name: "Bob" }, { name: "Cat" }, { name: "Dan" }],
  tables: [
    { name: "A", capacity: 2 },
    { name: "B", capacity: 2 },
  ],
  relations: [],
});

test("weights: likes add up per statement, avoids subtract, shared tags add", () => {
  const p = base();
  p.relations = [
    { a: "Ann", b: "Bob", kind: "like" },
    { a: "bob", b: "ann", kind: "like" }, // mutual, case-insensitive
    { a: "Cat", b: "Dan", kind: "avoid" },
  ];
  p.guests[0].tags = ["uni", "chess"];
  p.guests[2].tags = ["UNI", "chess", "x"];
  p.weights = { like: 3, avoid: 5, tag: 1 };
  const inst = compile(p);
  const g = (i: number, j: number) => inst.G[i * inst.N + j];
  assert.equal(g(0, 1), 6);
  assert.equal(g(1, 0), 6);
  assert.equal(g(2, 3), -5);
  assert.equal(g(0, 2), 2); // two shared tags
  assert.equal(g(0, 0), 0);
});

test("parties become units; weights inside a party become a constant", () => {
  const p = base();
  p.guests[0].party = "fam";
  p.guests[1].party = "Fam";
  p.relations = [
    { a: "Ann", b: "Bob", kind: "like" },
    { a: "Ann", b: "Cat", kind: "like" },
    { a: "Bob", b: "Cat", kind: "avoid" },
  ];
  const inst = compile(p);
  assert.equal(inst.U, 3);
  assert.deepEqual(inst.units[0], [0, 1]);
  assert.equal(inst.intra, 3);
  // Unit-level weight between {Ann,Bob} and Cat is 3 - 5.
  assert.equal(inst.Ws[0 * inst.U + 1], -2);
});

test("never pairs carry a penalty larger than any soft swing", () => {
  const p = base();
  p.relations = [
    { a: "Ann", b: "Bob", kind: "never" },
    { a: "Ann", b: "Bob", kind: "like" },
    { a: "Cat", b: "Dan", kind: "like" },
  ];
  const inst = compile(p);
  assert.equal(inst.neverPairs.length, 1);
  assert.ok(inst.HARD > 2 * 6);
  assert.ok(inst.W[0 * inst.U + 1] < -inst.HARD + 10);
});

test("rejects invalid problems with clear errors", () => {
  const cases: Array<[string, (p: Problem) => void, RegExp]> = [
    ["duplicate name", (p) => p.guests.push({ name: "ann " }), /Duplicate guest/],
    ["unknown guest", (p) => p.relations.push({ a: "Ann", b: "Zed", kind: "like" }), /Unknown guest "Zed"/],
    ["self relation", (p) => p.relations.push({ a: "Ann", b: "ann", kind: "like" }), /themself/],
    [
      "never inside party",
      (p) => {
        p.guests[0].party = p.guests[1].party = "x";
        p.relations.push({ a: "Ann", b: "Bob", kind: "never" });
      },
      /same party/,
    ],
    [
      "party locked to two tables",
      (p) => {
        p.guests[0].party = p.guests[1].party = "x";
        p.guests[0].table = "A";
        p.guests[1].table = "B";
      },
      /two different tables/,
    ],
    ["lock to unknown table", (p) => (p.guests[0].table = "Nope"), /unknown table/],
    ["too many guests", (p) => p.guests.push({ name: "Eve" }), /5 guests but only 4 seats/],
    [
      "party too large",
      (p) => {
        for (const g of p.guests.slice(0, 3)) g.party = "big";
      },
      /does not fit/,
    ],
    [
      "locked overload",
      (p) => {
        p.tables[1].capacity = 3;
        for (const g of p.guests.slice(0, 3)) g.table = "A";
      },
      /does not fit|Too many guests locked/,
    ],
    ["bad capacity", (p) => (p.tables[0].capacity = 0), /positive whole-number/],
    ["no tables", (p) => (p.tables = []), /No tables/],
  ];
  for (const [label, mutate, re] of cases) {
    const p = base();
    mutate(p);
    assert.throws(() => compile(p), (e: unknown) => e instanceof SeatplanError && re.test(e.message), label);
  }
});

test("weights: undefined entries fall back to defaults; non-numbers are rejected", () => {
  const p = base();
  p.relations = [{ a: "Ann", b: "Bob", kind: "like" }];
  p.weights = { like: undefined, avoid: 2 };
  assert.equal(compile(p).G[1], 3);
  p.weights = { like: NaN };
  assert.throws(() => compile(p), /must be a number/);
});
