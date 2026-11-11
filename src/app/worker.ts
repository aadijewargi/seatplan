/// <reference lib="webworker" />
import { anneal } from "../core/anneal.ts";
import { solveExact } from "../core/exact.ts";
import { compile, SeatplanError, type Problem } from "../core/model.ts";
import { toPlan, type Plan } from "../core/score.ts";

export interface SolveRequest {
  type: "solve";
  problem: Problem;
  seed: number;
  prove: boolean;
  /** Current seating by guest name, used as a warm start when still valid. */
  warm?: Record<string, string>;
}

export type WorkerMessage =
  | { type: "progress"; fraction: number; best: number; history: number[] }
  | { type: "proving" }
  | { type: "done"; plan: Plan; optimal: boolean | null; ms: number; units: number }
  | { type: "error"; message: string };

const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<SolveRequest>) => {
  const req = e.data;
  const t0 = performance.now();
  try {
    const inst = compile(req.problem);
    let initial: Int32Array | undefined;
    if (req.warm) {
      // Map the warm start onto units; drop it if it breaks capacity or locks.
      const tIndex = new Map(inst.tableNames.map((n, i) => [n, i]));
      const a = new Int32Array(inst.U);
      const load = new Int32Array(inst.T);
      let ok = true;
      for (let u = 0; u < inst.U && ok; u++) {
        const t = tIndex.get(req.warm[inst.guestNames[inst.units[u][0]]] ?? "");
        if (t === undefined || (inst.lock[u] >= 0 && inst.lock[u] !== t)) ok = false;
        else {
          a[u] = t;
          load[t] += inst.size[u];
        }
      }
      for (let t = 0; t < inst.T && ok; t++) if (load[t] > inst.cap[t]) ok = false;
      if (ok) initial = a;
    }
    const history: number[] = [];
    let lastPost = 0;
    const res = anneal(inst, {
      seed: req.seed,
      initial,
      progressEvery: 2000,
      onProgress: (p) => {
        history.push(p.best);
        const now = performance.now();
        if (now - lastPost > 50) {
          lastPost = now;
          post({ type: "progress", fraction: p.fraction, best: p.best, history: history.slice(-200) });
        }
      },
    });
    let assign = res.assign;
    let optimal: boolean | null = null;
    if (req.prove) {
      post({ type: "proving" });
      const ex = solveExact(inst, { incumbent: assign, nodeLimit: 3_000_000 });
      optimal = ex.optimal;
      if (ex.assign && ex.score > res.score + 1e-9) assign = ex.assign;
    }
    post({ type: "done", plan: toPlan(inst, assign), optimal, ms: performance.now() - t0, units: inst.U });
  } catch (err) {
    post({
      type: "error",
      message: err instanceof SeatplanError || err instanceof Error ? err.message : String(err),
    });
  }
};
