# Data Tools & Algorithms Integration Investigation (Milestone 3)

## 1. Observation

### 1.1 Multi-Column Sort
- **Location**: `packages/data/src/index.ts:13-31`
- **Source Code**:
  ```ts
  13: function compare(a: Scalar,b: Scalar): number {
  14:   if(a===b)return 0; if(a===null)return 1;if(b===null)return -1;
  15:   if(typeof a==='number'&&typeof b==='number')return a-b;
  16:   return String(a).localeCompare(String(b), 'en', {numeric:true,sensitivity:'base'});
  17: }
  18: /** Sorting moves whole authored cells including formatting; calculated values are comparison keys. */
  19: export function sortRange(workbook: Workbook, range: RangeRef, keys: readonly SortKey[], reader: ValueReader): Patch[] {
  20:   checkRange(range);
  21:   const rows = Array.from({length:range.bottom-range.top+1},(_,i)=>range.top+i);
  22:   rows.sort((a,b)=>{
  23:     for(const key of keys){
  24:       const c=compare(reader.value({sheetId:range.sheetId,row:a,col:range.left+key.offset}),reader.value({sheetId:range.sheetId,row:b,col:range.left+key.offset}));
  25:       if(c)return key.direction==='asc'?c:-c;
  26:     }return a-b;
  27:   });
  28:   const patches:Patch[]=[];
  29:   rows.forEach((source,i)=>{for(let col=range.left;col<=range.right;col++) patches.push({kind:'cell',at:{sheetId:range.sheetId,row:range.top+i,col},cell:getCell(workbook,{sheetId:range.sheetId,row:source,col})??null});});
  30:   return patches;
  31: }
  ```
- **Observed Behavior**:
  1. **Multi-key Sorting**: The algorithm iterates sequentially over `keys: readonly SortKey[]` where `SortKey = { offset: number; direction: "asc" | "desc" }`. It evaluates the first non-zero comparison `c` and flips sign for `'desc'`.
  2. **Stability**: Line 26 has `return a - b;` as the tiebreaker when all sort keys compare equal, guaranteeing stable sorting.
  3. **Header Rows**: `sortRange` has no `hasHeader` parameter or header row exclusion logic. It sorts all rows in `[range.top, range.bottom]`. The caller must explicitly increment `range.top` to preserve headers.
  4. **Comparison Type Handling**: In `compare` (lines 14-16), if both values are numbers, it does `a - b`. Otherwise, it falls back to `String(a).localeCompare(String(b), ...)`. A number and a string (e.g. `10` vs `"apple"`) are compared by stringifying `10` to `"10"`. An error object `{ kind: "error", code: "#VALUE!" }` stringifies to `"[object Object]"`. In contrast, `packages/model/src/filters.ts:3-13` implements an explicit rank hierarchy (`number < string < boolean < error < null`).
- **UI Invocation** (`apps/web/src/App.tsx:91`):
  ```ts
  const sort=(direction:'asc'|'desc')=>change(sortRange(workbook,{...selection,sheetId},[{offset:0,direction}],reader()),'Sort');
  ```
  The UI only passes `[{offset: 0, direction}]`, which limits sorting to the first column only. If a user selects a range including a header row, the header row is sorted as data.

---

### 1.2 AutoFilter & Hidden Rows
- **Location**: `packages/model/src/filters.ts:1-75`
- **Source Code**:
  ```ts
  14: export function matchesFilter(value: Scalar, predicate: FilterPredicate): boolean {
  15:   switch (predicate.kind) {
  16:     case "values": return predicate.values.some(v => compare(value, v) === 0);
  17:     case "blank": return (value === null) === predicate.blank;
  18:     case "text": {
  19:       if (typeof value !== "string") return false;
  20:       const actual = value.toLocaleLowerCase("en-US"), expected = predicate.value.toLocaleLowerCase("en-US");
  21:       const op = predicate.op;
  22:       switch (op) {
  23:         case "contains": return actual.includes(expected);
  24:         case "startsWith": return actual.startsWith(expected);
  25:         case "endsWith": return actual.endsWith(expected);
  26:         default: { const exhaustive: never = op; return exhaustive; }
  27:       }
  28:     }
  29:     case "compare": {
  30:       const result = compare(value, predicate.value);
  31:       const op = predicate.op;
  32:       switch (op) {
  33:         case "=": return result === 0;
  34:         case "<>": return result !== 0;
  35:         case "<": return result < 0;
  36:         case "<=": return result <= 0;
  37:         case ">": return result > 0;
  38:         case ">=": return result >= 0;
  39:         default: { const exhaustive: never = op; return exhaustive; }
  40:       }
  41:     }
  42:     default: { const exhaustive: never = predicate; return exhaustive; }
  43:   }
  44: }
  ```
