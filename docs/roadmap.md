# OpenExcel dependency-ordered implementation roadmap

Status: executable handoff, 2026-10-20. The architecture/contracts are the foundation deliverable; application implementation is not complete. No feature below is waived by staging it later. A stage is complete only after its evidence gate passes; no nonfunctional controls or fabricated measurements.

## Ownership and write scopes

Owner labels denote one active writer, not a request to create seven simultaneous sessions. An owner may work in several stages, but no second owner edits its paths concurrently. Every test/fixture belongs to the package that owns the behavior. The lead integrates exports/configuration and commits verified increments; child owners do not commit.

| Owner | Exclusive write scope | Read/import dependencies | Required handoff |
| --- | --- | --- | --- |
| FOUNDATION | Root `package.json`, `package-lock.json`, `tsconfig*.json`, `vitest.config.*`, `playwright.config.*`, `.gitignore`, `scripts/**`, `.github/**`, `Dockerfile`, `compose.yaml`, `.dockerignore`, `README.md` | All public contracts; no package-source edits | Reproducible scripts, build graph, isolation/cleanup, startup readiness, locked dependencies |
| MODEL | `packages/model/**` | None | All model/API schemas, immutable transactions/history, public exports |
| FORMAT | `packages/formatting/**` | model | Number/date formatting and appearance readers, TEXT-compatible fixtures |
| FORMULA | `packages/formula/**` | model, formatting | Syntax, rewrite planner, full function registry, engine, calculation evidence |
| DATA | `packages/data/**` | model, formula | Data planners, filters/pivots, charts projection, sandboxed Goal Seek |
| INTEROP | `packages/interop/**` | model | Safe XLSX/CSV/TSV adapter, OOXML supplements, compatibility report/fixtures |
| SERVER | `apps/server/**` | model, formula, interop | SQLite worker, HTTP routes, save/recovery/download tests |
| WEB | `apps/web/**` | model, formatting, formula, data | Worker coordinator, real grid/editor, all UI features, app integration tests |
| ACCEPTANCE | `tests/e2e/**`, `benchmarks/**`, `samples/**`, `evidence/acceptance/**`, `evidence/benchmarks/**`, `evidence/screenshots/**` | Public package APIs and real app; no package/source edits | Real-browser journeys, sample generation, measured workloads and reports |
| DOCUMENTATION | `docs/**`, `evidence/foundation/architecture.md` | Read all evidence | Architecture/contract changes coordinated before consumers; compatibility/status/deployment docs |

During this foundation task, DOCUMENTATION writes only the four requested files. Other evidence paths are future ownership, not permission to create them now. `openexcellence-prompt` and `.omo/drafts/openexcel.md` are preserved user work and are not assigned to any writer.

Package owners own their package manifests but send dependency additions to FOUNDATION, the sole lockfile writer. Shared type/API changes are proposed to MODEL and DOCUMENTATION, applied once by the owner, then consumed downstream. A consumer never adds a private duplicate of a shared interface. New files outside these scopes require explicit reassignment by the lead before editing.

Before fan-out the lead records the one person/session assigned to each owner label. Labels can be reassigned only after the former writer stops; `packages/formula/syntax` and `packages/formula/functions` are subpaths of FORMULA, not independent package owners. DOCUMENTATION owns the normative contracts, MODEL implements shared schemas, and a downstream owner reports a discrepancy rather than patching either upstream scope. Foundation creates only root orchestration; package directory/manifests remain owned by their single package writer.

## Build and implementation DAG

```text
F0 foundation/toolchain
  -> M1 model and frozen API schema
       -> F2 formatting ---------+
       -> I2 interoperability --+|
       -> Q2 syntax/model-only  ||   (same FORMULA owner)
                    F2 + Q2 -> Q3 complete engine/function registry
                                      -> D4 data/pivots/charts projection
                         I2 + Q3      -> S4 persistence and file API
                   M1 -> W2 grid/editor shell (same WEB owner)
        W2 + F2 + Q3 + D4 + S4 -> W5 complete app integration
        W5 + I2 + Q3 -> A6 acceptance/compatibility
        A6 -> P7 measured performance/security/deployment
        P7 -> R8 final evidence and delivery
```

