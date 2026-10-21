import type { FilterPredicate, FilterSpec, RowInterval, Scalar, Sheet, ValueReader } from "./types.js";

function compare(a: Scalar, b: Scalar): number {
  const rank = (v: Scalar): number => v === null ? 4 : typeof v === "number" ? 0
    : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3;
  const ar = rank(a), br = rank(b);
  if (ar !== br) return ar - br;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.toLocaleLowerCase("en-US").localeCompare(b.toLocaleLowerCase("en-US"), "en-US");
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") return a.code.localeCompare(b.code, "en-US");
  return 0;
}
export function matchesFilter(value: Scalar, predicate: FilterPredicate): boolean {
  switch (predicate.kind) {
    case "values": return predicate.values.some(v => compare(value, v) === 0);
    case "blank": return (value === null) === predicate.blank;
    case "text": {
      if (typeof value !== "string") return false;
      const actual = value.toLocaleLowerCase("en-US"), expected = predicate.value.toLocaleLowerCase("en-US");
      const op = predicate.op;
      switch (op) {
        case "contains": return actual.includes(expected);
        case "startsWith": return actual.startsWith(expected);
        case "endsWith": return actual.endsWith(expected);
        default: { const exhaustive: never = op; return exhaustive; }
      }
    }
    case "compare": {
      const result = compare(value, predicate.value);
      const op = predicate.op;
      switch (op) {
        case "=": return result === 0;
        case "<>": return result !== 0;
        case "<": return result < 0;
        case "<=": return result <= 0;
        case ">": return result > 0;
        case ">=": return result >= 0;
        default: { const exhaustive: never = op; return exhaustive; }
      }
    }
    default: { const exhaustive: never = predicate; return exhaustive; }
  }
}
export function hiddenRows(sheet: Sheet, reader: ValueReader): readonly RowInterval[] {
  const hidden = new Set<number>();
  const test = (filter: FilterSpec, row: number): boolean => filter.columns.every(column => {
    const value = reader.value({ sheetId: sheet.id, row, col: filter.range.left + column.offset });
    return column.combine === "and" ? column.predicates.every(p => matchesFilter(value, p))
      : column.predicates.some(p => matchesFilter(value, p));
  });
  const filter = sheet.properties.filter;
  if (filter) for (let row = filter.range.top + Number(filter.header); row <= filter.range.bottom; row++) {
    // A table filter replaces the sheet predicate over that table's rows.
    if (sheet.properties.tables.some(t => t.filter && row >= t.range.top && row <= t.range.bottom)) continue;
    if (!test(filter, row)) hidden.add(row);
  }
  for (const table of sheet.properties.tables) if (table.filter) {
    for (let row = table.range.top + 1; row <= table.range.bottom - Number(table.totalsRow); row++)
      if (row >= table.filter.range.top && row <= table.filter.range.bottom && !test(table.filter, row)) hidden.add(row);
  }
  // Headers/totals are protected even when another filter range intersects them.
  for (const table of sheet.properties.tables) {
    hidden.delete(table.range.top);
    if (table.totalsRow) hidden.delete(table.range.bottom);
  }
  const intervals: { start: number; end: number }[] = [];
  for (const row of [...hidden].sort((a, b) => a - b)) {
    const last = intervals.at(-1);
    if (last && row === last.end + 1) last.end = row;
    else intervals.push({ start: row, end: row });
  }
  return intervals;
}
