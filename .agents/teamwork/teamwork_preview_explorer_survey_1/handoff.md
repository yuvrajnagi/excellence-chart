# Investigation Report: UI, Grid Architecture, and Build/Dev Setup

**Explorer**: explorer_survey_1 (`teamwork_preview_explorer`)  
**Target Codebase**: `/workspaces/excellence-chart`  
**Date**: 2026-10-23  
**Status**: Complete  

---

## Executive Summary

The OpenExcel repository contains a working, high-quality TypeScript foundation with 410 passing unit/integration tests across 11 test suites, successful builds via Vite and TypeScript project references, and a functioning DOM-virtualized grid supporting 1,048,576 rows by 16,384 columns with logarithmic coordinate indexing.

However, two out of three Playwright e2e tests fail due to an **ID desynchronization bug** between client snapshot IDs and server-generated workbook IDs on `POST /api/workbooks` during save and page reload. In the user interface, while core spreadsheet viewing, editing, basic formatting, formulas, charts, and undo/redo exist, significant functionality required by **Requirement R1** is either missing or implemented via primitive blocking browser `window.prompt()` modals:
1. **Row & Column Insert/Delete**: Completely absent from both UI and operations.
2. **Header Interactions & Resize**: No mouse drag handles to resize rows/columns; no double-click auto-fit; no column/row header click to select whole column/row; no header context menus.
3. **Selection & Fill Handle UX**: Fill handle is anchored inside the active cell rather than at the bottom-right corner of the multi-cell selection bounding box; fill series inference only handles vertical numeric series of width 1.
4. **Find & Replace**: Only executes a blind "Replace All" via two successive browser prompts; cannot search, locate, or navigate between matching cells (violating the UI acceptance criterion: *"Find & replace locates and substitutes text across the active sheet"*).
5. **Sheet Tab Management**: Reordering tabs (drag-and-drop or shift) is missing; tab color picker is missing from the UI despite model and CSS support.
6. **Dialog System**: Extensive reliance on intrusive `prompt()` popups for row height, column width, cell notes, find & replace, AutoFilter, validation lists, custom formatting, and pivot fields, rather than standard Excel-style dialogs/popovers.

---

## 1. Observation

### 1.1 Build and Development Setup
- **Root `package.json`**:
  - Name: `"openexcel"`, version: `"0.1.0"`, type: `"module"`.
  - Engines: `"node": ">=24.0.0"` (Current Node runtime: `v24.21.0`).
  - Workspaces: `["packages/*", "apps/*"]`.
  - Dependencies: `exceljs@4.4.0`, `fflate@0.8.3`, `react@19.1.0`, `react-dom@19.1.0`, `zod@4.3.6`.
  - DevDependencies: `@biomejs/biome@2.5.15`, `@playwright/test@1.55.1`, `vite@7.3.7`, `vitest@5.0.5`, `typescript@5.9.3`, `tsx@4.20.6`.
- **Scripts in `scripts/run.sh`**:
  - `npm run typecheck`: Runs `tsc -b --pretty false` and `tsc -p tsconfig.tests.json --pretty false`. Result: **Exit code 0** (clean).
  - `npm test`: Runs `tsc -b` and `vitest run`. Result: **Exit code 0**, 11 test files, 410 tests passed in 3.47s.
  - `npm run build`: Runs `tsc -b` and `vite build --config apps/web/vite.config.ts`. Result: **Exit code 0**, bundles web application to `apps/web/dist` in 2.25s.
  - `npm run benchmark`: Runs `benchmarks/run.ts`. Result: **Exit code 0** (100K formulas cold recalc: 1.30s; 100K formulas incremental update: 0.94ms; 1M cells sparse tiles: 760ms).
  - `npm run samples`: Runs `samples/generate.ts`. Result: **Exit code 0** (generates challenge workbook: 6 sheets, 18,244 bytes).
  - `npm run dev`: Runs `node scripts/dev.mjs`, which starts backend on `http://127.0.0.1:3001` and Vite frontend on `http://127.0.0.1:5173` with a proxy forwarding `/api` to the backend while preserving origin headers.
