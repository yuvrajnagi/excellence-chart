# Formula Calculation Engine Survey Report

- **Subagent**: `explorer_survey_2` (`teamwork_preview_explorer`)
- **Working Directory**: `/workspaces/excellence-chart/.agents/teamwork/teamwork_preview_explorer_survey_2`
- **Focus Area**: Requirement R2 & Formula Engine Acceptance Criteria
- **Date**: 2026-10-23

---

## 1. Observation

### 1.1 Architecture & Source Files
The formula calculation engine is located primarily in `packages/formula/` and tested in `packages/formula/test/` and `tests/compatibility/`.

Key source files:
1. `packages/formula/src/index.ts` (528 lines, 30,890 bytes):
   - Implements `createEngine(initial: Workbook, options?: { nowMs?: number; random?: () => number }): FormulaEngine` (lines 18–511).
   - Implements legacy `Engine.create(workbook: Workbook, options?: unknown): { ok: true; value: Engine }` facade (lines 513–522).
   - Re-exports core modules: `parseFormula`, `tokenize`, `adjustFormulaReferences` from `./syntax.js`; `*` from `./functions.js`; `*` from `./ast.js`; `*` from `./parser.js`.
2. `packages/formula/src/syntax.ts` (38 lines, 5,067 bytes):
   - High-performance recursive-descent Pratt parser with precedence climbing (`expr(min)`, lines 30–31).
   - Defines AST type `Ast` supporting `'structured'`, `'apply'`, `'literal'`, `'ref'`, `'name'`, `'range'`, `'binary'`, `'unary'`, `'call'`, and `'array'` (line 2).
   - Implements `tokenize(source: string): Token[]` (lines 4–12).
   - Implements `parseFormula(source: string): Ast` with limits: source length ≤ 32,768, nesting depth ≤ 256 (lines 13–32).
   - Implements `adjustFormulaReferences(source: string, rowDelta: number, colDelta: number): string` for cell copy/paste/fill operations, with 0..1,048,575 row and 0..16,383 column boundary checks returning `#REF!` when out of bounds (lines 35–37).
3. `packages/formula/src/lexer.ts` (321 lines, 8,740 bytes):
   - Tokenizer generating rich tokens with `kind`, `value`, `start`, and `end` offsets (lines 1–6).
   - Token kinds: `NUMBER`, `STRING`, `BOOLEAN`, `ERROR`, `IDENT`, `SHEET_PREFIX`, `PLUS`, `MINUS`, `STAR`, `SLASH`, `CARET`, `AMPERSAND`, `PERCENT`, `EQ`, `NEQ`, `LT`, `LTE`, `GT`, `GTE`, `LPAREN`, `RPAREN`, `LBRACE`, `RBRACE`, `COMMA`, `SEMICOLON`, `COLON`, `EXCL`, `EOF` (lines 8–15).
   - Error literal regex recognizes all 11 Excel error codes: `#NULL!`, `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`, `#N/A`, `#SPILL!`, `#CALC!`, `#CIRC!`, `#PARSE!` (line 17).
   - Handles quoted sheet prefixes `'Sheet Name'!A1` and escaped single quotes `''` (lines 57–98).
   - Handles unquoted sheet prefixes `Sheet1!A1`, `Data_2024!B2` (lines 175–190).
   - Handles double-quoted strings with escaped double quotes `""` (lines 101–129).
4. `packages/formula/src/ast.ts` (97 lines, 2,096 bytes):
   - Strongly-typed `AstNode` union with node kinds: `number`, `string`, `boolean`, `error`, `empty`, `cell`, `range`, `unary`, `binary`, `function`, `array`, `name`, `paren` (lines 83–96).
5. `packages/formula/src/parser.ts` (666 lines, 17,626 bytes):
   - Object-oriented recursive descent parser with explicit operator precedence levels 1 through 8 (lines 142–272).
   - Level 1: Comparisons (`=`, `<>`, `<`, `<=`, `>`, `>=`) — left-associative
   - Level 2: Concatenation (`&`) — left-associative
   - Level 3: Addition & Subtraction (`+`, `-`) — left-associative
   - Level 4: Multiplication & Division (`*`, `/`) — left-associative
   - Level 5: Exponentiation (`^`) — right-associative
   - Level 6: Unary prefix (`+`, `-`)
   - Level 7: Postfix percentage (`%`)
   - Level 8: Atoms (literals, parens, arrays, sheet-qualified refs, cell/range refs, names, function calls)
   - Coordinate helpers: `colToLetters(col: number): string` and `lettersToCol(letters: string): number` supporting column indices 0 (`A`) through 16,383 (`XFD`) (lines 25–52).
   - Round-trip AST pretty-printer: `printFormula(node: AstNode): string` (lines 592–665).
