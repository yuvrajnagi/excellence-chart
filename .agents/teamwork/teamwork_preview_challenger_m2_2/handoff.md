# Milestone M2 Adversarial Challenge Report: Challenger 2

**Explicit Verdict**: **REJECT**

---

## 1. Observation

### Verification Commands Executed
1. `npm test`:
   - Command: `npm test`
   - Result: 12 test files passed, 418 tests passed (Duration: 3.49s, exit code 0).
2. `npm run test:e2e`:
   - Command: `npm run test:e2e` (executed in isolation without port collision)
   - Result: 8 tests passed (Duration: 28.7s, exit code 0).
   - *Note on test concurrency*: When multiple runners execute `playwright test` concurrently, both bind fixed port `3018` and access `.openexcel/e2e`, resulting in `net::ERR_CONNECTION_REFUSED`. When run in isolation, all 8 browser tests pass.

### Adversarial Findings & Verbatim Evidence

#### Finding 1 (CRITICAL — Data Loss Bug): Tile Key Coordinate Mismatch in `insertRow`, `deleteRow`, `insertColumn`, `deleteColumn`
- **Location**: `apps/web/src/operations.ts`, lines 99, 191, 288, 380:
  ```ts
  const tk = `${Math.floor(r / 128)}:${Math.floor(c / 64)}` as TileKey;
  ```
- **Contract Definition**: `packages/model/src/coordinates.ts`, lines 6-7, 36-39:
  ```ts
  export const TILE_ROWS = 128;
  export const TILE_COLUMNS = 32;
  ...
  export function tileKey(row: number, col: number): Result<TileKey> {
    return validPosition(row, col)
      ? { ok: true, value: `${Math.floor(row / TILE_ROWS)}:${Math.floor(col / TILE_COLUMNS)}` }
      : { ok: false, error: { code: "OUT_OF_BOUNDS", message: "Cell is outside the grid" } };
  }
  ```
  And `packages/model/src/store.ts`, line 44:
  ```ts
  export function getCell(workbook: Workbook, at: CellAddress): Cell | undefined {
    if (!validPosition(at.row, at.col)) return undefined;
    return workbook.sheets[at.sheetId]?.tiles[tileOf(at.row, at.col)]?.[keyOf(at.row, at.col)];
  }
  ```
- **Empirical Execution**: `artifacts/scratch/test_tile_mismatch.ts`:
  ```
  Before insert, getCell(AF1): { input: { kind: 'value', value: 'test-col-32' } }
  --- 1. Testing insertRow with col 32 ---
  After insertRow, getCell(AF2): undefined
  ❌ BUG in insertRow: cell lost!
  --- 2. Testing deleteRow with col 32 ---
  After deleteRow, getCell(AF1): undefined
  ❌ BUG in deleteRow: cell lost!
  --- 3. Testing insertColumn with col 32 ---
  After insertColumn, getCell(AG1): undefined
  ❌ BUG in insertColumn: cell lost!
  --- 4. Testing deleteColumn with col 64 ---
  After deleteColumn, getCell(BL1 col 63): undefined
  ❌ BUG in deleteColumn: cell lost!
  ```
- **Blast Radius**: Because the operations hardcoded `c / 64` instead of `c / 32` (`TILE_COLUMNS`), any cell at column index >= 32 (column `AF` through `XFD`, representing 16,352 out of 16,384 columns or 99.8% of the spreadsheet grid) gets indexed under the wrong tile key upon row or column insertion or deletion, causing `getCell()` to return `undefined`. All cells in those columns are effectively lost to the formula worker, renderer, and file exporter.

---

#### Finding 2 (HIGH — Corrupt Calculation): Inverted Formula Reference Rewriting in `deleteRow` and `deleteColumn`
- **Location**: `apps/web/src/operations.ts`, lines 212-220 & lines 402-409:
  ```ts
  if (newCell.input.kind === 'formula') {
    newCell = {
      ...newCell,
      input: {
        ...newCell.input,
        source: adjustFormulaReferences(newCell.input.source, -count, 0),
      },
    };
  }
  ```
