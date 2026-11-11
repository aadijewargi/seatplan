import type { Guest, Relation, RelationKind, TableSpec } from "./model.ts";
import type { Plan } from "./score.ts";

/** RFC 4180-style CSV parsing (quoted fields, doubled quotes, CRLF). */
export function parseCsvRows(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ["name", "guest", "student", "person"],
  party: ["party", "group", "household", "family", "couple"],
  like: ["likes", "like", "with", "prefer", "friends"],
  avoid: ["avoid", "avoids", "dislikes", "dislike", "not with"],
  never: ["never", "apart", "must not", "never with"],
  tags: ["tags", "tag", "circle", "circles"],
  table: ["table", "lock", "locked", "seat"],
};

export interface ParsedGuests {
  guests: Guest[];
  relations: Relation[];
  warnings: string[];
}

/**
 * Parse a guest list. Only `name` is required. Columns (any order, case-insensitive):
 *
 *   name, party, likes, avoid, never, tags, table
 *
 * `likes`/`avoid`/`never`/`tags` hold several values separated by ";" (or "|").
 */
export function parseGuestCsv(text: string): ParsedGuests {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  let delimiter = ",";
  if (firstLine.split("\t").length > firstLine.split(",").length) delimiter = "\t";
  else if (!firstLine.includes(",") && firstLine.includes(";")) delimiter = ";";
  const multi = delimiter === ";" ? /\|/ : /[;|]/;

  const rows = parseCsvRows(text, delimiter);
  const warnings: string[] = [];
  if (rows.length === 0) return { guests: [], relations: [], warnings: ["The guest list is empty."] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    col[field] = header.findIndex((h) => aliases.includes(h));
  }
  let body = rows.slice(1);
  if (col.name < 0) {
    // No recognisable header: treat column 1 as names, keep the first row.
    col.name = 0;
    body = rows;
    warnings.push('No "name" column header found; using the first column as names.');
  }
  if (body !== rows) {
    const known = new Set(Object.values(col));
    header.forEach((h, c) => {
      if (h && !known.has(c)) warnings.push(`Ignoring unknown column "${rows[0][c].trim()}".`);
    });
  }

  const cell = (r: string[], f: string) => (col[f] >= 0 ? (r[col[f]] ?? "").trim() : "");
  const list = (r: string[], f: string) =>
    cell(r, f)
      .split(multi)
      .map((s) => s.trim())
      .filter(Boolean);

  const guests: Guest[] = [];
  const seen = new Map<string, number>();
  const pending: Array<{ from: string; to: string; kind: RelationKind }> = [];
  body.forEach((r, i) => {
    const name = cell(r, "name");
    if (!name) {
      warnings.push(`Row ${i + 2}: no name, skipped.`);
      return;
    }
    const k = name.toLowerCase();
    if (seen.has(k)) {
      warnings.push(`Row ${i + 2}: duplicate guest "${name}", skipped.`);
      return;
    }
    seen.set(k, guests.length);
    const g: Guest = { name };
    const party = cell(r, "party");
    if (party) g.party = party;
    const tags = list(r, "tags");
    if (tags.length) g.tags = tags;
    const table = cell(r, "table");
    if (table) g.table = table;
    guests.push(g);
    for (const kind of ["like", "avoid", "never"] as const) {
      for (const to of list(r, kind)) pending.push({ from: name, to, kind });
    }
  });

  const relations: Relation[] = [];
  for (const p of pending) {
    const j = seen.get(p.to.toLowerCase());
    if (j === undefined) {
      warnings.push(`${p.from}: unknown guest "${p.to}" in "${p.kind}", ignored.`);
      continue;
    }
    const to = guests[j].name;
    if (to.toLowerCase() === p.from.toLowerCase()) continue;
    relations.push({ a: p.from, b: to, kind: p.kind });
  }
  return { guests, relations, warnings };
}

/**
 * Parse a table layout such as "Head:12, 6x8, 2 x 10" or "Window:4, Door:4".
 *   "N x C"  -> N tables of capacity C, named "Table 1", "Table 2", ...
 *   "name:C" -> one named table
 *   "C"      -> one unnamed table
 */
export function parseTables(spec: string): TableSpec[] {
  const tables: TableSpec[] = [];
  const unnamed: number[] = [];
  const parts = spec
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^(\d+)\s*[x×*]\s*(\d+)$/i))) {
      for (let i = 0; i < Number(m[1]); i++) unnamed.push(tables.push({ name: "", capacity: Number(m[2]) }) - 1);
    } else if ((m = part.match(/^(.+?)\s*:\s*(\d+)$/))) {
      tables.push({ name: m[1].trim(), capacity: Number(m[2]) });
    } else if ((m = part.match(/^(\d+)$/))) {
      unnamed.push(tables.push({ name: "", capacity: Number(m[1]) }) - 1);
    } else {
      throw new Error(`Can't read table spec "${part}". Use e.g. "6x8" or "Head:12".`);
    }
  }
  const used = new Set(tables.map((t) => t.name.toLowerCase()).filter(Boolean));
  let n = 1;
  for (const i of unnamed) {
    while (used.has(`table ${n}`)) n++;
    tables[i].name = `Table ${n}`;
    used.add(`table ${n}`);
    n++;
  }
  return tables;
}

const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function planToCsv(plan: Plan): string {
  const lines = ["table,seat,guest"];
  for (const t of plan.tables) {
    t.guests.forEach((g, i) => lines.push([t.name, String(i + 1), g].map(csvField).join(",")));
  }
  return lines.join("\n") + "\n";
}