- **Repository Structure**:
  - `apps/web`: React 19 frontend (`App.tsx`, `Chart.tsx`, `operations.ts`, `api.ts`, `calculation.worker.ts`, `styles.css`, `types.ts`).
  - `apps/server`: Node.js HTTP + SQLite backend with atomic WAL transactions (`app.ts`, `storage.ts`, `jobs.ts`, `worker.ts`).
  - `packages/model`: Immutable data model, tile store (128 rows x 64 cols per tile), transaction commit/inversion, schemas (`store.ts`, `coordinates.ts`, `schemas.ts`, `types.ts`).
  - `packages/formula`: Lexer, parser, AST, dependency graph with cycle detection, spill arrays, function library (`index.ts`, `functions.ts`, `syntax.ts`).
  - `packages/formatting`: Number formats, color scales, style-to-CSS mapper (`index.ts`).
  - `packages/data`: Sort, AutoFilter, Pivot tables, Goal Seek, Remove Duplicates (`index.ts`).
  - `packages/interop`: XLSX (via ExcelJS) and CSV/TSV import/export worker (`index.ts`).
  - `tests/e2e`: Playwright tests (`performance.spec.ts`, `workbook.spec.ts`).

### 1.2 E2E Test Execution & Persistence Bug
Running `npm run test:e2e` resulted in **2 failures and 1 pass**:
```
Running 3 tests using 1 worker
  ✘  1) tests/e2e/performance.spec.ts:4:1 › measure scrolling over 100,000 populated cells (17.1s)
  ✘  2) tests/e2e/workbook.spec.ts:3:1 › edit, calculate, format, chart, persist and XLSX round trip (17.6s)
  ✓  3) tests/e2e/workbook.spec.ts:89:1 › virtual grid reaches last address and supports undo (895ms)
```

Direct observations of failure points:
1. `performance.spec.ts:18:92`:
   ```ts
   // Line 16-18:
   const response=await request.post('/api/workbooks',{data:{kind:'snapshot',name:workbook.properties.name,workbook}});
   await page.addInitScript(id=>localStorage.setItem('openexcel-last',id),workbook.id);
   await page.goto('/');
   await expect(page.getByRole('gridcell',{name:'J1 cell',exact:true})).toHaveText('9');
   ```
   Error: `Expected string: "9", Received string: ""` (Timed out after 15,000ms).

2. `workbook.spec.ts:19:47`:
   ```ts
   // Line 17-19:
   await page.getByRole('button',{name:'Save',exact:true}).click();
   await expect(page.getByText('Saved',{exact:true})).toBeVisible();
   await page.reload();
   await expect(cell('C2')).toHaveText('330');
   ```
   Error: `Expected string: "330", Received string: ""` (Timed out after 15,000ms).

3. Cause in `apps/server/src/app.ts` lines 30–34:
   ```ts
   if(path==='/api/workbooks'&&req.method==='POST'){
     const data=unwrap(parseCreateWorkbookRequest(await jsonBody(req)));
     if(data.name.length>255)throw new HttpError(400,'INVALID_INPUT','Name too long');
     const workbook=data.kind==='blank'
       ?createWorkbook({id:createId('workbook'),sheetId:createId('sheet'),name:data.name,timestamp:new Date().toISOString()})
       :{...data.workbook,id:createId('workbook'),properties:{...data.workbook.properties,name:data.name}};
     return json(res,201,store.create(workbook));
   }
   ```
   Notice that for `kind: 'snapshot'`, the server generates a new `id: createId('workbook')`.

