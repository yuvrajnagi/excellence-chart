# OpenExcel public contracts, version 1

These declarations are normative implementation signatures, not pseudocode or implemented exports. Contract revision: 2026-10-20. Each TypeScript block names its module. Blocks for the same module concatenate in order. The owner implements declarations in ordinary `.ts` files and re-exports only the listed public entry points. Internal file organization is the owner's choice. Readonly means consumers cannot mutate a returned value; engine/history objects are explicitly stateful.

All JSON boundaries use strict Zod schemas matching these types, reject unknown object fields and prototype keys, enforce integer/finite-number/resource constraints, and return `Result`, not an unchecked cast. Optional fields are absent rather than `undefined` on the wire. Runtime-only interfaces (function contexts, readers, AbortSignal) are never serialized. IDs use Zod brands with the exact tag strings below.

## 1. Model: coordinates, values and errors

```typescript
// module: @openexcel/model
import type { $brand } from "zod";
export type Brand<T, Tag extends string> = T & $brand<Tag>;
export type WorkbookId = Brand<string, "WorkbookId">;
export type SheetId = Brand<string, "SheetId">;
export type StyleId = Brand<string, "StyleId">;
export type ObjectId = Brand<string, "ObjectId">;
export type TransactionId = Brand<string, "TransactionId">;
export interface IdTypes {
  readonly workbook: WorkbookId;
  readonly sheet: SheetId;
  readonly style: StyleId;
  readonly object: ObjectId;
  readonly transaction: TransactionId;
}
export declare function createId<K extends keyof IdTypes>(kind: K): IdTypes[K];
export declare function parseId<K extends keyof IdTypes>(kind: K, input: unknown): Result<IdTypes[K]>;
export type CellKey = `${number}:${number}`;
export type TileKey = `${number}:${number}`;
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
export interface DomainError {
  readonly code:
    | "INVALID_INPUT" | "OUT_OF_BOUNDS" | "NOT_FOUND" | "CONFLICT"
    | "RESOURCE_LIMIT" | "CANCELLED" | "BUSY" | "SPILL_CHILD"
    | "MERGE_CONFLICT" | "VALIDATION_FAILED" | "HISTORY_LIMIT"
    | "UNSUPPORTED" | "IO_ERROR" | "INTERNAL";
  readonly message: string;
  readonly path?: string;
  readonly address?: CellAddress;
}
export interface CellAddress {
  readonly sheetId: SheetId;
  readonly row: number;
  readonly col: number;
}
export interface CellRect {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}
export interface RangeRef extends CellRect {
  readonly sheetId: SheetId;
}
export type ErrorCode =
  | "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?"
  | "#NUM!" | "#N/A" | "#SPILL!" | "#CALC!" | "#CIRC!" | "#PARSE!";
export interface ErrorValue {
  readonly kind: "error";
  readonly code: ErrorCode;
  readonly message?: string;
}
export type Scalar = null | number | string | boolean | ErrorValue;
export interface ArrayValue {
  readonly kind: "array";
  readonly rows: number;
  readonly cols: number;
  readonly values: readonly Scalar[];
}
export type ComputedValue = Scalar | ArrayValue;
export type CellInput =
  | { readonly kind: "value"; readonly value: Scalar }
  | { readonly kind: "formula"; readonly source: string };
export interface Cell {
  readonly input: CellInput;
  readonly styleId?: StyleId;
  readonly note?: string;
}
export type Tile = Readonly<Partial<Record<CellKey, Cell>>>;
export type TileStore = Readonly<Partial<Record<TileKey, Tile>>>;
export interface ResourceLimits {
  readonly maxSheets: number;
  readonly maxAuthoredCells: number;
  readonly maxFormulaLength: number;
  readonly maxAstDepth: number;
  readonly maxArrayCells: number;
  readonly maxEvaluationSteps: number;
  readonly maxCalculationMs: number;
  readonly maxLambdaDepth: number;
}
export declare const GRID_ROWS: 1048576;
export declare const GRID_COLUMNS: 16384;
export declare const TILE_ROWS: 128;
export declare const TILE_COLUMNS: 32;
export declare const DEFAULT_LIMITS: ResourceLimits;
export declare function cellKey(row: number, col: number): Result<CellKey>;
export declare function tileKey(row: number, col: number): Result<TileKey>;
export declare function parseAddress(text: string, sheetId: SheetId): Result<CellAddress>;
export declare function formatAddress(address: CellAddress): string;
export declare function parseWorkbook(input: unknown, limits?: ResourceLimits): Result<Workbook>;
export declare function parseCellInput(text: string, dateSystem: "1900" | "1904"): CellInput;
```

Rectangles are inclusive and nonempty; arrays are row-major, positive rectangular dimensions, exactly `rows * cols` scalar values and no nested arrays. Nonfinite numbers become `#NUM!`, never JSON null. A missing cell evaluates to `null`; `""` remains a string. `parseAddress` accepts an unqualified A1 address only (optional `$`), not a range; formula syntax owns qualified/mixed references. `formatAddress` returns unqualified uppercase A1.

`parseCellInput` removes one leading apostrophe to force text, recognizes leading `=`, TRUE/FALSE, finite decimal/scientific numbers and unambiguous ISO dates. Other text stays text; ambiguous localized dates are not guessed. Invariant formula syntax is English names, comma arguments and dot decimals. UI-localized display does not change stored syntax.

`parseCellInput("")` produces a null value, never an empty-string value; an apostrophe alone produces `""`. Strings are limited to 32,767 Unicode code points at input boundaries. Dates in cells are numeric serial values, never a second date scalar type. Missing dictionary keys are read with indexed access and may be absent even when the index signature uses `Record`; `noUncheckedIndexedAccess` is mandatory. Numeric coordinates/revisions are finite safe integers, revisions nonnegative. `DEFAULT_LIMITS` is exactly `{maxSheets:256,maxAuthoredCells:2000000,maxFormulaLength:32768,maxAstDepth:1024,maxArrayCells:1000000,maxEvaluationSteps:50000000,maxCalculationMs:30000,maxLambdaDepth:256}`. Workbook parsers validate aggregate limits as well as individual fields.

All modules in this document are ESM, including declaration consumers. `zod` means Zod 4, because the ID representation uses its `$brand` type. Runtime dependencies selected for foundation are Zod 4, ExcelJS, fflate and fast-xml-parser; FOUNDATION resolves/pins compatible exact versions in the lockfile. React/Vite, TypeScript, Vitest and Playwright versions are pinned there too. No Bun-specific API appears in shipped Node/browser packages.

## 2. Model: formatting and worksheet objects

```typescript
// module: @openexcel/model
export interface Border {
  readonly style: "none" | "thin" | "medium" | "thick" | "dashed" | "dotted" | "double";
  readonly color: string;
}
export interface CellStyle {
  readonly font?: {
    readonly family?: string; readonly size?: number;
    readonly bold?: boolean; readonly italic?: boolean;
    readonly underline?: boolean; readonly color?: string;
  };
  readonly fill?: string;
  readonly borders?: {
    readonly top?: Border; readonly right?: Border;
    readonly bottom?: Border; readonly left?: Border;
  };
  readonly horizontal?: "general" | "left" | "center" | "right";
  readonly vertical?: "top" | "middle" | "bottom";
  readonly wrap?: boolean;
  readonly rotation?: number;
  readonly numberFormat?: string;
}
export interface Theme {
  readonly name: string;
  readonly fontFamily: string;
  readonly colors: readonly string[];
}
export interface AxisItem {
  readonly size?: number;
  readonly hidden?: boolean;
  readonly styleId?: StyleId;
}
export interface OutlineGroup {
  readonly id: ObjectId;
  readonly axis: "row" | "column";
  readonly start: number;
  readonly end: number;
  readonly collapsed: boolean;
}
export type Threshold =
  | { readonly kind: "minimum" | "maximum" }
  | { readonly kind: "number" | "percent" | "percentile"; readonly value: number };
export type ConditionalRule = {
  readonly id: ObjectId; readonly range: CellRect;
  readonly priority: number; readonly stopIfTrue: boolean;
} & (
  | { readonly kind: "formula"; readonly formula: string; readonly style: CellStyle }
  | { readonly kind: "colorScale"; readonly stops: readonly {
      readonly threshold: Threshold; readonly color: string;
    }[] }
  | { readonly kind: "dataBar"; readonly min: Threshold; readonly max: Threshold;
      readonly color: string; readonly showValue: boolean }
  | { readonly kind: "iconSet"; readonly thresholds: readonly Threshold[];
      readonly icons: readonly ("up" | "right" | "down" | "check" | "cross" | "dot")[];
      readonly reverse: boolean; readonly showValue: boolean }
);
export type ValidationRule = {
  readonly id: ObjectId; readonly range: CellRect;
  readonly allowBlank: boolean; readonly severity: "stop" | "warning";
  readonly message: string;
} & (
  | { readonly kind: "list"; readonly source:
      | { readonly kind: "values"; readonly values: readonly string[] }
      | { readonly kind: "range"; readonly range: RangeRef } }
  | { readonly kind: "number"; readonly integer: boolean;
      readonly min?: number; readonly max?: number }
  | { readonly kind: "custom"; readonly formula: string }
);
export type FilterPredicate =
  | { readonly kind: "values"; readonly values: readonly Scalar[] }
  | { readonly kind: "compare"; readonly op: "=" | "<>" | "<" | "<=" | ">" | ">=";
      readonly value: Scalar }
  | { readonly kind: "text"; readonly op: "contains" | "startsWith" | "endsWith";
      readonly value: string }
  | { readonly kind: "blank"; readonly blank: boolean };
export interface FilterSpec {
  readonly range: CellRect;
  readonly header: boolean;
  readonly columns: readonly {
    readonly offset: number; readonly predicates: readonly FilterPredicate[];
    readonly combine: "and" | "or";
  }[];
}
export interface RowInterval {
  readonly start: number;
  readonly end: number;
}
export interface ValueReader {
  value(at: CellAddress): Scalar;
}
export declare function matchesFilter(value: Scalar, predicate: FilterPredicate): boolean;
export declare function hiddenRows(sheet: Sheet, reader: ValueReader): readonly RowInterval[];
export interface SortKey {
  readonly offset: number;
  readonly direction: "asc" | "desc";
}
export interface TableDefinition {
  readonly id: ObjectId;
  readonly name: string;
  readonly range: CellRect;
  readonly columns: readonly {
    readonly id: ObjectId; readonly name: string;
    readonly calculatedFormula?: string; readonly totalsFormula?: string;
  }[];
  readonly totalsRow: boolean;
  readonly styleId?: StyleId;
  readonly filter?: FilterSpec;
}
export type Aggregate = "sum" | "count" | "countNumbers" | "average" | "min" | "max";
export interface PivotDefinition {
  readonly id: ObjectId;
  readonly name: string;
  readonly source: RangeRef;
  readonly destination: CellAddress;
  readonly rows: readonly number[];
  readonly columns: readonly number[];
  readonly values: readonly {
    readonly offset: number; readonly aggregate: Aggregate; readonly label: string;
  }[];
  readonly filters: readonly {
    readonly offset: number; readonly predicate: FilterPredicate;
  }[];
  readonly rowTotals: boolean;
  readonly columnTotals: boolean;
  readonly output?: RangeRef;
  readonly refreshedAtRevision?: number;
}
export type ChartKind =
  | "line" | "area" | "column" | "bar" | "scatter"
  | "pie" | "donut" | "histogram" | "combo";
export interface ChartSeries {
  readonly id: ObjectId;
  readonly name: string;
  readonly nameCell?: CellAddress;
  readonly values: RangeRef;
  readonly categories?: RangeRef;
  readonly xValues?: RangeRef;
  readonly kind?: "line" | "area" | "column";
  readonly axis: "primary" | "secondary";
  readonly color: string;
}
export interface ChartAxis {
  readonly title: string;
  readonly min?: number; readonly max?: number;
  readonly logarithmic: boolean;
  readonly numberFormat: string;
  readonly gridlines: boolean;
}
export interface ChartDefinition {
  readonly id: ObjectId;
  readonly kind: ChartKind;
  readonly title: string;
  readonly series: readonly ChartSeries[];
  readonly anchor: {
    readonly row: number; readonly col: number;
    readonly offsetX: number; readonly offsetY: number;
    readonly width: number; readonly height: number;
  };
  readonly axes: { readonly x: ChartAxis; readonly y: ChartAxis; readonly y2?: ChartAxis };
  readonly legend: "none" | "top" | "bottom" | "left" | "right";
  readonly showHidden: boolean;
  readonly blankAs: "gap" | "zero";
  readonly stacked: boolean;
  readonly background: string;
  readonly histogram?: { readonly mode: "count" | "width"; readonly value: number };
}
```

