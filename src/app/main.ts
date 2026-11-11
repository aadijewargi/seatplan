import { parseGuestCsv, parseTables, planToCsv } from "../core/io.ts";
import { compile, DEFAULT_WEIGHTS, type Problem } from "../core/model.ts";
import { toPlan, type Plan } from "../core/score.ts";
import { EXAMPLES } from "./examples.ts";
import type { SolveRequest, WorkerMessage } from "./worker.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  example: $<HTMLSelectElement>("example"),
  file: $<HTMLInputElement>("file"),
  csv: $<HTMLTextAreaElement>("csv"),
  warnings: $("warnings"),
  tables: $<HTMLInputElement>("tables"),
  seats: $("seats"),
  like: $<HTMLInputElement>("w-like"),
  avoid: $<HTMLInputElement>("w-avoid"),
  tag: $<HTMLInputElement>("w-tag"),
  prove: $<HTMLInputElement>("prove"),
  solve: $<HTMLButtonElement>("solve"),
  bar: $("bar"),
  spark: $<HTMLCanvasElement>("spark"),
  status: $("status"),
  score: $("score"),
  badge: $("badge"),
  reopt: $<HTMLButtonElement>("reopt"),
  export: $<HTMLButtonElement>("export"),
  print: $<HTMLButtonElement>("print"),
  grid: $("tables-grid"),
  detail: $("detail"),
  cards: $("cards"),
};

interface State {
  plan: Plan | null;
  /** Locks added in the UI (guest name -> table name). CSV locks are separate. */
  uiLocks: Record<string, string>;
  selected: string | null;
  running: boolean;
  seed: number;
}
const state: State = { plan: null, uiLocks: {}, selected: null, running: false, seed: 1 };

// ---------- persistence (best effort; the app works without it) ----------
const STORE = "seatplan:v1";
function save() {
  try {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        csv: el.csv.value,
        tables: el.tables.value,
        w: [el.like.value, el.avoid.value, el.tag.value],
        prove: el.prove.checked,
        uiLocks: state.uiLocks,
      }),
    );
  } catch {
    /* storage unavailable */
  }
}
function load(): boolean {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return false;
    const s = JSON.parse(raw);
    el.csv.value = s.csv ?? "";
    el.tables.value = s.tables ?? "";
    [el.like.value, el.avoid.value, el.tag.value] = s.w ?? [];
    el.prove.checked = !!s.prove;
    state.uiLocks = s.uiLocks ?? {};
    return !!el.csv.value;
  } catch {
    return false;
  }
}

// ---------- building the problem ----------
interface Built {
  problem: Problem;
  warnings: string[];
  csvLocked: Set<string>;
  partyOf: Map<string, string[]>;
}

function build(): Built {
  const parsed = parseGuestCsv(el.csv.value);
  const tables = parseTables(el.tables.value);
  const tableNames = new Set(tables.map((t) => t.name));
  const csvLocked = new Set(parsed.guests.filter((g) => g.table).map((g) => g.name));
  // UI locks to tables that don't exist (e.g. while the layout is being
  // edited) are ignored but kept, so they come back if the table does.
  const guests = parsed.guests.map((g) => {
    const t = state.uiLocks[g.name];
    return t && !g.table && tableNames.has(t) ? { ...g, table: t } : g;
  });
  const byParty = new Map<string, string[]>();
  for (const g of guests) {
    const k = g.party?.trim().toLowerCase();
    if (k) byParty.set(k, [...(byParty.get(k) ?? []), g.name]);
  }
  const partyOf = new Map<string, string[]>();
  for (const g of guests) {
    const k = g.party?.trim().toLowerCase();
    partyOf.set(g.name, k ? byParty.get(k)! : [g.name]);
  }
  const num = (x: HTMLInputElement, d: number) => (x.value.trim() === "" || !isFinite(+x.value) ? d : Math.max(0, +x.value));
  const weights = {
    like: num(el.like, DEFAULT_WEIGHTS.like),
    avoid: num(el.avoid, DEFAULT_WEIGHTS.avoid),
    tag: num(el.tag, DEFAULT_WEIGHTS.tag),
  };
  return { problem: { guests, tables, relations: parsed.relations, weights }, warnings: parsed.warnings, csvLocked, partyOf };
}

let built: Built | null = null;