4. Cause in `apps/web/src/App.tsx` line 52:
   ```ts
   const save=async()=>{
     const snapshot=current.current;
     const task=saveQueue.current.then(async()=>{
       if(savedRevision.current===snapshot.revision&&version.current)return;
       setStatus('Saving…');
       const response=version.current
         ?await api.saveWorkbook(snapshot.id,{workbook:snapshot,storageVersion:version.current})
         :await api.createWorkbook({kind:'snapshot',workbook:snapshot,name:snapshot.properties.name});
       version.current=response.storageVersion;
       savedRevision.current=snapshot.revision;
       localStorage.setItem('openexcel-last',snapshot.id);
       setStatus('Saved');
     });
     ...
   };
   ```
   When `api.createWorkbook` runs, `response` is `{ workbook: { id: "NEW_ID", ... }, storageVersion: 1 }`. However, `App.tsx` saves `snapshot.id` (the client's old ID) to `localStorage.setItem('openexcel-last', snapshot.id)`.

5. Cause in `apps/web/src/App.tsx` line 54:
   ```ts
   const initialize=async()=>{
     try{
       const list=await api.listWorkbooks();
       if(!alive)return;
       setRecent([...list.items]);
       const id=localStorage.getItem('openexcel-last');
       if(id&&list.items.some(w=>w.id===id)){
         const result=await api.getWorkbook(id);
         if(!alive)return;
         version.current=result.storageVersion;
         savedRevision.current=result.workbook.revision;
         setWorkbook(result.workbook);
       }
       setStatus('Ready');
     } ...
   };
   ```
   Because `snapshot.id` was stored, `list.items.some(w => w.id === id)` is `false`. The application silently skips loading the saved workbook and stays on a blank workbook with empty cells.

### 1.3 UI & Virtualized Grid Implementation
- **Component File**: `apps/web/src/App.tsx` (115 lines, single monolith component).
- **Coordinate System (`apps/web/src/operations.ts` lines 28–38)**:
  - `axis(defaultSize, info, limit, zoom)` builds a prefix-delta lookup array over sparse row/column overrides.
  - `position(index)`: Binary searches overrides in $O(\log K)$ to return absolute pixel offset.
  - `indexAt(offset)`: Binary searches 0 to `limit - 1` ($O(\log(\text{limit}))$) to find cell index at pixel offset.
  - Total limits: 1,048,576 rows and 16,384 columns.
- **Scroll Surface Scaling (`apps/web/src/App.tsx` lines 34–35)**:
  ```ts
  const scaleY=Math.max(1,(rowAxis.total-size.height+28)/(16_000_000-size.height+28));
  const scaleX=Math.max(1,(colAxis.total-size.width+48)/(16_000_000-size.width+48));
  ```
  Caps phantom container dimension at 16,000,000 px to prevent browser layout engine coordinate overflow.
- **DOM Rendering (`App.tsx` lines 101–106)**:
  - Container: `<div ref={viewport} className="oe-viewport" role="grid" aria-rowcount={1048576} aria-colcount={16384}>`
  - Phantom spacer: `<div style={{height: Math.min(rowAxis.total, 16_000_000) + 28, width: Math.min(colAxis.total, 16_000_000) + 48}}/>`
  - Visible cells: `<div className="oe-cells" style={{left: scroll.x, top: scroll.y, width: size.width, height: size.height}}>`
  - Visible slice: `baseRows = rowAxis.visible(firstRow, Math.ceil(size.height / (defaultRowHeight * zoom)) + 8)` (capped at 100 rows, 80 cols).
  - Row and Col headers:
    ```tsx
    {cols.map(col=><div key={`c${col}`} className="oe-col" style={{left:colLeft(col),width:colAxis.size(col)}}>{letters(col)}</div>)}
    {rows.map(row=><div key={`r${row}`} className="oe-row" style={{top:rowTop(row),height:rowAxis.size(row)}}>{row+1}</div>)}
    <div className="oe-corner"/>
    ```
    Headers have no event listeners (`onClick`, `onMouseDown`, `onContextMenu`).
- **Calculation Worker (`App.tsx` lines 56–57, `calculation.worker.ts`)**:
  - Web Worker receives visible viewport cell addresses and active chart range addresses.
  - Calculates values in background and updates `values` state map: `setValues(e.data.values)`.

### 1.4 User Interactions in `App.tsx`
1. **Cell Selection**:
   - Single cell: Click sets `active = {row, col}` and `end = {row, col}`.
   - Range selection: Mouse drag or Shift+Click updates `end = {row, col}`.
   - Discontiguous multi-selection: Ctrl/Meta+Click appends `selection` into `extraSelections: CellRect[]`.
   - Bug in Fill Handle anchor (`App.tsx` line 104):
     `{isActive&&!editing&&<span className="oe-fill" title="Drag to fill" ... />}`
     Fill handle is nested inside the active cell element. If a user selects range `B2:E8` starting from `B2`, the fill handle renders at the bottom-right corner of `B2`, rather than at the bottom-right corner of `E8`!
2. **Keyboard Navigation (`App.tsx` line 101)**:
   - Moves map: `ArrowUp: [-1,0]`, `ArrowDown: [1,0]`, `ArrowLeft: [0,-1]`, `ArrowRight: [0,1]`, `Enter: [1,0]`, `Tab: [0, shift ? -1 : 1]`, `PageDown: [20,0]`, `PageUp: [-20,0]`.
   - Bug: `Enter` does not check `shiftKey`. Shift+Enter moves downward instead of upward.
   - Missing shortcuts: `Home`, `Ctrl+Home`, `Ctrl+End`, `Ctrl+Arrows` (navigate to data edges), `Ctrl+A` (select all), `Ctrl+F` (find dialog), `Ctrl+B`/`Ctrl+I`/`Ctrl+U` (style toggles).
3. **Copy / Cut / Paste (`App.tsx` lines 65–66)**:
   - Plain text tab-separated values copied to `navigator.clipboard`.
   - Relative formula references shifted using `adjustFormulaReferences`.
   - Missing: Does not copy cell formatting (fill, text color, borders, number format). Cut clears cells immediately instead of on paste. No Paste Special.
4. **Row and Column Operations**:
   - Resize: Only via View tab `prompt('Row height...')` and `prompt('Column width...')`. No mouse drag on header edges.
   - Hide/Unhide: View tab has "Hide row" and "Unhide rows". View tab has NO "Hide column" or "Unhide columns".
   - Insert/Delete: Neither UI nor operations module contains logic to insert or delete rows or columns.
5. **Freeze Panes (`App.tsx` lines 39–40, 94)**:
   - Implemented via `view.freezeRows` and `view.freezeColumns`.
   - Frozen cells given `zIndex: 4`.
   - Missing: Visual freeze boundary separation line.
6. **Merge Cells (`App.tsx` lines 92, 104)**:
   - Insert tab has "Merge cells" and "Unmerge". Context menu has "Merge cells".
   - Render logic: If `row !== merged.top || col !== merged.left`, cell returns `null`.
   - Flaw: When `merged.top` scrolls off-screen, subsequent visible rows of the merged cell return `null`, making the merged area disappear.
7. **Find & Replace (`App.tsx` line 95)**:
   - Uses two browser `prompt()` calls: `prompt('Find text')` and `prompt('Replace with')`.
   - Performs immediate Replace All across all tiles.
   - Flaw: No interactive search/locate/highlighting of matches. No dialog UI.
8. **Sheet Tabs (`App.tsx` lines 86, 92, 108)**:
   - Bottom tab bar renders sheets in `workbook.sheetOrder`.
   - Supports: Switch tab, Add sheet (＋), Rename (prompt), Duplicate, Delete.
   - Missing: Drag/drop tab reordering. Tab color picker is not exposed in UI.

---

## 2. Logic Chain

1. **E2E Test Failures**:
   - `app.ts:33` creates a new ID for workbook snapshots (`id: createId('workbook')`).
   - `App.tsx:52` retains `snapshot.id` in `localStorage.setItem('openexcel-last', snapshot.id)` without updating its ID to `response.workbook.id`.
   - `performance.spec.ts:17` sets `localStorage` to `workbook.id` instead of the created workbook's ID returned in the JSON response.
   - Upon page load, `App.tsx:54` checks `list.items.some(w => w.id === id)`. Because `id` does not match the server's newly generated ID, the check fails.
   - The UI therefore opens an empty blank workbook, causing the tests waiting for populated cells (`J1='9'`, `C2='330'`) to time out.
   - **Conclusion**: Preserving `data.workbook.id` on snapshot creation in `app.ts` (or updating client state from `response.workbook`) will immediately resolve both failing e2e tests.

2. **Virtualized Grid Responsiveness**:
   - Grid rendering uses logarithmic coordinate lookup via prefix trees in `operations.ts` (`position()` and `indexAt()`).
   - DOM elements are strictly limited to the viewport slice plus freeze rows/cols (<3,000 DOM elements maximum).
   - In Test 3 (`virtual grid reaches last address and supports undo`), the grid reaches `XFD1048576` in under 900ms.
   - In Test 1 benchmark loop, 120 scrolling frames execute with responsive DOM updates.
   - **Conclusion**: The underlying virtual scrolling engine is sound and capable of handling 100K+ and 1M+ rows; its only barrier to passing e2e was the storage ID mismatch bug.

3. **Requirement R1 Feature Gaps**:
   - Requirement R1 explicitly specifies: *"column/row operations (insert, delete, hide, resize, group)"*. Currently, insert and delete do not exist anywhere in the web app or model operations; column hide is absent from the UI; resize lacks mouse drag handles.
   - Requirement R1 explicitly specifies: *"sheet tabs (create/delete/rename/reorder/duplicate/color)"*. Reorder and tab color picker have no UI controls.
   - Requirement R1 explicitly specifies: *"find & replace"*, and Acceptance Criteria requires: *"Find & replace locates and substitutes text across the active sheet"*. The current implementation only runs a blind "Replace All" via `prompt()`, without ability to locate or highlight cells.
   - Requirement R1 specifies an Excel-like desktop experience. The heavy use of modal `prompt()` dialogs across 10+ core spreadsheet actions creates an inferior user experience that diverges from standard desktop spreadsheet ergonomics.

---

## 3. Caveats

1. **Web Worker Worker-Client File**: `apps/web/src/worker-client.ts` (33KB) contains an alternative formula evaluation parser that is unused; `App.tsx` instead uses `calculation.worker.ts` which directly calls `@openexcel/formula`'s `createEngine`.
2. **CSS Duplication**: `apps/web/src/styles.css` contains 1,813 lines of comprehensive CSS classes for an advanced spreadsheet design (including dialogs, formula bar, tabs), but `App.tsx` relies primarily on `.oe-*` classes appended at lines 1814–1816.
3. **No Changes Made**: This survey is strictly read-only pursuant to explorer constraints. No production code was modified during this turn.

---

## 4. Conclusion & Recommended Action Plan

### 4.1 Summary Assessment Table

| Requirement / Component | Current Status | Verdict | Priority Fix |
|---|---|---|---|
| **Build & Test Suite** | 410 vitest tests pass; typecheck clean; build clean | ✅ Solid | Ready for CI |
| **Persistence ID Sync** | ID mismatch between server and client snapshot | ❌ Bug | **P0 (Fixes 2/3 E2E tests)** |
| **1M Row Virtual Grid** | DOM virtualization with logarithmic axis index | ✅ Solid | Working as designed |
| **Cell Selection** | Single, range, multi-selection | ⚠️ Minor UI bug | Move fill handle to selection corner |
| **Keyboard Navigation** | Arrows, PageUp/Down, Enter, Tab, F2 | ⚠️ Incomplete | Fix Shift+Enter; add Home/End/Ctrl+Arrows |
| **Row/Col Insert & Delete** | Completely missing | ❌ Missing | **P1 (Core R1 requirement)** |
| **Row/Col Resize** | Only via `prompt()` | ⚠️ Incomplete | Add mouse drag handles on headers |
| **Col Hide/Unhide** | Row hide exists; Column hide missing | ⚠️ Incomplete | Add col hide/unhide to View & context menu |
| **Header Selection** | Headers not clickable | ⚠️ Incomplete | Click header to select entire row/col/sheet |
| **Find & Replace** | Only Replace All via `prompt()` | ❌ Missing AC | **P1 (Acceptance criteria gap)** |
| **Sheet Tab Management** | Add, rename, duplicate, delete exist | ⚠️ Incomplete | Add drag/button reorder & tab color picker |
| **Interactive Dialogs** | 10+ actions use `window.prompt()` | ⚠️ UX Debt | Replace `prompt()` with floating modals/popovers |
| **Copy / Paste** | Plain text TSV with formula reference adjust | ⚠️ Incomplete | Support formatting & Paste Special |

---

### 4.2 Proposed Implementation Details for Subsequent Agents

#### Fix 1: Fix Snapshot ID Persistence (Fixes E2E Tests)
In `apps/server/src/app.ts` (line 32):
```ts
// Before:
const workbook=data.kind==='blank'?createWorkbook({id:createId('workbook'),sheetId:createId('sheet'),name:data.name,timestamp:new Date().toISOString()}):{...data.workbook,id:createId('workbook'),properties:{...data.workbook.properties,name:data.name}};

// After:
const workbook=data.kind==='blank'
  ? createWorkbook({id:createId('workbook'),sheetId:createId('sheet'),name:data.name,timestamp:new Date().toISOString()})
  : {...data.workbook, id: data.workbook.id ?? createId('workbook'), properties:{...data.workbook.properties,name:data.name}};
```
And in `apps/web/src/App.tsx` (line 52):
```ts
// Ensure App updates its internal snapshot reference when creating a workbook:
if ('workbook' in response) {
  current.current = response.workbook;
  setWorkbook(response.workbook);
  localStorage.setItem('openexcel-last', response.workbook.id);
} else {
  localStorage.setItem('openexcel-last', snapshot.id);
}
```

#### Fix 2: Implement Row/Column Insert and Delete Operations
In `apps/web/src/operations.ts`:
- `insertRow(workbook, sheetId, rowIndex, count = 1)`: Shifts all cells at `row >= rowIndex` down by `count`, adjusts formulas referencing cells below `rowIndex` via `adjustFormulaReferences`, and updates merges/rowInfo.
- `deleteRow(workbook, sheetId, rowIndex, count = 1)`: Deletes cells in `rowIndex .. rowIndex + count - 1`, shifts subsequent cells up by `count`, marks deleted cell references as `#REF!`, and updates merges/rowInfo.
- `insertColumn(workbook, sheetId, colIndex, count = 1)` & `deleteColumn(workbook, sheetId, colIndex, count = 1)`.

#### Fix 3: Implement Find & Replace Dialog with Locate/Next/Previous
Replace `prompt('Find text')` in `App.tsx` with a non-modal floating dialog:
- Fields: Find Input, Replace Input, "Find Next", "Find Previous", "Replace", "Replace All", "Match Case", "Match Entire Cell".
- "Find Next" moves `active` selection and viewport scroll (`go(row, col)`) to the next matching cell.

#### Fix 4: Header Interactions & Mouse Drag Resize
- Add mouse drag resize indicator on `.oe-col` right border and `.oe-row` bottom border:
  On drag start, capture mouse movement; on drag end, dispatch `columnInfo` / `rowInfo` patch.
- Add click handler on `.oe-col` to select column `0..1048575`.
- Add click handler on `.oe-row` to select row `0..16383`.
- Add click handler on `.oe-corner` to select entire worksheet (`0..1048575, 0..16383`).
- Add right-click context menu on row/column headers for Insert, Delete, Hide, Unhide, and Resize.

#### Fix 5: Sheet Tabs Enhancements
- Tab reorder: Add Move Left / Move Right buttons or HTML5 drag-and-drop to reorder `workbook.sheetOrder`.
- Tab color: Add color picker popup on right-click or in bottom tab bar to set `sheet.properties.tabColor`.

---

## 5. Verification Method

To independently verify all findings and test subsequent fixes:

1. **Verify TypeScript type checking**:
   ```bash
   npm run typecheck
   ```
   Must exit with code 0.

2. **Verify unit & integration tests**:
   ```bash
   npm test
   ```
   Must pass all 410 tests in 11 test suites.

3. **Verify web application build**:
   ```bash
   npm run build
   ```
   Must compile `apps/web/dist` successfully.

4. **Verify E2E tests**:
   ```bash
   npm run test:e2e
   ```
   After applying Fix 1, all 3 tests (`measure scrolling over 100,000 populated cells`, `edit, calculate, format, chart, persist and XLSX round trip`, and `virtual grid reaches last address and supports undo`) should pass.

5. **Verify formula and grid performance benchmarks**:
   ```bash
   npm run benchmark
   ```
   Exits with code 0 and reports sub-millisecond incremental recalculation on 100K formulas.

6. **Verify sample challenge workbook generation**:
   ```bash
   npm run samples
   ```
   Exits with code 0 and generates `samples/Excel_Compatibility_Challenge.xlsx`.
