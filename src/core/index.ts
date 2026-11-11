import { anneal, type AnnealOptions } from "./anneal.ts";
import { solveExact } from "./exact.ts";
import { compile, type Instance, type Problem } from "./model.ts";
import { toPlan, type Plan } from "./score.ts";

export * from "./model.ts";
export * from "./score.ts";
export * from "./io.ts";
export { anneal, polish } from "./anneal.ts";
export { solveExact } from "./exact.ts";
export { greedy, pack } from "./construct.ts";

export interface SolveOptions extends AnnealOptions {
  /**
   * Try to prove the annealed seating optimal with branch and bound.
   * Gives up (without changing the answer) after `exactNodeLimit` nodes.
   */
  prove?: boolean;
  exactNodeLimit?: number;
}

export interface SolveResult {
  plan: Plan;
  inst: Instance;
  assign: Int32Array;
  /** true = proven optimal, false = proof attempt ran out of budget, null = not attempted. */
  optimal: boolean | null;
  iterations: number;
  history: number[];
  ms: number;
}

export function solve(problem: Problem, opts: SolveOptions = {}): SolveResult {
  const t0 = Date.now();
  const inst = compile(problem);
  const res = anneal(inst, opts);
  let assign = res.assign;
  let optimal: boolean | null = null;
  if (opts.prove) {
    const ex = solveExact(inst, { incumbent: assign, nodeLimit: opts.exactNodeLimit ?? 2_000_000 });
    optimal = ex.optimal;
    if (ex.assign && ex.score > res.score + 1e-9) assign = ex.assign;
  }
  return {
    plan: toPlan(inst, assign),
    inst,
    assign,
    optimal,
    iterations: res.iterations,
    history: res.history,
    ms: Date.now() - t0,
  };
}
