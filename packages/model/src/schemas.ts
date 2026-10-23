import { z } from "zod";
import type {
  AtomicEdit, Cell, CellStyle, Commit, CompatibilityIssue, Edit, FileOptions,
  HistoryState, Patch, ResourceLimits, Result, Sheet, SheetProperties, Transaction, Workbook,
} from "./types.js";
import { DEFAULT_LIMITS, GRID_COLUMNS, GRID_ROWS, TILE_COLUMNS, TILE_ROWS } from "./coordinates.js";

export const workbookIdSchema = z.uuid().brand<"WorkbookId">();
export const sheetIdSchema = z.uuid().brand<"SheetId">();
export const styleIdSchema = z.uuid().brand<"StyleId">();
export const objectIdSchema = z.uuid().brand<"ObjectId">();
export const transactionIdSchema = z.uuid().brand<"TransactionId">();
export const timestampSchema = z.iso.datetime({ offset: true });
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = integer.positive();
const finite = z.number().finite();
const row = integer.max(GRID_ROWS - 1);
const col = integer.max(GRID_COLUMNS - 1);
const text = z.string().refine(s => [...s].length <= 32767, "Text exceeds 32767 code points");
const formula = z.string().startsWith("=").max(DEFAULT_LIMITS.maxFormulaLength);
const color = z.string().regex(/^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/);
const sheetName = z.string().min(1).max(31).regex(/^[^\[\]:*?/\\]+$/);
const symbolName = z.string().min(1).max(255).regex(/^[\p{L}_\\][\p{L}\p{N}_.\\]*$/u)
  .refine(s => !/^(?:[A-Z]{1,3}[1-9]\d*|R\d*C\d*|R|C)$/i.test(s), "Name cannot be an address");
export const rectSchema = z.strictObject({ top: row, left: col, bottom: row, right: col })
  .refine(r => r.top <= r.bottom && r.left <= r.right, "Rectangle must be nonempty");
export const addressSchema = z.strictObject({ sheetId: sheetIdSchema, row, col });
export const rangeSchema = z.strictObject({ ...rectSchema.shape, sheetId: sheetIdSchema })
  .refine(r => r.top <= r.bottom && r.left <= r.right, "Rectangle must be nonempty");
