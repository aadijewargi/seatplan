/**
 * Benchmarks.
 *   1. Optimality: on instances small enough for branch and bound to finish,
 *      how often does annealing find the proven optimum?
 *   2. Scale: quality and run time of random packing vs greedy vs annealing.
 *
 * Run with `npm run bench`; results are written to bench/results.md.
 */
import { writeFileSync } from "node:fs";
import { compile } from "../src/core/model.ts";
import { anneal } from "../src/core/anneal.ts";
import { solveExact } from "../src/core/exact.ts";
import { greedy, pack } from "../src/core/construct.ts";
import { objective } from "../src/core/score.ts";
import { generateProblem } from "../src/core/generate.ts";
import { mulberry32 } from "../src/core/rng.ts";

const now = () => performance.now();
const lines: string[] = [];
const out = (s = "") => {
  console.log(s);
  lines.push(s);
};

out("# seatplan benchmarks");
out();
out(`Node ${process.version}, ${process.platform}/${process.arch}. Times are wall-clock milliseconds.`);
out();
out("## 1. Annealing vs proven optimum");
out();
out("| guests | tables x seats | instances | annealing = optimum | mean anneal ms | mean exact ms | mean B&B nodes |");
out("|---:|---|---:|---:|---:|---:|---:|");

for (const [guests, tableSize] of [
  [12, 4],
  [16, 4],
  [18, 6],
  [20, 5],
  [24, 6],
] as const) {
  let hits = 0;
  let proven = 0;
  let annealMs = 0;
  let exactMs = 0;
  let nodes = 0;
  const n = 20;
  for (let s = 1; s <= n; s++) {
    const p = generateProblem(1000 * guests + s, {
      guests,
      tableSize,
      partyRate: 0.2,
      likesPerGuest: 2,
      avoidsPerGuest: 0.6,
      nevers: 2,
      circles: 3,
    });
    const inst = compile(p);
    let t = now();
    const sa = anneal(inst, { seed: s });
    annealMs += now() - t;
    t = now();
    const ex = solveExact(inst, { nodeLimit: 50_000_000 });
    exactMs += now() - t;
    nodes += ex.nodes;
    if (!ex.optimal) continue;
    proven++;
    if (Math.abs(sa.score - ex.score) < 1e-6) hits++;
  }
  out(
    `| ${guests} | ${Math.ceil(guests / tableSize)} x ${tableSize} | ${proven} | ${hits}/${proven} | ${(annealMs / n).toFixed(1)} | ${(exactMs / n).toFixed(1)} | ${Math.round(nodes / n).toLocaleString("en-US")} |`,
  );
}

out();
out("## 2. Scaling: random packing vs greedy vs annealing");
out();
out("Score = total happiness (higher is better), mean over 5 instances. Never-pair violations in brackets.");
out();
out("| guests | tables | random | greedy | annealing | anneal ms |");
out("|---:|---:|---:|---:|---:|---:|");
for (const guests of [50, 100, 200, 400]) {
  const tableSize = 10;
  let rs = 0;
  let gs = 0;
  let as = 0;
  let ms = 0;
  let rv = 0;
  let gv = 0;
  let av = 0;
  const n = 5;
  let T = 0;
  for (let s = 1; s <= n; s++) {
    const p = generateProblem(7 * guests + s, {
      guests,
      tableSize,
      slack: 4,
      partyRate: 0.25,
      likesPerGuest: 2,
      avoidsPerGuest: 0.5,
      nevers: Math.round(guests / 20),
      circles: Math.round(guests / 8),
    });
    const inst = compile(p);
    T = inst.T;
    const score = (a: Int32Array) => {
      // Recover the soft score: objective = soft - HARD * violations.
      let viol = 0;
      for (const [x, y] of inst.neverPairs) if (a[inst.unitOf[x]] === a[inst.unitOf[y]]) viol++;
      return { soft: objective(inst, a) + viol * inst.HARD, viol };
    };
    const r = score(pack(inst, mulberry32(s), 1)!);
    const g = score(greedy(inst, mulberry32(s)));
    const t = now();
    const res = anneal(inst, { seed: s });
    ms += now() - t;
    const a = score(res.assign);
    rs += r.soft;
    gs += g.soft;
    as += a.soft;
    rv += r.viol;
    gv += g.viol;
    av += a.viol;
  }
  const f = (x: number, v: number) => `${(x / n).toFixed(1)} (${v})`;
  out(`| ${guests} | ${T} | ${f(rs, rv)} | ${f(gs, gv)} | **${f(as, av)}** | ${(ms / n).toFixed(0)} |`);
}

writeFileSync(new URL("./results.md", import.meta.url), lines.join("\n") + "\n");
