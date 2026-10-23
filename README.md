# OpenExcel

A runnable TypeScript spreadsheet application with a custom calculation engine,
virtualized React grid, SQLite persistence, live SVG charts and XLSX/CSV exchange.
This is an implemented subset of the requested Excel alternative. Read the
[implementation ledger](docs/implementation-status.md) for remaining gaps.

## Run locally

Requires Node.js **24 or later** and npm. No account or external database is required.

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port 3001 and stores its SQLite database
in `.data/` by default. `PORT`, `WEB_PORT`, and `DATA_DIR` override these defaults.
Autosave and the Save button use the same persistence service; save errors remain
visible and local edits stay in memory.

## Production

```bash
npm run build
npm start
```

Open **http://127.0.0.1:3001**. The server hosts the built frontend and API together.
For a container deployment:

```bash
docker compose up --build
```

Compose publishes port 3001 and stores data in the `openexcel-data` named volume.
The server is designed for a local/trusted deployment; authentication and public
multi-tenant operation are not implemented.

## Use

- Click a cell and type, or enter a value/formula in the formula bar and press Enter.
- Use arrow keys, Tab, Enter, F2 and Delete; Shift extends the selection.
- Enter an address or rectangular range in the name box. `XFD1048576` reaches the
  last address without allocating an entire worksheet.
- Home contains formatting, clipboard and undo/redo commands. Other ribbon tabs
  expose implemented worksheet, data, chart, view and review operations.
- File imports XLSX/CSV/TSV and exports XLSX or CSV. Interoperability notices report
  unsupported representations. Native OpenExcel objects can survive its private
  XLSX metadata extension even where standard Excel objects are not emitted.
- Import `examples/Excel_Compatibility_Challenge.xlsx` to explore a six-sheet
  financial model, lookup and array formulas, charts, formatting, analysis and errors.

## Verify and measure

```bash
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npm run samples
npm run benchmark
```

Playwright launches the real HTTP API and production frontend on port 3018. Its workflows
exercise editing, formulas, formatting, charts, persistence and XLSX exchange. The
performance case populates 100,000 cells and records animation-frame timings and
mounted cell counts. Test data goes under `.openexcel/e2e/`.

Node benchmark source is in `benchmarks/run.ts`; raw runtime/hardware/timing/memory
results are written to `artifacts/benchmark.json`. Browser results are in
`artifacts/browser-benchmark.json`. These are environment-specific observations,
not guarantees for every machine. Generated screenshots are in `artifacts/`.

## Source layout

| Path | Responsibility |
| --- | --- |
| `packages/model` | Sparse tiles, schemas, transactions, undo and workbook objects |
| `packages/formula` | Custom syntax, evaluation, function library, dependencies and cache |
| `packages/formatting` | Style translation and supported display formats |
| `packages/data` | Sort, deduplication, split, pivot aggregation and Goal Seek |
| `packages/interop` | XLSX/CSV/TSV conversion and file resource limits |
| `apps/server` | SQLite, versioned saves, HTTP API and conversion workers |
| `apps/web` | React grid, ribbon, charts and calculation Web Worker |

See [runtime architecture](docs/runtime-architecture.md),
[formula compatibility](docs/formula-compatibility.md),
[roadmap](docs/roadmap-current.md) and the [status ledger](docs/implementation-status.md).
ExcelJS is used for file interoperability; formula calculation is implemented here.