function refreshInputs() {
  el.warnings.innerHTML = "";
  try {
    built = build();
    const nGuests = built.problem.guests.length;
    const nSeats = built.problem.tables.reduce((s, t) => s + t.capacity, 0);
    el.seats.textContent = `${nGuests} guests · ${built.problem.tables.length} tables · ${nSeats} seats`;
    el.seats.style.color = nSeats < nGuests ? "var(--bad)" : "";
    // Compile now so impossible setups (too few seats, a party too big for any
    // table, contradictory locks) are reported before the user presses Solve.
    try {
      if (nGuests) compile(built.problem);
    } catch (err) {
      const li = document.createElement("li");
      li.className = "err";
      li.textContent = (err as Error).message;
      el.warnings.append(li);
      el.solve.disabled = true;
      save();
      return;
    }
    for (const w of built.warnings.slice(0, 30)) {
      const li = document.createElement("li");
      li.textContent = w;
      el.warnings.append(li);
    }
    el.solve.disabled = state.running || nGuests === 0;
  } catch (err) {
    built = null;
    const li = document.createElement("li");
    li.className = "err";
    li.textContent = (err as Error).message;
    el.warnings.append(li);
    el.seats.textContent = "";
    el.solve.disabled = true;
  }
  save();
}

// ---------- solving (in a Web Worker so the page stays responsive) ----------
let worker: Worker | null = null;

function solve(warm: boolean, userStarted = true) {
  refreshInputs();
  if (!built) return;
  worker?.terminate();
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  state.running = true;
  el.solve.disabled = el.reopt.disabled = true;
  el.solve.textContent = "Optimising…";
  el.status.textContent = "";
  el.bar.style.width = "0%";
  const req: SolveRequest = {
    type: "solve",
    problem: built.problem,
    seed: state.seed++,
    prove: el.prove.checked,
  };
  if (warm && state.plan) {
    req.warm = {};
    for (const g of state.plan.guests) req.warm[g.name] = g.table;
  }
  const finish = () => {
    state.running = false;
    el.solve.textContent = "Find best seating";
    el.solve.disabled = false;
    el.reopt.disabled = !state.plan;
  };
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data;
    if (m.type === "progress") {
      el.bar.style.width = `${(m.fraction * 100).toFixed(1)}%`;
      drawSpark(m.history);
    } else if (m.type === "proving") {
      el.bar.style.width = "100%";
      el.status.textContent = "Checking optimality with branch and bound…";
    } else if (m.type === "done") {
      el.bar.style.width = "100%";
      const before = state.plan?.score;
      state.plan = m.plan;
      state.selected = null;
      let msg = `Done in ${(m.ms / 1000).toFixed(2)} s.`;
      if (warm && before !== undefined) msg += ` Happiness ${fmt(before)} → ${fmt(m.plan.score)}.`;
      if (m.optimal === true) msg += " Proven optimal.";
      else if (m.optimal === false) msg += ` Too big to prove optimal (${m.units} parties); this is the best found.`;
      el.status.textContent = msg;
      render();
      finish();
      // On narrow screens the chart is below the form; bring it into view.
      if (userStarted && window.matchMedia("(max-width: 900px)").matches) {
        document.querySelector(".chart")?.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      el.status.textContent = "";
      const li = document.createElement("li");
      li.className = "err";
      li.textContent = m.message;
      el.warnings.prepend(li);
      finish();
    }
  };
  worker.onerror = (e) => {
    el.status.textContent = `Solver crashed: ${e.message}`;
    finish();
  };
  worker.postMessage(req);
}