- **Hidden Row Calculation** (`packages/model/src/filters.ts:45-74`):
  ```ts
  45: export function hiddenRows(sheet: Sheet, reader: ValueReader): readonly RowInterval[] {
  46:   const hidden = new Set<number>();
  47:   const test = (filter: FilterSpec, row: number): boolean => filter.columns.every(column => {
  48:     const value = reader.value({ sheetId: sheet.id, row, col: filter.range.left + column.offset });
  49:     return column.combine === "and" ? column.predicates.every(p => matchesFilter(value, p))
  50:       : column.predicates.some(p => matchesFilter(value, p));
  51:   });
  52:   const filter = sheet.properties.filter;
  53:   if (filter) for (let row = filter.range.top + Number(filter.header); row <= filter.range.bottom; row++) {
  54:     if (sheet.properties.tables.some(t => t.filter && row >= t.range.top && row <= t.range.bottom)) continue;
  55:     if (!test(filter, row)) hidden.add(row);
  56:   }
  57:   for (const table of sheet.properties.tables) if (table.filter) {
  58:     for (let row = table.range.top + 1; row <= table.range.bottom - Number(table.totalsRow); row++)
  59:       if (row >= table.filter.range.top && row <= table.filter.range.bottom && !test(table.filter, row)) hidden.add(row);
  60:   }
  61:   for (const table of sheet.properties.tables) {
  62:     hidden.delete(table.range.top);
  63:     if (table.totalsRow) hidden.delete(table.range.bottom);
  64:   }
  65:   const intervals: { start: number; end: number }[] = [];
  66:   for (const row of [...hidden].sort((a, b) => a - b)) {
  67:     const last = intervals.at(-1);
  68:     if (last && row === last.end + 1) last.end = row;
  69:     else intervals.push({ start: row, end: row });
  70:   }
  71:   return intervals;
  72: }
  ```
- **Grid Application** (`apps/web/src/App.tsx:33-37`):
  ```ts
  33:   if(!sheet.properties.filter&&!sheet.properties.groups.some(g=>g.axis==='row'&&g.collapsed))return base;
  34:   const result:Record<string,AxisItem>={...base};
  35:   if(sheet.properties.filter){const engine=createEngine(workbook);for(const interval of hiddenRows(sheet,{value:at=>{const v=engine.value(at);return typeof v==='object'&&v?.kind==='array'?v.values[0]??null:v;}}))for(let row=interval.start;row<=interval.end;row++)result[row]={...result[row],hidden:true};}
  36:   for(const group of sheet.properties.groups)if(group.axis==='row'&&group.collapsed)for(let row=group.start;row<=group.end;row++)result[row]={...result[row],hidden:true};
  37:   return result;
  ```
- **Observed Behavior & Discrepancies**:
  1. AutoFilter criteria allow combinations of `and` / `or` predicates across multiple columns.
  2. Header protection is respected in `hiddenRows` (`filter.range.top + Number(filter.header)`).
  3. Table filter protection ensures table headers (`table.range.top`) and totals rows (`table.range.bottom`) are deleted from `hidden`.
  4. **Bug in `App.tsx:33-35`**: `if (!sheet.properties.filter && !sheet.properties.groups.some(...)) return base;`. If a sheet has tables with filters (`table.filter`) but NO `sheet.properties.filter`, line 33 returns early and line 35 does not execute `hiddenRows()`. Table filter hidden rows are thus completely ignored by the web viewport.