const errorSchema = z.strictObject({
  kind: z.literal("error"),
  code: z.enum(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#SPILL!", "#CALC!", "#CIRC!", "#PARSE!"]),
  message: text.optional(),
});
export const scalarSchema = z.union([z.null(), finite, text, z.boolean(), errorSchema]);
const inputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("value"), value: scalarSchema }),
  z.strictObject({ kind: z.literal("formula"), source: formula }),
]);
export const cellSchema = z.strictObject({
  input: inputSchema, styleId: styleIdSchema.optional(), note: text.optional(),
}) as z.ZodType<Cell>;
const border = z.strictObject({
  style: z.enum(["none", "thin", "medium", "thick", "dashed", "dotted", "double"]), color,
});
export const styleSchema = z.strictObject({
  font: z.strictObject({
    family: text.optional(), size: finite.min(6).max(96).optional(),
    bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strikethrough: z.boolean().optional(), color: color.optional(),
  }).optional(),
  fill: color.optional(),
  borders: z.strictObject({ top: border.optional(), right: border.optional(), bottom: border.optional(), left: border.optional() }).optional(),
  horizontal: z.enum(["general", "left", "center", "right"]).optional(),
  vertical: z.enum(["top", "middle", "bottom"]).optional(),
  wrap: z.boolean().optional(), rotation: finite.min(-90).max(90).optional(), numberFormat: text.optional(),
}) as z.ZodType<CellStyle>;
const axisItem = z.strictObject({ size: finite.positive().optional(), hidden: z.boolean().optional(), styleId: styleIdSchema.optional() });
const threshold = z.union([
  z.strictObject({ kind: z.enum(["minimum", "maximum"]) }),
  z.strictObject({ kind: z.literal("number"), value: finite }),
  z.strictObject({ kind: z.enum(["percent", "percentile"]), value: finite.min(0).max(100) }),
]);
const ruleBase = { id: objectIdSchema, range: rectSchema, priority: integer, stopIfTrue: z.boolean() };
const conditional = z.discriminatedUnion("kind", [
  z.strictObject({ ...ruleBase, kind: z.literal("formula"), formula, style: styleSchema }),
  z.strictObject({ ...ruleBase, kind: z.literal("colorScale"), stops: z.array(z.strictObject({ threshold, color })).min(2).max(3) })
    .refine(r => r.stops.every((s, i) => {
      const prev = r.stops[i - 1]?.threshold;
      return !prev || !("value" in prev) || !("value" in s.threshold) || prev.value <= s.threshold.value;
    }), "Scale thresholds must be ordered"),
  z.strictObject({ ...ruleBase, kind: z.literal("dataBar"), min: threshold, max: threshold, color, showValue: z.boolean() }),
  z.strictObject({ ...ruleBase, kind: z.literal("iconSet"), thresholds: z.array(threshold),
    icons: z.array(z.enum(["up", "right", "down", "check", "cross", "dot"])).min(2), reverse: z.boolean(), showValue: z.boolean() })
    .refine(r => r.thresholds.length === r.icons.length - 1, "Icon thresholds must equal icons minus one"),
]);
const validationBase = { id: objectIdSchema, range: rectSchema, allowBlank: z.boolean(), severity: z.enum(["stop", "warning"]), message: text };
const validation = z.discriminatedUnion("kind", [
  z.strictObject({ ...validationBase, kind: z.literal("list"), source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("values"), values: z.array(text) }),
    z.strictObject({ kind: z.literal("range"), range: rangeSchema }),
  ]) }),
  z.strictObject({ ...validationBase, kind: z.literal("number"), integer: z.boolean(), min: finite.optional(), max: finite.optional() })
    .refine(r => r.min === undefined || r.max === undefined || r.min <= r.max, "Invalid validation bounds"),
  z.strictObject({ ...validationBase, kind: z.literal("custom"), formula }),
]);
const predicate = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("values"), values: z.array(scalarSchema) }),
  z.strictObject({ kind: z.literal("compare"), op: z.enum(["=", "<>", "<", "<=", ">", ">="]), value: scalarSchema }),
  z.strictObject({ kind: z.literal("text"), op: z.enum(["contains", "startsWith", "endsWith"]), value: text }),
  z.strictObject({ kind: z.literal("blank"), blank: z.boolean() }),
]);
const filter = z.strictObject({
  range: rectSchema, header: z.boolean(),
  columns: z.array(z.strictObject({ offset: integer, predicates: z.array(predicate), combine: z.enum(["and", "or"]) })),
}).superRefine((f, ctx) => {
  const offsets = new Set<number>();
  for (const c of f.columns) {
    if (c.offset > f.range.right - f.range.left || offsets.has(c.offset)) ctx.addIssue({ code: "custom", message: "Invalid or duplicate filter offset" });
    offsets.add(c.offset);
  }
});
const table = z.strictObject({
  id: objectIdSchema, name: symbolName, range: rectSchema,
  columns: z.array(z.strictObject({ id: objectIdSchema, name: text.min(1), calculatedFormula: formula.optional(), totalsFormula: formula.optional() })).min(1),
  totalsRow: z.boolean(), styleId: styleIdSchema.optional(), filter: filter.optional(),
}).refine(t => t.columns.length === t.range.right - t.range.left + 1
  && t.range.bottom - t.range.top + 1 >= (t.totalsRow ? 2 : 1)
  && new Set(t.columns.map(c => c.name.toLocaleLowerCase("en-US"))).size === t.columns.length,
"Table dimensions and headers must agree")
  .refine(t => !t.filter || (t.filter.range.top === t.range.top && t.filter.range.left === t.range.left
    && t.filter.range.right === t.range.right && t.filter.range.bottom <= t.range.bottom - (t.totalsRow ? 1 : 0)), "Filter must lie in table data");
