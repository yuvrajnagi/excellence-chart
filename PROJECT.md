# Project: OpenExcel

## Architecture
OpenExcel is a modular, high-performance, Excel-compatible spreadsheet application with a multi-package architecture:
- `apps/web`: React 19 single-page application with DOM-virtualized grid supporting 1,048,576 rows x 16,384 columns, logarithmic coordinate lookup, ribbon toolbar, formula bar, sheet tabs, and Web Worker calculation engine offloading.
- `apps/server`: Node.js HTTP server backed by SQLite (WAL mode, `synchronous=FULL`, 5000ms timeout) providing atomic workbook storage, optimistic concurrency control (`If-Match` storage versioning), and idempotent save receipts.
- `packages/model`: Immutable spreadsheet document model based on sparse 128x64 tiles, reversible transactions, cell address mapping, and schema validation.
- `packages/formula`: From-scratch formula calculation engine with lexer, Pratt parser with operator precedence, AST, dependency graph with spatial range indexing, cycle detection returning `#CIRC!`, dynamic array spill logic returning `#SPILL!`, volatile function tracking, and all 88 Excel functions.
- `packages/formatting`: Number formatting grammar, currency/percent/date formatting, style-to-CSS mapper, and conditional formatting rules.
- `packages/data`: Data operations including stable multi-column sorting, AutoFilter hidden row computation, data validation, pivot table generation and refresh, Goal Seek, text-to-columns, and deduplication.
- `packages/interop`: Lossless XLSX import/export with embedded SHA-256 manifest, OOXML DrawingML chart generation, and RFC 4180 CSV/TSV import/export.

## Feature Inventory
Every feature identified from ORIGINAL_REQUEST.md and the survey phase:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Virtualized Grid | 1,048,576 rows x 16,384 columns responsive DOM virtualized grid with logarithmic prefix coordinate lookup | M1 / M2 | R1, Survey 1 |
| 2 | Cell Selection & Fill Handle | Single, range, discontiguous selection; fill handle anchored to selection corner with series inference | M2 | R1, Survey 1 |
| 3 | Formula Bar & In-Cell Editing | Formula bar sync, in-cell editor, reference highlighting | M2 | R1, Survey 1 |
| 4 | Keyboard & Mouse Navigation | Arrows, PageUp/Down, Home/End, Shift+Enter, Ctrl+Arrows edge navigation, shortcuts | M2 | R1, Survey 1 |
| 5 | Row & Column Operations | Insert/delete rows and columns, resize via mouse drag handles, hide/unhide rows and columns | M2 | R1, Survey 1 |
| 6 | Header Interactions | Click column/row/corner headers to select whole columns, rows, or sheet; right-click context menus | M2 | R1, Survey 1 |
| 7 | Freeze Panes & Merge Cells | Freeze top rows / left columns; merge ranges with proper scrolling occlusion handling | M2 | R1, Survey 1 |
| 8 | Find & Replace | Interactive floating dialog to find, locate/navigate matching cells, and replace across sheet | M2 | R1, Survey 1 |
| 9 | Sheet Tab Management | Create, delete, rename, duplicate, reorder tabs, and tab color customization | M2 | R1, Survey 1 |
| 10 | Context Menus & Ribbon Toolbar | Excel-style ribbon toolbar tabs (Home, Insert, Data, View) and cell/header context menus | M2 | R1, Survey 1 |
| 11 | Formula Lexer, Parser & AST | Pratt precedence parser, AST structure, round-trip pretty-printer, error literals | M1 / Verified | R2, Survey 2 |
| 12 | Formula References | Relative, absolute ($A$1), mixed, range, cross-sheet (`Sheet1!A1`), named ranges, table refs | M1 / Verified | R2, Survey 2 |
| 13 | Dependency Graph & Recalculation | Spatial range indexing, topological DFS stack sort, incremental recalculation (100k in ~1ms) | M1 / Verified | R2, Survey 2 |
| 14 | Cycle Detection & Dynamic Spills | Returns `#CIRC!` without hanging; matrix spill evaluation with `#SPILL!` collision handling | M1 / Verified | R2, Survey 2 |
| 15 | 88 Formula Functions Library | Complete implementations of SUM through SUBTOTAL with 265 test cases | M1 / Verified | R2, Survey 2 |
| 16 | Cell Formatting | Fonts, sizes, bold, italic, underline, fill colors, text colors, borders, alignment, number formats | M3 | R3, Survey 3 |
| 17 | Conditional Formatting | Color scales, data bars, icon sets, and formula rules | M3 | R3, Survey 3 |
| 18 | Data Tools | Multi-column sort, AutoFilter hidden rows, validation rules, tables, pivot tables, Goal Seek | M3 | R3, Survey 3 |
| 19 | Interactive Charts | All 9 chart types (line, bar, column, scatter, pie, donut, area, histogram, combo) with reactive updates | M3 | R3, Survey 3 |
| 20 | SQLite Persistence & Autosave | SQLite WAL storage, optimistic concurrency locking, debounced autosave, snapshot ID sync | M1 | R3, Survey 3 |
| 21 | XLSX & CSV Import/Export | Lossless XLSX round-trip with SHA-256 manifest, OOXML DrawingML charts, CSV import/export | M1 / M3 | R3, Survey 3 |
| 22 | Playwright E2E Test Suite | Automated end-to-end browser tests verifying editing, formula recalculation, persistence, performance | M1 / M4 | R4, Survey 1, 3 |
| 23 | Challenge Workbook & Benchmarks | Excel_Compatibility_Challenge.xlsx generation and automated benchmarks | M3 / M4 | R4, Survey 2, 3 |
| 24 | Documentation & Packaging | Comprehensive README, architecture docs, Docker Compose, implementation status report | M4 | R4 |

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Persistence & E2E Stability Core | Fix server snapshot ID preservation (`app.ts`) and client `App.tsx` persistence sync; verify Playwright E2E tests pass | none | DONE |
| M2 | UI Interactions & Grid Completeness | Implement row/column insert and delete with formula adjustment; header drag-resize; whole column/row selection; interactive Find & Replace dialog; sheet tab reorder & color picker; fill handle anchor fix | M1 | DONE |
| M3 | Data Tools, Integration & Quality Polish | Add full integration pipeline tests (`tests/integration/`); verify formatting, data tools, charts, table insert UI; verify challenge workbook and benchmarks | M1, M2 | IN_PROGRESS |
| M4 | Final Milestone: E2E Verification & Adversarial Hardening | Phase 1: 100% E2E test verification (Tiers 1-4); Phase 2: Adversarial coverage hardening (Tier 5); verify documentation, Docker Compose, and acceptance criteria | M3 | PLANNED |