6. `packages/formula/src/functions.ts` (101 lines, 16,678 bytes):
   - Exports `FUNCTION_NAMES` containing all 88 mandatory functions (line 13).
   - Exports `createDefaultRegistry()` with declared min/max arities (lines 14–27).
   - Exports core dispatch `invoke(name: string, a: ComputedValue[], nowMs: number, random: () => number): ComputedValue` (lines 28–100).
   - Implements evaluation logic for mathematical, statistical, text, lookup, dynamic array, financial, and date/time functions.

---

### 1.2 References Implementation
- **Relative, Absolute, Mixed References**:
  - Parsed by regex `/^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/` in `syntax.ts:26` and `parser.ts:20,62`.
  - Stored as `row: number, col: number, absRow: boolean, absCol: boolean`.
  - Converted and shifted via `adjustFormulaReferences`: relative references adjust with `rowDelta` and `colDelta`; `$A$1` absolute references remain unchanged.
- **Range References**:
  - Expressed as `{ kind: 'range', from: Ast, to: Ast }` in `syntax.ts` and `{ kind: 'range', sheet?, startRow, startCol, endRow, endCol, absStartRow, ... }` in `ast.ts`.
  - In `index.ts:195-207`, resolves sheet, computes bounding box `[top, bottom, left, right]`, checks max cell allocation (≤ 1,000,000 cells; returns `#CALC!` if exceeded), and returns `{ kind: 'array', rows, cols, values }`.
- **Cross-Sheet References**:
  - Parsed with syntax `Sheet1!A1`, `'Sheet Name'!A1`, `'Bob''s Sheet'!B2`, `Sheet1!A1:B10`.
  - Evaluated in `index.ts:127-132`:
    ```ts
    const resolveSheet = (address: CellAddress, sheetName?: string) => {
      if (!sheetName) return address.sheetId;
      const found = Object.values(workbook.sheets).find((sheet) =>
        sheet.properties.name.toLowerCase() === sheetName.toLowerCase());
      if (!found) throw err("#REF!");
      return found.id;
    };
    ```
- **Named Ranges**:
  - Evaluated in `index.ts:179-190`:
    Resolves names from `workbook.names` matching name case-insensitively and scope (`scope === null || scope === address.sheetId`).
    Detects circular named ranges using `activeNames.has(nameKey) => return err("#CIRC!")`.
    Recursively parses and evaluates the named formula.
- **Structured Table References**:
  - Parsed in `syntax.ts:7-8,17` (`Table[Column]`, `Table[[#Headers],[Column]]`, `Table[[#Data],[Column]]`, `Table[[#Totals],[Column]]`, `Table[@Column]`, `Table[[#All],[Column]]`).
  - Evaluated in `index.ts:133-163,167-172` by looking up table definitions on workbook sheets and resolving to corresponding cell ranges.

---

### 1.3 Dependency Graph, Cycle Detection & Recalculation
- **Dependency Structures** (`index.ts:20-65`):
  - Forward dependencies: `deps: Map<string, CellAddress[]>`
  - Reverse dependencies: `reverse: Map<string, Set<string>>`
  - Range dependencies with 256-row spatial indexing: `rangeDeps: Map<string, RangeRef[]>`, `rangeIndex: Map<string, Set<string>>` bucketed by `${sheetId}:${Math.floor(row / 256)}`. Avoids registering millions of individual blank cell dependency edges while maintaining fast invalidation when any cell in a range changes.
  - Formula index: `formulaIndex: Map<string, { at: CellAddress; cell: Cell }>`
  - Dirty formulas: `dirty: Set<string>`
  - Volatile formulas: `volatile: Set<string>` populated when formula source matches `/\b(?:RAND|RANDBETWEEN|NOW|TODAY|OFFSET|INDIRECT)\s*\(/i`.