const pivot = z.strictObject({
  id: objectIdSchema, name: symbolName, source: rangeSchema, destination: addressSchema,
  rows: z.array(integer), columns: z.array(integer),
  values: z.array(z.strictObject({ offset: integer, aggregate: z.enum(["sum", "count", "countNumbers", "average", "min", "max"]), label: text })),
  filters: z.array(z.strictObject({ offset: integer, predicate })),
  rowTotals: z.boolean(), columnTotals: z.boolean(), output: rangeSchema.optional(), refreshedAtRevision: integer.optional(),
}).refine(p => [...p.rows, ...p.columns, ...p.values.map(v => v.offset), ...p.filters.map(f => f.offset)]
  .every(v => v <= p.source.right - p.source.left), "Pivot offset is outside source");
const chartAxis = z.strictObject({
  title: text, min: finite.optional(), max: finite.optional(), logarithmic: z.boolean(), numberFormat: text, gridlines: z.boolean(),
}).refine(a => (a.min === undefined || a.max === undefined || a.min < a.max)
  && (!a.logarithmic || ((a.min === undefined || a.min > 0) && (a.max === undefined || a.max > 0))), "Invalid chart axis bounds");
const chart = z.strictObject({
  id: objectIdSchema, kind: z.enum(["line", "area", "column", "bar", "scatter", "pie", "donut", "histogram", "combo"]),
  title: text,
  series: z.array(z.strictObject({
    id: objectIdSchema, name: text, nameCell: addressSchema.optional(), values: rangeSchema,
    categories: rangeSchema.optional(), xValues: rangeSchema.optional(), kind: z.enum(["line", "area", "column"]).optional(),
    axis: z.enum(["primary", "secondary"]), color,
  })),
  anchor: z.strictObject({ row, col, offsetX: finite.nonnegative(), offsetY: finite.nonnegative(), width: finite.positive(), height: finite.positive() }),
  axes: z.strictObject({ x: chartAxis, y: chartAxis, y2: chartAxis.optional() }),
  legend: z.enum(["none", "top", "bottom", "left", "right"]), showHidden: z.boolean(),
  blankAs: z.enum(["gap", "zero"]), stacked: z.boolean(), background: color,
  histogram: z.strictObject({ mode: z.enum(["count", "width"]), value: finite.positive() }).optional(),
}).refine(c => !c.histogram || c.histogram.mode !== "count" || Number.isSafeInteger(c.histogram.value), "Histogram count must be an integer");
const rowIndex = z.string().regex(/^(0|[1-9]\d*)$/).refine(k => Number(k) < GRID_ROWS);
const colIndex = z.string().regex(/^(0|[1-9]\d*)$/).refine(k => Number(k) < GRID_COLUMNS);
export const sheetPropertiesSchema = z.strictObject({
  name: sheetName, tabColor: color.optional(), hidden: z.boolean(),
  defaultRowHeight: finite.positive(), defaultColumnWidth: finite.positive(),
  rowInfo: z.record(rowIndex, axisItem), columnInfo: z.record(colIndex, axisItem),
  groups: z.array(z.strictObject({
    id: objectIdSchema, axis: z.enum(["row", "column"]), start: integer, end: integer, collapsed: z.boolean(),
  }).refine(g => g.start <= g.end && g.end < (g.axis === "row" ? GRID_ROWS : GRID_COLUMNS), "Invalid outline range")),
  merges: z.array(rectSchema), conditionalFormats: z.array(conditional), validations: z.array(validation),
  tables: z.array(table), pivots: z.array(pivot), charts: z.array(chart), filter: filter.optional(),
  view: z.strictObject({
    freezeRows: integer.max(GRID_ROWS), freezeColumns: integer.max(GRID_COLUMNS), zoom: finite.min(25).max(400),
    scrollRow: row, scrollColumn: col, active: z.strictObject({ row, col }),
    selection: z.array(rectSchema), gridlines: z.boolean(),
  }),
}) as z.ZodType<SheetProperties>;
const cellKeySchema = z.string().regex(/^(0|[1-9]\d*):(0|[1-9]\d*)$/)
  .refine(k => { const [r, c] = k.split(":").map(Number); return r !== undefined && c !== undefined && r < GRID_ROWS && c < GRID_COLUMNS; });