- **Contract Requirement**: `PROJECT.md`, lines 68-71:
  ```
  deleteRow(workbook: Workbook, sheetId: string, rowIndex: number, count?: number): Workbook
  - Removes cells in rowIndex .. rowIndex + count - 1.
  - Shifts subsequent cells up by count.
  - Replaces references to deleted cells with #REF!.
  ```
- **Empirical Execution**: `artifacts/scratch/test_formula_shift.ts`:
  Given initial cells:
  - Row 0 (A1): 10
  - Row 1 (A2): 20
  - Row 2 (A3): 30
  - Row 3 (A4): `=A1+A2`
  Execute `deleteRow(workbook, sheetId, 1, 1)` (deleting row 1 / A2):
  ```
  Original formula in A4: =A1+A2
  Resulting formula in A3 after deleting Row 2 (A2): { kind: 'formula', source: '=#REF!+A1' }
  ```
- **Blast Radius**: `adjustFormulaReferences(source, -count, 0)` blindly shifts *every* reference in the formula downward. Consequently:
  - References to cells above the deleted row (e.g. `A1` at row 0) get decremented to `row: -1`, becoming `#REF!`.
  - References to the deleted row (e.g. `A2` at row 1) get decremented to `row: 0`, becoming `A1` (pointing to unrelated data instead of `#REF!`).
  - Formulas above `rowIndex` that reference moved rows are completely ignored and never updated.

---

#### Finding 3 (MEDIUM — UX / Undo Stack Corruption): History Stack Eviction on Live Header Drag Resize
- **Location**: `apps/web/src/App.tsx`, lines 119-120:
  ```tsx
  const onMove=(me:MouseEvent)=>{
    if(!colResize.current)return;
    const delta=(me.clientX-colResize.current.startX)/zoom;
    const newW=Math.max(20,Math.min(1000,Math.round(colResize.current.startWidth+delta)));
    props({columnInfo:{...sheet.properties.columnInfo,[colResize.current.col]:{size:newW}}});
  };
  ```
- **Mechanism**: Every `mousemove` event triggers `props()`, which calls `change()`, which unconditionally creates a transaction commit and appends to `history.current.record(result.value.commit)`.
- **Empirical Execution**: `artifacts/scratch/test_resize_history.ts`:
  ```
  History after user edit: canUndo = true
  Was original user edit preserved in undo stack?: false
  BUG CONFIRMED: Dragging resize handle flooded history stack and evicted prior user edits!
  ```
- **Blast Radius**: Dragging a column or row header for 100 pixels generates ~100 mousemove commits. Because the history capacity is `maxEntries: 100`, the drag completely evicts all prior user cell edits, formulas, and formatting from the undo stack.

---

## 2. Logic Chain

1. **Premise 1**: In `packages/model`, the grid is tiled with `TILE_ROWS = 128` and `TILE_COLUMNS = 32`. `getCell` looks up `tileOf(row, col) = `${Math.floor(row / 128)}:${Math.floor(col / 32)}``.
2. **Observation 1**: In `apps/web/src/operations.ts` lines 99, 191, 288, and 380, the tile key is calculated as `${Math.floor(r / 128)}:${Math.floor(c / 64)}`.
3. **Inference 1**: For all cells where `c >= 32`, `Math.floor(c / 64) !== Math.floor(c / 32)`. When `insertRow`, `deleteRow`, `insertColumn`, or `deleteColumn` writes shifted cells, it writes them into the wrong tile.
4. **Conclusion 1**: Any cell in columns 32..16383 (`AF..XFD`) vanishes from `getCell()` queries following any row or column structural change.

5. **Premise 2**: `PROJECT.md` requires `deleteRow` and `deleteColumn` to replace references to deleted cells with `#REF!`, while maintaining correct references to preserved cells.
6. **Observation 2**: `deleteRow` calls `adjustFormulaReferences(source, -count, 0)` for all formulas below the deleted row, unconditionally subtracting `count` from all row indices regardless of position.
7. **Conclusion 2**: Intact references to cells above the deleted row become `#REF!`, while references to the deleted row become shifted valid references to the wrong cells.

