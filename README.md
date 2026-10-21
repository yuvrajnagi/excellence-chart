# OpenExcel

OpenExcel is a local-first, TypeScript spreadsheet application with a sparse workbook model, custom formula parser/evaluator, React grid UI, chart definitions, and XLSX/CSV interoperability.

## Quick start

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The API listens on `http://127.0.0.1:3001` and persists the current workbook under `.data/`.

Production build and checks:

```bash
npm run typecheck
npm test
npm run build
```

Docker:

```bash
docker compose up --build
```

## Repository layout

- `packages/model`: sparse workbook schema, transactions, coordinates, history, filters, and validation.
- `packages/formula`: parser, AST, safe evaluator, built-in functions, reference adjustment, and calculation worker support.
- `packages/formatting`: style and conditional-formatting helpers.
- `packages/data`: sorting, filtering, duplicate handling, validation, and table operations.
- `packages/interop`: XLSX/CSV import and export with input/resource limits.
- `apps/web`: React + Vite spreadsheet UI and SVG chart renderer.
- `apps/server`: Node HTTP API and durable JSON persistence.

## Compatibility and limitations

The calculation engine is independent of ExcelJS and never evaluates JavaScript from workbook content. Supported formulas and interoperability behavior are covered by `tests/compatibility` and package tests. Unsupported Excel features are reported as compatibility issues rather than silently claimed as compatible.

The current release is an actively usable foundation, not a claim of complete Microsoft Excel parity. Advanced pivot-table editing, full multi-range selection UX, and some dynamic-array/lambda semantics remain incomplete and are tracked in `docs/implementation-status.md`. Performance numbers are produced only by the benchmark command when benchmark fixtures are present; no synthetic results are published.
