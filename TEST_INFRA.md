# E2E Test Infra: OpenExcel (Rust Core, WASM & Native Desktop)

## Test Philosophy
- Requirement-driven, multi-target verification.
- Opaque-box E2E testing + transparent-box unit verification.
- Zero-compromise acceptance: 100% test pass on native Rust, WASM Web Worker, Playwright browser E2E, and sub-second 100k-cell benchmarks.

## Feature Inventory & Test Mapping
| # | Feature | Rust Unit Tests (`cargo test`) | Integration Tests | Playwright E2E Browser | 100k Benchmark Harness |
|---|---------|:------------------------------:|:-----------------:|:----------------------:|:----------------------:|
| 1 | Sparse Grid & Coordinates | ✓ | ✓ | ✓ | ✓ |
| 2 | Pratt Formula Parser & AST | ✓ | ✓ | ✓ | - |
| 3 | Spatial Dependency Graph | ✓ | ✓ | ✓ | ✓ |
| 4 | Cycle Detection (`#CIRC!`) | ✓ | ✓ | ✓ | - |
| 5 | Dynamic Array Spills (`#SPILL!`) | ✓ | ✓ | ✓ | - |
| 6 | 88 Standard Excel Functions | ✓ (All 88) | ✓ | ✓ | - |
| 7 | Excel 1900 Date System Quirk | ✓ | ✓ | - | - |
| 8 | wasm32 Target Compilation | ✓ | ✓ | ✓ | - |
| 9 | Web Worker WASM Integration | - | ✓ | ✓ | ✓ |
| 10 | Native Desktop Shell & CLI | ✓ | ✓ | - | - |
| 11 | SQLite WAL Persistence | ✓ | ✓ | ✓ | - |
| 12 | Local File I/O (.openexcel / .xlsx) | ✓ | ✓ | ✓ | - |
| 13 | Virtualized Grid UI (1M x 16k) | - | - | ✓ | - |
| 14 | Formula Recalculation & Bar Sync | ✓ | ✓ | ✓ | ✓ |
| 15 | Cell Styling & Conditional Formats | - | ✓ | ✓ | - |
| 16 | Interactive Charts (9 types) | - | ✓ | ✓ | - |
| 17 | Data Tools (Sort, AutoFilter, Tables) | - | ✓ | ✓ | - |
| 18 | 100k-Cell Recalculation Throughput | - | - | - | ✓ (<1.0s) |

## Test Suites & Invocations
1. **Rust Engine & Functions**:
   `cargo test -p openexcel-core`
   Executes parser, AST, dependency graph, cycle detection, dynamic array spills, and all 88 standard functions.
2. **Desktop Shell & SQLite Persistence**:
   `cargo test -p openexcel-desktop`
   Executes SQLite WAL mode, `BEGIN IMMEDIATE` transactions, optimistic concurrency, and local file I/O tests.
3. **Core TypeScript Pipeline & Compatibility Tests**:
   `npm test`
   Executes 423 unit/integration tests across models, formatting, data tools, interop, and function oracle.
4. **Playwright E2E Browser Automation**:
   `npm run test:e2e`
   Executes all 9 end-to-end tests covering cell selection, editing, formula recalculation with WASM worker, charts, dialogs, sheet tabs, formatting, persistence, and virtual grid navigation.
5. **100,000+ Formula Cells Performance Benchmarks**:
   `npm run benchmark`
   Executes the 100,000-cell dependency chain benchmark, asserting sub-second (<1000ms) recalculation throughput and emitting `artifacts/benchmark.json`.
