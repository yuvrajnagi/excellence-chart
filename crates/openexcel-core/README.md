# `openexcel-core`

The core spreadsheet calculation engine for OpenExcel, written in 100% safe, high-performance Rust.

---

## Capabilities

- **Grid Data Structures**: Sparse 128x32 tile-based cell grid supporting 1,048,576 rows × 16,384 columns without dense memory allocation.
- **Formula Lexer & Pratt Parser**: Recursive descent operator precedence parser supporting unary, binary, right-associative exponentiation (`^`), postfix percentage (`%`), range references (`:`), structured references, and array literals (`{1, 2; 3, 4}`).
- **Dependency Graph**: Directed dependency graph with 256-row spatial range indexing and iterative DFS stack cycle detection returning `#CIRC!` without stack exhaustion.
- **Dynamic Array Spills**: Matrix spill engine with collision detection returning `#SPILL!` when authored cells obstruct the spill rectangle.
- **88 Excel Functions**: Complete standard spreadsheet function library across 9 modular source files (`math.rs`, `logical.rs`, `lookup.rs`, `dynamic_array.rs`, `text.rs`, `date_time.rs`, `financial.rs`, `statistical.rs`, `bindings.rs`).
- **Date System Compatibility**: Full support for the Lotus 1-2-3 / Excel 1900 leap year quirk (`DATE(1900, 2, 29) = 60.0`).
- **WASM Ready**: Compiles cleanly to `wasm32-unknown-unknown` with `no_std`-friendly core algorithms.

---

## Directory Structure

```text
src/
├── lib.rs              # Crate root and public exports
├── types.rs            # Value types (Scalar, ComputedValue, ErrorCode)
├── coordinates.rs      # Column letter conversion (A..XFD) & A1 address parsing
├── grid.rs             # Sparse 128x32 tile-based cell storage
├── ast.rs              # Typed AST expressions
├── lexer.rs            # Formula tokenizer
├── parser.rs           # Pratt precedence parser
├── graph.rs            # Dependency graph & cycle detection (#CIRC!)
├── spill.rs            # Dynamic array spill management (#SPILL!)
├── evaluator.rs        # AST evaluation & criteria matching
├── engine.rs           # High-level Engine API & recalculation scheduler
└── functions/          # 9 modules implementing all 88 functions
    ├── mod.rs          # Registry & dispatcher
    ├── math.rs         # SUM, AVERAGE, MIN, MAX, COUNT, SUBTOTAL, etc.
    ├── logical.rs      # IF, IFS, AND, OR, NOT, IFERROR, SWITCH, etc.
    ├── lookup.rs       # INDEX, MATCH, XLOOKUP, VLOOKUP, OFFSET, etc.
    ├── dynamic_array.rs# FILTER, SORT, UNIQUE, SEQUENCE, TRANSPOSE, etc.
    ├── text.rs         # TEXT, VALUE, LEFT, REPLACE, TEXTJOIN, etc.
    ├── date_time.rs    # TODAY, NOW, DATE, YEAR, WORKDAY, etc.
    ├── financial.rs    # PMT, PV, FV, NPV, IRR
    ├── statistical.rs  # STDEV, VAR, MEDIAN, LARGE, SMALL, RANK.EQ
    ├── bindings.rs     # LET, LAMBDA
    └── criteria.rs     # Wildcard (*, ?) and relational criteria parser
```

---

## Running Tests

```bash
cargo test -p openexcel-core
```

Covering:
- Unit tests (`src/lib.rs`): 12 tests
- Engine tests (`tests/engine_tests.rs`): 8 tests
- Function oracle tests (`tests/function_tests.rs`): 4 tests
- Adversarial stress tests (`tests/adversarial_tests.rs`, `tests/adversarial_function_tests.rs`): 13 tests
