## 2026-10-23T19:24:40Z
You are teamwork_preview_worker_m1_rust.
Your working directory is: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m1_rust

MANDATORY FIRST STEP:
Read the authoritative user request at:
/workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md
Specifically study the latest request timestamped 2026-10-23T19:00:46Z, Requirement R1: Rust Core Engine & Calculations and Acceptance Criteria.

Also read:
- /workspaces/excellence-chart/PROJECT.md
- /workspaces/excellence-chart/TEST_INFRA.md
- /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_explorer_survey2_1/handoff.md
- /workspaces/excellence-chart/tests/compatibility/function-cases.ts

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE BOUNDARIES:
You exclusively own:
- /workspaces/excellence-chart/Cargo.toml (root workspace manifest)
- /workspaces/excellence-chart/crates/openexcel-core/**

TASK OBJECTIVE:
Implement the genuine Rust core engine in `crates/openexcel-core` satisfying Requirement R1:
1. Root `Cargo.toml` defining the workspace members: `members = ["crates/openexcel-core"]`.
2. `crates/openexcel-core/Cargo.toml` configured with dependencies (`serde`, `serde_json`, `chrono`, etc.).
3. Core data structures (`src/types.rs`, `src/grid.rs`, `src/coordinates.rs`):
   - Values: `Scalar` (Null, Boolean, Number(f64), String, ErrorCode), `ArrayValue` (rows, cols, Vec<Scalar>), `ComputedValue`.
   - ErrorCode: `#NULL!`, `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`, `#N/A`, `#SPILL!`, `#CALC!`, `#CIRC!`, `#PARSE!`.
   - Coordinate validation: `0..1048576` rows, `0..16384` columns, bijective base-26 column letters (`A..XFD`).
   - Sparse cell storage with 128x32 tiling.
4. Formula Lexer, Pratt Parser & AST (`src/lexer.rs`, `src/parser.rs`, `src/ast.rs`):
   - Support numbers, scientific notation, strings with `""`, booleans, cell references (`A1`, `$A$1`, `A$1`, `$A1`), ranges (`A1:B10`), cross-sheet references (`Sheet1!A1`, `'My Sheet'!A1`), structured references, and error literals.
   - Exact operator precedence hierarchy: Range `:` (8,9), Exponentiation `^` (7,6 right-assoc), Unary `+,-` (8), Postfix `%` (8), Multiply/Divide `*,/` (5,6), Add/Subtract `+,-` (4,5), Concat `&` (3,4), Comparisons `=,<>,<,<=,>,>=` (2,3).
5. Dependency Graph & Cycle Detection (`src/graph.rs`):
   - Spatial range indexing using 256-row buckets (`sheet:row/256`).
   - Iterative DFS stack evaluation worklist.
   - Cycle detection: active evaluation stack set returning `ErrorCode::Circ` (`#CIRC!`) without hanging or crashing.
6. Dynamic Array Spill Mechanics (`src/spill.rs`):
   - Matrix evaluations with rows > 1 or cols > 1 spill across neighboring cells.
   - Grid boundary check (`row + rows <= 1048576 && col + cols <= 16384`).
   - Non-empty or existing spill collision check: returns `ErrorCode::Spill` (`#SPILL!`).
   - Automatic child invalidation when anchor or children are modified.
7. Complete 88 Standard Excel Functions (`src/functions/`):
   Organize into 9 modular files matching the oracle test assertions in `tests/compatibility/function-cases.ts`:
   - `math.rs`: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTIF, COUNTIFS, SUMIF, SUMIFS, AVERAGEIF, ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, POWER, SQRT, RAND, RANDBETWEEN, SUBTOTAL (with all 11 subtotal function numbers).
   - `logical.rs`: IF (element-wise broadcasting), IFS, AND, OR, NOT, IFERROR, IFNA, SWITCH, CHOOSE.
   - `bindings.rs`: LET (lexical variable binding), LAMBDA (closure application).
   - `lookup.rs`: INDEX, MATCH, XMATCH, XLOOKUP, VLOOKUP, HLOOKUP, OFFSET, INDIRECT.
   - `dynamic_array.rs`: FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TRANSPOSE, TAKE, DROP.
   - `text.rs`: TEXT (format string interpreter), VALUE, LEFT, RIGHT, MID, LEN, TRIM, SUBSTITUTE, REPLACE, CONCAT, TEXTJOIN, FIND, SEARCH, UPPER, LOWER, PROPER.
   - `date_time.rs`: TODAY, NOW, DATE, YEAR, MONTH, DAY, EDATE, EOMONTH, NETWORKDAYS, WORKDAY (with Excel 1900 leap year quirk: day 60 = 1900-02-29).
   - `financial.rs`: PMT, PV, FV, NPV, IRR (Newton-Raphson solver).
   - `statistical.rs`: STDEV.S, STDEV.P, VAR.S, VAR.P, MEDIAN, LARGE, SMALL, RANK.EQ.
8. Comprehensive test suites in `crates/openexcel-core/tests/` covering parser, graph, cycles, spills, and all 88 functions with edge cases.
9. VERIFICATION:
   Execute `cargo test -p openexcel-core`. All tests must pass with exit code 0.