---

### 1.3 Data Validation
- **Model Schema** (`packages/model/src/schemas.ts:76-84` and `types.ts:136-147`):
  ```ts
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
  ```
- **Evaluation on Cell Edit** (`apps/web/src/operations.ts:9-17`):
  ```ts
  9: export function inputPatch(w:Workbook,at:CellAddress,text:string):Patch {
  10:  const rule=w.sheets[at.sheetId]?.properties.validations.find(r=>contains(r.range,at.row,at.col));
  11:  const input=parseCellInput(text,w.properties.dateSystem);
  12:  if(rule && !(text===''&&rule.allowBlank)){
  13:   if(rule.kind==='list'&&rule.source.kind==='values'&&!rule.source.values.includes(text))throw new Error(rule.message);
  14:   if(rule.kind==='number'&&(input.kind!=='value'||typeof input.value!=='number'||(rule.integer&&!Number.isInteger(input.value))||(rule.min!==undefined&&input.value<rule.min)||(rule.max!==undefined&&input.value>rule.max)))throw new Error(rule.message);
  15:  }
  16:  const old=getCell(w,at);return {kind:'cell',at,cell:{...old,input}};
  17: }
  ```
- **Observed Behavior & Discrepancies**:
  1. Validations ARE evaluated during interactive cell entry via `inputPatch`.
  2. `rule.kind === 'number'` correctly supports whole numbers (`integer: true`) and decimals (`integer: false`) with optional `min` and `max`.
  3. `rule.kind === 'list'` with `source.kind === 'values'` is enforced.
  4. **Gaps in Evaluation**:
     - `rule.kind === 'list'` with `source.kind === 'range'` is NOT evaluated in `inputPatch` (it does not check `range` cell values).
     - `rule.kind === 'custom'` is NOT evaluated in `inputPatch` (it does not evaluate `rule.formula`).
     - Distinct `date` and `text length` validation kinds do not exist in `ValidationRule` schema (dates and text lengths must be expressed via `number` serials or `custom` formulas).
     - `severity: "warning"` is not distinguishable from `"stop"` — `inputPatch` always throws an unbypassable `Error(rule.message)`.
     - In-grid cell rendering does not render dropdown chevron icons or option pickers for `list` rules.

---

### 1.4 Tables & Structured References
- **Model Definition** (`packages/model/src/types.ts:174-185`):
  ```ts
  export interface TableDefinition {
    readonly id: ObjectId; readonly name: string; readonly range: CellRect;
    readonly columns: readonly { readonly id: ObjectId; readonly name: string; readonly calculatedFormula?: string; readonly totalsFormula?: string; }[];
    readonly totalsRow: boolean; readonly styleId?: StyleId; readonly filter?: FilterSpec;
  }
  ```
- **Formula Engine Structured References** (`packages/formula/src/index.ts:133-172`):
  ```ts
  133:   const structuredRange = (ast: Extract<Ast, {kind: "structured"}>, address: CellAddress): RangeRef | undefined => {
  134:     const candidates = Object.values(workbook.sheets).flatMap(sheet => sheet.properties.tables.map(table => ({table, sheetId: sheet.id})));
  135:     const found = candidates.find(({table, sheetId}) => ast.table
  136:       ? table.name.toLowerCase() === ast.table.toLowerCase()
  137:       : sheetId === address.sheetId && address.row >= table.range.top && address.row <= table.range.bottom && address.col >= table.range.left && address.col <= table.range.right);
  138:     if (!found) return undefined;
  139:     const {table, sheetId} = found;
  140:     const parts = ast.spec.replace(/^\[|\]$/g, "").replace(/\[|\]/g, "").split(",").map(part => part.trim());
  141:     let top = table.range.top + 1, bottom = table.range.bottom - Number(table.totalsRow);
  142:     let left = table.range.left, right = table.range.right;
  143:     for (const part of parts) {
  144:       const selector = part.toLowerCase();
  145:       if (selector === "#all") { top = table.range.top; bottom = table.range.bottom; }
  146:       else if (selector === "#data") { top = table.range.top + 1; bottom = table.range.bottom - Number(table.totalsRow); }
  147:       else if (selector === "#headers") top = bottom = table.range.top;
  148:       else if (selector === "#totals") { if (!table.totalsRow) return undefined; top = bottom = table.range.bottom; }
  149:       else {
  150:         if (part.startsWith("@") || selector === "#this row") {
  151:           if (address.sheetId !== sheetId || address.row <= table.range.top || address.row > table.range.bottom - Number(table.totalsRow)) return undefined;
  152:           top = bottom = address.row;
  153:         }
  154:         const column = part.startsWith("@") ? part.slice(1) : selector === "#this row" ? "" : part;
  155:         if (column) {
  156:           const index = table.columns.findIndex(item => item.name.toLowerCase() === column.toLowerCase());
  157:           if (index < 0) return undefined;
  158:           left = right = table.range.left + index;
  159:         }
  160:       }
  161:     }
  162:     return bottom < top ? undefined : {sheetId, top, bottom, left, right};
  163:   };
  ```
