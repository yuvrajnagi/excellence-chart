# OpenExcel

[![Rust Core Engine](https://img.shields.io/badge/Rust-1.80%2B-orange.svg?logo=rust)](file:///workspaces/excellence-chart/crates/openexcel-core)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-wasm--bindgen-654FF0.svg?logo=webassembly)](file:///workspaces/excellence-chart/crates/openexcel-wasm)
[![Desktop Shell](https://img.shields.io/badge/Desktop-SQLite%20WAL-blue.svg)](file:///workspaces/excellence-chart/crates/openexcel-desktop)
[![React 19 UI](https://img.shields.io/badge/React-19.1.0-61DAFB.svg?logo=react)](file:///workspaces/excellence-chart/apps/web)
[![Formula Engine](https://img.shields.io/badge/Formulas-88%20Standard%20Functions-green.svg)](file:///workspaces/excellence-chart/docs/formula-compatibility.md)
[![Tests Passing](https://img.shields.io/badge/Tests-471%2F471%20Passing-brightgreen.svg)](file:///workspaces/excellence-chart/docs/testing.md)
[![License](https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-yellow.svg)](file:///workspaces/excellence-chart/LICENSE)

**OpenExcel** is a high-performance, Excel-compatible spreadsheet application and engine designed from first principles. It couples a 100% safe **Rust calculation engine** with dual execution targets: compiling to **WebAssembly (WASM)** for non-blocking browser execution via Web Workers, and natively compiling to a **Desktop runner** backed by transactional SQLite Write-Ahead Logging (WAL) storage.

The presentation tier features a responsive **React 19 virtualized viewport** supporting **1,048,576 rows × 16,384 columns** at 60fps, paired with an Excel-style ribbon toolbar, two-way formula bar, 9 interactive reactive SVG chart types, custom cell formatting, multi-column sorting, AutoFilter, and lossless XLSX/CSV exchange.

---

## Architecture Overview

```mermaid
graph TD
    subgraph "Core Calculation Engine (crates/openexcel-core)"
        CoreEngine["Rust Calculation Engine<br/>Pratt Precedence Parser • Sparse 128x32 Tiling<br/>256-Row Spatial Index DAG • Iterative DFS Cycle Detector<br/>Dynamic Array Spill Manager • 88 Excel Functions"]
    end

    subgraph "Dual Execution Targets"
        WasmTarget["crates/openexcel-wasm<br/>wasm-bindgen • wasm-opt<br/>Zero-copy bridge • Error hook"]
        DesktopTarget["crates/openexcel-desktop<br/>Bundled SQLite WAL • BEGIN IMMEDIATE<br/>tiny-http Embedded Daemon • CLI"]
    end

    subgraph "Clients & Presentation"
        WebClient["apps/web (React 19 + Vite)<br/>DOM-Virtualized Grid (1M rows x 16k cols)<br/>Ribbon • Formula Bar • 9 SVG Charts"]
        WebWorker["Web Worker (calculation.worker.ts)<br/>Dedicated background thread<br/>Non-blocking UI recalculations"]
        DesktopApp["Desktop Runner (dist-release/run.sh)<br/>Standalone 4.1MB binary<br/>Local file I/O (.openexcel, .xlsx)"]
    end

    subgraph "Node.js Services & TS Tooling"
        Server["apps/server (Node.js API)<br/>Import/Export Worker Threads<br/>Multi-part streaming XLSX/CSV"]
        TSPackages["packages/*<br/>@openexcel/model • @openexcel/formula<br/>@openexcel/data • @openexcel/formatting • @openexcel/interop"]
    end

    CoreEngine --> WasmTarget
    CoreEngine --> DesktopTarget
    WasmTarget --> WebWorker
    WebWorker <-->|postMessage| WebClient
    DesktopTarget --> DesktopApp
    DesktopTarget -->|HTTP / REST| WebClient
    Server --> TSPackages
    WebClient --> TSPackages
```

- **`crates/openexcel-core`**: Safe Rust calculation engine with Pratt precedence parsing, sparse 128×32 cell chunking, 256-row spatial indexing dependency DAG, iterative DFS cycle detection returning `#CIRC!`, dynamic array spill collision manager returning `#SPILL!`, and 88 standard Excel functions across 9 domains.
- **`crates/openexcel-wasm`**: Optimized WebAssembly bindings exporting `WasmEngine` for non-blocking recalculation inside browser Web Workers.
- **`crates/openexcel-desktop`**: Standalone native desktop runner featuring bundled SQLite in Write-Ahead Logging (WAL) mode, optimistic concurrency versioning (`If-Match`), idempotent SHA-256 save receipts, local file I/O, and an embedded HTTP daemon.
- **`apps/web`**: React 19 single-page application with a DOM-virtualized grid (1,048,576 rows × 16,384 columns), ribbon toolbar, formula bar, conditional formatting, and 9 SVG chart types.
- **`apps/server`**: Node.js HTTP server and worker thread service for asynchronous XLSX/CSV conversions and headless document management.
- **`packages/*`**: Modular TypeScript packages for data contracts, formula evaluation, formatting, AutoFilter/sort/pivots, and XLSX interoperability.

---

## Key Features

### 1. High-Performance Rust Calculation Engine
- **Pratt Operator Precedence Parser**: Handles unary prefix/postfix operators, binary arithmetic, right-associative exponentiation (`2^3^2 = 512`), postfix percentage (`50% = 0.5`), range colon references (`A1:B10`), structured table references (`Table1[@Sales]`), and inline matrix literals (`{1, 2; 3, 4}`).
- **Spatial Indexing Dependency Graph**: Groups range dependencies into 256-row spatial buckets, avoiding exhaustive cell-by-cell scans on large rectangular ranges.
- **Cycle Detection Without Crashes**: Tracks active evaluation states on a stack; circular chains resolve immediately to `#CIRC!` without stack exhaustion or hanging.
- **Dynamic Array Spills**: Functions like `SEQUENCE`, `SORT`, and `FILTER` spill into adjacent empty cells; if authored data obstructs the bounding rectangle, the formula returns `#SPILL!`.
- **Lotus 1-2-3 / Excel 1900 Leap Year Quirk**: Accurately simulates the historical Excel leap year day 60 anomaly (`DATE(1900, 2, 29) = 60.0`).

### 2. Dual-Target Execution Topology
- **Browser Web Worker (WASM)**: Heavy recalculations execute off the browser main thread in `apps/web/src/calculation.worker.ts`, guaranteeing 60fps UI responsiveness even during recalculations of 100k+ cells.
- **Native Desktop & SQLite WAL**: The native binary (`crates/openexcel-desktop`) embeds SQLite with `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = FULL`, and `BEGIN IMMEDIATE` transactions, providing optimistic version locking and SHA-256 deduplicated save receipts.

### 3. Production React 19 Virtualized Grid
- **1,048,576 Rows × 16,384 Columns**: Smoothly navigates the full Excel grid limit using DOM virtualization and viewport windowing.
- **Two-Way Synchronized Formula Bar**: Live editing with coordinate Name Box navigation and syntax parsing.
- **9 Interactive SVG Chart Types**: Column, Bar, Line, Area, Scatter, Pie, Donut, Histogram, and Combo charts reactively re-render as cell values mutate.
- **Cell Styling & Conditional Formatting**: Font families, font weights, custom borders, alignment, number formats (`#,##0.00`, currencies, percentages, dates), color scales, and data bars.
- **Data Tools**: Multi-column sorting, AutoFilter dropdowns, data validation, and pivot tables.

### 4. Lossless File Interoperability
- **XLSX Import/Export**: Preserves cell formulas, calculated values, font styling, borders, conditional formatting rules, merged cells, and chart specifications.
- **CSV & TSV**: Streaming RFC-4180 parsing and export with customizable delimiters.
- **Native `.openexcel` Format**: Clean, schema-validated JSON format for atomic saving and loading.

---

## Quick Start: Run the Test Release Build

A fully precompiled, self-contained release package is included in [`dist-release/`](file:///workspaces/excellence-chart/dist-release):

```bash
# Launch server on default port 3001
./dist-release/run.sh

# Or specify a custom port and database file
./dist-release/run.sh 8080 my_finances.sqlite
```

Open **`http://localhost:3001`** in any modern web browser.

The release launcher:
1. Starts the native Rust desktop server executable (`dist-release/bin/openexcel-desktop`).
2. Initializes the local SQLite database with WAL journaling.
3. Serves the production React virtualized web client and WASM bundle.
4. Auto-saves all edits locally with atomic transaction guarantees.

---

## Native Desktop CLI

The native `openexcel-desktop` executable provides a scriptable command-line interface for automation, CI/CD pipelines, and local file storage:

```bash
# Build the native release binary
cargo build --release -p openexcel-desktop

# 1. Create a new workbook
./target/release/openexcel-desktop create --name "FY26_Budget" --db-path "openexcel.sqlite"

# 2. List all workbooks in the local database
./target/release/openexcel-desktop list --db-path "openexcel.sqlite"

# 3. Export a workbook snapshot to a file
./target/release/openexcel-desktop save --id "<workbook_id>" --file "FY26_Budget.openexcel" --db-path "openexcel.sqlite"

# 4. Start the embedded web server daemon
./target/release/openexcel-desktop serve --port 3001 --static-dir "dist-release/web" --db-path "openexcel.sqlite"
```

---

## Monorepo Workspace Structure

```text
├── Cargo.toml                          # Rust workspace configuration
├── package.json                        # Root npm monorepo configuration
│
├── crates/                             # Rust Crates
│   ├── openexcel-core/                 # Pure Rust spreadsheet calculation engine
│   ├── openexcel-wasm/                 # wasm-bindgen bindings for Web Workers
│   └── openexcel-desktop/              # Native runner, SQLite WAL engine & HTTP daemon
│
├── apps/                               # Application Shells
│   ├── web/                            # React 19 virtualized spreadsheet UI
│   ├── desktop/                        # Tauri v2 native desktop application shell
│   └── server/                         # Node.js REST API & worker thread service
│
├── packages/                           # TypeScript Core Packages
│   ├── model/                          # @openexcel/model: Schemas, coordinates & store
│   ├── formula/                        # @openexcel/formula: TS formula lexer & parser
│   ├── formula-wasm/                   # openexcel-wasm: Compiled WASM bundle & types
│   ├── data/                           # @openexcel/data: AutoFilter, sort, tables & pivots
│   ├── formatting/                     # @openexcel/formatting: Number formatting & rules
│   └── interop/                        # @openexcel/interop: XLSX & CSV import/export
│
├── dist-release/                       # Standalone runnable distribution package
│   ├── bin/openexcel-desktop           # Native 4.1MB release binary
│   ├── web/                            # Production Web UI build
│   └── run.sh                          # One-click startup script
│
├── docs/                               # Technical & Architectural Documentation
│   ├── architecture.md                 # Core calculation engine architecture
│   ├── runtime-architecture.md         # Dual-target execution and concurrency
│   ├── formula-compatibility.md        # Complete 88-function specification
│   ├── contracts.md                    # Rust and TypeScript wire interfaces
│   ├── testing.md                      # Multi-tier verification hierarchy
│   ├── benchmarks.md                   # 100k-cell throughput & memory specs
│   └── interoperability.md             # File formats and compatibility oracle
│
└── tests/                              # Integration & E2E Test Suites
    ├── compatibility/                  # Formula compatibility test oracles
    ├── integration/                    # Monorepo full-pipeline integration tests
    └── e2e/                            # Playwright browser automation tests
```

---

## Formula Function Catalog (All 88 Functions)

OpenExcel implements 100% of the requested standard spreadsheet function catalog natively:

| Module | Count | Functions |
|---|:---:|---|
| **Math** | 22 | `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `COUNTIF`, `COUNTIFS`, `SUMIF`, `SUMIFS`, `AVERAGEIF`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `INT`, `MOD`, `ABS`, `POWER`, `SQRT`, `RAND`, `RANDBETWEEN`, `SUBTOTAL` |
| **Logical** | 9 | `IF`, `IFS`, `AND`, `OR`, `NOT`, `IFERROR`, `IFNA`, `SWITCH`, `CHOOSE` |
| **Lookup & Reference** | 8 | `INDEX`, `MATCH`, `XMATCH`, `XLOOKUP`, `VLOOKUP`, `HLOOKUP`, `OFFSET`, `INDIRECT` |
| **Dynamic Array** | 8 | `FILTER`, `SORT`, `SORTBY`, `UNIQUE`, `SEQUENCE`, `TRANSPOSE`, `TAKE`, `DROP` |
| **Text** | 16 | `TEXT`, `VALUE`, `LEFT`, `RIGHT`, `MID`, `LEN`, `TRIM`, `SUBSTITUTE`, `REPLACE`, `CONCAT`, `TEXTJOIN`, `FIND`, `SEARCH`, `UPPER`, `LOWER`, `PROPER` |
| **Date & Time** | 10 | `TODAY`, `NOW`, `DATE`, `YEAR`, `MONTH`, `DAY`, `EDATE`, `EOMONTH`, `NETWORKDAYS`, `WORKDAY` |
| **Financial** | 5 | `PMT`, `PV`, `FV`, `NPV`, `IRR` |
| **Statistical** | 8 | `STDEV.S`, `STDEV.P`, `VAR.S`, `VAR.P`, `MEDIAN`, `LARGE`, `SMALL`, `RANK.EQ` |
| **Bindings & Closures** | 2 | `LET`, `LAMBDA` |

For parameter signatures, criteria wildcard syntax, and error conditions, see the [Formula Compatibility Guide](file:///workspaces/excellence-chart/docs/formula-compatibility.md).

---

## Development Setup

### Prerequisites
- **Rust**: 1.80+ (`rustc`, `cargo`, `wasm-pack`)
- **Node.js**: 22+ (`node`, `npm`)

### 1. Build the Rust Engine & WASM Package
```bash
# Run Rust workspace unit and integration tests
cargo test --workspace

# Compile WASM bindings for the Web Worker
wasm-pack build crates/openexcel-wasm --target web --release --out-dir ../../packages/formula-wasm
```

### 2. Install Dependencies & Run Development Server
```bash
# Install workspace dependencies
npm ci

# Start Vite development server
npm run dev
```

Open **`http://localhost:5173`**. The Vite development server proxies backend requests to `http://localhost:3001`.

### 3. Build Full Production Distribution
```bash
# Build all TypeScript packages, Web UI, and Rust binaries
npm run build
```

---

## Verification & Testing

OpenExcel employs a 4-tier verification hierarchy ensuring zero regressions, arithmetic correctness, and resilience against adversarial workloads:

```bash
# Tier 1: Rust Engine, Functions, and Adversarial Tests (48/48 PASS)
cargo test --workspace

# Tier 2: TypeScript Models, Formula, Interop, and Pipeline Tests (423/423 PASS)
npm test

# Tier 3: Automated 100k-Cell Throughput and Memory Benchmark
npm run benchmark

# Tier 4: End-to-End Browser Automation Suite (Playwright)
npm run test:e2e
```

### Test Suite Summary

| Test Suite | Location | Tests | Status |
|---|---|:---:|:---:|
| **Rust Core Unit Tests** | [`crates/openexcel-core/src/`](file:///workspaces/excellence-chart/crates/openexcel-core) | 12 | **PASS** |
| **Rust Engine Recalculation** | [`crates/openexcel-core/tests/engine_tests.rs`](file:///workspaces/excellence-chart/crates/openexcel-core/tests/engine_tests.rs) | 8 | **PASS** |
| **Rust Function Oracles** | [`crates/openexcel-core/tests/function_tests.rs`](file:///workspaces/excellence-chart/crates/openexcel-core/tests/function_tests.rs) | 4 | **PASS** |
| **Rust Adversarial Gates** | [`crates/openexcel-core/tests/adversarial_*.rs`](file:///workspaces/excellence-chart/crates/openexcel-core/tests/adversarial_tests.rs) | 13 | **PASS** |
| **Rust Desktop & Storage** | [`crates/openexcel-desktop/tests/`](file:///workspaces/excellence-chart/crates/openexcel-desktop/tests) | 10 | **PASS** |
| **Rust WASM Engine** | [`crates/openexcel-wasm/tests/`](file:///workspaces/excellence-chart/crates/openexcel-wasm/tests) | 7 | **PASS** |
| **TypeScript Test Suites** | [`packages/*/test/`](file:///workspaces/excellence-chart/packages), [`tests/`](file:///workspaces/excellence-chart/tests) | 423 | **PASS** |
| **Total Automated Tests** | Workspace-wide | **477+** | **100% PASS** |

---

## Performance Benchmarks

Measured on an AMD EPYC 7763 64-Core Processor (Linux 6.8, Node 22):

| Benchmark Operation | Scale | Time | Memory (RSS) |
|---|:---:|:---:|:---:|
| **Construct Authored Cells** | 200,000 cells | 231.5 ms | 201.8 MB |
| **Cold Recalculation** | 100,000 dependent formulas | 1,623.8 ms | 379.3 MB |
| **Incremental Single-Cell Update** | 100,000 dependent formulas | **1.34 ms** | 379.4 MB |
| **Read Cached Results** | 100,000 results | 64.8 ms | 381.7 MB |
| **Sparse Tile Construction** | 1,000,000 cells | 1,375.6 ms | 536.6 MB |
| **XLSX Challenge Workbook Export** | 6 sheets, formats & charts | 116.9 ms | 659.3 MB |
| **XLSX 10k Cells Export** | 10,000 cells (formulas + values) | 557.3 ms | 749.8 MB |
| **XLSX 10k Cells Import/Parse** | 10,000 cells | 934.1 ms | 785.8 MB |

---

## Architectural Documentation

For deep technical specifications, consult the dedicated guides in [`docs/`](file:///workspaces/excellence-chart/docs):

- **[Architecture Guide](file:///workspaces/excellence-chart/docs/architecture.md)**: Details the Pratt precedence parser, sparse 128×32 cell chunk storage, 256-row spatial indexing DAG, cycle detection stack, and dynamic array spill collision manager.
- **[Runtime Architecture](file:///workspaces/excellence-chart/docs/runtime-architecture.md)**: Details the dual-target execution topology, Web Worker message passing protocols, and SQLite WAL optimistic locking semantics.
- **[Formula Compatibility](file:///workspaces/excellence-chart/docs/formula-compatibility.md)**: Full 88-function matrix, arity requirements, criteria syntax, and Lotus 1-2-3 / Excel 1900 date system quirks.
- **[Interface Contracts](file:///workspaces/excellence-chart/docs/contracts.md)**: Type-safe contracts between the Rust core engine, WASM Web Worker bridge, Node.js API server, and React UI.
- **[Testing Strategy](file:///workspaces/excellence-chart/docs/testing.md)**: Complete guide to the 4-tier verification hierarchy and adversarial validation suites.
- **[Benchmarks Guide](file:///workspaces/excellence-chart/docs/benchmarks.md)**: Profiling methodologies, memory accounting rules, and reproducible benchmark commands.
- **[Interoperability Guide](file:///workspaces/excellence-chart/docs/interoperability.md)**: XLSX, CSV/TSV, and native `.openexcel` schema specifications and compatibility tests.

---

## License

This project is dual-licensed under either:

- Apache License, Version 2.0 ([LICENSE-APACHE](http://www.apache.org/licenses/LICENSE-2.0))
- MIT License ([LICENSE-MIT](http://opensource.org/licenses/MIT))

at your option.
