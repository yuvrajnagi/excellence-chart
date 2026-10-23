# Handoff Report: Rust Core Engine Architecture & Calculations (Requirement R1)

## 1. Observation

### 1.1 User Requirements & Authoritative Specifications
- `/workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md` (lines 63–110, timestamp `2026-10-23T19:00:46Z`):
  - Mission: *"Convert OpenExcel into a high-performance spreadsheet system powered by a Rust core engine that compiles to WebAssembly (WASM) for the web client and bundles natively for Desktop, maintaining full Excel compatibility, virtualized editing, and persistent storage."*
  - Requirement R1 (lines 72–74): *"Implement a Rust core engine that handles spreadsheet data structures (sparse cell grids, coordinate mapping), formula parsing (Pratt parser, AST, precedence), dependency graph tracking with cycle detection (`#CIRC!`), dynamic array spill mechanics (`#SPILL!`), and an Excel-compatible function library implementing all 88 standard spreadsheet functions."*
  - Acceptance Criteria (lines 95–99):
    - `cargo test` executes and passes for all core data structures, formula parser, dependency graph, cycle detection, and formula library functions.
    - The formula engine correctly calculates all 88 Excel functions with error propagation and edge cases matching test assertions.
    - Circular references return `#CIRC!` without hanging or crashing the process.
    - Dynamic array formulas spill across neighboring cells and return `#SPILL!` on collision.