## Interface Contracts

### Server API ↔ Client Persistence
- `POST /api/workbooks`:
  - Request: `{ kind: 'snapshot', name: string, workbook: Workbook }` or `{ kind: 'blank', name: string }`
  - Response: `{ workbook: Workbook, storageVersion: number }`
  - Contract: The server MUST preserve `workbook.id` when provided in snapshot requests instead of generating a new random ID, ensuring client and server maintain identity consistency across reloads.
- `PUT /api/workbooks/:id`:
  - Header: `If-Match: <storageVersion>`
  - Body: `{ workbook: Workbook, storageVersion: number }`
  - Response: `{ ok: true, storageVersion: number }` or HTTP 409 `VERSION_CONFLICT`

### Operations ↔ Model / Formula
- `insertRow(workbook: Workbook, sheetId: string, rowIndex: number, count?: number): Workbook`
  - Shifts all cells with `row >= rowIndex` down by `count`.
  - Adjusts formulas with `adjustFormulaReferences(formula, count, 0)` for cells below `rowIndex`.
- `deleteRow(workbook: Workbook, sheetId: string, rowIndex: number, count?: number): Workbook`
  - Removes cells in `rowIndex .. rowIndex + count - 1`.
  - Shifts subsequent cells up by `count`.
  - Replaces references to deleted cells with `#REF!`.
- `insertColumn(workbook: Workbook, sheetId: string, colIndex: number, count?: number): Workbook`
- `deleteColumn(workbook: Workbook, sheetId: string, colIndex: number, count?: number): Workbook`

### Web Viewport ↔ Calculation Worker
- Port: `calculation.worker.ts`
- Message `in`: `{ kind: 'calculate', workbook: Workbook, viewport: CellAddress[], chartRanges?: CellAddress[] }`
- Message `out`: `{ kind: 'calculated', values: Record<string, ComputedValue> }`

## Code Layout
- `apps/web/src/`:
  - `App.tsx`: Main application component, ribbon, formula bar, tabs, dialogs
  - `operations.ts`: Coordinate transformations, selection math, insert/delete row/col operations
  - `calculation.worker.ts`: Web Worker hosting `@openexcel/formula` engine
  - `Chart.tsx`: SVG rendering for all 9 chart types
  - `api.ts`: HTTP client for backend persistence
  - `styles.css`: Application styling
- `apps/server/src/`:
  - `app.ts`: HTTP request handlers and routing
  - `storage.ts`: SQLite database with WAL and transactions
- `packages/model/src/`:
  - `types.ts`, `schemas.ts`, `store.ts`, `coordinates.ts`, `filters.ts`
- `packages/formula/src/`:
  - `index.ts`, `syntax.ts`, `parser.ts`, `lexer.ts`, `functions.ts`, `ast.ts`
- `packages/formatting/src/`:
  - `index.ts`
- `packages/data/src/`:
  - `index.ts`
- `packages/interop/src/`:
  - `index.ts`, `charts.ts`
- `tests/`:
  - `compatibility/`: Formula engine and function compatibility tests
  - `e2e/`: Playwright end-to-end tests
  - `integration/`: Multi-module end-to-end pipeline integration tests