- **Incremental Recalculation** (`index.ts:433-492`):
  - `updateWorkbook(next)`: compares modified tiles and cells against previous revision; identifies changed cells and invalidates their dependents. If sheet names, tables, or named ranges change structurally, invalidates all caches.
  - `invalidate(roots)`: performs breadth-first traversal down reverse dependency graph, range dependents, and spilled children; removes stale cache entries and adds affected formula keys to `dirty`.
  - `recalculate()`:
    1. Invalidates all formulas in `volatile` and their dependents.
    2. Executes an iterative DFS topological sort over `dirty` formulas using an explicit work stack `work: { k: string; exit: boolean }[]` (lines 478–490).
    3. Evaluates direct formula references in topological order before reading dependent cells, preventing call stack overflow.
- **Circular Reference Detection** (`index.ts:391-427`):
  - During cell evaluation, adds the cell key to `active: Set<string>`.
  - If a cell reads an address currently in `active`, it immediately returns `{ kind: 'error', code: '#CIRC!' }` without hanging, recursing infinitely, or throwing an uncaught exception.
  - Call stack limit `stack.length > 256` returns `#CALC!`.
  - AST execution step limit `steps > 2_000_000` throws `#CALC!`.
  - Once the cycle is broken (e.g. an input cell updated), recalculation succeeds and clears the error.

---

### 1.4 Dynamic Arrays and Spill Implementation
- **Array Evaluation** (`index.ts:404-426`):
  - Any formula returning an `ArrayValue` (matrix or array literal) evaluates child positions relative to the anchor cell `(address.row + r, address.col + c)`.
  - Boundary check: If `address.row + rows > 1,048,576` or `address.col + cols > 16,384`, marked blocked.
  - Collision check: Each child target cell is inspected; if an authored cell contains an authored value or formula (`existing.input.kind === 'formula' || existing.input.value !== null`) or is already occupied by another active spill (`spills.has(key(child))`), `blocked` is set to `true`.
  - Error reporting: If blocked, anchor formula evaluates to `{ kind: 'error', code: '#SPILL!' }`.
  - Spill materialization: If unblocked, registers children in `spillChildren.set(k, ...)`, registers anchor dependency on each child (`addDependency(k, child)`), and populates `spills: Map<string, { owner: string; value: Scalar }>`.
  - Consumer invalidation: Any downstream formulas that previously evaluated while a target cell was blank are automatically invalidated (`invalidate(consumers)`).
  - Recovery: Clearing the blocking cell removes the obstruction and automatically spills on next recalculation.

---

### 1.5 Function Library Audit Matrix (All 88 Functions in R2)
Every function listed in Requirement R2 was verified in `packages/formula/src/functions.ts`, `packages/formula/src/index.ts`, and test fixtures in `tests/compatibility/function-cases.ts`:

| # | Function | Status | Implementation File & Line | Tested In | Behavior & Known Excel Differences |
|---|---|---|---|---|---|
| 1 | `SUM` | Implemented | `functions.ts:32` | `functions.test.ts:17,108` | Numeric values in ranges/arrays; ignores non-numeric strings in ranges. Empty range gives 0. |
| 2 | `AVERAGE` | Implemented | `functions.ts:32` | `functions.test.ts:18,109` | Sum divided by numeric count; returns `#DIV/0!` if no numbers. |
| 3 | `MIN` | Implemented | `functions.ts:32` | `functions.test.ts:19,110` | Minimum of numbers; empty numeric set returns 0. |
| 4 | `MAX` | Implemented | `functions.ts:32` | `functions.test.ts:20,111` | Maximum of numbers; empty numeric set returns 0. |
| 5 | `COUNT` | Implemented | `functions.ts:32` | `functions.test.ts:21,112` | Counts numeric cells in ranges; counts numbers, booleans, and numeric strings in direct arguments. |
| 6 | `COUNTA` | Implemented | `functions.ts:32` | `functions.test.ts:22,113` | Counts all non-null values including empty strings, errors, and booleans. |
| 7 | `COUNTIF` | Implemented | `functions.ts:34` | `functions.test.ts:23,114` | Matches comparisons (`>`, `<`, `=`, `<>`, `>=`, `<=`) and wildcards (`*`, `?`). |
| 8 | `COUNTIFS` | Implemented | `functions.ts:35` | `functions.test.ts:24,115` | Multi-criteria counting; requires equal flattened range lengths, else `#VALUE!`. |
| 9 | `SUMIF` | Implemented | `functions.ts:34` | `functions.test.ts:25,116` | Criteria range with optional sum range; returns 0 if no match. |
| 10 | `SUMIFS` | Implemented | `functions.ts:35` | `functions.test.ts:26,117` | Multi-criteria sum; requires equal flattened range lengths, else `#VALUE!`. |
| 11 | `AVERAGEIF` | Implemented | `functions.ts:34` | `functions.test.ts:27,118` | Criteria match average; returns `#DIV/0!` if no match. |
| 12 | `IF` | Implemented | `index.ts:264-287` | `functions.test.ts:28,119` | Short-circuit lazy evaluation on scalar branches; supports element-wise array broadcasting. |
| 13 | `IFS` | Implemented | `index.ts:302-310` | `functions.test.ts:29,120` | Sequential lazy evaluation of condition/result pairs; returns `#N/A` if none match; `#VALUE!` on odd args. |
| 14 | `AND` | Implemented | `functions.ts:33` | `functions.test.ts:30,121` | Evaluates truthiness of all arguments; propagates errors. |
| 15 | `OR` | Implemented | `functions.ts:33` | `functions.test.ts:31,122` | Evaluates truthiness of any argument; propagates errors. |
| 16 | `NOT` | Implemented | `functions.ts:33` | `functions.test.ts:32,123` | Inverts boolean truthiness; non-numeric/non-boolean string returns `#VALUE!`. |
| 17 | `IFERROR` | Implemented | `index.ts:288-301` | `functions.test.ts:33,124` | Lazy evaluation of fallback; replaces scalar errors and element-wise array errors. |
| 18 | `IFNA` | Implemented | `index.ts:288-301` | `functions.test.ts:34,125` | Lazy fallback; only replaces `#N/A`, preserving other errors (e.g. `#DIV/0!`). |
| 19 | `SWITCH` | Implemented | `index.ts:311-316` | `functions.test.ts:35,126` | Evaluates target, then value/result pairs lazily; optional default; `#N/A` if no match. |
| 20 | `LET` | Implemented | `index.ts:347-356` | `functions.test.ts:36,127` | Lexical scoping with `Map` environment; supports LAMBDA closures and eager expression evaluation. |
| 21 | `LAMBDA` | Implemented | `index.ts:75,365` | `functions.test.ts:37,128` | Direct execution `(LAMBDA(x,x+1))(2)`, named formulas, and LET bindings; 64-call stack limit. |
| 22 | `INDEX` | Implemented | `functions.ts:56` | `functions.test.ts:38,129` | 1-based row and column selection from 2D/1D array; returns `#REF!` if out of bounds. |
| 23 | `MATCH` | Implemented | `functions.ts:57-74` | `functions.test.ts:39,130` | Supports match modes: 0 (exact), 1 (less than/equal), -1 (greater than/equal), and wildcards. |
| 24 | `XMATCH` | Implemented | `functions.ts:57-74` | `functions.test.ts:40,131` | Modes: 0 (exact), -1 (exact/next smaller), 1 (exact/next larger), 2 (wildcard); search 1 / -1. |
| 25 | `XLOOKUP` | Implemented | `functions.ts:57-74` | `functions.test.ts:41,132` | Lookup/return vectors; supports missing fallback, wildcard search, reverse search, and multi-col returns. |
| 26 | `VLOOKUP` | Implemented | `functions.ts:76` | `functions.test.ts:42,133` | Vertical lookup with exact/approximate matching; `#REF!` if column index out of bounds; `#N/A` if not found. |
| 27 | `HLOOKUP` | Implemented | `functions.ts:76` | `functions.test.ts:43,134` | Horizontal lookup with exact/approximate matching; `#REF!` if row index out of bounds; `#N/A` if not found. |
| 28 | `FILTER` | Implemented | `functions.ts:77` | `functions.test.ts:44,135` | Filters rows matching boolean vector; returns 2D array; optional if_empty fallback or `#CALC!`. |
| 29 | `SORT` | Implemented | `functions.ts:79-96` | `functions.test.ts:45,136` | Sorts rows or columns by index and direction (1 asc, -1 desc). |
| 30 | `SORTBY` | Implemented | `functions.ts:79-96` | `functions.test.ts:46,137` | Sorts by one or more parallel key vectors with individual directions. |
| 31 | `UNIQUE` | Implemented | `functions.ts:79-96` | `functions.test.ts:47,138` | Deduplicates rows/columns; supports case-insensitive text and `exactly_once` option. |
| 32 | `SEQUENCE` | Implemented | `functions.ts:54` | `functions.test.ts:48,139` | Generates 2D array `(rows, cols, start, step)`; capped at 1,000,000 cells (`#CALC!`). |
| 33 | `TRANSPOSE` | Implemented | `functions.ts:55` | `functions.test.ts:49,140` | Transposes 2D/1D rectangular arrays. |
| 34 | `TAKE` | Implemented | `functions.ts:78` | `functions.test.ts:50,141` | Slices positive or negative rows/columns; returns `#CALC!` if rows=0 or cols=0. |
| 35 | `DROP` | Implemented | `functions.ts:78` | `functions.test.ts:51,142` | Drops positive or negative rows/columns; returns `#CALC!` if result is empty. |
| 36 | `CHOOSE` | Implemented | `index.ts:342-346` | `functions.test.ts:52,143` | Lazy evaluation: only evaluates the selected argument; `#VALUE!` if index < 1 or out of range. |
| 37 | `OFFSET` | Implemented | `index.ts:327-341` | `functions.test.ts:53,144` | Dynamic cell/range shift and dimension resizing; boundary checked; marked volatile. |
| 38 | `INDIRECT` | Implemented | `index.ts:317-326` | `functions.test.ts:54,145` | Dynamically parses text reference into AST and evaluates; marked volatile. |
| 39 | `TEXT` | Implemented | `functions.ts:43` | `functions.test.ts:55,146` | Formats numbers with decimals, `$`, `,`, `%`, and `yyyy-mm-dd`. |
| 40 | `VALUE` | Implemented | `functions.ts:42` | `functions.test.ts:56,147` | Parses numeric text, `$`, commas, and `%` into numbers; `#VALUE!` on invalid string. |
| 41 | `LEFT` | Implemented | `functions.ts:39` | `functions.test.ts:57,148` | Extracts characters from beginning; `#VALUE!` if count < 0. |
| 42 | `RIGHT` | Implemented | `functions.ts:39` | `functions.test.ts:58,149` | Extracts characters from end; returns `""` if count = 0. |
| 43 | `MID` | Implemented | `functions.ts:39` | `functions.test.ts:59,150` | 1-based character extraction; `#VALUE!` if start < 1 or count < 0. |
| 44 | `LEN` | Implemented | `functions.ts:39` | `functions.test.ts:60,151` | String code-unit length; returns 0 for empty string. |
| 45 | `TRIM` | Implemented | `functions.ts:39` | `functions.test.ts:61,152` | Trims leading/trailing whitespace and collapses internal multiple spaces to one. |
| 46 | `SUBSTITUTE` | Implemented | `functions.ts:40` | `functions.test.ts:62,153` | Case-sensitive substring replacement with optional instance index. |
| 47 | `REPLACE` | Implemented | `functions.ts:40` | `functions.test.ts:63,154` | Positional replacement: `(text, start, length, new_text)`. |
| 48 | `CONCAT` | Implemented | `functions.ts:39` | `functions.test.ts:64,155` | Concatenates flattened values and ranges; propagates errors. |
| 49 | `TEXTJOIN` | Implemented | `functions.ts:39` | `functions.test.ts:65,156` | Joins items with delimiter; boolean flag to ignore or preserve empty cells. |
| 50 | `FIND` | Implemented | `functions.ts:41` | `functions.test.ts:66,157` | Case-sensitive 1-based substring position search; `#VALUE!` if not found. |
| 51 | `SEARCH` | Implemented | `functions.ts:41` | `functions.test.ts:67,158` | Case-insensitive substring search with wildcard `*` and `?` support. |
| 52 | `UPPER` | Implemented | `functions.ts:39` | `functions.test.ts:68,159` | Converts string to uppercase. |
| 53 | `LOWER` | Implemented | `functions.ts:39` | `functions.test.ts:69,160` | Converts string to lowercase. |
| 54 | `PROPER` | Implemented | `functions.ts:39` | `functions.test.ts:70,161` | Capitalizes first letter of words using Unicode word boundaries. |
| 55 | `ROUND` | Implemented | `functions.ts:37` | `functions.test.ts:71,162` | Half-away-from-zero rounding to specified decimal places (positive or negative). |
| 56 | `ROUNDUP` | Implemented | `functions.ts:37` | `functions.test.ts:72,163` | Away-from-zero rounding. |
| 57 | `ROUNDDOWN` | Implemented | `functions.ts:37` | `functions.test.ts:73,164` | Toward-zero rounding. |
| 58 | `INT` | Implemented | `functions.ts:36` | `functions.test.ts:74,165` | Floor towards negative infinity (`INT(-1.2) = -2`). |
| 59 | `MOD` | Implemented | `functions.ts:36` | `functions.test.ts:75,166` | Remainder with divisor sign (`MOD(-3,2) = 1`); returns `#DIV/0!` if divisor is 0. |
| 60 | `ABS` | Implemented | `functions.ts:36` | `functions.test.ts:76,167` | Absolute numeric value. |
| 61 | `POWER` | Implemented | `functions.ts:36` | `functions.test.ts:77,168` | Exponentiation; returns `#NUM!` if result is non-real or non-finite. |
| 62 | `SQRT` | Implemented | `functions.ts:36` | `functions.test.ts:78,169` | Square root; returns `#NUM!` if argument < 0. |
| 63 | `RAND` | Implemented | `functions.ts:38` | `functions.test.ts:79,170` | Volatile random float in `[0, 1)`; accepts injectable deterministic random seed. |
| 64 | `RANDBETWEEN` | Implemented | `functions.ts:38` | `functions.test.ts:80,171` | Volatile random integer in `[min, max]`; `#NUM!` if min > max. |
| 65 | `TODAY` | Implemented | `functions.ts:44` | `functions.test.ts:81,172` | UTC integer date serial; volatile; accepts deterministic epoch clock. |
| 66 | `NOW` | Implemented | `functions.ts:44` | `functions.test.ts:82,173` | UTC floating-point timestamp serial; volatile; accepts deterministic epoch clock. |
| 67 | `DATE` | Implemented | `functions.ts:44` | `functions.test.ts:83,174` | Constructs 1900-system date serial with month/day overflow handling. |
| 68 | `YEAR` | Implemented | `functions.ts:44` | `functions.test.ts:84,175` | Extracts year; handles fictitious 1900-02-29 serial 60 special case. |
| 69 | `MONTH` | Implemented | `functions.ts:44` | `functions.test.ts:85,176` | Extracts month (1–12); handles serial 60 special case. |
| 70 | `DAY` | Implemented | `functions.ts:44` | `functions.test.ts:86,177` | Extracts day of month (1–31); handles serial 60 special case. |
| 71 | `EDATE` | Implemented | `functions.ts:45` | `functions.test.ts:87,178` | Shifts date by N months, clamping to end-of-month. |
| 72 | `EOMONTH` | Implemented | `functions.ts:45` | `functions.test.ts:88,179` | Computes serial of the last day of month N months away. |
| 73 | `NETWORKDAYS` | Implemented | `functions.ts:46` | `functions.test.ts:89,180` | Counts working days (excluding Sat/Sun and optional holidays list); 1M day cap. |
| 74 | `WORKDAY` | Implemented | `functions.ts:46` | `functions.test.ts:90,181` | Advances date by N working days; excludes weekends and optional holidays list. |
| 75 | `PMT` | Implemented | `functions.ts:50` | `functions.test.ts:91,182` | Constant annuity payment calculation: `-(v*factor+extra)/annuity`. |
| 76 | `PV` | Implemented | `functions.ts:50` | `functions.test.ts:92,183` | Present value of annuity/investment. |
| 77 | `FV` | Implemented | `functions.ts:50` | `functions.test.ts:93,184` | Future value of annuity/investment. |
| 78 | `NPV` | Implemented | `functions.ts:51` | `functions.test.ts:94,185` | Net present value of discounted cash flows: `sum(v / (1+rate)^i)`. |
| 79 | `IRR` | Implemented | `functions.ts:52` | `functions.test.ts:95,186` | Newton-Raphson iteration up to 100 iterations with 1e-10 convergence; `#NUM!` on non-convergence. |
| 80 | `STDEV.S` | Implemented | `functions.ts:49` | `functions.test.ts:96,187` | Sample standard deviation (N-1 denominator); `#DIV/0!` if count < 2. |
| 81 | `STDEV.P` | Implemented | `functions.ts:49` | `functions.test.ts:97,188` | Population standard deviation (N denominator); `#DIV/0!` if count < 1. |
| 82 | `VAR.S` | Implemented | `functions.ts:49` | `functions.test.ts:98,189` | Sample variance (N-1 denominator); `#DIV/0!` if count < 2. |
| 83 | `VAR.P` | Implemented | `functions.ts:49` | `functions.test.ts:99,190` | Population variance (N denominator); `#DIV/0!` if count < 1. |
| 84 | `MEDIAN` | Implemented | `functions.ts:48` | `functions.test.ts:100,191` | Median of numeric values; `#NUM!` if empty. |
| 85 | `LARGE` | Implemented | `functions.ts:48` | `functions.test.ts:101,192` | K-th largest number (1-based); `#NUM!` if k out of range. |
| 86 | `SMALL` | Implemented | `functions.ts:48` | `functions.test.ts:102,193` | K-th smallest number (1-based); `#NUM!` if k out of range. |
| 87 | `RANK.EQ` | Implemented | `functions.ts:48` | `functions.test.ts:103,194` | Rank of value in vector, optional order (0 desc, non-zero asc); equal values share rank. |
| 88 | `SUBTOTAL` | Implemented | `functions.ts:53` | `functions.test.ts:104,195` | Function codes 1–11 and 101–111 (AVERAGE, COUNT, COUNTA, MAX, MIN, PRODUCT, STDEV.S, STDEV.P, SUM, VAR.S, VAR.P). |

