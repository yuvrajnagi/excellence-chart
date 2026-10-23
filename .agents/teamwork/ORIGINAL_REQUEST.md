# Original User Request

## 2026-10-23T05:57:54Z

Build "OpenExcel," a genuinely usable, full-featured spreadsheet application inspired by Microsoft Excel. It must include a virtualized spreadsheet UI, a custom formula calculation engine (lexer/parser/AST/dependency graph), workbook management, cell formatting, interactive charts, data tools (sorting, filtering, pivot tables), XLSX import/export, and persistent storage. This is a complete software engineering project — not a demo or mockup.

Working directory: /workspaces/excellence-chart
Integrity mode: development

There is existing code in the working directory from a prior agent run. Inspect what exists, assess its quality, and build on top of it — do not start from scratch. Fix issues, fill gaps, add missing features, and make the application genuinely runnable and tested.

## Requirements

### R1. Interactive Spreadsheet UI
A polished, Excel-inspired desktop-style spreadsheet interface with: ribbon toolbar, formula bar, virtualized grid (1M+ rows, 16K+ columns), cell selection (single, range, discontiguous), mouse and keyboard navigation, copy/cut/paste, fill handle with series inference, undo/redo, column/row operations (insert, delete, hide, resize, group), freeze panes, merge cells, context menus, sheet tabs (create/delete/rename/reorder/duplicate/color), zoom, find & replace, and standard keyboard shortcuts.

### R2. Custom Formula Calculation Engine
A from-scratch formula engine with: lexer, parser, AST, operator precedence, cell/range references (relative, absolute, mixed, cross-sheet), named ranges, error propagation, dependency graph with topological recalculation, circular reference detection, incremental recomputation, volatile functions, array formulas with dynamic spill, and cached results. Must implement a comprehensive function library including: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTIF, COUNTIFS, SUMIF, SUMIFS, AVERAGEIF, IF, IFS, AND, OR, NOT, IFERROR, IFNA, SWITCH, LET, LAMBDA, INDEX, MATCH, XMATCH, XLOOKUP, VLOOKUP, HLOOKUP, FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TRANSPOSE, TAKE, DROP, CHOOSE, OFFSET, INDIRECT, TEXT, VALUE, LEFT, RIGHT, MID, LEN, TRIM, SUBSTITUTE, REPLACE, CONCAT, TEXTJOIN, FIND, SEARCH, UPPER, LOWER, PROPER, ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, POWER, SQRT, RAND, RANDBETWEEN, TODAY, NOW, DATE, YEAR, MONTH, DAY, EDATE, EOMONTH, NETWORKDAYS, WORKDAY, PMT, PV, FV, NPV, IRR, STDEV.S, STDEV.P, VAR.S, VAR.P, MEDIAN, LARGE, SMALL, RANK.EQ, and SUBTOTAL.

### R3. Formatting, Data Tools, Charts & Persistence
Cell formatting (fonts, colors, borders, alignment, number formats, conditional formatting). Data tools (sorting, autofilter, data validation, tables, pivot tables, CSV import/export). Interactive charts (line, bar, column, scatter, pie, donut, area, histogram, combo) that update when underlying data changes. Workbook persistence with autosave, XLSX import/export, and recoverable save failures. Multiple workbooks and worksheets.

### R4. Quality, Testing & Documentation
Comprehensive test suites (unit, integration, e2e with Playwright). A test workbook "Excel_Compatibility_Challenge.xlsx" exercising cross-sheet references, dynamic arrays, lookups, conditional formatting, charts, and deliberate errors. Performance benchmarks with measured results. README with setup instructions, Docker Compose, architecture docs, and honest implementation status report.

## Acceptance Criteria

### Runnable Application
- [ ] `npm install && npm run dev` (or equivalent single command) starts the application
- [ ] The spreadsheet UI loads in a browser and cells can be edited by clicking and typing

### Formula Engine
- [ ] Unit tests pass for all listed formula functions (SUM through SUBTOTAL)
- [ ] Formulas with cell references recalculate when dependencies change
- [ ] Circular reference detection produces an error rather than hanging
- [ ] Cross-sheet references (e.g., `=Sheet2!A1`) resolve correctly
- [ ] Array formulas spill results into adjacent cells

### UI Functionality
- [ ] Scrolling through 100,000+ rows remains responsive (no freeze >500ms)
- [ ] Copy/paste moves cell values and formulas between cells
- [ ] Undo/redo reverses and reapplies at least value edits and formatting changes
- [ ] Find & replace locates and substitutes text across the active sheet

### Persistence & File I/O
- [ ] A workbook can be saved, the page reloaded, and all data/formulas/formatting restored
- [ ] An XLSX file can be exported and re-imported with cell values and formulas preserved
- [ ] CSV import and export works for flat data

### Charts
- [ ] At least 3 chart types render from worksheet data
- [ ] Changing a cell value that a chart references causes the chart to update

### Testing
- [ ] `npm test` runs a test suite with >50 passing tests covering formula parsing, dependency graph, recalculation, formatting, and persistence
- [ ] At least one Playwright e2e test launches the app, enters data, writes a formula, and verifies the calculated result

### Documentation
- [ ] README documents installation, startup, and available commands
- [ ] An honest status report lists what is implemented vs. incomplete