const tileKeySchema = z.string().regex(/^(0|[1-9]\d*):(0|[1-9]\d*)$/)
  .refine(k => { const [r, c] = k.split(":").map(Number); return r !== undefined && c !== undefined && r < GRID_ROWS / TILE_ROWS && c < GRID_COLUMNS / TILE_COLUMNS; });
export const sheetSchema = z.strictObject({
  id: sheetIdSchema, properties: sheetPropertiesSchema,
  tiles: z.record(tileKeySchema, z.record(cellKeySchema, cellSchema)),
}).superRefine((s, ctx) => {
  for (const [key, tile] of Object.entries(s.tiles)) for (const coordinate of Object.keys(tile)) {
    const [r = -1, c = -1] = coordinate.split(":").map(Number);
    if (key !== `${Math.floor(r / TILE_ROWS)}:${Math.floor(c / TILE_COLUMNS)}`)
      ctx.addIssue({ code: "custom", message: "Cell does not belong to its tile", path: ["tiles", key, coordinate] });
  }
}) as z.ZodType<Sheet>;
const definedName = z.strictObject({ id: objectIdSchema, name: symbolName, scope: sheetIdSchema.nullable(), origin: addressSchema, formula });
export const workbookPropertiesSchema = z.strictObject({
  name: text.min(1), dateSystem: z.enum(["1900", "1904"]), locale: z.literal("en-US"),
  author: text, description: text, createdAt: timestampSchema, modifiedAt: timestampSchema,
  activeSheetId: sheetIdSchema,
  theme: z.strictObject({ name: text, fontFamily: text, colors: z.array(color) }),
  namedStyles: z.record(z.string().min(1), styleIdSchema),
});
export const resourceLimitsSchema = z.strictObject({
  maxSheets: positive, maxAuthoredCells: positive, maxFormulaLength: positive,
  maxAstDepth: positive, maxArrayCells: positive, maxEvaluationSteps: positive,
  maxCalculationMs: positive, maxLambdaDepth: positive,
}) as z.ZodType<ResourceLimits>;
const workbookShape = z.strictObject({
  schemaVersion: z.literal(1), id: workbookIdSchema, revision: integer,
  properties: workbookPropertiesSchema, sheetOrder: z.array(sheetIdSchema).min(1),
  sheets: z.record(sheetIdSchema, sheetSchema), styles: z.record(styleIdSchema, styleSchema), names: z.array(definedName),
}) as z.ZodType<Workbook>;