function drawSpark(history: number[]) {
  const c = el.spark;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 320;
  const h = c.clientHeight || 44;
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  if (history.length < 2) return;
  const sorted = [...history].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[sorted.length - 1];
  const span = hi - lo || 1;
  g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent");
  g.lineWidth = 2;
  g.beginPath();
  history.forEach((v, i) => {
    const x = (i / (history.length - 1)) * (w - 4) + 2;
    const y = h - 4 - (Math.max(0, v - lo) / span) * (h - 8);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();
}

// ---------- rendering ----------
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const shortName = (n: string) => {
  const parts = n.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : n;
};

function render() {
  const plan = state.plan;
  el.grid.innerHTML = "";
  el.detail.hidden = true;
  el.export.disabled = el.print.disabled = !plan;
  el.reopt.disabled = !plan || state.running;
  if (!plan) {
    el.score.textContent = "–";
    el.badge.hidden = true;
    el.grid.innerHTML = `<div class="empty-state"><strong>No seating yet</strong>Edit the guest list on the left (or load an example), then press <em>Find best seating</em>.</div>`;
    return;
  }
  el.score.textContent = fmt(plan.score);
  el.badge.hidden = false;
  el.badge.className = plan.feasible ? "badge" : "badge bad";
  el.badge.textContent = plan.feasible ? "all constraints met" : `${plan.problems.length} constraint${plan.problems.length > 1 ? "s" : ""} broken`;
  el.badge.title = plan.problems.join("\n");

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = `<span class="l-good">sits with a friend</span><span class="l-lonely">no friend at table</span><span class="l-bad">conflict at table</span><span class="l-lock">📌 locked</span>`;
  el.grid.before(legend);
  document.querySelectorAll(".legend").forEach((n, i, all) => i < all.length - 1 && n.remove());

  const byName = new Map(plan.guests.map((g) => [g.name, g]));
  const selParty = state.selected ? new Set(built?.partyOf.get(state.selected) ?? [state.selected]) : null;
  const selTable = state.selected ? byName.get(state.selected)?.table : null;
  const selSize = selParty?.size ?? 0;

  for (const t of plan.tables) {
    const card = document.createElement("div");
    card.className = "table-card";
    card.dataset.table = t.name;
    const isTarget = !!state.selected && selTable !== t.name;
    const full = t.guests.length + selSize > t.capacity;
    if (isTarget) card.classList.add("target");
    if (isTarget && full) card.classList.add("full");
    const happy = t.guests.reduce((s, g) => s + (byName.get(g)?.happiness ?? 0), 0) / 2;
    const round = document.createElement("div");
    round.className = "round";
    round.innerHTML = `<div class="top"><div class="name"></div><div class="meta">${t.guests.length}/${t.capacity}</div><div class="happy${happy < 0 ? " neg" : ""}">${happy >= 0 ? "+" : ""}${fmt(happy)}</div></div>`;
    round.querySelector(".name")!.textContent = t.name;
    const n = t.capacity;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const x = 50 + 39 * Math.cos(ang);
      const y = 50 + 40 * Math.sin(ang);
      const name = t.guests[i];
      if (!name) {
        const seat = document.createElement("span");
        seat.className = "seat";
        seat.style.left = `${x}%`;
        seat.style.top = `${y}%`;
        round.append(seat);
        continue;
      }
      const g = byName.get(name)!;
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.type = "button";
      chip.textContent = shortName(name);
      chip.title = name;
      chip.style.left = `${x}%`;
      chip.style.top = `${y}%`;
      chip.draggable = true;
      chip.dataset.guest = name;
      if (g.conflicts.length) chip.classList.add("bad");
      else if (g.friends.length) chip.classList.add("good");
      else chip.classList.add("lonely");
      if (state.uiLocks[name] || built?.csvLocked.has(name)) chip.classList.add("locked");
      if (state.selected === name) chip.classList.add("selected");
      else if (selParty?.has(name)) chip.classList.add("partner");
      chip.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.selected = state.selected === name ? null : name;
        render();
      });
      chip.addEventListener("dragstart", (ev) => {
        ev.dataTransfer?.setData("text/plain", name);
        state.selected = name;
      });
      round.append(chip);
    }
    card.append(round);
    card.addEventListener("click", () => {
      if (state.selected && selTable !== t.name) moveSelected(t.name);
    });
    card.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      card.classList.add("drop");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop"));
    card.addEventListener("drop", (ev) => {
      ev.preventDefault();
      card.classList.remove("drop");
      const name = ev.dataTransfer?.getData("text/plain");
      if (name) {
        state.selected = name;
        moveSelected(t.name);
      }
    });
    el.grid.append(card);
  }
  renderDetail();
  renderCards();
}

function renderDetail() {
  const plan = state.plan;
  if (!plan || !state.selected) {
    el.detail.hidden = true;
    return;
  }
  const g = plan.guests.find((x) => x.name === state.selected);
  if (!g) return;
  const party = built?.partyOf.get(g.name) ?? [g.name];
  const csvLock = built?.csvLocked.has(g.name);
  const locked = csvLock || !!state.uiLocks[g.name];
  el.detail.hidden = false;
  el.detail.innerHTML = "";
  const h = document.createElement("h3");
  h.textContent = g.name;
  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = `${g.table} · happiness ${g.happiness >= 0 ? "+" : ""}${fmt(g.happiness)}${party.length > 1 ? ` · party of ${party.length}` : ""}`;
  const list = (label: string, xs: string[]) => {
    const p = document.createElement("div");
    p.innerHTML = `<strong>${label}</strong>`;
    const ul = document.createElement("ul");
    for (const x of xs) {
      const li = document.createElement("li");
      li.textContent = x;
      ul.append(li);
    }
    if (!xs.length) {
      const li = document.createElement("li");
      li.textContent = "nobody";
      li.style.color = "var(--muted)";
      ul.append(li);
    }
    p.append(ul);
    return p;
  };
  const x = document.createElement("button");
  x.className = "x";
  x.setAttribute("aria-label", "Close");
  x.textContent = "×";
  x.onclick = () => {
    state.selected = null;
    render();
  };
  const lockBtn = document.createElement("button");
  lockBtn.className = "btn btn-ghost btn-s";
  lockBtn.disabled = !!csvLock;
  lockBtn.textContent = csvLock ? "Locked in CSV" : locked ? "Unlock" : `Lock to ${g.table}`;
  lockBtn.onclick = () => {
    for (const m of party) {
      if (locked) delete state.uiLocks[m];
      else state.uiLocks[m] = g.table;
    }
    save();
    refreshInputs();
    render();
  };
  const tip = document.createElement("p");
  tip.className = "help";
  tip.textContent = "Click another table to move here, or drag the name.";
  el.detail.append(x, h, sub, list("Friends at this table", g.friends), list("Conflicts at this table", g.conflicts), lockBtn, tip);
}