Colors are validated `#RRGGBB`/`#RRGGBBAA`, not CSS or HTML. Font sizes are 6-96 points, row/column sizes positive CSS pixels, rotations -90..90. Number formats are data, never CSS/JS. Conditional rules are ordered by priority then ID; first matching property wins, `stopIfTrue` stops subsequent rules. Scale stops are 2 or 3 ordered thresholds; icon thresholds count is icons minus one.

Filter offsets, sort offsets and pivot dimensions are zero-based within their source range. A table's range includes its header and optional totals row. Names/column IDs are stable under header rename; parser binds structured references to column IDs. Table rename or column rename is a semantic engine operation. A table's filter overrides the sheet filter only within that table.

Pivot source row 0 contains headers, subsequent rows contain data. Pivot refresh writes materialized output in one transaction and updates `output`; stale prior output is cleared only inside that recorded range. Overlap with source, another pivot, merge or non-owned nonblank output fails rather than overwrites. Filter changes and input edits mark the pivot stale; explicit refresh recomputes it. Charts are live on every calculation, unlike refreshable pivots.

## 3. Model: workbook, edits and undo

```typescript
// module: @openexcel/model
export interface SheetView {
  readonly freezeRows: number; readonly freezeColumns: number;
  readonly zoom: number;
  readonly scrollRow: number; readonly scrollColumn: number;
  readonly active: { readonly row: number; readonly col: number };
  readonly selection: readonly CellRect[];
  readonly gridlines: boolean;
}
export interface SheetProperties {
  readonly name: string;
  readonly tabColor?: string;
  readonly hidden: boolean;
  readonly defaultRowHeight: number;
  readonly defaultColumnWidth: number;
  readonly rowInfo: Readonly<Record<string, AxisItem>>;
  readonly columnInfo: Readonly<Record<string, AxisItem>>;
  readonly groups: readonly OutlineGroup[];
  readonly merges: readonly CellRect[];
  readonly conditionalFormats: readonly ConditionalRule[];
  readonly validations: readonly ValidationRule[];
  readonly tables: readonly TableDefinition[];
  readonly pivots: readonly PivotDefinition[];
  readonly charts: readonly ChartDefinition[];
  readonly filter?: FilterSpec;
  readonly view: SheetView;
}
export interface Sheet {
  readonly id: SheetId;
  readonly properties: SheetProperties;
  readonly tiles: TileStore;
}
export interface DefinedName {
  readonly id: ObjectId;
  readonly name: string;
  readonly scope: SheetId | null;
  readonly origin: CellAddress;
  readonly formula: string;
}
export interface WorkbookProperties {
  readonly name: string;
  readonly dateSystem: "1900" | "1904";
  readonly locale: "en-US";
  readonly author: string;
  readonly description: string;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly activeSheetId: SheetId;
  readonly theme: Theme;
  readonly namedStyles: Readonly<Record<string, StyleId>>;
}
export interface Workbook {
  readonly schemaVersion: 1;
  readonly id: WorkbookId;
  readonly revision: number;
  readonly properties: WorkbookProperties;
  readonly sheetOrder: readonly SheetId[];
  readonly sheets: Readonly<Record<string, Sheet>>;
  readonly styles: Readonly<Record<string, CellStyle>>;
  readonly names: readonly DefinedName[];
}
export type Patch =
  | { readonly kind: "cell"; readonly at: CellAddress; readonly cell: Cell | null }
  | { readonly kind: "sheet"; readonly sheetId: SheetId; readonly sheet: Sheet | null }
  | { readonly kind: "sheetProperties"; readonly sheetId: SheetId;
      readonly properties: SheetProperties }
  | { readonly kind: "sheetOrder"; readonly order: readonly SheetId[] }
  | { readonly kind: "workbookProperties"; readonly properties: WorkbookProperties }
  | { readonly kind: "style"; readonly styleId: StyleId; readonly style: CellStyle | null }
  | { readonly kind: "names"; readonly names: readonly DefinedName[] };
export interface Transaction {
  readonly id: TransactionId;
  readonly baseRevision: number;
  readonly label: string;
  readonly timestamp: string;
  readonly patches: readonly Patch[];
}
export interface ChangeSet {
  readonly cells: readonly CellAddress[];
  readonly sheets: readonly SheetId[];
  readonly structure: boolean;
  readonly names: boolean;
  readonly styles: boolean;
}
export interface Commit {
  readonly transaction: Transaction;
  readonly revision: number;
  readonly inverse: readonly Patch[];
  readonly changes: ChangeSet;
}
export interface AppliedTransaction {
  readonly workbook: Workbook;
  readonly commit: Commit;
}
export interface EditHeader {
  readonly id: TransactionId;
  readonly baseRevision: number;
  readonly label: string;
  readonly timestamp: string;
  readonly history: "record" | "discardConfirmed";
  readonly validation: "enforce" | "warningsConfirmed";
}
export type AtomicEdit = EditHeader & (
  | { readonly kind: "patch"; readonly patches: readonly Patch[] }
  | { readonly kind: "splice"; readonly sheetId: SheetId;
      readonly axis: "row" | "column"; readonly index: number;
      readonly deleteCount: number; readonly insertCount: number;
      readonly insertedTableColumnIds: Readonly<Record<string, readonly ObjectId[]>> }
  | { readonly kind: "move"; readonly source: RangeRef; readonly destination: CellAddress }
  | { readonly kind: "sheetCreate"; readonly sheet: Sheet; readonly index: number }
  | { readonly kind: "sheetDelete"; readonly sheetId: SheetId }
  | { readonly kind: "sheetRename"; readonly sheetId: SheetId; readonly name: string }
  | { readonly kind: "sheetDuplicate"; readonly sheetId: SheetId;
      readonly newSheetId: SheetId; readonly name: string;
      readonly objectIds: Readonly<Record<string, ObjectId>> }
  | { readonly kind: "sheetReorder"; readonly order: readonly SheetId[] }
  | { readonly kind: "tableRename"; readonly sheetId: SheetId;
      readonly tableId: ObjectId; readonly name: string }
  | { readonly kind: "tableColumnRename"; readonly sheetId: SheetId;
      readonly tableId: ObjectId; readonly columnId: ObjectId; readonly name: string }
);
export interface EditBatch extends EditHeader {
  readonly kind: "batch";
  readonly edits: readonly AtomicEdit[];
}
export type Edit = AtomicEdit | EditBatch;
export interface HistoryOptions {
  readonly maxEntries: number; readonly maxBytes: number;
}
export interface HistoryState {
  readonly undo: readonly Commit[];
  readonly redo: readonly Commit[];
}
export interface History {
  canUndo(): boolean;
  canRedo(): boolean;
  record(commit: Commit): Result<void>;
  undo(workbook: Workbook, header: EditHeader): Result<AppliedTransaction>;
  redo(workbook: Workbook, header: EditHeader): Result<AppliedTransaction>;
  snapshot(): HistoryState;
  restore(state: HistoryState): Result<void>;
  clear(): void;
}
export declare function createWorkbook(options: {
  readonly id: WorkbookId; readonly sheetId: SheetId;
  readonly name: string; readonly timestamp: string;
}): Workbook;
export declare function getCell(workbook: Workbook, at: CellAddress): Cell | undefined;
export declare function entries(workbook: Workbook, range: RangeRef): Iterable<{
  readonly at: CellAddress; readonly cell: Cell;
}>;
export declare function applyTransaction(workbook: Workbook, transaction: Transaction): Result<AppliedTransaction>;
export declare function createHistory(options: HistoryOptions): History;
export declare function validateEdit(input: unknown): Result<Edit>;
```

`applyTransaction` validates the final aggregate atomically, computes inverse patches in reverse order, applies canonical tile cleanup and increments revision exactly once. Timestamp becomes workbook `modifiedAt` and is included in inverse state. Empty transactions are rejected. History preflights byte budget before engine publication; a rejected record must not leave an applied edit. `discardConfirmed` clears both history stacks before applying, only after the UI explicitly confirmed.

