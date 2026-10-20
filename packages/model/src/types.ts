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