function moveSelected(tableName: string) {
  const plan = state.plan;
  if (!plan || !state.selected || !built) return;
  const party = built.partyOf.get(state.selected) ?? [state.selected];
  if (party.some((m) => built!.csvLocked.has(m))) {
    el.status.textContent = `${state.selected} is locked in the CSV "table" column.`;
    return;
  }
  const target = plan.tables.find((t) => t.name === tableName)!;
  const moving = party.filter((m) => !target.guests.includes(m));
  if (target.guests.length + moving.length > target.capacity) {
    el.status.textContent = `${tableName} has no room for ${moving.length === 1 ? state.selected : `a party of ${moving.length}`}.`;
    return;
  }
  const seating: Record<string, string> = {};
  for (const g of plan.guests) seating[g.name] = g.table;
  for (const m of party) {
    seating[m] = tableName;
    state.uiLocks[m] = tableName;
  }
  const before = plan.score;
  refreshInputs();
  if (!built) return;
  try {
    const inst = compile(built.problem);
    const tIndex = new Map(inst.tableNames.map((n, i) => [n, i]));
    const assign = new Int32Array(inst.U);
    for (let u = 0; u < inst.U; u++) assign[u] = tIndex.get(seating[inst.guestNames[inst.units[u][0]]])!;
    state.plan = toPlan(inst, assign);
    const d = state.plan.score - before;
    el.status.textContent = `Moved ${party.join(" + ")} to ${tableName} (${d >= 0 ? "+" : ""}${fmt(d)}). Locked. Press Re-optimise to rearrange everyone else.`;
  } catch (err) {
    el.status.textContent = (err as Error).message;
  }
  state.selected = null;
  render();
}

function renderCards() {
  el.cards.innerHTML = "";
  const order = new Map((state.plan?.tables ?? []).map((t, i) => [t.name, i]));
  const guests = [...(state.plan?.guests ?? [])].sort((a, b) => order.get(a.table)! - order.get(b.table)!);
  for (const g of guests) {
    const c = document.createElement("div");
    c.className = "place-card";
    const n = document.createElement("div");
    n.className = "n";
    n.textContent = g.name;
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = g.table;
    c.append(n, t);
    el.cards.append(c);
  }
}

// ---------- wiring ----------
function loadExample(id: string) {
  const ex = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
  el.csv.value = ex.csv;
  el.tables.value = ex.tables;
  state.uiLocks = {};
  state.plan = null;
  refreshInputs();
  render();
}

el.example.innerHTML = `<option value="">Examples…</option>` + EXAMPLES.map((e) => `<option value="${e.id}">${e.label}</option>`).join("");
el.example.addEventListener("change", () => {
  if (el.example.value) loadExample(el.example.value);
  el.example.value = "";
});
el.file.addEventListener("change", async () => {
  const f = el.file.files?.[0];
  if (!f) return;
  el.csv.value = await f.text();
  state.uiLocks = {};
  refreshInputs();
  el.file.value = "";
});
let debounce = 0;
for (const input of [el.csv, el.tables, el.like, el.avoid, el.tag]) {
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(refreshInputs, 250);
  });
}
el.prove.addEventListener("change", save);
el.solve.addEventListener("click", () => solve(false));
el.reopt.addEventListener("click", () => solve(true));
el.export.addEventListener("click", () => {
  if (!state.plan) return;
  const blob = new Blob([planToCsv(state.plan)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "seating-plan.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
el.print.addEventListener("click", () => window.print());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.selected) {
    state.selected = null;
    render();
  }
});

if (!load()) {
  el.like.value = String(DEFAULT_WEIGHTS.like);
  el.avoid.value = String(DEFAULT_WEIGHTS.avoid);
  el.tag.value = String(DEFAULT_WEIGHTS.tag);
  loadExample("wedding");
  // First visit: solve the example straight away so there is something to see.
  solve(false, false);
} else {
  refreshInputs();
  render();
}