/** JSON preflight runs before Zod so inherited fields, accessors and explicit undefined cannot be lost by parsing. */
function wireError(input: unknown): string | undefined {
  const stack: { value: unknown; exit: boolean }[] = [{ value: input, exit: false }];
  const active = new Set<object>();
  const checked = new Set<object>();
  while (stack.length) {
    const frame = stack.pop()!;
    const value = frame.value;
    if (frame.exit) { active.delete(value as object); checked.add(value as object); continue; }
    if (value === null || typeof value === "string" || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value))) continue;
    if (typeof value !== "object") return "Expected JSON-compatible values";
    // Internal immutable transactions intentionally share addresses and style objects.
    // Reject cycles on the current path, while allowing already validated DAG nodes.
    if (active.has(value)) return "Cyclic object reference";
    if (checked.has(value)) continue;
    active.add(value);
    stack.push({ value, exit: true });
    const proto: unknown = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      return "Custom prototypes are forbidden";
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return "Prototype keys are forbidden";
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return "Accessors and nonenumerable values are forbidden";
      stack.push({ value: descriptor.value, exit: false });
    }
    if (Array.isArray(value) && Object.keys(value).length !== value.length) return "Sparse arrays are forbidden";
  }
  return undefined;
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function parseBoundary<T>(schema: z.ZodType<T>, input: unknown): Result<T> {
  const invalid = wireError(input);
  if (invalid) return { ok: false, error: { code: "INVALID_INPUT", message: invalid } };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: {
    code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input",
    path: parsed.error.issues[0]?.path.map(String).join(".") ?? "",
  } };
  return { ok: true, value: freeze(parsed.data) };
}

function checkWorkbook(w: Workbook, limits: ResourceLimits): Result<void> {
  const invalid = (message: string): Result<void> => ({ ok: false, error: { code: "INVALID_INPUT", message } });
  const resource = (message: string): Result<void> => ({ ok: false, error: { code: "RESOURCE_LIMIT", message } });
  const sheetIds = Object.keys(w.sheets);
  if (sheetIds.length > limits.maxSheets) return resource("Too many sheets");
  if (w.sheetOrder.length !== sheetIds.length || new Set(w.sheetOrder).size !== sheetIds.length
    || w.sheetOrder.some(id => !w.sheets[id])) return invalid("Sheet order must contain every sheet exactly once");
  if (!w.sheets[w.properties.activeSheetId] || !sheetIds.some(id => !w.sheets[id]?.properties.hidden)) return invalid("A visible active sheet and at least one visible sheet are required");
  if (w.sheets[w.properties.activeSheetId]?.properties.hidden) return invalid("Active sheet is hidden");
  const sheetNames = new Set<string>(), tableNames = new Set<string>(), objects = new Set<string>();
  const addObject = (id: string): boolean => { if (objects.has(id)) return false; objects.add(id); return true; };
  const styleExists = (id: string | undefined): boolean => id === undefined || Object.hasOwn(w.styles, id);
  const refExists = (ref: { readonly sheetId: string }): boolean => Object.hasOwn(w.sheets, ref.sheetId);
  let count = 0;
  for (const [id, s] of Object.entries(w.sheets)) {
    const p = s.properties, normalized = p.name.toLocaleLowerCase("en-US");
    if (id !== s.id || sheetNames.has(normalized)) return invalid("Invalid sheet ID or duplicate sheet name");
    sheetNames.add(normalized);
    for (const info of [...Object.values(p.rowInfo), ...Object.values(p.columnInfo)])
      if (!styleExists(info.styleId)) return invalid("Axis references missing style");
    for (const tile of Object.values(s.tiles)) if (tile) for (const cell of Object.values(tile)) if (cell) {
      if (++count > limits.maxAuthoredCells) return resource("Too many authored cells");
      if (cell.input.kind === "formula" && cell.input.source.length > limits.maxFormulaLength) return resource("Formula is too long");
      if (!styleExists(cell.styleId)) return invalid("Cell references missing style");
    }
    for (const object of [...p.groups, ...p.conditionalFormats, ...p.validations, ...p.tables, ...p.pivots, ...p.charts])
      if (!addObject(object.id)) return invalid("Object IDs must be unique");
    for (const v of p.validations) if (v.kind === "list" && v.source.kind === "range" && !refExists(v.source.range)) return invalid("Validation references missing sheet");
    for (const t of p.tables) {
      const key = t.name.toLocaleLowerCase("en-US");
      if (tableNames.has(key) || !styleExists(t.styleId)) return invalid("Invalid table name or style");
      tableNames.add(key);
      for (const c of t.columns) if (!addObject(c.id)) return invalid("Duplicate table column ID");
    }
    for (const pvt of p.pivots) if (!refExists(pvt.source) || !refExists(pvt.destination) || (pvt.output && !refExists(pvt.output))) return invalid("Pivot references missing sheet");
    for (const c of p.charts) for (const series of c.series) {
      if (!addObject(series.id)) return invalid("Duplicate chart series ID");
      for (const ref of [series.values, series.categories, series.xValues, series.nameCell])
        if (ref && !refExists(ref)) return invalid("Chart references missing sheet");
    }
  }
  if (Object.values(w.properties.namedStyles).some(id => !styleExists(id))) return invalid("Named style references missing style");
  const names = new Set<string>();
  for (const name of w.names) {
    const key = `${name.scope}:${name.name.toLocaleLowerCase("en-US")}`;
    if (!addObject(name.id) || names.has(key) || (name.scope !== null && !w.sheets[name.scope]) || !refExists(name.origin)) return invalid("Invalid or duplicate defined name");
    names.add(key);
  }
  return { ok: true, value: undefined };
}