Build order is `model`, then `formatting` and `interop`, then `formula`, then `data` and `server`, then `web`. Q2 and W2 may develop against already frozen interfaces without taking ownership of missing upstream implementation. They do not publish a runnable-app claim until Q3/S4 are real. There are no runtime stubs to satisfy an integration gate.

### F0 - foundation/toolchain

FOUNDATION establishes npm workspaces `packages/*`, `apps/*`, private package names exactly as contracts, ESM exports and project references. Use Node 24 with native SQLite, React/Vite, Vitest and Playwright. Pin resolved versions in one lockfile. TypeScript flags include strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax, noFallthroughCasesInSwitch and consistent casing. Build package JavaScript/declarations before consumers; no deep source aliases.

All named root scripts are mandatory:

```json
{
  "scripts": {
    "dev": "bash scripts/run.sh dev",
    "test": "bash scripts/run.sh test",
    "typecheck": "bash scripts/run.sh typecheck",
    "build": "bash scripts/run.sh build",
    "test:e2e": "bash scripts/run.sh test:e2e",
    "benchmark": "bash scripts/run.sh benchmark",
    "samples": "bash scripts/run.sh samples"
  }
}
```

| Script | Exact responsibility and downstream command |
| --- | --- |
| `npm run dev` | `scripts/dev.mjs` performs initial `tsc -b`, starts compiler watch, Node server watch and Vite, waits for actual server/Vite readiness, prints both origins and closes all owned children on exit. Defaults server 3001/web 5173; environment overrides supported; Vite proxies `/api` to server. |
| `npm run test` | `tsc -b --pretty false`, then `vitest run`; includes package and server integration tests, not Playwright or timing benchmarks. Arguments after `--` forward to Vitest. |
| `npm run typecheck` | `tsc -b --pretty false` across the project-reference DAG; emits incremental JS/declarations to workspace `dist/` as required by package exports, no bundling. No ignored diagnostics. |
| `npm run build` | `tsc -b --pretty false`, then `vite build --config apps/web/vite.config.ts`; produces package/server dist plus `apps/web/dist`; server serves that directory. |
| `npm run test:e2e` | Build, then `playwright test`; starts the real built server on port 0 with isolated SQLite and waits for its readiness event. No development-server reuse, mock API or persistent user database. |
| `npm run benchmark` | Build, then `node benchmarks/dist/run.js`; deterministic workload selection via `--suite scroll|formula|million|all --seed N --output PATH`; JSON raw samples plus Markdown summary. Default output under run root; caller-specified evidence directory retained. |
| `npm run samples` | Build, then `node samples/dist/generate.js`; writes `samples/generated/Excel_Compatibility_Challenge.xlsx`, native snapshot and expected-value manifest atomically after successful generation/validation. |

`scripts/run.sh` uses a fresh `mktemp -d` root for every invocation. Export `TMPDIR=$RUN_ROOT/tmp`, `NODE_COMPILE_CACHE=$RUN_ROOT/node-cache`, `BUN_RUNTIME_TRANSPILER_CACHE_PATH=$RUN_ROOT/bun-cache`, `npm_config_cache=$RUN_ROOT/npm-cache`, and create those directories before children. Assign every spawned child an owned temporary subroot and tracked PID. Trap EXIT/INT/TERM, close child processes/SQLite/workers/ports, remove only owned run roots, and print a receipt with run ID, exit code, process count and removed paths. Never delete shared caches, kill unrelated processes, or leave a fixed test DB/port. Runtime persistent data uses explicit `OPENEXCEL_DATA_DIR`, not TMPDIR; tests always override it.

