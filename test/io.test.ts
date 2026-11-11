import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsvRows, parseGuestCsv, parseTables, planToCsv } from "../src/core/io.ts";
import { solve } from "../src/core/index.ts";

test("CSV rows: quotes, escaped quotes, CRLF, BOM, blank lines", () => {
  const rows = parseCsvRows('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n3,\n');
  assert.deepEqual(rows, [
    ["a", "b"],
    ["x, y", 'say "hi"'],
    ["3", ""],
  ]);
});

test("guest CSV: aliases, multi-values, relations resolved case-insensitively", () => {
  const csv = [
    "Guest,Household,Likes,Avoid,Never,Tags,Table,Diet",
    "Ann,Smith,bob;Cat,,,uni,,veg",
    "Bob,Smith,,,Dan,,,",
    'Cat,,"Ann",Dan,,uni|work,Head,',
    "Dan,,,,,,,",
  ].join("\n");
  const r = parseGuestCsv(csv);
  assert.equal(r.guests.length, 4);
  assert.deepEqual(r.guests[0], { name: "Ann", party: "Smith", tags: ["uni"] });
  assert.deepEqual(r.guests[2], { name: "Cat", tags: ["uni", "work"], table: "Head" });
  assert.deepEqual(r.relations, [
    { a: "Ann", b: "Bob", kind: "like" },
    { a: "Ann", b: "Cat", kind: "like" },
    { a: "Bob", b: "Dan", kind: "never" },
    { a: "Cat", b: "Ann", kind: "like" },
    { a: "Cat", b: "Dan", kind: "avoid" },
  ]);
  assert.deepEqual(r.warnings, ['Ignoring unknown column "Diet".']);
});

test("guest CSV: warnings for unknown names, duplicates, missing names", () => {
  const r = parseGuestCsv("name,likes\nAnn,Zed\nann,\n,Ann\n");
  assert.equal(r.guests.length, 1);
  assert.equal(r.relations.length, 0);
  assert.equal(r.warnings.length, 3);
});

test("guest CSV: semicolon-delimited (European Excel) and tab-separated", () => {
  const semi = parseGuestCsv("name;likes\nAnn;Bob|Cat\nBob;\nCat;\n");
  assert.equal(semi.relations.length, 2);
  const tab = parseGuestCsv("name\tparty\nAnn\tx\nBob\tx\n");
  assert.equal(tab.guests[1].party, "x");
});

test("guest CSV: plain list of names without header", () => {
  const r = parseGuestCsv("Ann\nBob\n");
  assert.equal(r.guests.length, 2);
  assert.equal(r.warnings.length, 1);
});

test("table specs", () => {
  assert.deepEqual(parseTables("Head:12, 2x8, 10"), [
    { name: "Head", capacity: 12 },
    { name: "Table 1", capacity: 8 },
    { name: "Table 2", capacity: 8 },
    { name: "Table 3", capacity: 10 },
  ]);
  assert.deepEqual(
    parseTables("Table 1:4, 2 × 3").map((t) => t.name),
    ["Table 1", "Table 2", "Table 3"],
  );
  assert.throws(() => parseTables("lots"), /Can't read/);
});

test("end to end: CSV in, plan CSV out", () => {
  const parsed = parseGuestCsv("name,party,likes\nAnn,a,Cat\nBob,a,\nCat,,\nDan,,\n");
  const r = solve({ ...parsed, tables: parseTables("2x2") }, { seed: 1 });
  const out = planToCsv(r.plan);
  assert.match(out, /^table,seat,guest\n/);
  assert.equal(out.trim().split("\n").length, 5);
  const ann = r.plan.guests.find((g) => g.name === "Ann")!;
  const bob = r.plan.guests.find((g) => g.name === "Bob")!;
  assert.equal(ann.table, bob.table);
});