---

### 1.6 Verification Tool Commands & Results
1. Formula unit and compatibility test suite:
   ```bash
   npx vitest run tests/compatibility packages/formula/test
   ```
   **Result**: 4 test files, 380 tests passed (0 failures) in 1.15s:
   - `packages/formula/test/lexer.test.ts` (14 tests)
   - `packages/formula/test/parser.test.ts` (77 tests)
   - `tests/compatibility/functions.test.ts` (265 tests)
   - `tests/compatibility/engine.test.ts` (24 tests)

2. Full repository test suite:
   ```bash
   npm test
   ```
   **Result**: 11 test files, 410 tests passed (0 failures) in 3.63s.

3. Type-check formula package:
   ```bash
   npx tsc --project packages/formula/tsconfig.json --noEmit
   ```
   **Result**: Exit code 0, 0 errors.

4. Type-check test suite:
   ```bash
   npx tsc --project tsconfig.tests.json --noEmit
   ```
   **Result**: Exit code 0, 0 errors.

5. Formula benchmark run:
   ```bash
   npx tsx benchmarks/run.ts
   ```
   **Result**:
   - 100K formulas cold recalculate: 1335.97 ms
   - 100K formulas single input edit incremental recalculate: 1.05 ms
   - 100K formulas read cached results: 48.79 ms
   - 1M cells initialize engine: 1474.48 ms