- **Observed Behavior & Discrepancies**:
  1. The formula engine has a complete implementation of structured references supporting `Table[Col]`, `Table[[#Headers],[Col]]`, `Table[[#Totals],[Col]]`, `Table[[#Data],[Col]]`, `Table[[#All],[Col]]`, `[@Col]`, and `[#This Row]`.
  2. **Missing UI in `apps/web/`**: `PROJECT.md` line 49 explicitly specifies: *"verify formatting, data tools, charts, table insert UI"*. However, in `apps/web/src/App.tsx`, the `Insert` ribbon tab (`tab === 'Insert'`, line 115) contains "New sheet", "Duplicate sheet", "Delete sheet", "Insert chart", "Merge cells", and "Unmerge", but **NO "Insert Table" button**.
  3. **Zero Test Coverage**: Searching for `structured` or `table` references in `tests/compatibility/`, `tests/integration/pipeline.test.ts`, and `packages/formula/test/` revealed **zero** tests exercising structured references.

---

### 1.5 Pivot Tables
- **Model Definition** (`packages/model/src/types.ts:186-204`):
  `Aggregate = "sum" | "count" | "countNumbers" | "average" | "min" | "max"`. Supports multi-dimension `rows: number[]`, `columns: number[]`, `values: { offset, aggregate, label }[]`, `filters`, `rowTotals`, `columnTotals`.
- **Implementation** (`packages/data/src/index.ts:57-78, 104-147`):
  - `aggregate()` handles SUM (ignores non-numbers), COUNT (counts non-null, non-empty), COUNTNUMBERS (counts numbers), AVERAGE (sums / count; returns `#DIV/0!` if 0 numbers), MIN, MAX.
  - `pivotRows()` partitions by `JSON.stringify(r)` and `JSON.stringify(c)` and aggregates value buckets.
  - `refreshPivot()` rejects overlaps with source range, merged cells, other pivots, or authored destination cells. Updates `sheet.properties.pivots` with materialized `output` range.
- **UI Invocation** (`apps/web/src/App.tsx:92-104`):
  Exposes "Pivot sum" (generates new sheet with pivot table) and "Refresh pivot" (updates existing pivots via `refreshPivot`).
- **Integration Test** (`tests/integration/pipeline.test.ts:627-732`):
  Exercises single row group, SUM aggregation, Grand Total column, and overlap error rejection.
- **Coverage Gap**: Column fields (`columns: [offset]`) and combined row + column matrix pivots with `columnTotals` are not exercised in `tests/integration/pipeline.test.ts`.

---