History stacks are oldest-first. `snapshot` shares immutable commit objects; `restore` validates shape/budgets and atomically replaces both stacks, without applying patches or changing the workbook. The web coordinator maintains an equivalent model History alongside its authored replica: record actual acknowledged commits, call undo/redo only on the matching acknowledged request, and clear only on acknowledged `discardConfirmed`. It supplies this bounded state on worker restart so cancellation does not erase undo. History is session recovery state, not part of the persisted workbook or XLSX.

`hiddenRows` returns sorted disjoint inclusive intervals for filters only; manual hiding and collapsed groups remain separate. Filter comparison uses the same scalar type order as DATA sorting and case-insensitive en-US text, with errors equal only by error code. Columns combine with AND, predicates within a column use its combine flag. `matchesFilter` is the shared predicate primitive used by DATA and the engine, avoiding a formula-to-data import. Engine invalidates filtered visibility and SUBTOTAL consumers when any filter-source value changes; a visibility/value dependency cycle returns `#CIRC!`. Table totals/header rows are never filtered out.

Patch types deliberately include full-sheet replacement for structural plans and full property replacement for small metadata. An app-authored `"patch"` edit may change cells, styles, names, nonstructural properties and create/delete table/chart/pivot definitions; it may not use `"sheet"`/`"sheetOrder"`, rename sheets/tables/columns, change IDs or relocate table bounds. Semantic variants handle those transformations. Range copy/paste writes cells in place; cut is `"move"`. DATA sort changes row contents with copy-style formula adjustment; references outside the sorted block continue to address positions.

New tables derive their range from explicit selection. Table resizing is implemented as a range-preserving row/column splice when structural, or replacing the table definition only when extending into existing blank adjacent cells; engine rebuilds structured-reference bindings in either case. Model validates references to styles/IDs, uniqueness and bounds. The engine validates merged/spill/table conflicts, formulas, name binding and structural impacts.

Deleting the last visible sheet is invalid. Sheet duplicate remaps every contained object ID using the complete supplied map, generates cloned locally scoped names and rewrites references to the original sheet only for formulas/names inside the duplicate. Workbook-scoped names remain shared. Copy/paste changes only relative axes; insertion/deletion changes references even when absolute, contracts ranges, and converts fully deleted references to `#REF!`. Cut/move tracks moved targets in all dependent formulas. Splice at the grid edge rejects nonblank data loss. Merges reject overlapping merges and require explicit confirmation before clearing non-anchor cells; that clearing is part of the undoable transaction.

## 4. Formula syntax

```typescript
// module: @openexcel/formula/syntax
import type {
  CellAddress, CellRect, ErrorValue, ObjectId, RangeRef, Result,
  Scalar, SheetId, Workbook
} from "@openexcel/model";
export interface SourceSpan { readonly start: number; readonly end: number }
export interface Token {
  readonly kind: "number" | "string" | "identifier" | "reference" | "error"
    | "operator" | "punctuation" | "eof";
  readonly text: string;
  readonly span: SourceSpan;
}
export interface Reference {
  readonly sheetId: SheetId;
  readonly explicitSheet: boolean;
  readonly row: number; readonly col: number;
  readonly rowAbsolute: boolean; readonly colAbsolute: boolean;
}
export type Expr = SourceSpan & (
  | { readonly kind: "literal"; readonly value: Scalar }
  | { readonly kind: "missing" }
  | { readonly kind: "ref"; readonly ref: Reference }
  | { readonly kind: "range"; readonly from: Reference; readonly to: Reference;
      readonly whole: "none" | "rows" | "columns" }
  | { readonly kind: "name"; readonly name: string; readonly sheetId: SheetId | null }
  | { readonly kind: "structured"; readonly tableId: ObjectId;
      readonly columnIds: readonly ObjectId[];
      readonly section: "all" | "data" | "headers" | "totals" | "thisRow" }
  | { readonly kind: "unary"; readonly op: "+" | "-" | "@"; readonly operand: Expr }
  | { readonly kind: "percent" | "spill"; readonly operand: Expr }
  | { readonly kind: "binary";
      readonly op: "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | "<=" | ">" | ">=";
      readonly left: Expr; readonly right: Expr }
  | { readonly kind: "call"; readonly callee: Expr; readonly args: readonly Expr[] }
  | { readonly kind: "array"; readonly rows: readonly (readonly Expr[])[] }
);
export interface ParseContext {
  readonly workbook: Workbook;
  readonly origin: CellAddress;
}
export interface ParseDiagnostic {
  readonly code: "SYNTAX" | "DEPTH" | "LENGTH" | "REFERENCE";
  readonly message: string;
  readonly span: SourceSpan;
}
export type ReferenceTransform =
  | { readonly kind: "copy"; readonly from: CellAddress; readonly to: CellAddress }
  | { readonly kind: "splice"; readonly sheetId: SheetId; readonly axis: "row" | "column";
      readonly index: number; readonly deleteCount: number; readonly insertCount: number }
  | { readonly kind: "move"; readonly source: RangeRef; readonly destination: CellAddress }
  | { readonly kind: "deleteSheet"; readonly sheetId: SheetId }
  | { readonly kind: "duplicateSheet"; readonly from: SheetId; readonly to: SheetId;
      readonly objectIds: Readonly<Record<string, ObjectId>> };
export interface DependencySpec {
  readonly cells: readonly CellAddress[];
  readonly ranges: readonly RangeRef[];
  readonly names: readonly string[];
  readonly tables: readonly ObjectId[];
  readonly dynamic: boolean;
}
export declare function tokenize(source: string): Result<readonly Token[], readonly ParseDiagnostic[]>;
export declare function parseFormula(source: string, context: ParseContext): Result<Expr, readonly ParseDiagnostic[]>;
export declare function printFormula(expression: Expr, workbook: Workbook): string;
export declare function transformReferences(expression: Expr, transform: ReferenceTransform): Expr;
export declare function collectDependencies(expression: Expr): DependencySpec;
```

Offsets are UTF-16 string offsets into the source including `=`. Quoted sheet names escape `'` as `''`; strings escape `"` as `""`. Parsing strips `_xlfn.` and `_xlws.` compatibility prefixes for supported functions but preserves original authored source until edited. AST error literals carry `ErrorValue`; a broken reference is an error literal, not a coordinate `-1`. Structured forms include `Table[Column]`, `Table[[First]:[Last]]`, `Table[#All]`, `Table[#Data]`, `Table[#Headers]`, `Table[#Totals]`, `Table[@Column]` and a single section plus column selection. Multiple disjoint sections are outside this dialect and produce a diagnostic, not a partial reference.

Binding precedence, highest first: reference/range and spill, unary signs/implicit intersection, percent, power, multiply/divide, add/subtract, concatenation, comparisons. Power is left-associative to match the chosen Excel arithmetic dialect; `-1^2` is `1`. Arrays use comma columns and semicolon rows. Empty function arguments are `missing`, distinct from `null`. Parentheses may invoke a lambda expression, e.g. `LAMBDA(x,x+1)(2)`. Union/intersection reference operators, external workbook references and 3D sheet ranges return a diagnostic rather than incorrect parsing. Whole-column/row ranges remain symbolic until read.

## 5. Function registry and lazy evaluation

```typescript
// module: @openexcel/formula/functions
import type {
  ArrayValue, CellAddress, ErrorCode, ErrorValue, RangeRef, Result,
  Scalar, Workbook
} from "@openexcel/model";
import type { Expr } from "@openexcel/formula/syntax";
export interface ReferenceValue {
  readonly kind: "reference";
  readonly areas: readonly RangeRef[];
}
export interface MissingValue { readonly kind: "missing" }
export interface Binding { get(): EvalValue }
export interface Scope { lookup(name: string): Binding | undefined }
export interface LambdaValue {
  readonly kind: "lambda";
  readonly parameters: readonly string[];
  readonly body: Expr;
  readonly closure: Scope;
}
export type EvalValue = Scalar | ArrayValue | ReferenceValue | MissingValue | LambdaValue;
export interface EvaluationEpoch {
  readonly id: number;
  readonly nowMs: number;
  readonly randomSeed: number;
}
export interface EvaluationMask {
  readonly rows: number;
  readonly cols: number;
  readonly selected: readonly number[];
}
export interface FunctionContext {
  readonly origin: CellAddress;
  readonly workbook: Workbook;
  readonly epoch: EvaluationEpoch;
  readonly scope: Scope;
  readonly callSite: number;
  readonly mask: EvaluationMask | null;
  read(address: CellAddress): Scalar;
  iterate(range: RangeRef, mode: "all" | "nonblank"): Iterable<{
    readonly address: CellAddress; readonly value: Scalar;
    readonly filtered: boolean; readonly manuallyHidden: boolean;
    readonly subtotal: boolean;
  }>;
  scalar(value: EvalValue): Scalar;
  array(value: EvalValue): ArrayValue | ErrorValue;
  number(value: Scalar): number | ErrorValue;
  boolean(value: Scalar): boolean | ErrorValue;
  text(value: Scalar): string | ErrorValue;
  reference(text: string, style: "A1" | "R1C1"): ReferenceValue | ErrorValue;
  random(): number;
  consume(steps: number): ErrorValue | null;
  error(code: ErrorCode, message?: string): ErrorValue;
}
export interface LazyFunctionContext extends FunctionContext {
  evaluate(expression: Expr, scope?: Scope, mask?: EvaluationMask): EvalValue;
  bind(scope: Scope, name: string, binding: Binding): Scope;
  lambda(parameters: readonly string[], body: Expr, closure: Scope): LambdaValue;
  invoke(lambda: LambdaValue, arguments_: readonly EvalValue[]): EvalValue;
}
export interface FunctionMetadata {
  readonly name: string;
  readonly minArgs: number;
  readonly maxArgs: number | null;
  readonly volatile: boolean;
}
export type FunctionDefinition = FunctionMetadata & (
  | { readonly evaluation: "eager";
      readonly invoke: (args: readonly EvalValue[], context: FunctionContext) => EvalValue }
  | { readonly evaluation: "lazy";
      readonly invoke: (args: readonly Expr[], context: LazyFunctionContext) => EvalValue }
);
export interface FunctionRegistry {
  get(name: string): FunctionDefinition | undefined;
  list(): readonly FunctionMetadata[];
}
export declare function createFunctionRegistry(definitions: readonly FunctionDefinition[]): Result<FunctionRegistry>;
export declare function createDefaultRegistry(): FunctionRegistry;
```

Registry construction rejects duplicate normalized names and invalid arity; lookup is uppercase case-insensitive. The engine resolves lexical/name bindings before registered function names, checks arity, then dispatches `evaluation`. Eager means evaluate arguments, not preemptively propagate errors: IFERROR is lazy, but aggregates still need explicit blank/text/error rules. Never flatten references before passing them to a function; SUBTOTAL, INDEX and reference-sensitive coercion need provenance.