Export environment contract: `HOST` (default 127.0.0.1), `PORT` (3001), `WEB_PORT` (5173 development only), `OPENEXCEL_DATA_DIR` (local `.openexcel/`), `OPENEXCEL_WEB_ROOT` (built web directory), `OPENEXCEL_ALLOWED_ORIGIN` (printed same-origin URL). Docker uses `/data`, port 3001 and binds explicitly to `0.0.0.0`. Startup prints a machine-readable `{event:"ready",origin}` only after migrations and listener readiness. Tests subscribe to that event before interacting.

Gate: fresh install/build of completed packages, root script dispatch checked, native SQLite smoke test, two concurrent isolated test invocations with cleanup receipts, import-boundary check. Only completed-package checks are claimed until the complete DAG exists.

### M1 - model and boundary schemas

Implement all model/API types and exact export paths from contracts first. Implement sparse tiles, A1 conversions, IDs, workbook creation and parsing, transaction inversion, history, style/object metadata and structural invariants. Include schemas for worker/API consumers without importing app code.

Gate: sparse last-grid-cell edit without full allocation; JSON round trips; no input mutation; 1,000 randomly generated valid edit/undo/redo sequences; rollback after an invalid patch; inverse patch order; style-only blank retention; 1900/1904 metadata; malformed coordinates/prototype keys; stable IDs; history budget behavior. Compile a fixture importing every model/API export.

### F2 / I2 / Q2 / W2 - independent initial tracks

**FORMAT:** Implement one number-format parser/evaluator, date serial conversions, styles/themes and conditional-format evaluation with injected readers. No Engine imports. Gate: custom sections/accounting/scientific/date/elapsed formats, fictitious serial 60, negative zero/rounding, conditional priorities and caching; shared TEXT fixtures ready for FORMULA.

**INTEROP:** Implement bounded ZIP/XML preflight, CSV/TSV streaming parsing, base XLSX cells/styles/names/validation/tables, import/export loss reports, OpenExcel extension and chart supplement. Interop tests supply explicit known calculation caches, never import formula. Gate: independent golden XLSX fixtures, numeric/formula/style round trips, multiline CSV, Unicode, malformed XML/ZIP, external links, path traversal, excessive expansion and unsupported features visibly reported.

**FORMULA Q2:** Lexer/parser, precedence, absolute/mixed/cross-sheet/structured/name references, AST printer and reference planner. Use MODEL fixtures, not a new workbook shape. Gate: token spans/diagnostics, round-trip parse-print semantics, copy vs cut distinctions, insert/delete range contraction, sheet rename/delete/duplicate, table header rename, errors and extreme bounds.

**WEB W2:** Real DOM virtualized grid, logical scrolling, keyboard selection/editing/IME, headers, tabs, formula bar and basic ribbon. Wire the real MODEL snapshot/service contract; temporary component test harnesses are tests, not advertised application functionality. Gate: reaching XFD1048576, bounded DOM count, high DPI/zoom, freeze panes, active descendant remains mounted, focus/selection at narrow and desktop widths.

### Q3 - complete calculation engine

FORMULA completes registry, all required functions, lexical LET/LAMBDA closures, lazy branches, active-read cycle detection, dynamic references, interval range dependencies, incremental cache, arrays/spills and scheduling. Consume FORMAT for TEXT/date conversion. Implement Engine.set planning/history, batches, snapshot and exact epoch semantics. Implement mutation of large ranges as one atomic commit.

Gate: every function in the contract matrix has compatibility tests with independent expected values; range dependency count stays proportional to referenced rectangles, not their area; untouched formulas do not recalculate; dynamic dependencies replace old edges; unused scalar/array lazy branches do not error; seeded RNG independent of scheduling; spill blocked/unblocked/shrink/undo cases; cancellation leaves no partial cache; structural undo restores formula text and all chart/pivot/name/table references. Verify planning the same edit twice yields identical IDs/patches, engine forks cannot mutate their parent, and scratch evaluate does not publish a completed calculation. Use randomized DAG formulas compared with a simple independent full-evaluation oracle for bounded arithmetic expressions.

