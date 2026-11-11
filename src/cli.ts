import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseGuestCsv, parseTables, planToCsv } from "./core/io.ts";
import { solve } from "./core/index.ts";
import { SeatplanError } from "./core/model.ts";

const HELP = `seatplan - find the best seating chart for a guest list

Usage:
  seatplan <guests.csv> --tables "Head:10, 6x8" [options]

Options:
  -t, --tables <spec>   table layout, e.g. "6x8" or "Head:10, 5x8"   (required)
  -o, --out <file>      write the plan as CSV (table,seat,guest)
      --like <w>        weight per "likes" statement     (default 3)
      --avoid <w>       penalty per "avoid" statement    (default 5)
      --tag <w>         weight per shared tag            (default 1)
      --seed <n>        random seed for reproducible runs (default 1)
      --prove           try to prove the plan optimal with branch and bound
      --json            print the full plan as JSON
  -h, --help            show this help

Guest CSV columns: name, party, likes, avoid, never, tags, table
(only "name" is required; separate several names with ";").
`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      tables: { type: "string", short: "t" },
      out: { type: "string", short: "o" },
      like: { type: "string" },
      avoid: { type: "string" },
      tag: { type: "string" },
      seed: { type: "string" },
      prove: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return values.help ? 0 : 1;
  }
  if (!values.tables) {
    process.stderr.write('error: --tables is required, e.g. --tables "6x8"\n');
    return 1;
  }
  const num = (s: string | undefined, name: string) => {
    if (s === undefined) return undefined;
    const x = Number(s);
    if (!Number.isFinite(x) || x < 0) throw new SeatplanError(`--${name} must be a non-negative number`);
    return x;
  };

  const parsed = parseGuestCsv(readFileSync(positionals[0], "utf8"));
  for (const w of parsed.warnings) process.stderr.write(`warning: ${w}\n`);
  const tables = parseTables(values.tables);
  const result = solve(
    {
      guests: parsed.guests,
      relations: parsed.relations,
      tables,
      weights: { like: num(values.like, "like"), avoid: num(values.avoid, "avoid"), tag: num(values.tag, "tag") },
    },
    { seed: Number(values.seed ?? 1), prove: values.prove },
  );
  const { plan } = result;

  if (values.json) {
    process.stdout.write(JSON.stringify({ ...plan, optimal: result.optimal, ms: result.ms }, null, 2) + "\n");
  } else {
    const happiness = new Map(plan.guests.map((g) => [g.name, g]));
    for (const t of plan.tables) {
      const h = t.guests.reduce((s, g) => s + happiness.get(g)!.happiness, 0) / 2;
      process.stdout.write(`\n${t.name}  (${t.guests.length}/${t.capacity}, happiness ${h})\n`);
      for (const g of t.guests) {
        const r = happiness.get(g)!;
        const mark = r.conflicts.length ? "!" : r.friends.length ? "+" : " ";
        process.stdout.write(`  ${mark} ${g}\n`);
      }
    }
    process.stdout.write(`\nTotal happiness: ${plan.score}\n`);
    if (result.optimal === true) process.stdout.write("Proven optimal.\n");
    else if (result.optimal === false) process.stdout.write("Could not prove optimality within the search budget.\n");
    for (const p of plan.problems) process.stdout.write(`! ${p}\n`);
    process.stdout.write(`Solved in ${result.ms} ms.\n`);
  }
  if (values.out) {
    writeFileSync(values.out, planToCsv(plan));
    process.stderr.write(`wrote ${values.out}\n`);
  }
  return plan.feasible ? 0 : 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${msg}\n`);
  process.exitCode = 1;
}