Mandatory lazy functions: IF, IFS, IFERROR, IFNA, SWITCH, CHOOSE, LET, LAMBDA. IF/IFS/SWITCH evaluate only the selected branch; IFERROR/IFNA evaluate fallback only on a matching error; CHOOSE evaluates selected alternatives only. LET validates alternating names/values and final expression, extends scope sequentially, memoizes each binding within one invocation and evaluates only requested bindings. LAMBDA validates parameter identifiers, captures lexical scope and does not evaluate its body until invoked. Recursive named LAMBDA uses a self binding, not string substitution, and stops at 256 calls with `#NUM!`. A standalone uninvoked lambda in a cell yields `#CALC!`.

Array-valued conditions select branches elementwise. `EvaluationMask.selected` contains sorted unique row-major indexes within its positive shape. An omitted mask inherits the current context mask; null on the context means the whole result is demanded. An empty selected set does not evaluate the expression. A branch scalar broadcasts to selected positions; array branches must broadcast by singleton dimensions or match the condition shape. Nonselected result slots contain null only internally and are replaced by the selected alternative before publication. Aggregate/reduction arguments are fully demanded if any selected output needs their scalar result. LET memoization is per binding and demand mask, not a partially evaluated value reused as a full result. These rules prevent an unused `1/0` branch or lambda invocation from creating a visible error.

Every built-in receives the context above; none obtains time/randomness from globals. `consume` accepts a positive integer, debits the request budget, checks the monotonic deadline and returns `#CALC!` on exhaustion; loops call it at least every 1,024 visited elements and propagate its error. Registry callbacks are synchronous. They cannot yield to worker messages midway through a JavaScript call; cooperative recalculation yields between completed cell evaluations. The coordinator's termination fallback in architecture is mandatory for cancellation of a long individual call.

`FunctionContext.read`, `iterate` and `reference` register actual dependencies and consume the common budget. `scalar` performs top-left scalar extraction only when a function explicitly requests it; implicit intersection in an expression requires `@`. Arithmetic/comparison operators lift scalars across arrays, allow equal shapes or singleton dimensions, and return `#VALUE!` on incompatible shapes. References dereference lazily; function outputs may remain references for INDEX/OFFSET/INDIRECT before final cell materialization.

Default coercion: numeric conversion maps blank to 0, TRUE/FALSE to 1/0 and invariant numeric text to numbers; other text is `#VALUE!`. Logical conversion maps blank to false and finite numbers to nonzero, recognizes TRUE/FALSE text and rejects other text. Text conversion maps blank to `""`, booleans to TRUE/FALSE and numbers to invariant text; errors propagate. Aggregates override coercion: referenced text/booleans/blanks are ignored for numeric aggregations, while explicit scalar arguments follow that function's compatibility tests. Error search/order is row-major argument order, not hash-map iteration.

### Required function coverage and compatibility fixtures

Every function listed below is required, not a menu. Each receives named fixtures for ordinary inputs, minimum/maximum/invalid arity, blank vs empty text, coercion, errors, boundary values and applicable arrays/references. Expected results come from independently worked examples or recorded Excel exports, not calling the same implementation twice.

| Family | Required functions | Required edge semantics |
| --- | --- | --- |
| Aggregation | SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTIF, COUNTIFS, SUMIF, SUMIFS, AVERAGEIF | No numbers: SUM/MIN/MAX 0, AVERAGE `#DIV/0!`; COUNTA counts empty-string formula results; criteria `*`, `?`, `~`, comparison prefixes, shape mismatches and error cells |
| Logic/bindings | IF, IFS, AND, OR, NOT, IFERROR, IFNA, SWITCH, LET, LAMBDA, CHOOSE | Lazy cases above; no-match IFS/SWITCH `#N/A`; AND/OR reference text rules; unused binding errors; nested shadowing, closures, recursion |
| Lookup/reference | INDEX, MATCH, XMATCH, XLOOKUP, VLOOKUP, HLOOKUP, OFFSET, INDIRECT | INDEX array/reference form and zero row/column; MATCH modes -1/0/1; XMATCH/XLOOKUP modes 0/-1/1/2 and search 1/-1/2/-2; sorted precondition for binary/approximate modes; missing `#N/A`; A1/R1C1 INDIRECT without external links; volatile dynamic dependencies |
| Dynamic arrays | FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TRANSPOSE, TAKE, DROP | Empty FILTER without fallback `#CALC!`; stable sort; by-column UNIQUE/SORT; exactly-once UNIQUE; negative TAKE/DROP; zero-sized result `#CALC!`; obstruction, shape and boundary spill tests |
| Text | TEXT, VALUE, LEFT, RIGHT, MID, LEN, TRIM, SUBSTITUTE, REPLACE, CONCAT, TEXTJOIN, FIND, SEARCH, UPPER, LOWER, PROPER | TEXT delegates to formatting; VALUE invariant en-US numbers/currency/percent/ISO dates; FIND case sensitive, SEARCH wildcards/case insensitive; 1-based positions; negative lengths `#VALUE!`; TRIM ASCII space |
| Math/random | ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, POWER, SQRT, RAND, RANDBETWEEN | Half away from zero; INT floors negatives; MOD sign follows divisor; zero divisor `#DIV/0!`; invalid root/domain `#NUM!`; seeded random reproducibility and inclusive integer bounds |
| Dates | TODAY, NOW, DATE, YEAR, MONTH, DAY, EDATE, EOMONTH, NETWORKDAYS, WORKDAY | 1900/1904 systems, serial 60, month/day normalization, negative months, inclusive weekday counts, holidays and weekend skipping; UTC fixed epoch, not host timezone |
| Finance | PMT, PV, FV, NPV, IRR | Zero rate, beginning/end periods, sign convention; NPV starts at period 1; IRR mixed signs, guess default .1, bracketed solver bounded at 100 iterations and relative tolerance 1e-10; failure `#NUM!` |
| Statistics | STDEV.S, STDEV.P, VAR.S, VAR.P, MEDIAN, LARGE, SMALL, RANK.EQ | Sample/population divisors, insufficient values, stable numerics, ties, ascending/descending rank, k outside range `#NUM!` |
| Visibility | SUBTOTAL | Codes 1-11 and 101-111, exclude filtered rows always, exclude manually hidden rows for 100-series, exclude nested SUBTOTAL results |

No locale aliases, arbitrary JavaScript regex criteria, arbitrary date-string heuristics, iterative circular formulas, or user-loaded executable function plugins. String indexing uses Unicode code points; document the difference from older Excel UTF-16 compatibility modes. Floating point uses IEEE-754 doubles, not Excel's full decimal precision heuristics. `#CIRC!` and `#PARSE!` are OpenExcel diagnostic additions; XLSX export maps them to `#VALUE!` with issues. FORMULA imports `formatValue`, `validateNumberFormat` and `excelSerialToParts` from `@openexcel/formatting`; FORMAT owns their fixtures. Formatting's callback interface prevents a reverse dependency.

## 6. Engine and calculation cache

```typescript
// module: @openexcel/formula
import type {
  CellAddress, CellKey, Commit, ComputedValue, Edit, EditHeader, ErrorValue,
  HistoryOptions, HistoryState, RangeRef, ResourceLimits, Result, RowInterval, Scalar, Workbook
} from "@openexcel/model";
import type {
  EvaluationEpoch, FunctionRegistry
} from "@openexcel/formula/functions";
export type { EvaluationEpoch } from "@openexcel/formula/functions";
export interface EngineOptions {
  readonly registry: FunctionRegistry;
  readonly limits: ResourceLimits;
  readonly history: HistoryOptions;
  readonly historyState?: HistoryState;
}
export interface Spill {
  readonly anchor: CellAddress;
  readonly range: RangeRef;
}
export interface CalculationDelta {
  readonly revision: number;
  readonly epoch: number;
  readonly values: readonly {
    readonly at: CellAddress; readonly value: Scalar;
  }[];
  readonly removed: readonly CellAddress[];
  readonly spills: readonly Spill[];
  readonly removedSpills: readonly CellAddress[];
  readonly filteredRows: Readonly<Record<string, readonly RowInterval[]>>;
  readonly diagnostics: readonly {
    readonly at: CellAddress; readonly error: ErrorValue;
  }[];
  readonly evaluatedCells: number;
  readonly visitedRangeCells: number;
  readonly elapsedMs: number;
}
export interface CalculationSnapshot {
  readonly revision: number;
  readonly epoch: number;
  readonly values: Readonly<Record<string, Readonly<Partial<Record<CellKey, Scalar>>>>>;
  readonly spills: readonly Spill[];
}
export interface RecalculateRequest {
  readonly mode: "dirty" | "full";
  readonly epoch: EvaluationEpoch;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: {
    readonly completed: number; readonly pending: number;
  }) => void;
}
export declare class Engine {
  private constructor();
  static create(workbook: Workbook, options: EngineOptions): Result<Engine>;
  evaluate(address: CellAddress, epoch: EvaluationEpoch): Scalar;
  evaluateFormula(source: string, origin: CellAddress, epoch: EvaluationEpoch): ComputedValue;
  set(edit: Edit): Result<Commit>;
  recalculate(request: RecalculateRequest): Promise<Result<CalculationDelta>>;
  undo(header: EditHeader): Result<Commit>;
  redo(header: EditHeader): Result<Commit>;
  fork(): Result<Engine>;
  snapshot(): Workbook;
  calculationSnapshot(): Result<CalculationSnapshot>;
  dispose(): void;
}
```

These are the only Engine construction/evaluation/mutation/recalculation signatures. `Engine.create` builds indexes without evaluating or mutating the input. `snapshot` is an immutable authored view with shared tiles, not a deep copy. `set` commits authored state and invalidates indexes/cache but does not calculate; it returns the exact canonical commit, including rewritten references. `undo`/`redo` use the same invalidation pipeline.

`fork` creates an independent Engine with the same authored snapshot, immutable registry and limits, empty history and dirty calculation caches. Mutating or disposing the fork cannot affect the original; a fork is never posted across a worker boundary. `EngineOptions.historyState`, when supplied on init/recovery, is restored before any edit is accepted.

