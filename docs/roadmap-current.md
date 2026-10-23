# OpenExcel implementation roadmap

1. **Foundation:** sparse model, runtime schemas, immutable transactions and undo.
2. **Calculation:** safe parsing/evaluation, function compatibility tests, reverse
   dependencies, incremental cache invalidation, circular references and spill ranges.
3. **Application:** custom virtual viewport, keyboard editing, formula bar, formatting,
   sheet operations, live chart views, calculation worker and data commands.
4. **Persistence/interoperability:** SQLite snapshots and save versions, import/export
   workers, CSV injection handling, XLSX native subset and explicit loss reports.
5. **Acceptance:** six-sheet challenge workbook, browser workflows, regression tests,
   screenshots and reproducible 100K/1M benchmarks.
6. **Remaining completion work:** use the final implementation ledger to address gaps
   in advanced Excel semantics, uncommon formatting, tables, accessibility and large
   operations. Passing subset tests does not establish full Excel equivalence.

Decisions: preserve the existing TypeScript monorepo and model; implement the formula
engine independently; use SQLite rather than a service dependency; keep sparse DOM
virtualization and worker calculation; report unsupported OOXML features explicitly.
