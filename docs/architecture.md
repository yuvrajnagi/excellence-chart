# OpenExcel architecture

Status: implementation contract, 2026-10-20. This is a design, not a claim that the application exists. `openexcellence-prompt` is the product requirement; `docs/contracts.md` is the normative interface specification; `docs/roadmap.md` assigns implementation ownership and gates.

## Decisions

| Concern | Decision | Rejected alternative and reason |
| --- | --- | --- |
| Workspace | npm workspaces, ESM, TypeScript strict, Node 24, React/Vite, Vitest, Playwright | A second package manager or Bun production runtime would split the requested toolchain. |
| Storage model | JSON-compatible sparse tiles, 128 rows by 32 columns, containing only authored cells | Dense arrays cannot represent the full grid economically. A database row per theoretical cell is unnecessary. |
| Calculation | Custom lexer, parser, AST interpreter, dependency indexes, scheduler and function registry | No `eval`, `Function`, JavaScript expression compiler, or third-party calculation engine. |
| Editing | One serial worker owns the authoritative workbook, engine and history; UI holds a revisioned replica | Concurrent mutation in React and a worker creates ambiguous undo and stale-save races. |
| Grid | Custom DOM virtualization with a real accessible editor overlay | Canvas plus a second accessibility tree doubles the rendering and hit-testing contract. |
| Persistence | Node 24 `node:sqlite`, prepared statements, WAL, one database worker, transactional version checks | An ORM and PostgreSQL add infrastructure without helping the local single-user contract. |
| XLSX | ExcelJS for cells/styles and bounded OOXML supplements for charts/OpenExcel metadata | Assuming a file-format library preserves every feature silently loses charts and pivots. |
| Charts | Web-owned SVG renderer and editors, definitions in model, data projection in data package | A charting dependency must not become the workbook schema or formula evaluator. |
| Distribution | One local server serving built web assets and `/api/v1`; Docker volume for SQLite | Authentication, collaboration and public multi-tenant hosting are not requirements and are not implied. |

Use a lockfile, pin the Node 24 patch in CI/Docker, and record resolved library versions during foundation implementation. Do not call an unverified version "latest." The observed development runtime was Node `v24.21.0`. Skill defaults for Bun, pnpm and an ORM are overridden by this task's Node/npm/native-SQLite requirements.

## Packages and legal imports

An arrow means "imports." This is a closed list, including type-only imports and tests.

```text
@openexcel/model       -> no workspace package
@openexcel/formula     -> @openexcel/model, @openexcel/formatting
@openexcel/formatting  -> @openexcel/model
@openexcel/data        -> @openexcel/model, @openexcel/formula
@openexcel/interop     -> @openexcel/model
apps/server           -> @openexcel/model, @openexcel/formula, @openexcel/interop
apps/web              -> @openexcel/model, @openexcel/formula,
                         @openexcel/formatting, @openexcel/data
```

`formatting` receives a value/formula reader through an interface; it does not import formula. Formula imports formatting for TEXT and date conversion, so there is one number-format implementation. `interop` accepts supplied calculation caches and never calculates. Server imports formula only to prepare trustworthy XLSX caches. Data imports formula for copy/fill, sorting rewrites and sandboxed Goal Seek. No package imports an app. Web consumes HTTP contracts from `@openexcel/model/api`, never server source. Worker message types live in web, the leaf that already imports data and formula; putting them in formula would create a formula/data cycle.

| Package | Only public export paths | Single owner |
| --- | --- | --- |
| `packages/model` | `@openexcel/model`, `@openexcel/model/api` | MODEL |
| `packages/formula` | `@openexcel/formula`, `@openexcel/formula/syntax`, `@openexcel/formula/functions` | FORMULA |
| `packages/formatting` | `@openexcel/formatting` | FORMAT |
| `packages/data` | `@openexcel/data` | DATA |
| `packages/interop` | `@openexcel/interop` | INTEROP |
| `apps/server` | No consumable workspace exports | SERVER |
| `apps/web` | No consumable workspace exports | WEB |

