# Project: OpenExcel (Rust Core Engine, WASM, Desktop & Benchmarks)

## Architecture
OpenExcel is a high-performance, Excel-compatible spreadsheet application powered by a Rust core engine that compiles to WebAssembly (WASM) for the web client and runs natively in a Desktop shell with local SQLite persistence:
- `crates/openexcel-core`: Pure Rust spreadsheet engine containing sparse cell grids, coordinate mapping, Pratt formula parser, AST, operator precedence table, dependency graph with cycle detection (`#CIRC!`), dynamic array spill mechanics (`#SPILL!`), and an Excel-compatible function library of all 88 standard functions across 9 modules.
- `crates/openexcel-wasm`: WebAssembly target compiling to `wasm32-unknown-unknown` via `wasm-pack build --target web`, generating type-safe TypeScript declarations (`openexcel_wasm.d.ts`) and ES module bindings for non-blocking Web Worker execution.
- `crates/openexcel-desktop`: Native Rust desktop executable with bundled SQLite (`rusqlite = { version = "0.31", features = ["bundled"] }`, WAL mode, `BEGIN IMMEDIATE`, optimistic version locking), local file I/O (.openexcel and .xlsx), headless CLI, embedded local daemon (`openexcel-desktop serve`), and Tauri v2 configuration (`apps/desktop/tauri.conf.json`).
- `apps/web`: React 19 single-page application with DOM-virtualized grid supporting 1,048,576 rows x 16,384 columns, ribbon toolbar, formula bar, sheet tabs, cell styling, 9 chart types, data tool dialogs, and non-blocking Web Worker UI bindings (`calculation.worker.ts`).
- `tests/`: Comprehensive multi-tiered testing suite: native Rust unit and integration tests (`cargo test -p openexcel-core`), WebAssembly tests (`wasm-pack test`), Vitest suites (423 tests), and Playwright E2E browser automation tests.
- `benchmarks/`: Automated benchmark harness measuring recalculation throughput on 100,000+ dependent formula cells (<1.0 second threshold), memory consumption (RSS), and performance reporting (`artifacts/benchmark.json`).

## Feature Inventory
Every requirement and feature mapped to the 6 Dedicated Agent Tracks:

| # | Feature | Description | Dedicated Agent / Track | Milestone | Source |
|---|---------|-------------|-------------------------|-----------|--------|
| 1 | Sparse Cell Grid & Coordinates | 1,048,576 rows x 16,384 cols, 128x32 tiling, bijective base-26 coordinates | Agent 1: Rust Core Engine | M1 | R1 |
| 2 | Formula Lexer & Pratt Parser | AST, Pratt precedence table (levels 2..9), scientific notation, error literals | Agent 1: Rust Core Engine | M1 | R1 |
| 3 | Spatial Range Dependency Graph | 256-row spatial range buckets, topological recalculation worklist | Agent 1: Rust Core Engine | M1 | R1 |
| 4 | DFS Stack Cycle Detection | Active evaluation stack tracking returning `#CIRC!` without hanging or crashing | Agent 1: Rust Core Engine | M1 | R1 |
| 5 | Dynamic Array Spill Mechanics | Matrix evaluation, boundary checks, collision detection returning `#SPILL!` | Agent 1: Rust Core Engine | M1 | R1 |
| 6 | 88 Standard Excel Functions | SUM through SUBTOTAL across 9 modules matching compatibility oracle | Agent 1: Rust Core Engine | M1 | R1 |
| 7 | Excel 1900 Date System Quirk | Serial day 60 = Feb 29, 1900 compatibility preservation | Agent 1: Rust Core Engine | M1 | R1 |
| 8 | wasm32-unknown-unknown Compilation | `wasm-pack build --target web` producing ES module loader and `.wasm` binary | Agent 2: WASM Target & Bindings | M2 | R2 |
| 9 | Type-Safe TypeScript Bindings | Auto-generated `.d.ts` types and WASM bridge for Web Worker | Agent 2: WASM Target & Bindings | M2 | R2 |
| 10 | Web Worker Non-Blocking Offload | `calculation.worker.ts` hosting WASM engine without main-thread blocking | Agent 2: WASM Target & Bindings | M2 | R2 |
| 11 | Native Desktop Shell Packaging | `crates/openexcel-desktop` standalone binary + Tauri v2 packaging | Agent 3: Desktop Shell & Persistence | M2 | R2 |
| 12 | SQLite WAL Persistence | `rusqlite` bundled, WAL mode, `BEGIN IMMEDIATE`, optimistic versioning | Agent 3: Desktop Shell & Persistence | M2 | R2 |
| 13 | Local File I/O (.openexcel & .xlsx) | Atomic JSON save/open, lossless XLSX import/export with manifest | Agent 3: Desktop Shell & Persistence | M2 | R2 |
| 14 | Virtualized Viewport Grid UI | 1M rows x 16k cols DOM virtualization, logarithmic coordinate translation | Agent 4: UI Agent | M3 | R3 |
| 15 | Selection, Fill Handle & Navigation | Single/multi/discontiguous selection, fill handle series inference, shortcuts | Agent 4: UI Agent | M3 | R3 |
| 16 | Styling & Conditional Formatting | Font, size, bold, italic, underline, strike, borders, alignment, rules | Agent 4: UI Agent | M3 | R3 |
| 17 | Interactive Charts (9 types) | Column, line, area, bar, scatter, pie, donut, histogram, combo reactivity | Agent 4: UI Agent | M3 | R3 |
| 18 | Data Tools & Modal Dialogs | Multi-column sort, AutoFilter, validation dropdowns, tables, Find & Replace | Agent 4: UI Agent | M3 | R3 |
| 19 | Cargo & Vitest Test Suites | `cargo test -p openexcel-core`, Vitest 423 compatibility and pipeline tests | Agent 5: Testing Agent | M4 | R4 |
| 20 | Playwright E2E Browser Automation | End-to-end browser tests for editing, formula recalculation, persistence | Agent 5: Testing Agent | M4 | R4 |
| 21 | 100k-Cell Recalculation Benchmark | 100,000+ dependent cells recalculated in <1.0 second (<1000ms assertion) | Agent 6: Benchmarks Agent | M4 | R4 |
| 22 | Latency & RSS Memory Profiling | Throughput profiling, memory RSS tracking, `artifacts/benchmark.json` | Agent 6: Benchmarks Agent | M4 | R4 |