export function validateWorkbookState(input: unknown, limits: ResourceLimits = DEFAULT_LIMITS): Result<Workbook> {
  const parsedLimits = resourceLimitsSchema.safeParse(limits);
  if (!parsedLimits.success) return { ok: false, error: { code: "INVALID_INPUT", message: "Invalid resource limits" } };
  const parsed = parseBoundary(workbookShape, input);
  if (!parsed.ok) return parsed;
  const checked = checkWorkbook(parsed.value, parsedLimits.data);
  return checked.ok ? parsed : checked;
}
// API nesting needs the same aggregate validation as the standalone workbook boundary.
export const workbookSchema: z.ZodType<Workbook> = workbookShape.superRefine((w, ctx) => {
  const checked = checkWorkbook(w, DEFAULT_LIMITS);
  if (!checked.ok) ctx.addIssue({ code: "custom", message: checked.error.message });
});
export const patchSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("cell"), at: addressSchema, cell: cellSchema.nullable() }),
  z.strictObject({ kind: z.literal("sheet"), sheetId: sheetIdSchema, sheet: sheetSchema.nullable() }),
  z.strictObject({ kind: z.literal("sheetProperties"), sheetId: sheetIdSchema, properties: sheetPropertiesSchema }),
  z.strictObject({ kind: z.literal("sheetOrder"), order: z.array(sheetIdSchema).min(1) }),
  z.strictObject({ kind: z.literal("workbookProperties"), properties: workbookPropertiesSchema }),
  z.strictObject({ kind: z.literal("style"), styleId: styleIdSchema, style: styleSchema.nullable() }),
  z.strictObject({ kind: z.literal("names"), names: z.array(definedName) }),
]) as z.ZodType<Patch>;
export const transactionSchema = z.strictObject({
  id: transactionIdSchema, baseRevision: integer, label: text, timestamp: timestampSchema, patches: z.array(patchSchema).min(1),
}) as z.ZodType<Transaction>;
const header = {
  id: transactionIdSchema, baseRevision: integer, label: text, timestamp: timestampSchema,
  history: z.enum(["record", "discardConfirmed"]), validation: z.enum(["enforce", "warningsConfirmed"]),
};
export const headerSchema = z.strictObject(header);
const atomicSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...header, kind: z.literal("patch"), patches: z.array(patchSchema).min(1) })
    .refine(e => e.patches.every(p => p.kind !== "sheet" && p.kind !== "sheetOrder"), "Structural patches require semantic edits"),
  z.strictObject({ ...header, kind: z.literal("splice"), sheetId: sheetIdSchema, axis: z.enum(["row", "column"]),
    index: integer, deleteCount: integer, insertCount: integer, insertedTableColumnIds: z.record(objectIdSchema, z.array(objectIdSchema)) })
    .refine(e => e.index < (e.axis === "row" ? GRID_ROWS : GRID_COLUMNS)
      && e.index + e.deleteCount <= (e.axis === "row" ? GRID_ROWS : GRID_COLUMNS)
      && e.index + e.insertCount <= (e.axis === "row" ? GRID_ROWS : GRID_COLUMNS)
      && e.deleteCount + e.insertCount > 0, "Invalid splice bounds"),
  z.strictObject({ ...header, kind: z.literal("move"), source: rangeSchema, destination: addressSchema })
    .refine(e => e.destination.row + e.source.bottom - e.source.top < GRID_ROWS && e.destination.col + e.source.right - e.source.left < GRID_COLUMNS, "Move exceeds grid"),
  z.strictObject({ ...header, kind: z.literal("sheetCreate"), sheet: sheetSchema, index: integer }),
  z.strictObject({ ...header, kind: z.literal("sheetDelete"), sheetId: sheetIdSchema }),
  z.strictObject({ ...header, kind: z.literal("sheetRename"), sheetId: sheetIdSchema, name: sheetName }),
  z.strictObject({ ...header, kind: z.literal("sheetDuplicate"), sheetId: sheetIdSchema, newSheetId: sheetIdSchema, name: sheetName, objectIds: z.record(objectIdSchema, objectIdSchema) }),
  z.strictObject({ ...header, kind: z.literal("sheetReorder"), order: z.array(sheetIdSchema).min(1) })
    .refine(e => new Set(e.order).size === e.order.length, "Duplicate sheet ID"),
  z.strictObject({ ...header, kind: z.literal("tableRename"), sheetId: sheetIdSchema, tableId: objectIdSchema, name: symbolName }),
  z.strictObject({ ...header, kind: z.literal("tableColumnRename"), sheetId: sheetIdSchema, tableId: objectIdSchema, columnId: objectIdSchema, name: text.min(1) }),
]) as z.ZodType<AtomicEdit>;
export const editSchema = z.union([atomicSchema,
  z.strictObject({ ...header, kind: z.literal("batch"), edits: z.array(atomicSchema).min(1) })
    .refine(e => new Set([e.id, ...e.edits.map(child => child.id)]).size === e.edits.length + 1
      && e.edits.every((child, i) => child.baseRevision === e.baseRevision + i), "Batch IDs or evolving revisions are invalid"),
]) as z.ZodType<Edit>;
export const commitSchema = z.strictObject({
  transaction: transactionSchema, revision: positive, inverse: z.array(patchSchema).min(1),
  changes: z.strictObject({ cells: z.array(addressSchema), sheets: z.array(sheetIdSchema), structure: z.boolean(), names: z.boolean(), styles: z.boolean() }),
}).refine(c => c.revision === c.transaction.baseRevision + 1, "Commit revision mismatch") as z.ZodType<Commit>;
export const historyStateSchema = z.strictObject({ undo: z.array(commitSchema), redo: z.array(commitSchema) }) as z.ZodType<HistoryState>;
export const fileOptionsSchema = z.strictObject({
  format: z.enum(["xlsx", "csv", "tsv"]), sheetId: sheetIdSchema.optional(), range: rectSchema.optional(),
  csvEscapeFormulas: z.boolean(), delimiter: z.enum([",", ";", "\\t"]).optional(),
}).refine(f => f.format === "xlsx" || f.sheetId !== undefined, "Delimited export requires sheet ID") as z.ZodType<FileOptions>;
export const compatibilityIssueSchema = z.strictObject({
  code: z.enum(["UNSUPPORTED_FEATURE", "LOSSY_CONVERSION", "FORMULA_DIALECT", "FORMAT_FALLBACK", "EXTERNAL_CONTENT_REMOVED", "RESOURCE_LIMIT"]),
  severity: z.enum(["info", "warning", "error"]), feature: text, message: text, sheetId: sheetIdSchema.optional(), range: rectSchema.optional(),
}) as z.ZodType<CompatibilityIssue>;