8. **Premise 3**: User undo history has a maximum capacity of 100 commits (`maxEntries: 100`).
9. **Observation 3**: `onMove` calls `props()`, committing each intermediate mousemove coordinate to the undo stack.
10. **Conclusion 3**: A drag resize over 100px exhausts and purges the entire undo history.

---

## 3. Caveats

- The worker did successfully implement:
  - Clamping guards for column resize (20px to 1000px) and row resize (12px to 500px) with zoom compensation.
  - Whole row (`0..16383`), whole column (`0..1048575`), and sheet (`0..1048575, 0..16383`) bounding box selection logic.
  - Interactive Find & Replace dialog with Find Next, Find Previous (wrap-around verified), Match Case, Match Entire Cell, and regex escaping for special characters.
  - Sheet tab reordering boundaries (left disabled on first tab, right disabled on last tab).
  - Bottom-right bounding box anchoring of `.oe-fill`.
- Existing Playwright E2E and unit test suites pass only because existing tests do not exercise row/column operations beyond column 31 (`AF`), nor do they test formulas referencing rows above deleted rows.

---

## 4. Conclusion

**Verdict: REJECT**

Milestone M2 cannot be approved in its current state. The implementation of grid structural operations (`insertRow`, `deleteRow`, `insertColumn`, `deleteColumn`) contains critical data loss and formula corruption bugs:
1. **Critical**: Tile coordinate calculation uses `c / 64` instead of `TILE_COLUMNS = 32`, breaking all cells beyond column `AF` (99.8% of the spreadsheet).
2. **High**: Formula adjustments on deletion invert reference safety, turning valid references into `#REF!` and deleted references into wrong coordinates.
3. **Medium**: Continuous resize drag commits flood the undo history stack and erase earlier edits.

### Required Worker Fixes:
1. In `apps/web/src/operations.ts`:
   - Import `TILE_ROWS, TILE_COLUMNS` from `@openexcel/model` (or use `tileOf`).
   - Replace `${Math.floor(r / 128)}:${Math.floor(c / 64)}` with `${Math.floor(r / TILE_ROWS)}:${Math.floor(c / TILE_COLUMNS)}` in `insertRow`, `deleteRow`, `insertColumn`, and `deleteColumn`.
2. In `apps/web/src/operations.ts`:
   - Implement reference adjustment logic for row/col deletion that checks whether the referenced cell falls within the deleted span (becomes `#REF!`), is below the deleted span (shifts by `-count`), or is above the deleted span (remains unchanged). Apply reference updates across all formulas in the sheet.
3. In `apps/web/src/App.tsx`:
   - Keep resize dimensions in local/ref state during `mousemove` and only commit `props()` once on `mouseup` (`onUp`).

---

## 5. Verification Method

To independently verify these findings:

1. **Verify Tile Mismatch Data Loss**:
   ```bash
   npx tsx artifacts/scratch/test_tile_mismatch.ts
   ```
   *Expected outcome*: Demonstrates `getCell` returning `undefined` for columns >= 32 after `insertRow`, `deleteRow`, `insertColumn`, `deleteColumn`.

2. **Verify Formula Reference Inversion**:
   ```bash
   npx tsx artifacts/scratch/test_formula_shift.ts
   ```
   *Expected outcome*: Demonstrates `=A1+A2` in A4 becoming `source: '=#REF!+A1'` after deleting row 1 (A2).

3. **Verify Undo Stack Eviction**:
   ```bash
   npx tsx artifacts/scratch/test_resize_history.ts
   ```
   *Expected outcome*: Demonstrates prior user cell edits being evicted from `history.snapshot().undo` during mouse drag.

4. **Verify Baseline Test Suites**:
   ```bash
   npm test
   npm run test:e2e
   ```