## Milestones

| # | Milestone Name | Scope | Assigned Track | Dependencies | Status |
|---|----------------|-------|----------------|--------------|--------|
| M1 | Rust Core Calculation Engine | `crates/openexcel-core`: sparse grid, Pratt parser, AST, dependency graph with `#CIRC!`, dynamic array spills (`#SPILL!`), 88 functions across 9 modules, `cargo test` | Agent 1 (Rust Core Engine) | none | PLANNED |
| M2 | WASM Target & Desktop Shell | `crates/openexcel-wasm` (`wasm-pack build --target web`, TS bindings) + `crates/openexcel-desktop` (bundled SQLite WAL, headless CLI, local file I/O, Tauri config) | Agent 2 (WASM) & Agent 3 (Desktop) | M1 | PLANNED |
| M3 | Integrated Spreadsheet UI | `apps/web/src/calculation.worker.ts` WASM integration, virtualized grid, ribbon, styling, charts, data tool dialogs, worker UI bindings | Agent 4 (UI Agent) | M2 | PLANNED |
| M4 | Automated Testing & 100k Benchmarks | Unit test suites (`cargo test`), Playwright E2E suite, 100,000+ dependent cells recalculation benchmark (<1s), `artifacts/benchmark.json` | Agent 5 (Testing) & Agent 6 (Benchmarks) | M3 | PLANNED |

## Interface Contracts

### Rust Core ↔ WASM Web Worker Bindings
- Rust crate: `crates/openexcel-wasm` exporting `WasmEngine`:
  - `new() -> WasmEngine`
  - `update_workbook(json_str: &str)`
  - `recalculate() -> WasmRecalcResult`
  - `get_computed_values(addresses_json: &str) -> String` (returns JSON map of `{ "sheetId/row:col": ComputedValue }`)
- Web Worker contract (`apps/web/src/calculation.worker.ts`):
  - Request: `{ id: number, workbook?: Workbook, addresses: CellAddress[] }`
  - Response: `{ id: number, values: Record<string, ComputedValue>, error?: string }`

### Native Desktop Runner ↔ Local Storage & Files
- Executable: `openexcel-desktop`
- CLI commands:
  - `openexcel-desktop create --name <name>`
  - `openexcel-desktop save --id <id> --file <path>`
  - `openexcel-desktop list`
  - `openexcel-desktop serve --port 3001 --db-path ./workbooks.db`
- SQLite schema: `workbooks` and `saves` tables with WAL mode, `BEGIN IMMEDIATE`, optimistic version checking, and idempotent SHA-256 receipts.

### UI ↔ Calculation Worker
- Non-blocking postMessage passing visible viewport coordinates + chart category/value ranges.
- React components (`App.tsx`, `Chart.tsx`) consume async computed values dictionary without UI stutter or scroll lag.

## Code Layout
- `crates/`:
  - `openexcel-core/`: Pure Rust spreadsheet calculation engine
    - `src/`: `lib.rs`, `types.rs`, `grid.rs`, `parser.rs`, `lexer.rs`, `ast.rs`, `graph.rs`, `spill.rs`
    - `src/functions/`: `math.rs`, `logical.rs`, `bindings.rs`, `lookup.rs`, `dynamic_array.rs`, `text.rs`, `date_time.rs`, `financial.rs`, `statistical.rs`
    - `tests/`: `engine_tests.rs`, `function_tests.rs`
  - `openexcel-wasm/`: WebAssembly bindings
    - `src/`: `lib.rs`, `bridge.rs`
    - `pkg/`: Generated WASM and TypeScript declarations
  - `openexcel-desktop/`: Native desktop application and SQLite runner
    - `src/`: `main.rs`, `storage.rs`, `file_io.rs`, `server.rs`
- `apps/`:
  - `web/`: React 19 UI, virtualized grid, ribbon, styling, charts
  - `desktop/`: Tauri v2 configuration (`tauri.conf.json`)
- `tests/`:
  - `compatibility/`: Formula function oracle tests
  - `integration/`: Multi-module integration tests
  - `e2e/`: Playwright browser automation tests
- `benchmarks/`:
  - `run.ts`: 100k-cell dependency chain benchmark harness