`evaluate` synchronously computes the requested scalar and its dependency closure at the supplied epoch, including spill resolution; it is for worker/tests/server only. For an array anchor it returns the top-left scalar. `evaluateFormula` evaluates an ephemeral expression with the same reader and lexical environment without creating authored cells or publishing a spill; it returns the complete array. It serves validation, conditional formatting and what-if evaluation. Both use a scratch cache, do not clear dirty flags or publish a calculation snapshot, consume budgets and turn evaluation exhaustion into `#CALC!`; they cannot throw a raw recursion exception. Scratch spill placement considers all potentially overlapping candidate anchors in canonical order; a direct read must not choose a different winner from full recalculation.

`recalculate` asynchronously stages cache/spill changes for all dirty or all formula cells and publishes one coherent epoch only after completion. Cancellation/resource failure preserves authored state and the last published calculation snapshot, keeps affected cells dirty and returns an error. A completed delta is relative to the previous published snapshot; `removed` includes vanished spill cells/cached formulas so clients clear stale values. Raw literal cells are read from the workbook; calculated snapshot values include every formula anchor and spill child, not every blank cell.

`filteredRows` is a full replacement per listed sheet; include an empty array when a previously filtered sheet becomes fully visible. These intervals exclude manual/group hiding. A full recalc includes every sheet. UI must not independently recompute filters from a stale calculation cache.

Only one operation may evaluate/mutate an engine at a time. `set`/undo/redo return BUSY while recalculate is in flight; synchronous evaluate during that interval returns `#CALC!` with a busy diagnostic. The coordinator cancels and awaits the prior operation, rather than relying on this fallback. Epoch IDs strictly increase between published calculations; repeated synchronous reads within one epoch share volatile values. Reusing an epoch ID with different nowMs/seed is invalid. A changed epoch invalidates volatile closures even without edits. `calculationSnapshot` returns BUSY when the current authored revision has not finished calculating. `dispose` is idempotent and releases indexes; `snapshot` remains readable as the last immutable authored workbook. Other methods after disposal return INTERNAL (`evaluate`/`evaluateFormula` return `#CALC!`).

## 7. Formatting package

```typescript
// module: @openexcel/formatting
import type {
  CellAddress, CellStyle, ComputedValue, ErrorValue, RangeRef, Result,
  Scalar, Workbook
} from "@openexcel/model";
export interface FormatContext {
  readonly dateSystem: "1900" | "1904";
  readonly locale: "en-US";
}
export interface DisplayValue {
  readonly text: string;
  readonly color?: string;
  readonly alignment: "left" | "right" | "center";
}
export interface FormatReader {
  readonly revision: number;
  readonly epoch: number;
  value(at: CellAddress): Scalar;
  formula(source: string, origin: CellAddress): ComputedValue;
  values(range: RangeRef): Iterable<Scalar>;
}
export interface CellAppearance {
  readonly style: CellStyle;
  readonly display: DisplayValue;
  readonly dataBar?: { readonly fraction: number; readonly color: string };
  readonly icon?: string;
}
export declare function formatValue(value: Scalar, format: string, context: FormatContext): DisplayValue;
export declare function validateNumberFormat(format: string): Result<string>;
export declare function resolveAppearance(
  workbook: Workbook, at: CellAddress, reader: FormatReader
): CellAppearance;
export declare function excelSerialToParts(serial: number, dateSystem: "1900" | "1904"): {
  readonly year: number; readonly month: number; readonly day: number;
  readonly hour: number; readonly minute: number; readonly second: number;
} | ErrorValue;
```

Style cascade: default theme, column style, row style, cell style, conditional rules. `resolveAppearance` must not scan a large rule range for each visible cell; cache scale statistics by workbook identity/revision/epoch/rule ID and invalidate via source ranges. Reader callbacks are app/worker adapters, not formula imports. In the worker, formula-backed conditional rules use a frozen epoch. Web receives appearances for visible cells from the worker and never creates a second main-thread Engine.

Number-format grammar required in both TEXT and formatting: up to four semicolon sections; positive/negative/zero/text selection; `0`, `#`, `?`; decimal/group separators; percent scaling; scientific `E+00`; currency literals; accounting spacing `_` and fill `*`; quoted/escaped literals; `@`; date tokens `y m d h s`, AM/PM, elapsed `[h]`, `[m]`, `[s]`; standard named colors and one leading numeric condition per section. Month/minute token disambiguation depends on adjoining hour/second tokens. Locale/currency-ID brackets unsupported by the parser produce an explicit unsupported-format issue during import, and display falls back to General. Never silently call a custom format "fully Excel compatible."

## 8. Data operations and charts

```typescript
// module: @openexcel/data
import type {
  CellAddress, CellRect, ChartDefinition, ComputedValue, Edit, EditHeader,
  FilterSpec, ObjectId, RangeRef, Result, Scalar, SheetId, SortKey,
  Transaction, ValidationRule, Workbook
} from "@openexcel/model";
import type { Engine, EvaluationEpoch } from "@openexcel/formula";
export type DataOperation =
  | { readonly kind: "sort"; readonly range: RangeRef; readonly header: boolean;
      readonly keys: readonly SortKey[] }
  | { readonly kind: "filter"; readonly sheetId: SheetId;
      readonly tableId?: ObjectId; readonly filter: FilterSpec | null }
  | { readonly kind: "textToColumns"; readonly source: RangeRef;
      readonly delimiter: string; readonly destination: CellAddress }
  | { readonly kind: "removeDuplicates"; readonly range: RangeRef;
      readonly header: boolean; readonly columns: readonly number[] }
  | { readonly kind: "subtotals"; readonly range: RangeRef;
      readonly groupColumn: number; readonly valueColumns: readonly number[];
      readonly functionCode: number }
  | { readonly kind: "refreshPivot"; readonly sheetId: SheetId; readonly pivotId: ObjectId }
  | { readonly kind: "fill"; readonly source: RangeRef;
      readonly target: RangeRef; readonly mode: "copy" | "series" }
  | { readonly kind: "replace"; readonly query: FindQuery;
      readonly replacement: string; readonly mode: "first" | "all" };
export interface FindQuery {
  readonly ranges: readonly RangeRef[];
  readonly text: string;
  readonly lookIn: "values" | "formulas";
  readonly caseSensitive: boolean;
  readonly wholeCell: boolean;
  readonly maxResults: number;
}
export interface FindResult {
  readonly matches: readonly CellAddress[];
  readonly truncated: boolean;
}
export interface ClipboardPayload {
  readonly version: 1;
  readonly workbookId: Workbook["id"];
  readonly sourceRevision: number;
  readonly sourceSheetName: string;
  readonly sheets: readonly { readonly id: SheetId; readonly name: string }[];
  readonly source: RangeRef;
  readonly cells: readonly {
    readonly rowOffset: number; readonly colOffset: number;
    readonly cell: import("@openexcel/model").Cell;
  }[];
  readonly styles: Workbook["styles"];
  readonly cut: boolean;
}
export interface DataContext {
  readonly workbook: Workbook;
  readonly epoch: EvaluationEpoch;
  readonly header: EditHeader;
  readonly signal?: AbortSignal;
  value(at: CellAddress): Scalar;
  formula(source: string, origin: CellAddress): ComputedValue;
}
export interface DataPlan {
  readonly edit: Edit;
  readonly affected: readonly RangeRef[];
  readonly warnings: readonly string[];
}
export interface ValidationResult {
  readonly valid: boolean;
  readonly severity: "stop" | "warning";
  readonly message: string;
}
export interface GoalSeekRequest {
  readonly target: CellAddress;
  readonly changing: CellAddress;
  readonly goal: number;
  readonly lower: number;
  readonly upper: number;
  readonly tolerance: number;
  readonly maxIterations: number;
  readonly epoch: EvaluationEpoch;
  readonly signal?: AbortSignal;
}
export interface GoalSeekResult {
  readonly converged: boolean;
  readonly value: number;
  readonly residual: number;
  readonly iterations: number;
}
export interface ChartPoint {
  readonly label: string;
  readonly x: number | null;
  readonly y: number | null;
  readonly source?: CellAddress;
}
export interface ChartData {
  readonly chartId: ObjectId;
  readonly revision: number;
  readonly epoch: number;
  readonly series: readonly {
    readonly id: ObjectId; readonly name: string;
    readonly points: readonly ChartPoint[];
  }[];
  readonly warnings: readonly string[];
}
export declare function planDataOperation(operation: DataOperation, context: DataContext): Promise<Result<DataPlan>>;
export declare function filterRows(spec: FilterSpec, context: DataContext, sheetId: SheetId): readonly number[];
export declare function findDuplicates(range: RangeRef, columns: readonly number[], context: DataContext): readonly number[];
export declare function validateValue(rule: ValidationRule, at: CellAddress, context: DataContext): ValidationResult;
export declare function goalSeek(engine: Engine, request: GoalSeekRequest): Promise<Result<GoalSeekResult>>;
export declare function projectChart(chart: ChartDefinition, context: DataContext): Result<ChartData>;
export declare function findCells(query: FindQuery, context: DataContext): FindResult;
export declare function copyRange(range: RangeRef, context: DataContext, cut: boolean): ClipboardPayload;
export declare function parseClipboardPayload(input: unknown): Result<ClipboardPayload>;
export declare function planPaste(payload: ClipboardPayload, destination: CellAddress, context: DataContext): Result<DataPlan>;
```

Data planners never mutate the supplied workbook or engine. They create one Edit for the worker to apply, based on `header.baseRevision`; stale plans are rejected. `filterRows` returns hidden absolute row indexes; `findDuplicates` returns duplicate absolute row indexes, excluding the first occurrence and treating the supplied range as data-only. Removing duplicates compacts rows inside the selected range and clears its tail without deleting full worksheet rows. Sorting is stable, case-insensitive en-US, numbers before text before booleans before errors, blanks last in either direction. Reject partial merged/spilled ranges, incompatible tables and nonrectangular sorts. Formula cells move with copy-style reference adjustment.

Text-to-columns handles quoted delimiters, explicit destination and overwrite preflight. Fill infers arithmetic sequences from at least two numbers/dates, repeats text patterns and otherwise copies; relative formula references always adjust. Subtotals returns one batch Edit containing semantic splices and cell patches, committed atomically with no user-visible intermediate splice.

`validateValue` reads the proposed cell through the context's `value` adapter and translates custom formulas relative to the rule's top-left. The worker obtains a candidate with `planEdit` plus `applyTransaction`, creates a temporary engine from that candidate, calculates its affected values at the request epoch, and validates all affected validation ranges against it before calling Engine.set on the live engine. It disposes the candidate engine on every path. The candidate is never published or entered in live history. Stop failures always block the original edit; warning failures require `header.validation:"warningsConfirmed"` after explicit UI acknowledgment. DataPlan warning acknowledgment uses that same explicit flag, but cannot bypass stop failures. Validation is an app policy before Engine.set, not recursive validation while replaying undo. Undo/redo replays previously accepted authored states.