---

## 2. Logic Chain

1. **Premise**: Requirement R2 mandates a from-scratch formula engine with lexer, parser, AST, operator precedence, cell/range references (relative, absolute, mixed, cross-sheet), named ranges, error propagation, dependency graph with topological recalculation, circular reference detection, incremental recomputation, volatile functions, array formulas with dynamic spill, and 88 specified functions.
2. **From Observation 1.1**: The codebase implements custom tokenization (`lexer.ts`, `syntax.ts`), recursive descent parsing with operator precedence (`parser.ts`, `syntax.ts`), AST structures (`ast.ts`, `syntax.ts`), and evaluation (`index.ts`). No third-party formula evaluator is used.
3. **From Observation 1.2**:
   - Relative, absolute, mixed, and range references are parsed with bounds checks (1..1,048,576 rows, 1..16,384 columns).
   - Cross-sheet references (`Sheet1!A1`, `'My Sheet'!A1:B10`) resolve sheet IDs case-insensitively and return `#REF!` on missing sheets.
   - Named ranges resolve in global and worksheet scopes, with cycle detection.
   - Reference adjustment during copy/cut/paste (`adjustFormulaReferences`) properly offsets relative components while preserving `$A$1` absolute anchors.
4. **From Observation 1.3**:
   - The dependency graph maintains forward `deps`, reverse dependencies, and 256-row spatial range buckets (`rangeIndex`).
   - Incremental recomputation invalidates only dirty dependents on workbook edits, demonstrated by the 1.05 ms benchmark for 100,000 formulas.
   - Volatile functions (`RAND`, `NOW`, `TODAY`, `OFFSET`, `INDIRECT`) are tracked in a dedicated set and invalidated on explicit recalculation.
   - Direct-reference chains are recalculated using an iterative topological DFS stack, tested up to 5,000 chained cells without stack overflow.
   - Circular reference detection returns `{ kind: 'error', code: '#CIRC!' }` immediately, without hanging or throwing, and recovers once the cycle is broken.