### D4 / S4 - independent consumers

**DATA:** Stable sorts, filters, text splitting, duplicate tools, validation, tables, subtotal batch plans, pivot aggregations/refresh, copy/fill inference, chart projection and Goal Seek. Gate: stable ties, blanks/errors and hidden rows; table reference invalidation; pivot source/output overlap and stale tail cleanup; validation proposed-value handling; chart range changes and all nine kinds; cancellation/stale plans; Goal Seek never mutates the live engine, convergence and nonconvergence both tested.

**SERVER:** Repository worker, migrations, API schema parsing, optimistic SQLite save/receipt protocol, recent files, create/duplicate/delete, import preview and export artifacts. Gate: real temporary SQLite across restart; two clients' version conflict; lost-response retry with same save ID; mismatched payload reuse rejection; quota/disk/write failure visible; DB constraints; upload limits/expiry; export immutable version; parameterized queries; close/cleanup. No fake repository substitute for persistence tests.

### W5 - full app integration

WEB integrates real worker/calculation/API and finishes every requested UI flow:

* Home/Insert/Formulas/Data/Review/View/File tabs expose implemented commands only; actual dialogs/actions, no inert placeholders.
* Editing, discontiguous selection, rich clipboard payload + TSV fallback, cut/move, series fill, undo/redo, find/replace, context menus and familiar keyboard shortcuts.
* Row/column insert/delete/hide/resize/group, freeze, merge/unmerge, sheet create/delete/rename/reorder/duplicate/color, zoom and responsive keyboard-accessible focus.
* Fonts/fills/borders/alignment/wrap/rotation, number formats, styles/themes, painter and all conditional-rule kinds.
* Data tools, validations/dropdowns, structured tables, subtotal/pivot editors/refresh, what-if and accepted Goal Seek.
* Nine chart kinds with live ranges, titles, axes/legend/series editors, tooltips and resize/move, preserved through save/load.
* Multiple workbooks, recent files, autosave/manual save, recovery IndexedDB, conflict/save-as handling, XLSX/CSV/TSV import/export with loss acknowledgment.

Gate: worker messages correlate session/request/revision/epoch; edit during calculation cancels then commits; no same-revision stale chart/appearance overwrite; one undo per user operation; autosave never marks a newer revision saved; rejected validation retains edit text; error/loading/empty states; worker crash/cancel recovery preserves acknowledged cells and bounded history. Exercise clipboard copy/paste/cut after source revision changes, find/duplicate queries, cross-workbook relative references and worker-only calculation. Simulate a non-yielding calculation and assert termination/recovery using the cancellation acknowledgment and lifecycle events, not a fixed sleep. Drive the real app at desktop/mobile widths and verify no overlap, clipped editor or blank panes.

### A6 - compatibility challenge and real-browser acceptance

ACCEPTANCE builds `Excel_Compatibility_Challenge.xlsx` using actual public APIs and export adapter. Sheets must include a financial model with cross-sheet references, dynamic arrays, lookup tables, conditional formatting, pivot analysis, all chart categories, dates/custom formats, nested formulas/LET/LAMBDA, deliberate errors and cycles. Include expected values, expected warnings and a deterministic seed in a neighboring manifest.

Playwright launches the built app, creates a workbook, enters values/formulas, navigates distant cells, formats ranges, creates and edits a live chart, creates/refreshed pivot, tests undo, waits for save acknowledgment, restarts server, reloads, exports XLSX, imports it into a new workbook and checks visible results and preservation/loss reports. Add conflict, corrupt upload, spill-obstruction and keyboard accessibility journeys. Subscribe to downloads/responses/worker-ready/state changes before triggering actions; no fixed sleeps or polling-delay assertions.

Gate: clean unit/integration/property/E2E results; screenshots and traces of the real application; native snapshot round trip exact apart from documented server metadata; XLSX subset round trip checked against declared expected losses. A mismatch cannot be "fixed" by deleting or weakening an acceptance test.