Find searches existing authored/cached spill cells in sheet-order then row/column order, compares literal text without regex, and reports truncation at maxResults. Replace targets authored input only, preserves formatting and fails if an all-match result is truncated. It re-parses the replaced source as CellInput and applies one undoable batch. Clipboard MIME is `application/x-openexcel-cells+json` plus TSV text; missing entries inside the source rectangle represent blank cells. The worker validates pasted JSON and remaps/deduplicates styles. Copy adjusts relative formulas; same-workbook cut uses semantic move. Cross-workbook cut pastes as copy and explicitly leaves the source intact. Discontiguous selection copies as ordered TSV blocks; rich paste requires one rectangular source/destination or returns INVALID_INPUT rather than guessing.

Clipboard copies retain the source revision and sheet ID/name map. Same-workbook cut requires that exact revision, otherwise returns CONFLICT and asks the user to cut again; it never clears a later replacement value. Cross-workbook paste binds unqualified references to the destination sheet and explicit source sheet names to same-named destination sheets (case insensitive); missing sheets become `#REF!`. Workbook names/table names bind only if present in the destination, otherwise remain source with `#NAME?` and a DataPlan warning; no hidden external-workbook link is created. Source coordinates determine relative offsets; copied styles are remapped by value. `parseClipboardPayload` applies model limits and checks offset bounds, duplicate positions and source metadata.

Goal Seek uses `engine.fork()`, fixes the epoch for all iterations and never changes the original. It requires a finite bracket, numeric literal changing cell and numeric target result; uses bounded bisection/secant steps, rejects cycles/errors, and returns `converged:false` rather than pretending success. It disposes the fork on every exit. The UI applies a successful value as one ordinary edit only on acceptance. What-if scenario comparison uses the same sandbox and reports before/after values without writing.

Chart ranges are one-dimensional and series/category lengths must agree; scatter requires numeric x-values. Errors/non-numbers become gaps with warnings, not coerced zero; blank policy is explicit. Histogram bins use `[left,right)` except the last inclusive edge, count/width from its configuration. Pie/donut reject negative values; combo requires a per-series kind; log axes reject nonpositive domains. Live data updates are keyed by revision and source-range intersection. Web owns hit testing, tooltips, range/series editors, drag/resize and SVG export; definitions persist in model.

### Compound structural plans

```typescript
// module: @openexcel/formula
import type { AtomicEdit, Transaction } from "@openexcel/model";
export interface PlannedEdit {
  readonly edit: Edit;
  readonly transaction: Transaction;
}
export declare function planEdit(workbook: Workbook, edit: Edit): Result<PlannedEdit>;
export declare function composeEdits(workbook: Workbook, edits: readonly AtomicEdit[], header: EditHeader): Result<PlannedEdit>;
```

`planEdit` is the same planner used by `Engine.set`; it performs semantic transformations and returns canonical patches without mutating. `composeEdits` plans sequentially against intermediate immutable snapshots, then combines/inverts them as one transaction at the original revision. Its returned `edit` is a batch, not an unchecked structural-patch escape hatch. Batch child revisions are the evolving planned revisions, child IDs remain unique, and publication normalizes to the outer ID/revision/timestamp/history. Nested batches are not allowed. `planDataOperation` handles every DataOperation, including subtotals, through this one DataPlan contract.

### Structural invariants shared by planners

Splice/cut transforms all reference-bearing objects, not just formula cells: defined names, conditional/validation formulas and ranges, table ranges, chart series/categories/x-values/name cells, pivot source/destination/output, merges, groups, sparse axis overrides and view selection/freeze positions. Formula-valued fields are parsed at their documented origin before transformation. Deleting the whole range of an optional object removes that object and emits an undoable patch; deleting a required series range removes that series, and a chart with no series is removed. A pivot losing its source is removed but its materialized cells remain ordinary cells. A cut cannot split a merge/table/pivot output; partial intersection is `INVALID_INPUT`. Moving cells does not move row heights/column widths.

Table creation validates unique nonblank headers. Cell edits to an existing header must be normalized to `tableColumnRename` with the corresponding header-cell patch in the same transaction. Table column IDs survive splices. `insertedTableColumnIds` maps each affected table ID to one preallocated ObjectId per inserted column in ordinal order; it is empty for row operations or no intersecting tables. Missing, extra or duplicate IDs fail preflight. Calculated-column formulas fill the data rows on creation/resize and adjust relative references per row; a deliberate individual formula override is retained until the user explicitly reapplies the column formula.

`Engine.set` calls `planEdit` once and owns final publication. For preflight validation the coordinator may call `planEdit`, but generated IDs must already be carried by the edit. DATA/coordinator allocates IDs with `createId` when constructing an edit, never inside `planEdit`. Planning the same edit twice therefore yields the same transaction. All subordinate IDs/timestamps are input-derived; there is no wall-clock or random read during planning. Empty or no-op plans return `INVALID_INPUT`, not a phantom revision.

Formula syntax/name errors are stored source plus calculated `#PARSE!`/`#NAME?`, not reasons to reject an otherwise valid cell edit. Reject malformed model input, invalid structural transforms, resource breaches and forbidden spill/merge edits before publication. This distinction also preserves unsupported imported formulas for later correction.

## 9. Interop package

```typescript
// module: @openexcel/model
export interface CompatibilityIssue {
  readonly code: "UNSUPPORTED_FEATURE" | "LOSSY_CONVERSION" | "FORMULA_DIALECT"
    | "FORMAT_FALLBACK" | "EXTERNAL_CONTENT_REMOVED" | "RESOURCE_LIMIT";
  readonly severity: "info" | "warning" | "error";
  readonly feature: string;
  readonly message: string;
  readonly sheetId?: SheetId;
  readonly range?: CellRect;
}
export interface FileOptions {
  readonly format: "xlsx" | "csv" | "tsv";
  readonly sheetId?: SheetId;
  readonly range?: CellRect;
  readonly csvEscapeFormulas: boolean;
  readonly delimiter?: "," | ";" | "\\t";
}
```

```typescript
// module: @openexcel/interop
import type {
  CellKey, ChartDefinition, CompatibilityIssue, FileOptions, PivotDefinition,
  ResourceLimits, Result, Scalar, SheetView, Workbook, WorkbookId, SheetId
} from "@openexcel/model";
export interface InteropLimits {
  readonly maxInputBytes: number;
  readonly maxExpandedBytes: number;
  readonly maxZipEntries: number;
  readonly maxExpansionRatio: number;
  readonly maxFieldBytes: number;
  readonly workbook: ResourceLimits;
}
export interface ImportOptions {
  readonly format: "xlsx" | "csv" | "tsv";
  readonly workbookId: WorkbookId;
  readonly firstSheetId: SheetId;
  readonly name: string;
  readonly timestamp: string;
  readonly delimiter?: "," | ";" | "\\t";
  readonly parseCsvFormulas: boolean;
  readonly limits: InteropLimits;
  readonly signal?: AbortSignal;
}
export interface ImportResult {
  readonly workbook: Workbook;
  readonly issues: readonly CompatibilityIssue[];
}
export interface OpenExcelExtension {
  readonly schemaVersion: 1;
  readonly sheets: readonly {
    readonly id: SheetId;
    readonly name: string;
    readonly charts: readonly ChartDefinition[];
    readonly pivots: readonly PivotDefinition[];
    readonly view: SheetView;
  }[];
}
export interface ExportCache {
  readonly revision: number;
  readonly values: Readonly<Record<string, Readonly<Partial<Record<CellKey, Scalar>>>>>;
}
export interface ExportOptions {
  readonly file: FileOptions;
  readonly cache: ExportCache;
  readonly limits: InteropLimits;
  readonly signal?: AbortSignal;
}
export interface ExportResult {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly filename: string;
  readonly issues: readonly CompatibilityIssue[];
}
export declare function importWorkbook(bytes: Uint8Array, options: ImportOptions): Promise<Result<ImportResult>>;
export declare function exportWorkbook(workbook: Workbook, options: ExportOptions): Promise<Result<ExportResult>>;
```

CSV formulas import as literal strings by default; explicit `parseCsvFormulas:true` opts into the custom safe engine later, never evaluation inside interop. TSV forces tab delimiter. All delimited text is UTF-8 with optional BOM; newline output is CRLF and quotes double embedded quotes. A string token `"\\t"` denotes tab in options, not a two-character separator in the file. CSV export requires sheet ID; a workbook containing several sheets is never silently flattened.

XLSX input is checked as a ZIP before library parsing; entry path traversal, duplicate ZIP names, encrypted entries, external relationships, DTD/entities and expansion-limit violations are rejected or removed with typed issues as specified in architecture. Use generated IDs for imported sheets/objects; additional IDs may be created by the adapter with `crypto.randomUUID`, never derived from unsafe names. Workbook import is all-or-nothing on structural corruption.

Export cache must match authored revision, include all formula anchors/spill children, and contain no closures. Interop does not import the formula package. The caller is responsible for full successful calculation; missing cache values for formula anchors are an INVALID_INPUT error. XLSX formula strings omit leading `=` only in the file representation. Formula-looking string values remain strings. Filename sanitization controls download headers only; filenames never select server paths.

## 10. API schema

