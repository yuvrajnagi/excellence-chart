# File interoperability and persistence

`packages/interop` uses ExcelJS for OOXML cell/style parsing and writing. Calculation is performed by OpenExcel's own formula engine. It does not execute formula text as JavaScript.

## Supported XLSX subset

Values, formula source and cached results, sheet names/order, font family/size/bold/italic/underline/color, solid fills, supported cell border styles, alignment, wrapping, rotation, number formats, row heights, column widths, visibility, merges and frozen panes are emitted as standard Excel features. Color scales, formula conditions, data bars and icon sets are emitted as conditional formatting; custom icons map to 3Arrows, and stop-if-true remains private metadata.

Line, area, column, bar, scatter, pie and donut charts are emitted as standard DrawingML charts with live range references and cached points. Native axes are basic; secondary axes and advanced styling are omitted. Histogram and combo charts remain in the OpenExcel extension and report a conversion warning. Formula errors unsupported by Excel's cached-value schema map to `#VALUE!` in the native cache. Formula source remains intact.

Every XLSX export includes `openexcel/workbook.json`. OpenExcel restores its chart definitions, pivots, table and validation definitions, conditional rules, names and view configuration from this validated extension on reimport. Third-party editors can remove this extension. Pivots export their current output cells but do not become native Excel pivot-cache objects. Dynamic arrays retain anchor formulas and require recalculation by a compatible Excel version; a native dynamic-array spill metadata definition is not emitted.

External XLSX import reads cell values, formulas, basic styles and dimensions. External charts, pivot definitions, conditional formatting, validations, defined names and tables are not reconstructed and generate a warning. Native chart export has automated OOXML part and relationship checks and ExcelJS reload coverage; desktop Microsoft Excel has not been available for validation.

## CSV and TSV

Quoted fields, embedded newlines, doubled quotes and CRLF are supported. Import treats formula-looking text as literal unless formula import is explicitly enabled. Export uses calculated values and quotes all fields; the default escape option prefixes formula-like string values with an apostrophe. Formulas are never evaluated by the CSV serializer.

## Resource limits

HTTP JSON snapshots are bounded at 128 MiB to permit the measured million-cell sparse snapshot. File import is bounded separately at 32 MiB compressed input, 128 MiB expanded ZIP content, 10,000 ZIP entries and a 1,000:1 per-entry expansion ratio. ZIP traversal, duplicate entries, XML entities/DOCTYPE and external relationships are rejected. Model schema and authored-cell limits apply after decoding. Native chart series have a 100,000-point cap. Server file jobs run in workers with a 512 MiB heap budget and 30-second deadline; only one import/export job runs at a time.

SQLite snapshots use WAL and FULL synchronous writes. A save checks the expected storage version and records the snapshot plus retry receipt in one immediate transaction. Concurrent stale saves return HTTP 409; retries of the same save ID and snapshot return the original receipt. The 100 most recent receipts per workbook are retained. Five download results are held for up to five minutes. No external account or telemetry is required.

## Verification

Run `npm test -- packages/interop/test apps/server/test`. Tests cover malformed input, formula-safe CSV, XLSX value/style/formula and advanced metadata round trips, standard chart parts, conditional formatting, multiple sheets, SQLite persistence across connections, concurrent save conflicts, durable retry receipts, invalid origins and worker import/export. Run `npm run samples` to regenerate `examples/Excel_Compatibility_Challenge.xlsx` and its conversion warning report.