### 1.6 Goal Seek
- **Algorithm** (`packages/data/src/index.ts:79-91`):
  ```ts
  export interface GoalSeekResult { converged:boolean; value:number; result:number; iterations:number }
  /** Secant iteration with finite checks and bounded steps; callers choose a pure scenario evaluator. */
  export function goalSeek(fn:(input:number)=>number,target:number,initial=0,tolerance=1e-7,maxIterations=100):GoalSeekResult {
    let x0=initial,x1=initial+Math.max(1,Math.abs(initial)*0.01);let y0=fn(x0)-target;
    for(let i=0;i<maxIterations;i++){
      const y1=fn(x1)-target;
      if(!Number.isFinite(y1))return {converged:false,value:x1,result:y1+target,iterations:i+1};
      if(Math.abs(y1)<=tolerance)return {converged:true,value:x1,result:y1+target,iterations:i+1};
      if(y1===y0)return {converged:false,value:x1,result:y1+target,iterations:i+1};
      const next=x1-y1*(x1-x0)/(y1-y0);x0=x1;y0=y1;x1=next;
    }
    return {converged:false,value:x1,result:fn(x1),iterations:maxIterations};
  }
  ```
- **UI Wiring** (`apps/web/src/App.tsx:105`):
  Prompts user for changing cell address and target value. For each secant iteration, applies candidate patch to workbook and evaluates active formula cell with `createEngine(applied.value.workbook).value(...)`.
- **Observed Behavior & Test Gaps**:
  1. Root-finding algorithm uses the Secant method with safeguards against infinite/NaN steps and zero slope (`y1 === y0`).
  2. `tolerance` defaults to `1e-7` with max 100 iterations.
  3. In both `packages/data/test/data.test.ts:11` and `tests/integration/pipeline.test.ts:1277-1288`, `goalSeek` is tested **only** with standalone JavaScript closures (e.g. `x => x * x`), never end-to-end with the `@openexcel/formula` engine and realistic financial formulas (such as `=PMT(...)` or `=A1*A2`).

---

## 2. Logic Chain

1. **Premise**: Milestone 3 requires complete data tools integration, covering multi-column sort, AutoFilter, data validation, tables, pivot tables, Goal Seek, and integration tests (`PROJECT.md` line 49).
2. **Analysis of Sorting**:
   - `packages/data/src/index.ts:19-27` implements a stable multi-column sort algorithm.
   - However, `compare()` in `packages/data/src/index.ts:13-17` sorts heterogeneous types by string coercion (`localeCompare`), meaning error objects become `"[object Object]"` and numbers are compared alphabetically against strings.
   - In `apps/web/src/App.tsx:91`, the UI only supports sorting by column offset 0 of the selection without header row exclusion.
3. **Analysis of AutoFilter**:
   - `packages/model/src/filters.ts:45-74` properly handles `FilterSpec` and computes hidden row intervals while protecting headers and totals rows.
   - However, `apps/web/src/App.tsx:33-35` guards hidden row calculation behind `if (sheet.properties.filter)`. When a table on the sheet has `table.filter`, but the sheet itself does not have a global `sheet.properties.filter`, the table filter is completely ignored.
4. **Analysis of Data Validation**:
   - `apps/web/src/operations.ts:10-15` enforces `list` (literal values) and `number` (whole/decimal) rules upon cell input.
   - However, range-based lists (`source: { kind: 'range' }`) and custom formulas (`kind: 'custom'`) are bypassed without evaluation.
5. **Analysis of Tables & Structured References**:
   - `packages/formula/src/index.ts:133-172` already contains full parsing and evaluation for structured references (`Table1[Col]`, `[@Col]`, `#Totals`, `#Headers`, etc.).
   - However, `apps/web/` lacks the "table insert UI" explicitly listed in `PROJECT.md` M3 scope, and the test suite has zero integration tests exercising structured references.
6. **Analysis of Goal Seek**:
   - `goalSeek()` in `packages/data/src/index.ts:81-91` correctly implements the Secant method with finite and flat-slope guards.
   - However, no test in the test suite verifies that `goalSeek` interacts correctly with `createEngine` or workbook transactions.
7. **Deduction**: While the core mathematical algorithms in `packages/data/` are functional, there are integration bugs in `App.tsx` (AutoFilter table skipping, missing table insert UI), comparison inconsistencies in `packages/data`, validation omissions in `operations.ts`, and major test gaps in `pipeline.test.ts`.

---

## 3. Caveats

