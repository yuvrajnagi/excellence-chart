# OpenExcel implementation and acceptance ledger

This is a requirement ledger, not a feature announcement. **The application is not
implemented yet.** Architecture documents exist; no runnable application, passing
application tests, measured benchmarks, or functioning-app screenshots are claimed.
The task remains active. Change an entry only after recording its actual evidence.

Status vocabulary: **Pending**, **Implemented, unverified**, **Verified**, or
**Incomplete** with a concrete limitation. An unsupported XLSX representation is
distinct from an unimplemented native application feature.

## Interactive spreadsheet

| Requirement | Status | Intended proof |
| --- | --- | --- |
| File, Home, Insert, Formulas, Data, Review, View ribbon | Pending | Each exposed command performs its labeled operation |
| Editable formula bar and name box | Pending | Enter SUM, navigate to XFD1048576 |
| Column letters and row numbers | Pending | Correct absolute labels after scrolling |
| Horizontal and vertical scrolling | Pending | Real browser scroll and distant navigation |
| 1,048,576 rows and 16,384 columns, virtualized | Pending | Last cell editable; bounded mounted cell count |
| Active, rectangular and discontiguous selections | Pending | Pointer, Shift and Ctrl/Cmd selection journeys |
| Mouse and keyboard navigation | Pending | Arrow, Tab, Enter, Home, End, Page navigation |
| Multi-cell copy, cut and paste | Pending | Values, styles and relative formulas; cut target tracking |
| Fill handle and inferred series | Pending | Drag numeric/date series and formulas |
| Undo/redo values, formulas, styles, structure | Pending | Actual edits reverted and replayed |
| Row/column insertion and deletion | Pending | Formula reference contraction/shift and undo |
| Row/column hiding, resizing and grouping | Pending | Visible geometry, keyboard and saved state |
| Freeze panes | Pending | Headers/panes remain fixed during two-axis scrolling |
| Merge and unmerge | Pending | Bounds, conflict handling and undo |
| Context menus | Pending | Pointer and keyboard-opened commands |
| Sheet create/delete/rename/reorder/duplicate/color | Pending | Multi-sheet formulas and save/reload |
| Zoom controls | Pending | Grid/editor/selection geometry at multiple scales |
| Find and replace | Pending | Value/formula search and atomic replacement |
| Familiar shortcuts | Pending | Copy/paste, edit, undo/redo, find and clear |
| Responsive layout and accessible focus | Pending | Desktop/mobile captures, ARIA and keyboard |
| High DPI and smooth scrolling | Pending | DPR captures and measured scroll workload |

## Custom calculation engine

| Requirement | Status | Intended proof |
| --- | --- | --- |
| Lexer, parser, AST and precedence | Pending | Independent arithmetic/parser fixtures |
| Numeric, boolean, string and date values | Pending | Coercion and date-system fixtures |
| Cell/range, relative/absolute/mixed references | Pending | Copy/fill/splice and evaluation fixtures |
| Cross-sheet references and defined names | Pending | Financial workbook and name scope cases |
| Error propagation | Pending | Error type/value and lazy branch cases |
| Dependency graph and topological recalculation | Pending | DAG correctness and long-chain workload |
| Circular reference detection | Pending | Cycle members and unaffected neighbors |
| Incremental recomputation and cached values | Pending | Changed closure, untouched evaluation counts |
| Optimized range dependencies | Pending | Whole-column aggregate without per-cell graph edges |
| Reference adjustment during copy/fill/structure | Pending | Mixed axes, cut/move, deleted targets and undo |
| Volatility and scheduling | Pending | Fixed epochs, seeded random and dirty dependents |
| Arrays and dynamic spills | Pending | Obstruction, expansion, shrink and removal |
| Deterministic evaluation | Pending | Fixed seed/clock and scheduling-independent outputs |
| Safe non-JavaScript interpreter | Pending | Untrusted formula input cannot execute host code |

### Required function inventory

Every name is required. Entries remain Pending until normal, invalid-argument,
error, and relevant edge behavior is exercised with independent expected values.

| Family | Names | Status |
| --- | --- | --- |
| Aggregation | SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTIF, COUNTIFS, SUMIF, SUMIFS, AVERAGEIF | Pending |
| Logic | IF, IFS, AND, OR, NOT, IFERROR, IFNA, SWITCH | Pending |
| Bindings | LET, LAMBDA | Pending |
| Lookup | INDEX, MATCH, XMATCH, XLOOKUP, VLOOKUP, HLOOKUP | Pending |
| Arrays | FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TRANSPOSE, TAKE, DROP | Pending |
| Reference | CHOOSE, OFFSET, INDIRECT | Pending |
| Text | TEXT, VALUE, LEFT, RIGHT, MID, LEN, TRIM, SUBSTITUTE, REPLACE, CONCAT, TEXTJOIN, FIND, SEARCH, UPPER, LOWER, PROPER | Pending |
| Mathematics | ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, POWER, SQRT | Pending |
| Random | RAND, RANDBETWEEN | Pending |
| Dates | TODAY, NOW, DATE, YEAR, MONTH, DAY, EDATE, EOMONTH, NETWORKDAYS, WORKDAY | Pending |
| Finance | PMT, PV, FV, NPV, IRR | Pending |
| Statistics | STDEV.S, STDEV.P, VAR.S, VAR.P, MEDIAN, LARGE, SMALL, RANK.EQ | Pending |
| Visibility | SUBTOTAL | Pending |

