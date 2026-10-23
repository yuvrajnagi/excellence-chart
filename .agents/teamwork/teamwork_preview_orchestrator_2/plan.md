# Project Execution Plan — 6 Dedicated Agents Architecture

## Overview
Transform OpenExcel into a high-performance spreadsheet powered by a Rust core engine compiling to WASM (web worker) and Native Desktop (Tauri/native shell), with full Excel parity, 88 functions, virtualized editing, persistent storage, automated testing, and reproducible 100k-cell benchmarks.

## 6 Dedicated Agents Breakdown (User Mandate)
Per explicit User Directive, the project structure and execution are partitioned into exactly 6 distinct dedicated agents:

1. **Agent 1: Rust Core Calculation Engine**
   - Scope: Core data structures (sparse cell grid, 128x32 tiling, coordinate mapping), Pratt parser, AST, operator precedence, dependency graph with DFS stack cycle detection (`#CIRC!`), dynamic array spill mechanics (`#SPILL!`), and all 88 Excel standard functions.
   - Target: `crates/openexcel-core`, `cargo test`.

2. **Agent 2: WASM Target & Bindings**
   - Scope: `wasm32-unknown-unknown` compilation, `wasm-bindgen` / `tsify` type-safe JavaScript & TypeScript bindings, packaging for npm/workspace, Web Worker runtime integration (`calculation.worker.ts`), and non-blocking asynchronous recalculation.
   - Target: WASM package, web worker runtime.

3. **Agent 3: Desktop Shell & Persistence**
   - Scope: Native desktop shell (Tauri / desktop wrapper), native binary compilation, local file system I/O (open/save .openexcel / .xlsx), and SQLite database persistence with WAL mode and transaction integrity.
   - Target: `apps/desktop` / Tauri shell, SQLite persistence.

4. **Agent 4: UI Agent**
   - Scope: Exclusively UI capabilities — virtualized viewport rendering (1,048,576 rows x 16,384 columns), ribbon toolbar, formula bar synchronization, active-cell selection, multi-cell ranges, fill handle autofill with series inference, cell styling & conditional formatting, interactive charts (9 types), data tool dialogs (AutoFilter, sort, tables, validation), and WASM worker UI bindings.
   - Target: `apps/web`.

5. **Agent 5: Testing Agent**
   - Scope: Unit test suites (`cargo test`, Vitest), multi-module integration tests, compatibility suite (all 88 functions and edge cases), and Playwright E2E browser automation tests exercising full user flows (editing, formula calculation, file round-trips).
   - Target: `tests/`, Playwright E2E suite.

6. **Agent 6: Benchmarks Agent**
   - Scope: Performance benchmark harness, measuring throughput and responsiveness on 100,000+ dependent formula cells (sub-second target), latency profiling, memory consumption (RSS tracking), and XLSX import/export performance.
   - Target: `benchmarks/run.ts`, benchmark artifacts.

## Milestones & Workflow
- Phase 0: 6-Agent Dedicated Survey & Architecture Mapping.
- Phase 1: PROJECT.md, TEST_INFRA.md & Interface Contracts.
- Phase 2: Milestone Iteration Loops across the 6 dedicated tracks.
- Phase 3: Integrated Dual Track E2E Testing & 100k-cell Benchmark Validation.
- Phase 4: Final Verification, Integrity Forensics Audit & Delivery.