1. **UI Dialog Constraints**: In `apps/web/src/App.tsx`, user inputs for data operations (AutoFilter text, Goal Seek parameters, Pivot dimensions, Validation lists) rely on browser `prompt()` dialogs. In automated Playwright testing, these must be intercepted via `page.on('dialog')` handlers.
2. **Formula Range List Validation**: Validating range-based lists (`source.kind === 'range'`) during cell input requires reading cells across the workbook. In `inputPatch(w, at, text)`, the workbook `w` is available, making range value lookups feasible.
3. **Custom Formula Validation Evaluation**: Evaluating `kind: 'custom'` validations requires evaluating the formula in the context of the proposed edit, which requires a formula engine instance.

---

## 4. Conclusion

The data algorithms in `@openexcel/data` and `@openexcel/formula` provide strong foundational support for Excel-compatible data operations. However, to complete Milestone 3, the following remediation and enhancements must be implemented:

1. **Table Insert UI**: Add an "Insert Table" button to `apps/web/src/App.tsx` (Insert tab) that creates a `TableDefinition` over the current selection, auto-populates column names, and attaches it to `sheet.properties.tables`.
2. **AutoFilter Fix in `App.tsx`**: Update lines 33-35 in `apps/web/src/App.tsx` so that `hiddenRows` is invoked if `sheet.properties.filter` OR `sheet.properties.tables.some(t => t.filter)` is present.
3. **Data Validation Completeness**:
   - In `apps/web/src/operations.ts:inputPatch`, add support for range-based list validation (`source.kind === 'range'`) by reading cells within the referenced range.
   - Add custom formula validation (`kind: 'custom'`) evaluation.
4. **Compare Hierarchy Unification**: Align `compare()` in `packages/data/src/index.ts` with `packages/model/src/filters.ts` so numeric, string, boolean, error, and blank values are sorted in accordance with standard Excel rank ordering.
5. **Comprehensive Integration Test Expansion**: Add tests in `tests/integration/pipeline.test.ts` for:
   - Structured table references (`=SUM(Table1[Column1])`, `Table1[[#Totals],[Column1]]`, and `[@Column1]`).
   - Goal Seek driving formula recalculation with `createEngine` (e.g. loan payment `=PMT(...)` or target revenue formula).
   - Multi-column sort with primary and secondary sort keys.
   - AutoFilter on tables hiding rows in conjunction with grid axis calculations.

---

## 5. Verification Method

### 5.1 Automated Test Execution Commands
Run the existing unit and integration test suites:
```bash
# Verify packages/data unit tests pass
pnpm test packages/data/test/data.test.ts

# Verify formula engine parser & compatibility tests pass
pnpm test packages/formula/test/parser.test.ts
pnpm test tests/compatibility/functions.test.ts

# Verify full integration pipeline test passes
pnpm test tests/integration/pipeline.test.ts

# Verify entire test suite passes
pnpm test
```

### 5.2 Verification Targets for New Worker Implementation
1. **Structured References Integration Test**:
   - Create a workbook with `sheet.properties.tables` containing a table named `SalesTable`.
   - Populate columns `Quarter` (col 0) and `Amount` (col 1).
   - Enter a formula `=SUM(SalesTable[Amount])` in an external cell.
   - Enter a formula `=[@Amount]*1.1` in a row inside `SalesTable`.
   - Assert `createEngine(workbook).value(...)` returns the expected computed values.
2. **Goal Seek Integration Test**:
   - Create a cell `A1` with value `100`, cell `A2` with formula `=A1*1.2`.
   - Run `goalSeek(val => { ...update A1, recompute A2... }, 240, 100)`.
   - Assert `result.converged === true` and `result.value` is close to `200`.
3. **Table AutoFilter Test**:
   - Define a table with `table.filter` where column 0 must equal `'Software'`.
   - Assert `hiddenRows(sheet, reader)` returns intervals hiding non-Software rows even when `sheet.properties.filter` is undefined.
4. **Invalidation Conditions**:
   - If `pnpm test` fails with type errors or broken assertions.
   - If `pipeline.test.ts` fails to round-trip tables or filters through SQLite WAL or XLSX manifests.