Each package has `src/index.ts`, `test/`, `package.json` and `tsconfig.json`; declared subpaths have their own barrels. Publish/build mapping is explicit: `types: ./dist/<entry>.d.ts`, `import: ./dist/<entry>.js`; `model/api` maps to `dist/api.js`, formula subpaths to `dist/syntax.js` and `dist/functions.js`. No wildcard exports, default exports, source deep imports, cross-package relative imports, or alternate aliases. All `.js` extensions in emitted ESM imports resolve under Node. Vite/Vitest use package exports, not a second alias topology. FOUNDATION owns root build orchestration and lockfile; package owners supply dependency requests, not concurrent lockfile edits.

## Authoritative state and sparse addressing

The grid is exactly 1,048,576 rows by 16,384 columns (A1:XFD1048576). Coordinates in memory are zero-based; displayed A1 and ARIA indexes are one-based. Coordinates are bounded integers; no guessed used-range dimensions constrain navigation.

A workbook serializes to plain JSON: no `Map`, `Set`, `Date`, `BigInt`, typed array, function or prototype-bearing domain object. A sheet's `tiles` dictionary maps `"tileRow:tileCol"` to a dictionary of global `"row:col"` keys. Missing cells mean blank; missing tiles allocate nothing. A populated blank with a style/note is retained. An empty unstyled cell is removed, and an empty tile is removed. Tile keys must match contained coordinates. This adds one dictionary layer without inventing a persistent collection library.

The model copies touched tiles once per transaction, shares untouched immutable tiles, and batches changes before copying top-level sheet indexes. Engine indexes use internal Maps/Sets, not serialized state. Snapshot serialization and million-cell imports run outside the main thread. A million widely scattered cells are an adversarial memory case to measure, not a promised constant-memory case.

Authored formula source includes `=`. ASTs, dependency indexes, calculated values, spill children, hidden-by-filter indexes and rendered formatting are derived caches, never authoritative authored cells. Dates are numeric Excel serials plus formatting and a workbook date-system flag. The 1900 leap-day anomaly is handled explicitly in formula/formatting conversions; a JS Date cannot represent fictitious 1900-02-29.

Sheet/object/style IDs are stable. Sheet names are case-insensitively unique, 1-31 characters, and reject Excel's forbidden `[]:*?/\\` characters. Named expressions and table names are case-insensitive and cannot shadow A1/R1C1-style addresses. IDs are UUID strings, never filenames.

## Editing, history and calculation flow

1. The editor produces an `Edit` at a known workbook revision.
2. The worker serializes the request. An edit arriving during calculation aborts that calculation and waits for its cancellation boundary before mutation.
3. `Engine.set` validates preconditions, plans reference changes, creates one model transaction and calls `applyTransaction` once.
4. The commit contains forward/inverse patches and touched cells/metadata. History records only authored changes. Rejected edits have no partial effect.
5. The worker emits the commit. The main-thread replica applies the identical forward patches at the exact base revision.
6. Dirty dependents recalculate in the worker. A calculated event carries workbook revision, calculation epoch and scalar/spill deltas.
7. Web applies only current-revision events, updates visible cells and live charts, and schedules autosave.

Structural edits, cut/move and sheet operations go through semantic `Edit` variants, not raw tile patches. The formula package rewrites AST references and prints formula source. Model knows coordinates and transactions but never parses formulas. Formatting/data commands submit transactions through `Engine.set`; a transaction cannot secretly add/delete/reorder sheets or relocate cells. `Engine.set` enforces this distinction.

Undo/redo replays exact patches as a new increasing revision; it never decrements the workbook revision or restores stale calculation caches. One paste, fill, format-painter action, sort, filter setting, pivot refresh, or row/column operation is one history entry. History defaults to 200 entries and 64 MiB of serialized forward/inverse patches; evict oldest complete entries and surface the history boundary. An operation exceeding the entire budget must ask the UI to confirm a non-undoable edit or cancel; never silently drop undo.

