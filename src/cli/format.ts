// format.ts — render a command's result as json or a table, and the ASCII star map.
//
// JSON is the machine-readable default (what the officers' harnesses parse); table
// is for a human at the terminal.

import type { World } from "../world/types.ts";

export type Format = "json" | "table";

export function render(value: unknown, format: Format): string {
  if (format === "json") return JSON.stringify(value, null, 2);
  return asTable(value);
}

/** A deliberately small human renderer: arrays of flat objects become a column
 *  table; a single object becomes aligned key: value lines; primitives print as-is. */
function asTable(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    if (typeof value[0] === "object" && value[0] !== null) {
      const rows = value as Record<string, unknown>[];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const widths = cols.map((c) =>
        Math.max(c.length, ...rows.map((r) => fmtCell(r[c]).length))
      );
      const line = (cells: string[]) =>
        cells.map((c, i) => c.padEnd(widths[i])).join("  ");
      const header = line(cols);
      const sep = widths.map((w) => "-".repeat(w)).join("  ");
      const body = rows.map((r) => line(cols.map((c) => fmtCell(r[c]))));
      return [header, sep, ...body].join("\n");
    }
    return value.map((v) => fmtCell(v)).join("\n");
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const w = Math.max(...keys.map((k) => k.length));
    return keys.map((k) => `${k.padEnd(w)} : ${fmtCell(obj[k])}`).join("\n");
  }
  return fmtCell(value);
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ── ASCII star map ────────────────────────────────────────────────────
type Plot = { x: number; y: number; glyph: string; label: string };

/** A plain-ASCII map of the star system, so a stranger can SEE the agents reason
 *  and act on something visible (PLAN §7, milestone 6). Ships are '@', hazards '*',
 *  stations '#'. North (+y) is up. Deterministic: same world => same map. */
export function starMap(world: World, width = 56, height = 19): string {
  const plots: Plot[] = [];
  for (const s of Object.values(world.ships)) {
    plots.push({ x: s.position.x, y: s.position.y, glyph: "@", label: s.id });
  }
  for (const h of world.hazards) {
    plots.push({ x: h.position.x, y: h.position.y, glyph: "*", label: `${h.id} (${h.kind})` });
  }
  for (const st of world.stations) {
    plots.push({ x: st.position.x, y: st.position.y, glyph: "#", label: st.name });
  }
  if (plots.length === 0) return "(empty space)";

  const xs = plots.map((p) => p.x);
  const ys = plots.map((p) => p.y);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  // pad so nothing sits on the border, and avoid a zero span
  const padX = Math.max(1, (maxX - minX) * 0.1), padY = Math.max(1, (maxY - minY) * 0.1);
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;

  const col = (x: number) => Math.round(((x - minX) / (maxX - minX)) * (width - 1));
  const row = (y: number) => Math.round(((maxY - y) / (maxY - minY)) * (height - 1));

  const grid: string[][] = Array.from({ length: height }, () => Array(width).fill(" "));
  for (const p of plots) grid[row(p.y)][col(p.x)] = p.glyph;

  const top = "+" + "-".repeat(width) + "+";
  const body = grid.map((r) => "|" + r.join("") + "|").join("\n");
  const legend = plots
    .map((p) => `  ${p.glyph}  ${p.label}  (${p.x}, ${p.y})`)
    .join("\n");
  return `${top}\n${body}\n${top}\n${legend}`;
}