5. **From Observation 1.4**:
   - Formulas returning arrays (e.g. `SEQUENCE`, `FILTER`, array arithmetic) evaluate spatial boundaries, check for collision with authored cells or existing spills, and spill into child cells or return `#SPILL!`.
   - Spills dynamically invalidate consumers that formerly read blanks and recover when blockers are cleared.
6. **From Observation 1.5**:
   - All 88 functions listed in Requirement R2 are present in `FUNCTION_NAMES` and `createDefaultRegistry()`.
   - Every function is tested with ordinary values, edge/boundary cases, and invalid arity in `tests/compatibility/functions.test.ts`. All 265 tests pass.
7. **From Observation 1.6**:
   - Full test suite (410 tests) and benchmark pass cleanly.
8. **Duality Observation**:
   - The codebase has two parallel parser files: `packages/formula/src/syntax.ts` (compact engine parser supporting structured table references and direct lambda application) and `packages/formula/src/parser.ts` (object-oriented AST parser with `printFormula` round-tripping). Both are exported from `@openexcel/formula`. `index.ts` uses `syntax.ts` for internal formula evaluation.

---

## 3. Caveats

1. **Spill Range Syntax (`A1#`) and Implicit Intersection (`@`)**:
   - The lexer/parser does not parse the `#` spill operator (e.g., `=SUM(A1#)`) or top-level `@` implicit intersection (e.g., `=@A1:A10`). Users reference spill results using explicit ranges (e.g. `A1:B3`).