### Calculation mechanism

The interpreter is custom and pure apart from an injected epoch clock/seed. Parse errors become spreadsheet errors; malformed workbook JSON is a boundary error, not a cell value. Formulas cannot read the filesystem, network, global objects or arbitrary JavaScript.

Direct references use reverse adjacency lists. Range references use sheet-local rectangle indexes; `SUM(A:A)` records one rectangle, not 1,048,576 cell edges. Membership queries determine dirty formulas on cell changes. Calculation scans populated values where semantics permit; positional functions preserve blank positions without expanding a whole-column array. Required array allocations and visits consume a resource budget.

Static dependencies cover all branches conservatively. Actual reads are tracked separately: lazy IF/LET/LAMBDA branches must not trigger errors/cycles in unexecuted branches. Use iterative stacks and strongly connected components on active reads plus a gray evaluation stack for dynamic references. Cycle members return `#CIRC!`, dependents propagate it, and unrelated cells still calculate. INDIRECT/OFFSET replace their dynamic dependencies after each evaluation; dependency stabilization is bounded at 32 passes. A non-stabilizing component returns `#CALC!` with a diagnostic.

Dirty scheduling evaluates dependencies before consumers. One epoch fixes `nowMs` and `randomSeed`; volatile functions and their dependents are invalidated on edits, explicit recalculation, and a visible-workbook minute tick. Random values derive from seed + cell address + AST call-site + invocation path, not scheduler order. No background timer repeatedly calculates hidden workbooks.

Spill ownership is a separate index. Array dimensions, bounds, merged ranges, tables and authored-cell obstructions are checked before publishing any child. Failed placement returns `#SPILL!` at the anchor and removes the previous spill. Editing a spill child is rejected with its anchor address. Clearing the anchor clears the spill. Spill conflicts are resolved in sheet-order/row/column order, with the loser returning `#SPILL!`; recalculation cannot oscillate with scheduling order. Reads of spill children depend on both the anchor and occupancy changes.

### Worker and failure semantics

Web creates one module worker per open workbook, with at most two resident engines; inactive workbooks are saved and closed before another is loaded. Worker requests/replies contain version `1`, session ID, request ID and revision where applicable. Transferred export buffers are not reused. The exact discriminated unions are in contracts.

Recalculation yields between cell evaluations when its slice has consumed 2,048 steps or 8 ms. These are scheduling targets, not a false promise of preempting a synchronous registry callback. Each built-in loop checks its budget/deadline at least every 1,024 visits. A long single call may exceed the slice target but stays off the main thread. Cancellation first posts a cancel request; if it has not acknowledged within 250 ms, the coordinator terminates that owned worker and settles the cancelled operation locally. The timeout is cancellation behavior, not test synchronization. The main thread keeps its acknowledged authored replica and mirrors model History; restart supplies both, retains the editor draft, and replays only unacknowledged edits whose base revision still matches. Calculation results carry both revision and epoch, including chart and conditional-format projections, so a same-revision volatile recalculation cannot be overwritten by an older projection.

Imported ZIP/XML work runs in a disposable Node worker with a hard deadline, not in the HTTP event loop. Worker termination never acknowledges an unfinished edit/save. Pure data planners may yield by chunk; mutation is published only after one complete validated transaction. Formatting/data readers share the worker's completed epoch, and clipboard/search/paste/duplicate queries use explicit worker messages rather than reimplementing formula semantics in React.

## Grid and accessible interaction

Use a bounded physical scroll surface of at most 8,000,000 CSS pixels per axis, with logical offsets mapped to it and rebased around the viewport; do not create a 25-million-pixel row spacer. Wheel/touch movement updates logical pixel offsets directly. Scrollbar drag maps proportionally across the complete sheet. Keyboard/name-box navigation uses exact logical coordinates, independent of scrollbar precision.