### 1.2 Toolchain & Workspace State
- Executed `rustc --version`: returned `bash: line 1: rustc: command not found` (exit code 127).
- Executed `cargo --version`: returned `bash: line 1: cargo: command not found` (exit code 127).
- Executed `which wasm-pack`: returned `wasm-pack not found`.
- Filesystem inspection: `find . -maxdepth 3 -name "Cargo.toml" -o -name "*.rs"` returned no Rust files or crates in `/workspaces/excellence-chart`.
- Environment inspection:
  - `sudo -n true` returned `0` (`sudo available`).
  - `curl -I https://sh.rustup.rs` returned `HTTP/2 200` with AmazonS3/CloudFront headers.
  - Rust installation via rustup is immediately viable on this host (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`).

### 1.3 TypeScript Formula Engine & Model Analysis
- **Coordinate System & Limits**:
  - `packages/model/src/coordinates.ts`:
    - Grid dimensions: `GRID_ROWS = 1048576` (1,048,576 rows, 0-indexed `0..1048575`), `GRID_COLUMNS = 16384` (16,384 columns, 0-indexed `0..16383`, `A..XFD`).
    - Tile size: `TILE_ROWS = 128`, `TILE_COLUMNS = 32`.
    - TileKey format: `"${Math.floor(row / 128)}:${Math.floor(col / 32)}"`.
    - Column conversion: Bijective base-26 (`colToLetters`, `lettersToCol`).
- **Data Types & Values**:
  - `packages/model/src/types.ts`:
    - `ErrorCode`: `"#NULL!"`, `"#DIV/0!"`, `"#VALUE!"`, `"#REF!"`, `"#NAME?"`, `"#NUM!"`, `"#N/A"`, `"#SPILL!"`, `"#CALC!"`, `"#CIRC!"`, `"#PARSE!"`.
    - `Scalar`: `null | number | string | boolean | ErrorValue`.
    - `ArrayValue`: `{ kind: 'array', rows: number, cols: number, values: readonly Scalar[] }`.
    - `ComputedValue`: `Scalar | ArrayValue`.
- **Lexer & Pratt Parser**:
  - `packages/formula/src/lexer.ts`:
    - Token kinds: `NUMBER`, `STRING`, `BOOLEAN`, `ERROR`, `IDENT`, `SHEET_PREFIX`, `PLUS`, `MINUS`, `STAR`, `SLASH`, `CARET`, `AMPERSAND`, `PERCENT`, `EQ`, `NEQ`, `LT`, `LTE`, `GT`, `GTE`, `LPAREN`, `RPAREN`, `LBRACE`, `RBRACE`, `COMMA`, `SEMICOLON`, `COLON`, `EXCL`, `EOF`.
    - Supports escaped quotes in strings (`""`), single-quoted sheet names (`'Sheet Name'!`), case-insensitive booleans, and error literals.
  - `packages/formula/src/parser.ts`:
    - Operator precedence hierarchy (from lowest to highest):
      1. Comparison (`=`, `<>`, `<`, `<=`, `>`, `>=`) — left-associative, prec 2
      2. Concatenation (`&`) — left-associative, prec 3
      3. Addition & Subtraction (`+`, `-`) — left-associative, prec 4
      4. Multiplication & Division (`*`, `/`) — left-associative, prec 5
      5. Exponentiation (`^`) — right-associative, prec 7
      6. Unary prefix (`+`, `-`) — right-associative, prec 8
      7. Postfix (`%`) — left-associative (divides operand by 100)
      8. Range (`:`) — left-associative, prec 8
      9. Function call / Parentheses / Array literal (`{}`) / Atoms (prec 9)
    - AST nodes (`packages/formula/src/ast.ts`): `NumberLiteral`, `StringLiteral`, `BooleanLiteral`, `ErrorLiteral`, `EmptyLiteral`, `CellRefNode`, `RangeRefNode`, `UnaryOpNode`, `BinaryOpNode`, `FunctionCallNode`, `ArrayLiteralNode`, `NameRefNode`, `ParenNode`.
- **Dependency Graph, Cycle Detection & Recalculation**:
  - `packages/formula/src/index.ts`:
    - Spatial indexing: Range dependencies are grouped into 256-row buckets (`rangeBucket = (sheetId, row) => "${sheetId}:${Math.floor(row / 256)}"`) to avoid creating 16M edges for blank cells.
    - Cycle detection: An active evaluation stack (`stack: string[]`) and set (`active: Set<string>`) track cells currently being evaluated. If `active.has(k)` is encountered during recursion, evaluation immediately returns `{ kind: 'error', code: '#CIRC!' }` without looping or hanging.
    - Deep chain scheduling: `recalculate()` uses an iterative worklist stack (`work: { k: string, exit: boolean }[]`) rather than native JS call stack, passing tests with 5,000+ sequential dependencies (`A{row} = A{row-1} + 1`).
- **Dynamic Array Spills (`#SPILL!`)**:
  - `packages/formula/src/index.ts` lines 404–426:
    - When formula evaluation returns an `ArrayValue` where `rows > 1` or `cols > 1`:
      - Boundary check: If `address.row + value.rows > 1048576 || address.col + value.cols > 16384`, sets `blocked = true`.
      - Collision check: For every child cell `(address.row + r, address.col + c)` with `(r, c) != (0, 0)`, checks if the cell contains authored formula, non-null value, or is occupied by an existing spill. If so, sets `blocked = true`.
      - If `blocked`: result is `#SPILL!`.
      - If not blocked: establishes spill child relationships in `spillChildren` and `spills`, binds dependency from anchor to child cells so edits to child cells invalidate anchor, and transitively invalidates downstream cells reading formerly blank child cells.
- **The 88 Excel Functions & Compatibility Test Oracle**:
  - `tests/compatibility/function-cases.ts`:
    - Lines 16–105 define exact test cases for all 88 functions: `SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTIF, COUNTIFS, SUMIF, SUMIFS, AVERAGEIF, IF, IFS, AND, OR, NOT, IFERROR, IFNA, SWITCH, LET, LAMBDA, INDEX, MATCH, XMATCH, XLOOKUP, VLOOKUP, HLOOKUP, FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TRANSPOSE, TAKE, DROP, CHOOSE, OFFSET, INDIRECT, TEXT, VALUE, LEFT, RIGHT, MID, LEN, TRIM, SUBSTITUTE, REPLACE, CONCAT, TEXTJOIN, FIND, SEARCH, UPPER, LOWER, PROPER, ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, POWER, SQRT, RAND, RANDBETWEEN, TODAY, NOW, DATE, YEAR, MONTH, DAY, EDATE, EOMONTH, NETWORKDAYS, WORKDAY, PMT, PV, FV, NPV, IRR, STDEV.S, STDEV.P, VAR.S, VAR.P, MEDIAN, LARGE, SMALL, RANK.EQ, SUBTOTAL`.
    - Lines 107–196 define 88 edge/boundary cases: error conditions, division by zero, empty ranges, invalid dates, out-of-bounds indices, and type coercion.

---

## 2. Logic Chain

1. **Requirement Fulfillment**:
   Requirement R1 explicitly calls for a Rust core engine that handles spreadsheet data structures, Pratt parser, AST, dependency graph with DFS stack cycle detection (`#CIRC!`), dynamic array spill mechanics (`#SPILL!`), and an Excel-compatible function library implementing all 88 standard spreadsheet functions. Acceptance criteria mandate that `cargo test` executes and passes for all of these components.

2. **Toolchain Prerequisite**:
   Because neither `rustc` nor `cargo` is currently installed in the container PATH, the build/implementation phase must first install Rust via `rustup` (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable`) and add `$HOME/.cargo/bin` to `PATH`.

3. **Crate Architecture & Multi-Target Readiness**:
   - The core engine logic must be decoupled from UI and platform bindings to satisfy dual-target compilation (Requirement R2: WASM for web workers and native Rust for Desktop).
   - Recommended layout:
     - Root workspace `Cargo.toml` with `crates/openexcel-core`.
     - `crates/openexcel-core` compiled as both `rlib` and `cdylib` with optional `wasm` feature (`wasm-bindgen`, `serde-wasm-bindgen`).
     - This allows `cargo test` to run 100% natively on Linux x86_64 at full speed, while also enabling `wasm-pack build --target web` or `--target bundler` for WASM artifact generation.

4. **Data Structure Design**:
   - **Values**: Rust `enum Scalar` (`Null`, `Boolean(bool)`, `Number(f64)`, `String(String)`, `Error(ErrorCode)`) and `struct ArrayValue { rows: usize, cols: usize, values: Vec<Scalar> }`.
   - **Coordinates**: `CellAddress { sheet_id: String, row: u32, col: u32 }` (0-indexed, validated against `0..1048576` and `0..16384`).
   - **Grid Storage**: A high-performance two-level sparse store matching OpenExcel's tile architecture:
     `HashMap<TileKey, Tile>` per sheet, where `Tile` is `HashMap<(u16, u16), Cell>`, or a direct coordinate hash map `HashMap<(u32, u32), Cell>` with tile clustering for spatial query acceleration.

5. **Pratt Parser & AST**:
   - Lexer: Token stream with zero-copy string slices (`&str`) or owned `Token` structs, handling sheet prefixes (`Sheet1!`, `'My Sheet'!`), cell refs (`$A$1`), string literals with `""`, numbers with scientific notation, and error constants.
   - Pratt Parser: Binding power lookup table implementing exact Excel precedence:
     - Range `:` (8, 9)
     - Exponentiation `^` (7, 6) [right-associative]
     - Prefix `+`, `-` (8)
     - Postfix `%` (8)
     - Multiply/Divide `*`, `/` (5, 6)
     - Add/Subtract `+`, `-` (4, 5)
     - Concat `&` (3, 4)
     - Comparison `=`, `<>`, `<`, `<=`, `>`, `>=` (2, 3)
   - AST node enumeration representing all constructs (literals, references, ranges, structured table references, unary ops, binary ops, function calls, arrays, LET/LAMBDA applications).

6. **Dependency Graph & Cycle Detection**:
   - Directed graph storing:
     - `deps: HashMap<CellKey, Vec<CellAddress>>`
     - `reverse_deps: HashMap<CellKey, HashSet<CellKey>>`
     - `range_deps: HashMap<CellKey, Vec<RangeRef>>`
     - `range_index: HashMap<(String, u32), HashSet<CellKey>>` (256-row spatial buckets).
   - Cycle detection:
     - When evaluating cell `K`, `cycle_detector.enter(K)` checks if `K` is currently in the active evaluation stack. If found, returns `ErrorCode::Circ` (`#CIRC!`).
     - Post-evaluation `cycle_detector.exit(K)` pops `K`.
     - Non-recursive iterative post-order traversal using an explicit worklist stack (`Vec<WorkItem>`) prevents stack overflows on chains of 10,000+ cells.

7. **Dynamic Array Spill Mechanics**:
   - Evaluator returns `ComputedValue`.
   - If `ComputedValue` is an `Array` with `rows > 1` or `cols > 1`:
     - Run boundary check: `row + rows <= 1048576 && col + cols <= 16384`.
     - Check collision with non-empty cells or existing spills in target rectangle.
     - If collision: anchor value becomes `ErrorCode::Spill` (`#SPILL!`).
     - If clear: register spill children in `spill_map: HashMap<CellKey, CellKey>` (child -> anchor) and `spill_children: HashMap<CellKey, Vec<CellKey>>`. Downstream formulas depending on child cells are re-evaluated.
     - Add dependency edges from child cells to anchor cell so any subsequent input into a spilled cell immediately triggers re-spill calculation.

8. **88 Functions Organization**:
   Decompose the 88 functions into 9 cohesive modules within `crates/openexcel-core/src/functions/`:
   - `math.rs`: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTIF, COUNTIFS, SUMIF, SUMIFS, AVERAGEIF, ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, POWER, SQRT, RAND, RANDBETWEEN, SUBTOTAL (with all 11 subtotal codes).
   - `logical.rs`: IF (element-wise on array condition), IFS, AND, OR, NOT, IFERROR (element-wise on array), IFNA, SWITCH, CHOOSE (short-circuiting unselected branches).
   - `bindings.rs`: LET (scoped lexical environment), LAMBDA (closure creation and recursive application up to depth 64).
   - `lookup.rs`: INDEX, MATCH, XMATCH, XLOOKUP, VLOOKUP, HLOOKUP, OFFSET, INDIRECT.
   - `dynamic_array.rs`: FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TRANSPOSE, TAKE, DROP.
   - `text.rs`: TEXT (number/date format string interpreter), VALUE, LEFT, RIGHT, MID, LEN, TRIM, SUBSTITUTE, REPLACE, CONCAT, TEXTJOIN, FIND, SEARCH, UPPER, LOWER, PROPER.
   - `date_time.rs`: TODAY, NOW, DATE, YEAR, MONTH, DAY, EDATE, EOMONTH, NETWORKDAYS, WORKDAY (with Excel 1900 date system and leap-year day 60 quirk).
   - `financial.rs`: PMT, PV, FV, NPV, IRR (Newton-Raphson 100-iteration solver with tolerance 1e-10).
   - `statistical.rs`: STDEV.S, STDEV.P, VAR.S, VAR.P, MEDIAN, LARGE, SMALL, RANK.EQ.

---

## 3. Caveats

1. **Host Toolchain State**:
   `rustc` and `cargo` are not installed by default in the codespace image. The implementation phase must run the `rustup` installer script before any `cargo` command can run. Network connectivity to `https://sh.rustup.rs` was verified and works.
2. **Date System Parity**:
   Excel historically treats 1900 as a leap year (the Lotus 1-2-3 leap year bug). Day 60 corresponds to February 29, 1900. Both the TypeScript engine and tests in `tests/compatibility/function-cases.ts` (lines 175–177) enforce this convention: serial 60 must return Year=1900, Month=2, Day=29. The Rust date library/implementation must explicitly preserve this compatibility quirk.
3. **Array Broadcasting**:
   Binary arithmetic operators (`+`, `-`, `*`, `/`, `^`, `&`, comparisons) must support array broadcasting: scalar-with-array (1x1 broadcast to MxN), row-vector-with-column-vector (1xN with Mx1 broadcast to MxN). If dimensions are incompatible and neither is 1, it must return `#VALUE!`.
4. **WASM & Desktop Compilation**:
   Detailed investigation of Web Worker WASM loading and native desktop shell packaging is assigned to companion explorer `teamwork_preview_explorer_survey2_2`. However, the core crate design specified here is cleanly decoupled and immediately ready for both targets.

---

## 4. Conclusion

The Rust core engine architecture for OpenExcel is fully mapped, scoped, and directly aligned with Requirement R1 and the existing TypeScript reference implementation.

### Key Architecture Blueprint:
1. **Workspace & Crate Setup**:
   - Workspace root: `/workspaces/excellence-chart/Cargo.toml`
   - Core crate: `/workspaces/excellence-chart/crates/openexcel-core`
   - Crate types: `rlib`, `cdylib`
   - Optional features: `wasm` (`wasm-bindgen`, `serde-wasm-bindgen`)
2. **File & Module Structure**:
   ```
   crates/openexcel-core/
   ├── Cargo.toml
   ├── src/
   │   ├── lib.rs                  # Crate exports, public API, WASM exports
   │   ├── types.rs                # ErrorCode, Scalar, ArrayValue, ComputedValue, ResourceLimits
   │   ├── coordinates.rs          # Grid bounds, colToLetters, lettersToCol, CellAddress, RangeRef
   │   ├── model/
   │   │   ├── mod.rs
   │   │   ├── cell.rs             # Cell, CellInput (value or formula string)
   │   │   ├── tile.rs             # Sparse tile store (128x32)
   │   │   └── workbook.rs         # Workbook and Sheet models, table metadata
   │   ├── parser/
   │   │   ├── mod.rs
   │   │   ├── token.rs            # TokenKind, Token
   │   │   ├── lexer.rs            # Excel formula lexer
   │   │   ├── ast.rs              # AstNode, BinOp, UnaryOp, CellRefNode, RangeRefNode
   │   │   └── pratt.rs            # Pratt parser with precedence table
   │   ├── graph/
   │   │   ├── mod.rs
   │   │   ├── dep_graph.rs        # Directed dependency graph, forward & reverse edges
   │   │   ├── spatial_index.rs    # 256-row bucket spatial range indexing
   │   │   └── cycle_detector.rs   # DFS active stack cycle detection (`#CIRC!`)
   │   ├── spill/
   │   │   ├── mod.rs
   │   │   └── spill_manager.rs    # Spill bounds check, collision detection (`#SPILL!`), invalidation
   │   ├── functions/
   │   │   ├── mod.rs              # Registry, dispatcher, criteria parser
   │   │   ├── math.rs             # 22 math functions (SUM through SUBTOTAL)
   │   │   ├── logical.rs          # 9 logical functions (IF, IFS, SWITCH, CHOOSE, etc.)
   │   │   ├── bindings.rs         # LET, LAMBDA (lexical environments & closures)
   │   │   ├── lookup.rs           # 8 lookup functions (INDEX, MATCH, XLOOKUP, OFFSET, etc.)
   │   │   ├── dynamic_array.rs    # 8 array functions (FILTER, SORT, UNIQUE, SEQUENCE, etc.)
   │   │   ├── text.rs             # 16 text functions (TEXT, VALUE, LEFT, REPLACE, etc.)
   │   │   ├── date_time.rs        # 10 date functions (DATE, TODAY, WORKDAY, etc.)
   │   │   ├── financial.rs        # 5 financial functions (PMT, PV, FV, NPV, IRR)
   │   │   └── statistical.rs      # 9 statistical functions (STDEV, VAR, MEDIAN, etc.)
   │   └── engine/
   │       ├── mod.rs
   │       ├── evaluator.rs        # AST evaluation, short-circuiting, broadcasting
   │       └── engine.rs           # Engine struct (update_workbook, recalculate, evaluate_formula)
   └── tests/
       ├── coordinate_tests.rs
       ├── parser_tests.rs
       ├── graph_tests.rs
       ├── spill_tests.rs
       ├── function_oracle_tests.rs  # All 88 functions from function-cases.ts
       └── edge_case_tests.rs        # All 88 edge cases from function-cases.ts
   ```
3. **Execution Plan**:
   - Step 1: Install Rust toolchain via rustup in workspace.
   - Step 2: Initialize root `Cargo.toml` and `crates/openexcel-core`.
   - Step 3: Implement `types`, `coordinates`, `model`, and unit tests.
   - Step 4: Implement `lexer`, `pratt`, `ast`, and parser tests.
   - Step 5: Implement `dep_graph`, `spatial_index`, `cycle_detector` (`#CIRC!`), and `spill_manager` (`#SPILL!`).
   - Step 6: Implement all 88 Excel functions across the 9 modules, importing test cases directly from `tests/compatibility/function-cases.ts`.
   - Step 7: Run `cargo test` to achieve 100% test pass on all unit, graph, spill, and function oracle suites.

---

## 5. Verification Method

To independently verify the findings and subsequent implementation of Requirement R1:

1. **Verify Toolchain Installation**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
   source "$HOME/.cargo/env"
   rustc --version
   cargo --version
   ```
   *Expected output*: `rustc 1.8x.x` and `cargo 1.8x.x`.

2. **Verify Rust Core Test Suite**:
   Once `crates/openexcel-core` is created:
   ```bash
   cargo test --workspace --all-targets
   ```
   *Expected output*: All unit and integration tests pass (exit code 0), covering:
   - Parser tests (Pratt precedence, associative operators, array literals, structured references)
   - Dependency graph tests (5,000+ deep dependency chains, incremental recalculation)
   - Cycle detection tests (circular formulas return `#CIRC!` without hanging)
   - Spill tests (`SEQUENCE` spills, collisions return `#SPILL!`, blocker clearing recovers)
   - Oracle compatibility tests (all 88 standard function cases pass)
   - Edge case compatibility tests (all 88 edge/boundary cases pass)

3. **Verify File Layout Compliance**:
   ```bash
   test -f /workspaces/excellence-chart/Cargo.toml
   test -d /workspaces/excellence-chart/crates/openexcel-core/src
   ```
   *Expected output*: Exit code 0, verifying proper modular crate structure in `crates/`.

4. **Invalidation Conditions**:
   - If any of the 88 Excel functions deviates in behavior or return type from `tests/compatibility/function-cases.ts`, the verification fails.
   - If a circular reference causes recursion stack exhaustion instead of returning `#CIRC!`, the verification fails.
   - If a dynamic array spill overwrites populated cells instead of returning `#SPILL!`, the verification fails.