2. **3D Cube References**:
   - Multi-sheet 3D ranges like `Sheet1:Sheet3!A1` are not supported (single sheet prefix `Sheet1!A1` is supported).
3. **Union and Intersection Operators**:
   - Reference union `(A1:A2, B1:B2)` and intersection `A1:C3 B1:D4` are not supported.
4. **Full-Column / Full-Row Shorthand**:
   - Formulas like `=SUM(A:A)` or `=SUM(1:1)` are not parsed; explicit bounds must be used (e.g. `=SUM(A1:A1048576)`).
5. **Iterative Circular Calculations**:
   - Circular references intentionally produce the error `#CIRC!`; iterative calculation with max iterations / tolerance is not implemented.
6. **R1C1 Reference Notation**:
   - Only A1 notation is supported; `INDIRECT(..., FALSE)` returns `#REF!`.
7. **1904 Date System**:
   - Only the 1900 date system is supported (including Excel's fictitious leap day serial 60).

---

## 4. Conclusion

1. **Requirement R2 Status**: **Fully Satisfied**.
   - Custom formula calculation engine exists with complete lexer, parser, AST, operator precedence, reference resolution, dependency graph, cycle detection, incremental recomputation, volatile functions, dynamic spill arrays, and all 88 specified functions.
2. **Acceptance Criteria Status**:
   - `Unit tests pass for all listed formula functions (SUM through SUBTOTAL)`: **PASS** (265 tests passing).
   - `Formulas with cell references recalculate when dependencies change`: **PASS** (incremental recalculation verified).
   - `Circular reference detection produces an error rather than hanging`: **PASS** (`#CIRC!` error produced).
   - `Cross-sheet references (e.g., =Sheet2!A1) resolve correctly`: **PASS** (verified in engine and interoperability challenge tests).
   - `Array formulas spill results into adjacent cells`: **PASS** (dynamic array spilling and `#SPILL!` collision handling verified).
3. **Actionable Recommendations for Implementers**:
   - No architectural overhaul or function library additions are needed for R2.
   - If extending formula syntax in future milestones, consider adding `A1#` spill reference token support to `syntax.ts` and `lexer.ts`.
   - Maintain the dual parser export contract as both `syntax.ts` and `parser.ts` are actively referenced by test suites and packaging.

---

## 5. Verification Method

Independent verification can be executed with the following commands from the repository root `/workspaces/excellence-chart`:

1. **Verify All 88 Formula Functions & Engine Tests**:
   ```bash
   npx vitest run tests/compatibility packages/formula/test
   ```
   *Expected*: 4 test files, 380 tests pass.

2. **Verify Full Application Test Suite**:
   ```bash
   npm test
   ```
   *Expected*: 11 test files, 410 tests pass with exit code 0.

3. **Verify Formula Type Safety**:
   ```bash
   npx tsc --project packages/formula/tsconfig.json --noEmit
   npx tsc --project tsconfig.tests.json --noEmit
   ```
   *Expected*: Clean compilation with 0 diagnostics.

4. **Verify Calculation Performance & Memory**:
   ```bash
   npx tsx benchmarks/run.ts
   ```
   *Expected*: 100K formulas recalculate in ~1.3s cold and ~1ms incremental.