```typescript
// module: @openexcel/model/api
import type {
  CompatibilityIssue, FileOptions, ResourceLimits, Result, Workbook, WorkbookId
} from "@openexcel/model";
export interface ApiError {
  readonly error: {
    readonly code: "INVALID_INPUT" | "NOT_FOUND" | "VERSION_CONFLICT"
      | "SAVE_ID_REUSED" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA"
      | "RESOURCE_LIMIT" | "IO_ERROR" | "ORIGIN_REJECTED" | "INTERNAL";
    readonly message: string;
    readonly requestId: string;
    readonly currentVersion?: number;
    readonly fields?: readonly { readonly path: string; readonly message: string }[];
  };
}
export interface WorkbookSummary {
  readonly id: WorkbookId; readonly name: string;
  readonly storageVersion: number; readonly revision: number;
  readonly createdAt: string; readonly updatedAt: string; readonly openedAt: string;
}
export interface WorkbookEnvelope {
  readonly workbook: Workbook;
  readonly storageVersion: number;
  readonly savedAt: string;
}
export type CreateWorkbookRequest =
  | { readonly kind: "blank"; readonly name: string }
  | { readonly kind: "snapshot"; readonly workbook: Workbook; readonly name: string };
export interface ListWorkbooksQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly order: "recent" | "updated";
}
export interface ListWorkbooksResponse {
  readonly items: readonly WorkbookSummary[];
  readonly nextCursor?: string;
}
export interface SaveWorkbookRequest {
  readonly saveId: string;
  readonly workbook: Workbook;
}
export interface SaveWorkbookResponse {
  readonly id: WorkbookId; readonly storageVersion: number;
  readonly savedRevision: number; readonly savedAt: string; readonly saveId: string;
}
export interface DuplicateWorkbookRequest {
  readonly name: string;
}
export interface ImportHttpOptions {
  readonly format: "xlsx" | "csv" | "tsv";
  readonly name: string;
  readonly delimiter?: "," | ";" | "\\t";
  readonly parseCsvFormulas: boolean;
}
export interface ImportHttpResponse {
  readonly workbook: Workbook;
  readonly issues: readonly CompatibilityIssue[];
}
export interface ExportRequest {
  readonly storageVersion: number;
  readonly file: FileOptions;
  readonly calculation: { readonly nowMs: number; readonly randomSeed: number };
}
export interface ExportResponse {
  readonly token: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly expiresAt: string;
  readonly issues: readonly CompatibilityIssue[];
}
export interface HealthResponse {
  readonly status: "ok";
  readonly apiVersion: 1;
  readonly workbookSchemaVersion: 1;
  readonly limits: ResourceLimits;
  readonly maxBodyBytes: number;
}
export declare function parseCreateWorkbookRequest(input: unknown): Result<CreateWorkbookRequest>;
export declare function parseSaveWorkbookRequest(input: unknown): Result<SaveWorkbookRequest>;
export declare function parseImportHttpOptions(input: unknown): Result<ImportHttpOptions>;
export declare function parseExportRequest(input: unknown): Result<ExportRequest>;
export declare function parseListWorkbooksQuery(input: unknown): Result<ListWorkbooksQuery>;
export declare function parseWorkbookEnvelope(input: unknown): Result<WorkbookEnvelope>;
export declare function parseApiError(input: unknown): Result<ApiError>;
export declare function parseDuplicateWorkbookRequest(input: unknown): Result<DuplicateWorkbookRequest>;
export declare function parseListWorkbooksResponse(input: unknown): Result<ListWorkbooksResponse>;
export declare function parseSaveWorkbookResponse(input: unknown): Result<SaveWorkbookResponse>;
export declare function parseImportHttpResponse(input: unknown): Result<ImportHttpResponse>;
export declare function parseExportResponse(input: unknown): Result<ExportResponse>;
export declare function parseHealthResponse(input: unknown): Result<HealthResponse>;
```

| Method and exact path | Request | Success | Failure/side effect |
| --- | --- | --- | --- |
| GET `/api/v1/health` | None | 200 `HealthResponse` | 503 if storage unavailable |
| GET `/api/v1/workbooks?order=recent&limit=50&cursor=...` | Query schema, limit 1-100 | 200 `ListWorkbooksResponse` | Invalid cursor 400; opaque base64url timestamp+ID keyset, no SQL text |
| POST `/api/v1/workbooks` | `CreateWorkbookRequest` | 201 `WorkbookEnvelope`, Location header | Server assigns new workbook UUID, revision 0, version 1; within-workbook sheet/object IDs remain unchanged |
| GET `/api/v1/workbooks/:id` | UUID | 200 `WorkbookEnvelope`, ETag `"vN"` | 404 missing; updates opened_at, not document/storage revision |
| PUT `/api/v1/workbooks/:id` | `SaveWorkbookRequest`, required `If-Match: "vN"` | 200 `SaveWorkbookResponse`, new ETag | 428 missing precondition, 412 stale version, 409 reused save ID; body workbook ID must equal path |
| DELETE `/api/v1/workbooks/:id` | required `If-Match` | 204 | 404 missing, 412 conflict, 428 missing precondition |
| POST `/api/v1/workbooks/:id/duplicate` | `DuplicateWorkbookRequest`, required `If-Match` | 201 `WorkbookEnvelope` | Atomic source-version read and new workbook creation; fresh workbook UUID/revision 0 |
| POST `/api/v1/imports` | multipart `file` and JSON `options: ImportHttpOptions` | 200 `ImportHttpResponse` | Parses but does not save; UI acknowledges issues then POST snapshot |
| POST `/api/v1/workbooks/:id/exports` | `ExportRequest` | 201 `ExportResponse` | 412 if version differs; computes saved snapshot in worker; no arbitrary uploaded cache trusted |
| GET `/api/v1/exports/:token` | Opaque random 256-bit token | 200 bytes with media type and attachment filename | 404 missing/expired; 10-minute expiry, download may be retried until expiry |

All errors use `ApiError`, including non-JSON upload failures. JSON bodies use `application/json`; downloads use XLSX MIME or UTF-8 CSV/TSV, `nosniff`, and safe Content-Disposition. 400 validation, 403 origin, 404 absent, 409 reuse, 412 conflict, 413 size, 415 media, 422 resource/content limits, 500 internal and 503 storage unavailable are fixed mappings. Error code INVALID_INPUT covers missing precondition at 428; VERSION_CONFLICT covers 412. Never return stack traces or local paths.

Create-from-snapshot and duplicate preserve within-workbook sheet/object IDs because their namespace is workbook ID; they reset revision and change workbook ID and server creation metadata. Imported temporary workbook IDs are replaced on persistence. `revision` remains client authored sequence after a load; server rejects a save whose document revision is lower than the persisted document revision unless it is an idempotent receipt retry.

Export always saves first in the UI and awaits that revision's storage version. Server captures that version's immutable snapshot, calculates it, writes the result in an owned temporary directory and returns issues/token. Content does not change if later edits save. Aborted requests terminate their workers and delete partial artifacts; complete tokens expire after ten minutes and shutdown removes all owned artifacts.

The UI supplies the frozen clock/seed of its last completed calculation in `ExportRequest.calculation`; server uses these inputs with its own epoch ID 1 and the same default registry. Both numbers are finite safe integers; randomSeed is an unsigned 32-bit integer and nowMs is a valid UTC ECMAScript timestamp. A server-generated export without a UI must explicitly choose and record them. Supplied time/seed are data, not trusted formula results. This makes volatile cached values reproducible without importing formula types into model/api.

List defaults are recent/50; cursor encodes `{order,timestamp,id}` as base64url JSON and is parsed with bounded length 512, matching query order and valid timestamp/UUID. Order is descending timestamp then ascending ID, with the exact lexicographic continuation predicate. `saveId` is a UUID; hash the canonical JSON of SaveWorkbookRequest (sorted object keys, array order preserved, UTF-8) rather than transport whitespace. Receipts are checked before version/revision rejection. Invalid older authored revision is 400 INVALID_INPUT, not an untyped repository exception. POST creation/import/duplicate are not automatically retried; the UI reconciles the workbook list after a lost create response before offering a manual retry.

## 11. Server interfaces

```typescript
// module: apps/server/src/contracts.ts
import type { Result, WorkbookId } from "@openexcel/model";
import type {
  CreateWorkbookRequest, ListWorkbooksQuery, ListWorkbooksResponse,
  SaveWorkbookRequest, SaveWorkbookResponse, WorkbookEnvelope
} from "@openexcel/model/api";
export interface RepositoryFailure {
  readonly code: "INVALID_INPUT" | "NOT_FOUND" | "VERSION_CONFLICT" | "SAVE_ID_REUSED" | "IO_ERROR";
  readonly message: string;
  readonly currentVersion?: number;
}
export interface WorkbookRepository {
  list(query: ListWorkbooksQuery): Promise<Result<ListWorkbooksResponse, RepositoryFailure>>;
  create(request: CreateWorkbookRequest): Promise<Result<WorkbookEnvelope, RepositoryFailure>>;
  get(id: WorkbookId): Promise<Result<WorkbookEnvelope, RepositoryFailure>>;
  save(id: WorkbookId, request: {
    readonly expectedVersion: number; readonly body: SaveWorkbookRequest;
  }): Promise<Result<SaveWorkbookResponse, RepositoryFailure>>;
  delete(id: WorkbookId, expectedVersion: number): Promise<Result<void, RepositoryFailure>>;
  duplicate(id: WorkbookId, request: {
    readonly expectedVersion: number; readonly name: string;
  }): Promise<Result<WorkbookEnvelope, RepositoryFailure>>;
  close(): Promise<void>;
}
export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly webRoot: string;
  readonly runRoot: string;
  readonly maxBodyBytes: number;
  readonly allowedOrigin: string;
}
export interface RunningServer {
  readonly origin: string;
  close(): Promise<void>;
}
export declare function openRepository(databasePath: string): Promise<WorkbookRepository>;
export declare function startServer(config: ServerConfig): Promise<RunningServer>;
```

Server uses Node `http` and `node:sqlite`; no HTTP framework or ORM is necessary for these routes. Parser/schema implementations are shared from model/api, while SQL/storage workers and route handlers remain server-private. `port:0` is required in tests. `close` awaits connections/workers and produces an owned-resource cleanup receipt. Migrations run before health becomes ready. Server imports no data/UI package.

## 12. Web worker protocol and UI service