Compatibility differences must be documented per supported behavior, not hidden
behind registry presence or a single happy-path example.

## Formatting

| Requirement | Status |
| --- | --- |
| Font family and size, bold, italic and underline | Pending |
| Text colors, background fills and borders | Pending |
| Horizontal/vertical alignment | Pending |
| Wrap and rotation | Pending |
| Numeric, percentage, currency and accounting formats | Pending |
| Scientific and date formats | Pending |
| Custom number-format grammar | Pending |
| Format painter | Pending |
| Conditional color scales | Pending |
| Conditional data bars and icons | Pending |
| Formula-based conditional formatting | Pending |
| Cell styles and themes | Pending |
| Persisted row heights and column widths | Pending |
| Rich-text cells | Optional; not implemented |

## Data tools

| Requirement | Status | Intended proof |
| --- | --- | --- |
| Ascending/descending and multi-column sort | Pending | Stable ties, formulas, blanks/errors |
| AutoFilter | Pending | Visibility and SUBTOTAL update |
| Text-to-columns | Pending | Quoting, delimiters and overwrite handling |
| Duplicate detection/removal | Pending | Selected columns and tail clearing |
| Validation dropdowns and custom rules | Pending | Accepted/rejected edits and visible feedback |
| Tables and structured references | Pending | Header rename, data growth and totals |
| Subtotals | Pending | Grouped materialization and one-step undo |
| Pivot rows, columns, aggregation and filtering | Pending | Known totals and dimensional layout |
| Pivot refresh | Pending | Changed source and stale tail cleanup |
| CSV and TSV import/export | Pending | Multiline/Unicode round trip and injection policy |
| Large data operations | Pending | Worker progress/cancel and browser responsiveness |
| What-if analysis | Pending | Isolated comparison, unchanged original |
| Goal Seek | Pending | Convergence/nonconvergence and explicit acceptance |

## Live editable charts

All charts require live source ranges, data-change updates, titles, legends,
axes as applicable, series configuration, formatting and native save/load.

| Kind | Status |
| --- | --- |
| Line | Pending |
| Area | Pending |
| Column | Pending |
| Bar | Pending |
| Scatter | Pending |
| Pie | Pending |
| Donut | Pending |
| Histogram | Pending |
| Combo | Pending |

## Workbook services and interoperability

| Requirement | Status | Intended proof |
| --- | --- | --- |
| Multiple workbooks and sheets | Pending | Separate documents and cross-sheet calculations |
| Autosave and manual save | Pending | Acknowledged revision survives reload |
| Recent files | Pending | Actual persisted list/order |
| XLSX import/export | Pending | Supported feature round trips and loss reports |
| CSV import/export | Pending | Explicit sheet and safe formula-like text |
| Persisted sheet state and formatting/formulas | Pending | Restart/reload comparisons |
| Workbook metadata | Pending | Name/author/description/date system preserved |
| Recoverable save failures | Pending | Failure does not discard local state |
| Transactional persistence | Pending | SQLite atomicity and save-version conflicts |
| Untrusted-file limits and validation | Pending | Corrupt/oversized/malformed archive rejection |

## Engineering and delivery

| Requirement | Status | Required artifact |
| --- | --- | --- |
| Modular TypeScript architecture | Design only | docs/architecture.md, docs/contracts.md |
| Sparse cell storage | Pending | model source and measured storage workload |
| Bounded virtualization and rendering | Pending | browser DOM/frame evidence |
| Worker-intensive calculation/data operations | Pending | worker source and real responsiveness proof |
| 100K populated-cell scrolling | Pending | raw frame/input measurements |
| 100K dependent formulas | Pending | full and incremental timing/counts |
| 1M populated-cell load/memory | Pending | raw hardware/runtime/timing/memory |
| Schema validation and resource limits | Pending | API/file/formula boundary tests |
| Safe uploads, paths and injection handling | Pending | malformed/adversarial integration evidence |
| No telemetry/accounts | Pending | source and runtime dependency audit |
| Unit/integration/regression/property tests | Pending | npm run test |
| Real Playwright user workflow | Pending | npm run test:e2e, screenshots and trace |
| Complete source | Pending | runnable workspace packages and applications |
| Installation and one-command startup | Pending | README.md and npm run dev |
| Production build | Pending | npm run build |
| Docker Compose | Pending | Dockerfile, compose.yaml and verified startup |
| Formula compatibility matrix | Pending | tested per-function behavior/differences |
| Reproducible measured benchmarks | Pending | benchmark source, raw output and report |
| Functioning-app screenshots | Pending | desktop/mobile real browser captures |
| Sample workbooks | Pending | Excel_Compatibility_Challenge.xlsx |
| Honest final status | In progress | this ledger updated against actual evidence |

## Acceptance workbook

`Excel_Compatibility_Challenge.xlsx` must contain financial cross-sheet references,
dynamic arrays, lookup tables, conditional formats, pivot-style analysis, charts,
dates/custom formats, complex nested formulas, deliberate errors and cycles.
Generation, reimport and known-result assertions are still Pending.

## Verification commands

The planned root commands are `npm run dev`, `npm run test`,
`npm run typecheck`, `npm run build`, `npm run test:e2e`,
`npm run samples`, and `npm run benchmark`. These commands are contracts,
not evidence that they currently exist or pass.
