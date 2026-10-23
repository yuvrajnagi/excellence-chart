# Implemented runtime architecture

This document describes the executable repository. The original `contracts.md` and
`architecture.md` include a broader design; they are not evidence that every planned
API or feature has been delivered. The acceptance ledger is `implementation-status.md`.

## Boundaries

- **model** defines immutable sparse tiles, workbook metadata, styles and worksheet
  objects. Coordinates are zero based internally and A1 at the user boundary. A tile
  has 128 rows × 32 columns; only authored cells occupy storage. Transactions produce
  inverse patches for undo. Zod validates external data and transaction results.
- **formula** contains a custom lexer/parser, AST evaluator, function registry,
  dependency indexes and result cache. It never compiles workbook text to JavaScript.
  Dates are serial numbers. Reverse dependencies invalidate affected results; range
  dependencies use row buckets. Dynamic arrays own spill cells without persisting
  spill children as authored values. Tests describe the supported formula dialect.
- **formatting** translates stored styles to CSS and interprets supported numeric and
  date display formats. This is a restricted grammar, not the full Excel format engine.
- **data** provides bounded pure operations returning cell patches: stable sorts,
  duplicate removal and delimited splitting. Pivot aggregation and secant Goal Seek
  are separate numerical helpers. UI exposure is tracked independently.
- **interop** reads/writes XLSX using ExcelJS and CSV/TSV with explicit quoting. ZIP
  limits and XML checks run before workbook conversion. Native OpenExcel metadata is
  stored as a private XLSX part, allowing richer OpenExcel round trips than generic
  Excel import. Export warnings distinguish standard OOXML output from private data.
- **server** uses Node HTTP and SQLite WAL. Workbook snapshots, optimistic storage
  versions and save receipts are transactional. File conversion/calculation runs in
  bounded worker threads. The server also hosts the production web build.
- **web** is React/Vite with a custom DOM grid. Only viewport cells are mounted. Sparse
  axis overrides support hidden/resized rows and columns. Scaled scroll coordinates
  stay below browser element-size limits while reaching XFD1048576. A dedicated Web
  Worker calculates cell values. Autosave queues snapshots and reports save failures.

## Update path

1. An edit produces authored patches, validated by the model.
2. A new immutable workbook revision updates the viewport and history.
3. The calculation worker receives a changed workbook, invalidates dependent cached
   values and supplies visible/chart values. Scrolling requests values without sending
   another complete workbook.
4. Autosave persists a snapshot using the last acknowledged storage version.
5. A conflicting storage version produces an error; the client retains its local edit.

## Resource and deployment choices

The application is intended for a local/trusted single-user deployment. It has no
external identity service and no telemetry. It is not a hardened public multi-tenant
service. SQLite is the chosen persistence engine; Node 24 supplies `node:sqlite`.

Sparse storage makes an empty theoretical grid inexpensive. It does not eliminate
snapshot costs: edits validate workbook state and the browser transfers changed
snapshots to its worker. Those paths remain scalability limitations. Published
benchmarks separate Node model/calculation measurements from browser scroll timings.

The production process can be launched with `npm start` after a build or through
Docker Compose. SQLite data belongs on a persistent local volume; do not share the
same SQLite file across unrelated hosts through a network filesystem.