```typescript
// module: apps/web/src/workers/protocol.ts
import type {
  CellAddress, Commit, ComputedValue, DomainError, Edit,
  EditHeader, HistoryState, ObjectId, RangeRef, ResourceLimits, Result, Workbook
} from "@openexcel/model";
import type {
  CalculationDelta, CalculationSnapshot, EvaluationEpoch
} from "@openexcel/formula";
import type {
  ChartData, ClipboardPayload, DataOperation, FindQuery, FindResult,
  GoalSeekRequest, GoalSeekResult
} from "@openexcel/data";
import type { CellAppearance } from "@openexcel/formatting";
export interface Envelope {
  readonly version: 1;
  readonly sessionId: string;
  readonly requestId: string;
}
export type WorkerRequest = Envelope & { readonly body:
  | { readonly type: "init"; readonly workbook: Workbook;
      readonly limits: ResourceLimits; readonly history?: HistoryState }
  | { readonly type: "edit"; readonly edit: Edit }
  | { readonly type: "undo" | "redo"; readonly header: EditHeader }
  | { readonly type: "recalculate"; readonly revision: number;
      readonly mode: "dirty" | "full"; readonly epoch: EvaluationEpoch }
  | { readonly type: "evaluate"; readonly revision: number;
      readonly source: string; readonly origin: CellAddress; readonly epoch: EvaluationEpoch }
  | { readonly type: "data"; readonly operation: DataOperation;
      readonly header: EditHeader; readonly epoch: EvaluationEpoch }
  | { readonly type: "copy"; readonly revision: number; readonly range: RangeRef;
      readonly cut: boolean; readonly epoch: EvaluationEpoch }
  | { readonly type: "paste"; readonly payload: ClipboardPayload;
      readonly destination: CellAddress; readonly header: EditHeader;
      readonly epoch: EvaluationEpoch; readonly confirmOverwrite: boolean }
  | { readonly type: "find"; readonly revision: number;
      readonly query: FindQuery; readonly epoch: EvaluationEpoch }
  | { readonly type: "duplicates"; readonly revision: number;
      readonly range: RangeRef; readonly columns: readonly number[];
      readonly epoch: EvaluationEpoch }
  | { readonly type: "goalSeek"; readonly revision: number;
      readonly request: Omit<GoalSeekRequest, "signal"> }
  | { readonly type: "chart"; readonly revision: number;
      readonly chartId: ObjectId; readonly epoch: EvaluationEpoch }
  | { readonly type: "appearance"; readonly revision: number;
      readonly cells: readonly CellAddress[]; readonly epoch: EvaluationEpoch }
  | { readonly type: "snapshot"; readonly revision: number }
  | { readonly type: "cancel"; readonly targetRequestId: string }
  | { readonly type: "dispose" }
};
export type WorkerReply = Envelope & { readonly body:
  | { readonly type: "ready"; readonly revision: number }
  | { readonly type: "commit"; readonly commit: Commit }
  | { readonly type: "calculated"; readonly delta: CalculationDelta }
  | { readonly type: "evaluated"; readonly revision: number;
      readonly epoch: number; readonly value: ComputedValue }
  | { readonly type: "copied"; readonly revision: number; readonly payload: ClipboardPayload }
  | { readonly type: "found"; readonly revision: number;
      readonly epoch: number; readonly result: FindResult }
  | { readonly type: "duplicates"; readonly revision: number;
      readonly epoch: number; readonly rows: readonly number[] }
  | { readonly type: "goalSeek"; readonly revision: number;
      readonly epoch: number; readonly result: GoalSeekResult }
  | { readonly type: "chart"; readonly data: ChartData }
  | { readonly type: "appearance"; readonly revision: number; readonly epoch: number;
      readonly cells: readonly { readonly at: CellAddress; readonly appearance: CellAppearance }[] }
  | { readonly type: "snapshot"; readonly workbook: Workbook;
      readonly calculation: CalculationSnapshot | null }
  | { readonly type: "progress"; readonly completed: number; readonly pending: number }
  | { readonly type: "cancelled"; readonly targetRequestId: string }
  | { readonly type: "disposed" }
  | { readonly type: "error"; readonly error: DomainError; readonly revision: number | null }
};
export declare function parseWorkerRequest(input: unknown): Result<WorkerRequest>;
export declare function parseWorkerReply(input: unknown): Result<WorkerReply>;
```

Worker loads `createDefaultRegistry` locally; a function registry/EngineOptions is never posted. Init uses effective limits fetched from health, default history budgets and a new session ID; it acknowledges ready without silently calculating. An edit/undo/data request has one terminal commit or error. Recalculation is a separate request; progress is nonterminal, calculated/error is terminal. The coordinator immediately queues dirty recalc after commit. Cancellation can bypass the serial queue to flip the current AbortController; cancelled confirms the cancellation request, and the targeted operation still emits exactly one terminal CANCELLED error. A completed target cannot be retroactively cancelled. Dispose rejects queued work, aborts active work and acknowledges only after cleanup.

`paste` follows the same plan/validation/commit path as data operations and returns commit/error. The other new request/reply pairs are copy/copied, find/found and duplicates/duplicates; none mutates state. Goal Seek and calculation-dependent reads first require a completed calculation for their revision/epoch or return BUSY; the coordinator schedules recalculate before retrying them. Warnings that require acknowledgment are returned as VALIDATION_FAILED with the first affected address/message, never applied implicitly; paste may overwrite existing authored destination values only with `confirmOverwrite:true`. Formula/spill/merge/validation violations cannot be bypassed by this flag. Copy/fill/paste TSV interpretation belongs to DATA/coordinator, not a second main-thread formula evaluator.

For `edit`, which carries no explicit epoch, preflight validation uses the worker's latest completed epoch. Before the first completed calculation it uses `{id:0,nowMs:Date.parse(workbook.properties.modifiedAt),randomSeed:0}`; timestamps must therefore be valid UTC ISO strings. Data/paste requests use their explicit epoch. Post-commit recalculation always receives a fresh epoch in its separate request. Copying only spill children materializes their calculated scalar values; copying an entire spill including its anchor retains the anchor formula and omits derived child inputs so the destination recalculates its own spill.

All calculated projections are ordered by `(sessionId, revision, epoch)`, not revision alone. Volatile recalc can change chart/appearance/find results at an unchanged authored revision. The coordinator records the current requested epoch and ignores projections from earlier epochs, while request promises still settle once. Cancel for a completed/unknown target returns NOT_FOUND, not a fabricated cancelled reply. Forced worker termination settles outstanding promises locally as CANCELLED, retires the session, then reinitializes from the acknowledged workbook and mirrored HistoryState. Late messages cannot acknowledge an edit in the new session.

Ignore a reply from a retired session. Reject out-of-order revisions, correlate by request ID and never resolve another request's promise. No data mutation request accepts stale header revisions. A snapshot request returns authored state at the requested revision plus a calculation snapshot only if current; autosave needs only the authored snapshot. Progress means actual visited work; unknown totals report `pending:-1`.

```typescript
// module: apps/web/src/services/workbook-service.ts
import type {
  CellAddress, CellRect, Commit, Edit, Result, Workbook, WorkbookId
} from "@openexcel/model";
import type { WorkbookEnvelope, SaveWorkbookResponse } from "@openexcel/model/api";
export interface Selection {
  readonly active: CellAddress;
  readonly anchor: CellAddress;
  readonly ranges: readonly CellRect[];
}
export interface WorkbookService {
  open(id: WorkbookId): Promise<Result<WorkbookEnvelope>>;
  edit(edit: Edit): Promise<Result<Commit>>;
  save(): Promise<Result<SaveWorkbookResponse>>;
  snapshot(): Workbook;
  subscribe(listener: () => void): () => void;
  close(): Promise<Result<void>>;
}
export declare function createWorkbookService(options: {
  readonly apiBase: string;
  readonly worker: Worker;
  readonly sessionId: string;
}): WorkbookService;
```

Web-private grid/controller components consume this service, not Engine directly. HTTP client uses a bounded timeout and explicit status parsing; no blind retry of POST/DELETE. PUT retries preserve save ID/body/version. Persisted view settings coalesce into ordinary revisioned patches at interaction boundaries; scrolling itself updates transient UI state without a transaction per frame.

One service instance manages one open workbook. `open` must complete successfully before `edit`, `save` or `snapshot`; opening a second workbook on that instance returns BUSY until `close` succeeds. UI mounts workbook consumers only after that success, so `snapshot` has no nullable loading state. `close` flushes the save queue and fails without disposing the active workbook if saving fails. A user-confirmed discard is a UI lifecycle action that terminates the service's worker and retains the recovery snapshot, not an implicit success from `close`.

## 13. Contract conformance gates

Before downstream implementation, MODEL compiles the model/API declarations and schema round trips; FORMULA compiles syntax/functions/Engine against them. Each consumer imports the exact paths above in a small compile-only public-API fixture. An automated import-boundary check rejects every unlisted workspace edge, including type-only imports. All modules use strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax and exhaustive discriminants.

The final integration owner must exercise: edit -> commit -> replica -> calculation delta -> chart -> save -> restart -> load -> XLSX export -> import. Error tests cover stale revisions, cancelled calculation, save conflict, worker restart, spill obstruction, malformed archives and undo of structural references. A type-level interface match alone is not behavioral evidence.


## 14. Rust Core & Dual-Target Contracts (Native Desktop & WASM)

### 14.1 `openexcel-core` Public Rust API
```rust
// crate: crates/openexcel-core
pub struct Engine<'a> {
    pub fn new(workbook: &'a Workbook) -> Self;
    pub fn update_cell(&mut self, sheet_id: &str, row: u32, col: u32, input: CellInput);
    pub fn recalculate(&mut self) -> Result<RecalcResult, ErrorCode>;
    pub fn value(&self, addr: &CellAddress) -> ComputedValue;
    pub fn evaluate_formula(&mut self, sheet_id: &str, row: u32, col: u32, formula: &str) -> Result<ComputedValue, ErrorCode>;
}

pub struct PrattParser<'a> {
    pub fn new(tokens: Vec<Token<'a>>) -> Self;
    pub fn parse_expression(&mut self, precedence: u8) -> Result<AstNode, ErrorCode>;
}

pub struct DependencyGraph {
    pub fn register_dependencies(&mut self, cell: CellAddress, ast: &AstNode);
    pub fn topological_order(&self, dirty: &[CellAddress]) -> Result<Vec<CellAddress>, ErrorCode>;
}
```

### 14.2 `openexcel-wasm` WebAssembly Bindings
```typescript
// package: packages/formula-wasm
export class WasmEngine {
  constructor();
  static fromJson(json_str: string): WasmEngine;
  updateWorkbook(json_str: string): void;
  recalculate(): { dirty_cells_recalculated: number; elapsed_micros: number };
  evaluateFormula(sheet_id: string, row: number, col: number, formula: string): string;
  getComputedValues(addresses_json: string): string;
  format_address(row: number, col: number): string;
}
export function init_panic_hook(): void;
export function openexcel_version(): string;
```

### 14.3 `openexcel-desktop` HTTP & Persistence API
- `POST /api/workbooks`: Creates new blank or snapshot workbook, returns `{ workbook, storageVersion }`.
- `GET /api/workbooks`: Lists recent workbooks with metadata.
- `GET /api/workbooks/:id`: Fetches workbook snapshot.
- `PUT /api/workbooks/:id`: Atomic update. Requires `If-Match: <storageVersion>` header. Returns HTTP 409 `VERSION_CONFLICT` on mismatch.