### P7 - performance, reliability and deployment

ACCEPTANCE runs the three workload sizes from architecture, recording real samples/hardware and worker/main-thread breakdown. FOUNDATION adds reproducible Docker/Compose build and persistent volume; SERVER/WEB fix any in-scope lifecycle/security failures in their own scopes. Test graceful shutdown, request cancellation, malformed archives, content injection, strict CSP without unsafe-eval, origin enforcement and simulated save failures.

Gate: performance targets met on the recorded reference hardware, or explicit measured failure with workload/impact and an unfinished status. Browser remains interactive during large operations. A failed target is not silently changed. Compose survives a restart with the workbook intact. No network/account/telemetry requirement. Cleanup receipts identify all owned resources.

### R8 - delivery

DOCUMENTATION publishes actual status, formula compatibility matrix, XLSX limitations, benchmark evidence, screenshots, startup/deployment instructions and sample links. Lead independently verifies root scripts and the critical real-browser journey before committing the final increment. Every advertised feature maps to behavior/evidence; pending features remain marked incomplete and the product mission remains open.

## Requirement traceability

| Product requirement | Owner/stage | Acceptance evidence |
| --- | --- | --- |
| Part 1: all 20 UI items | WEB W2/W5 | Grid/keyboard/clipboard/structure/accessibility E2E and screenshots |
| Part 2: custom syntax/engine and every named function | FORMULA Q2/Q3 | Registry coverage, parser/rewrite/DAG/spill tests, compatibility matrix |
| Part 3: formatting including optional rich text | FORMAT F2 + WEB W5 + INTEROP I2 | Format/conditional fixtures and UI; rich-text flattening explicitly reported, editing optional |
| Part 4: sort/filter/split/dedup/validation/tables/subtotals/pivots/CSV/large data/what-if | DATA D4 + WEB W5 + INTEROP I2 | Operation tests, pivot/Goal Seek E2E, data benchmarks |
| Part 5: all nine editable live chart kinds | DATA D4 + WEB W5 + INTEROP I2 | Projection tests, range-update E2E, native persistence and XLSX loss fixtures |
| Part 6: workbook management/persistence/recovery | SERVER S4 + WEB W5 | SQLite restart/conflict tests and save/import/export E2E |
| Part 7: modular/sparse/worker/three performance workloads | All package owners + ACCEPTANCE P7 | Import-boundary check, allocation/recalc counts, measured benchmark reports |
| Part 8: safe formulas/uploads/schema/resources/recovery/no telemetry | FORMULA/INTEROP/SERVER/WEB | Security tests, limits and failure-path evidence |
| Part 9: unit/integration/regression/property/E2E | Each owner + ACCEPTANCE A6 | Actual Vitest/Playwright output, no mock-only app validation |
| Part 10: challenge workbook | ACCEPTANCE A6 | Generated XLSX/native/expected manifest and automated reload |
| Part 11: source/startup/build/Docker/docs/tests/benchmarks/screenshots/samples/status | FOUNDATION + DOCUMENTATION R8 | Root command receipts and artifact inventory |

## Bounded owner handoff

Each increment's handoff is at most 30 lines:

1. Owner, stage and exact changed paths.
2. Public contract version/exports implemented; any proposed contract change belongs to the contract owner, not an undocumented local workaround.
3. User-visible behaviors completed, with precise incomplete behaviors.
4. Commands run, exit codes and retained evidence paths; distinguish not run from failed.
5. Compatibility/performance findings, no claimed measurements without raw samples.
6. Owned process/cache/temp cleanup receipt.
7. Downstream owner unblocked and exact remaining dependency.

No request for a new plan or unresolved API decision is needed to begin F0/M1. Decisions are frozen by contracts; genuine implementation discoveries are addressed as explicit, coordinated contract revisions, never competing package interfaces.