Sparse row-height/column-width overrides and hidden/group intervals form a prefix-size index supporting coordinate-to-pixel and pixel-to-coordinate lookup. Default row height is 24 CSS px and column width 100 CSS px. Frozen rows/columns render separate clipped panes against the same selection state. Zoom 25-400% scales measurements once. Only visible cells plus two viewport margins render, capped at 12,000 DOM cells; merge anchors outside the viewport are projected into the visible merged rectangle.

The focusable grid exposes `role="grid"`, full `aria-rowcount`/`aria-colcount`, and an active-descendant cell that is always mounted. Visible rows/cells have absolute `aria-rowindex`/`aria-colindex`; selected state and errors are announced. A single positioned textarea/input is the real editable overlay, supports IME composition, selection, clipboard and formula text, and shares a draft with the formula bar. Escape cancels, Enter commits, Tab commits/moves, and composition Enter never commits prematurely. Selection includes primary, anchor and discontiguous rectangular ranges.

Arrow/Page/Home/End navigation, Ctrl/Cmd+C/X/V/Z/Y/F, Shift extension, Ctrl/Cmd discontiguous selection, F2 editing and Delete clearing are acceptance cases. Row/column headers, ribbon, sheets, dialogs and context menus are keyboard operable. Touch/small-screen layout collapses ribbon groups but retains explicit edit and sheet controls. Real browser checks cover desktop and narrow viewports, high DPI, focus after scrolling, screen-reader semantics and reduced motion.

## Persistence and recovery

Node's `DatabaseSync` API is synchronous; isolate it in one Node worker so large JSON serialization and transactions do not block HTTP. The database worker owns its connection and migrations. Use WAL, foreign keys, a 5-second busy timeout and prepared statements; schema migration version is independent of workbook schema version.

```sql
CREATE TABLE workbooks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  storage_version INTEGER NOT NULL, document_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  opened_at TEXT NOT NULL, document_json TEXT NOT NULL
);
CREATE TABLE save_receipts (
  workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
  save_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
  storage_version INTEGER NOT NULL, response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workbook_id, save_id)
);
CREATE INDEX workbooks_recent ON workbooks(opened_at DESC, id);
```

`PUT` uses an `If-Match` storage version, not the client document revision. Under `BEGIN IMMEDIATE`, first resolve an existing save receipt, otherwise compare version, replace the snapshot and insert receipt atomically. A retry with the same save ID and canonical JSON payload returns the first response even if its old `If-Match` is now stale. Reusing a save ID for a different canonical payload returns 409. Version mismatch returns 412 with current version; never last-writer-wins. Receipt retention is 30 days, advertised as the retry window. Export uses the saved immutable revision and the client's frozen clock/seed, but recomputes every value with the server's own engine rather than trusting client caches.

Autosave runs 750 ms after the latest commit, with a 5-second maximum delay; manual save awaits the same queue. Only one save is in flight per workbook. Edits during a save queue a newer snapshot. Only the returned saved revision is marked clean. Browser IndexedDB stores revisioned recovery snapshots before HTTP; quota errors show a warning, not "Saved." Closing/page navigation warns on acknowledged edits not durably saved. On conflict preserve the local recovery snapshot and offer reload or save as a new workbook. Server success means SQLite commit completed, not merely a request queued.

The default app is local single-user and loopback-bound. Same-origin checks and JSON/multipart content rules protect writes from unwanted browser origins. Docker external binding is opt-in and deployment documentation requires an authenticating reverse proxy before untrusted-network exposure. No telemetry or external account is needed.

## Interoperability and compatibility boundary

All requested application features remain in the roadmap. File-format compatibility is a separate, tested capability:

* XLSX values, formulas, dimensions, styles, merges, sheets, names, validations, tables and supported conditional-format rules map to native OOXML.
* ExcelJS handles base workbook serialization. The interop owner adds a bounded ZIP/XML layer (`fflate`, `fast-xml-parser`, external entities/DTD rejected) for chart relationships and OpenExcel metadata. No library-provided formula execution is used.
* Standard line/area/column/bar/scatter/pie/donut/combo charts receive native DrawingML chart parts and live cell references. Histograms export as column charts of explicit bin results, with a compatibility issue.
* Pivots export materialized cells and preserve editable OpenExcel pivot definitions in an OpenExcel extension. External native pivot caches are imported as materialized cells with a warning unless the adapter can map the complete definition. Application pivot functionality is still required.
* The extension is `customXml/openexcel.json` with the exact `OpenExcelExtension` schema in contracts; its relationships and content type are emitted by the adapter. On import, schema-validate it and use definitions only when referenced sheet IDs can be resolved through the extension's sheet-name/ID map. It is not required for ordinary XLSX cells.
* Modern dynamic-array formulas retain text and exported calculated cells; unsupported Excel dynamic-array metadata is reported. Export sets full recalculation on load. The native OpenExcel format/SQLite snapshot preserves the full model without an XLSX round trip.
* VBA/macros, external links, DDE, ActiveX, arbitrary embedded objects, Excel add-ins, 3D references, iterative circular calculation, locale formula names and legacy CSE entry semantics are outside the compatibility subset. They produce explicit import/export/function diagnostics; no external content is executed.
* Rich-text editing is the requirement's optional feature. V1 imports flattened text with a loss report and supports plain-text editing; never advertise rich-text editing as implemented.

The extension cannot guarantee another editor will retain it. Export always returns structured issues before download; the UI requires acknowledgment of lossy conversion. Unsupported functions remain formula source and show `#NAME?`, not fabricated cached success. CSV/TSV exports use supplied calculated scalar values, never execute formulas; strings beginning with `=`, `+`, `-`, `@`, tab or CR are apostrophe-prefixed by default and this policy is visible to the user.

## Limits and performance gates

Defaults are explicit configuration, not silent truncation: 256 MiB upload/JSON body; 1 GiB decompressed ZIP; 10,000 ZIP entries; 100:1 expansion ratio; 256 sheets; 2,000,000 authored cells; 32,768 formula characters; 1,024 AST nesting; 1,000,000 array/spill cells; 50,000,000 evaluation steps per request; 30-second calculation/export deadline; 64 MiB history. Reject with a typed resource error before publication. The server must stream/count uploads and ZIP expansion rather than trust declared sizes. CSV multi-line quoting is streaming; excessively long fields are rejected at 1 MiB. Operators may raise limits for measured hardware; clients receive effective limits.

These are targets, not measured results:

| Workload | Gate on recorded reference desktop |
| --- | --- |
| 100,000 populated cells, scroll/edit | At least 50 rendered frames/s during scripted scroll; p95 main-thread input task below 50 ms |
| 100,000 simple dependent formulas | Initial full calculation below 5 s; edit with 1,000 affected formulas p95 below 100 ms worker time; report a full 100,000-node chain separately |
| 1,000,000 populated cells | Record parse/load/save time, browser heap and server RSS; target load below 15 s and peak combined memory below 1.5 GiB |
| Large range sort/paste/import | Main thread stays interactive; progress/cancel visible; no main-thread task above 100 ms attributable to operation |

Record CPU/RAM/OS/browser/Node versions, dataset seed, cold/warm runs, ten repetitions, median/p95, memory method and raw samples. Do not fail CI on absolute wall time from a different machine; use correctness and operation-count regressions in CI and a controlled benchmark lane for timing.

## Evidence basis

Product scope comes from the local requirement file, not library promises. The 2026-10-20 verification rechecked Node 24 SQLite documentation (synchronous `DatabaseSync`), Vite `docs/guide/features.md` (module-worker constructor bundling), ExcelJS README (caller-supplied formula results) and Zod's branded output type. `evidence/foundation/architecture.md` records primary source identifiers and the declaration/import checks. Chart/pivot supplements are owned implementation work, not a claim that ExcelJS provides complete fidelity. Library capabilities do not substitute for OpenExcel interoperability tests.
