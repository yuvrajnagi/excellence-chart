# Milestone M2 Adversarial Challenge Report

**Verdict**: **REJECT**

---

## 1. Observation

### Verification Commands Executed
1. `npm test`:
   ```text
   Test Files  12 passed (12)
   Tests       418 passed (418)
   Duration    7.01s
   Exit code:  0
   ```
2. `npm run test:e2e`:
   ```text
   Running 8 tests using 1 worker
     ✓ 1 cell selection, keyboard navigation, and Name Box jumping (2.0s)
     ✓ 2 formula bar input, in-cell double-click editing, and formula recalculation (2.5s)
     ✓ 3 chart insertion and dynamic reactivity to cell data changes (2.9s)
     ✓ 4 Find & Replace dialog locates matching cells and updates text across sheet (2.2s)
     ✓ 5 sheet tabs creation and tab switching preserves worksheet state (2.0s)
     ✓ 6 measure scrolling over 100,000 populated cells (7.7s)
     ✓ 7 edit, calculate, format, chart, persist and XLSX round trip (5.0s)
     ✓ 8 virtual grid reaches last address and supports undo (1.7s)
     8 passed (28.7s)
   Exit code: 0
   ```
   *(Note: Sequential execution required as simultaneous runs collide on port 3018)*.

### Codebase Observations
- In `apps/web/src/operations.ts` lines 110–130 (`insertRow`):
  ```typescript
  if (r < rowIndex) {
    setCell(r, c, cell);
  } else {
    const newRow = r + count;
    let newCell = cell;
    if (newCell.input.kind === 'formula') {
      newCell = {
        ...newCell,
        input: {
          ...newCell.input,
          source: adjustFormulaReferences(newCell.input.source, count, 0),
        },
      };
    }
    setCell(newRow, c, newCell);
  }
  ```
- In `apps/web/src/operations.ts` lines 202–224 (`deleteRow`):
  ```typescript
  if (r < rowIndex) {
    setCell(r, c, cell);
  } else if (r >= endDel) {
    const newRow = r - count;
    let newCell = cell;
    if (newCell.input.kind === 'formula') {
      newCell = {
        ...newCell,
        input: {
          ...newCell.input,
          source: adjustFormulaReferences(newCell.input.source, -count, 0),
        },
      };
    }
    setCell(newRow, c, newCell);
  }
  ```
- In `apps/web/src/operations.ts` lines 298–320 (`insertColumn`) and lines 391–413 (`deleteColumn`): identical structure along the column axis.
- In `packages/formula/src/syntax.ts` lines 35–37 (`adjustFormulaReferences`):
  ```typescript
  export function adjustFormulaReferences(source:string,rowDelta:number,colDelta:number):string{
   const ts=tokenize(source);let out='',p=0;for(let i=0;i<ts.length;i++){const t=ts[i]!;out+=source.slice(p,t.start);const m=/^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/.exec(t.text);if(m&&ts[i+1]?.text!=='!'&&t.kind!=='string'){let col=0;for(const c of m[2]!.toUpperCase())col=col*26+c.charCodeAt(0)-64;col=col-1+(m[1]?0:colDelta);const row=Number(m[4])-1+(m[3]?0:rowDelta);out+=row<0||col<0||row>=1048576||col>=16384?'#REF!':m[1]+letters(col)+m[3]+String(row+1);}else out+=t.text;p=t.end;}return out+source.slice(p);
  }
  ```
- In `PROJECT.md` lines 68–71:
  ```markdown
  - `deleteRow(workbook: Workbook, sheetId: string, rowIndex: number, count?: number): Workbook`
    - Removes cells in `rowIndex .. rowIndex + count - 1`.
    - Shifts subsequent cells up by `count`.
    - Replaces references to deleted cells with `#REF!`.
  ```

### Empirical Test Observations
1. **Unrelated Row Deletion Corrupts Headers to `#REF!`**:
   - Given: Tax rate in `A1` (value 1.08), formula in `A12` (`=A1*100`).
   - Operation: Delete row 6 (`deleteRow(wb, sheetId, 5, 1)`).
   - Observed Result in `A11`: `{ kind: 'formula', source: '=#REF!*100' }`.
   - Result: Valid reference to unshifted cell `A1` was corrupted into `#REF!`.
2. **References to Deleted Cells Not Replaced with `#REF!`**:
   - Given: `A1` has `=A2` (pointing to row 2), `A2` has value 42, `A3` has value 99.
   - Operation: Delete row 2 (`deleteRow(wb, sheetId, 1, 1)`).
   - Observed Result in `A1`: `{ kind: 'formula', source: '=A2' }` and recalculates to `99`.
   - Result: `A1` was never updated to `#REF!` despite the cell it referenced (`A2`) being deleted. It silently bound to old `A3`.
3. **Inverted Reference Rewriting on Deletion**:
   - Given: `A1` (10), `B1` (20), `C1` (30), `D1` has `=A1+B1+C1`.
   - Operation: Delete column B (`deleteColumn(wb, sheetId, 1, 1)`).
   - Expected: `A1` unchanged, `B1` becomes `#REF!`, `C1` becomes `B1`. Expected formula: `=A1+#REF!+B1`.
   - Observed Result in `C1`: `{ kind: 'formula', source: '=#REF!+A1+B1' }`.
   - Result: The untouched column `A1` became `#REF!`, while the deleted column `B1` became `A1`.
4. **Insertion Shifting Non-Shifted Cells**:
   - Given: `A1` (10), `B1` (20), `C1` has `=A1+B1`.
   - Operation: Insert column at colIndex 1 (between Column A and Column B).
   - Expected: Column A is before insertion and does not shift. Formula in D1 should be `=A1+C1`.
   - Observed Result in `D1`: `{ kind: 'formula', source: '=B1+C1' }`.
   - Result: `A1` shifted to `B1` (now referencing blank column) even though Column A never moved.
5. **Absolute References Not Shifted When Physically Moved**:
   - Given: `A1` (10), `A2` has `=$A$1`.
   - Operation: Insert row at row 0 (`insertRow(wb, sheetId, 0, 1)`).
   - Expected: Row 1 moves to Row 2, so `$A$1` moves to `$A$2`. Formula in A3 should be `=$A$2`.
   - Observed Result in `A3`: `{ kind: 'formula', source: '=$A$1' }`.
   - Result: Absolute reference points to new blank row instead of moved cell.

---

## 2. Logic Chain

1. **Root Cause Analysis**:
   - The worker implemented row/column insert and delete by calling `adjustFormulaReferences(source, count, 0)` on formulas located at `r >= rowIndex`.
   - `adjustFormulaReferences` was originally designed solely for drag-filling / copy-pasting cells, where the delta represents the distance between source and target cells.
   - However, in structural row/column insertion and deletion:
     - Formula reference rewriting depends on the **target coordinates of the reference**, NOT the location of the formula cell.
     - When inserting a row at `rowIndex`: any reference pointing to a row `>= rowIndex` must shift by `+count`, whether the formula cell is located before or after `rowIndex`. Any reference pointing to `< rowIndex` must NOT shift.
     - When deleting a row at `rowIndex`: any reference pointing to `[rowIndex, rowIndex + count - 1]` must become `#REF!`. Any reference pointing to rows `>= rowIndex + count` must shift by `-count`. Any reference pointing to `< rowIndex` must NOT shift.
2. **Impact on User and System**:
   - Any spreadsheet with header cells in Row 1 (standard practice in almost all Excel workbooks) will have all references to Row 1 corrupted into `#REF!` whenever ANY row below it is deleted.
   - Deleting a referenced row fails to produce `#REF!`, causing silent data corruption where calculations bind to unintended adjacent data.
   - Inserting columns/rows alters dependencies to cells that never moved.
3. **Contract Violation**:
   - `PROJECT.md` line 71 explicitly specifies: `deleteRow ... Replaces references to deleted cells with #REF!`.
   - The worker report claims milestone completion, but this contract is violated.

---

## 3. Caveats

- Unit tests (`npm test`) and E2E tests (`npm run test:e2e`) all passed because the existing test suite does not include test cases for row/column insertion and deletion with formula dependencies.
- The UI components added in `App.tsx` (drag resize handles, selection bounding box, sheet tab color and reordering, interactive Find & Replace dialog) are well-crafted and functional. The defect is confined to the formula coordinate transformation logic in `apps/web/src/operations.ts`.

---

## 4. Adversarial Review

### Challenge Summary
**Overall risk assessment**: **CRITICAL**

### Challenges

#### [Critical] Challenge 1: `deleteRow` and `deleteColumn` Corrupt Untouched Reference Cells into `#REF!`
- **Assumption challenged**: Calling `adjustFormulaReferences(formula, -count, 0)` on cells below the deletion point safely adjusts references.
- **Attack scenario**: User has table headers or parameters in row 1 (`A1`) and formulas below row 10 referencing `=A1*2`. User deletes row 5.
- **Blast radius**: All formula cells below row 5 referencing row 1 are instantly corrupted into `+#REF!*2`.
- **Mitigation**: Formula rewriting must inspect the referenced cell coordinate `m[4]`, not the formula container cell `r`. References targeting `< rowIndex` must remain untouched.

#### [Critical] Challenge 2: References to Deleted Cells Are Never Replaced with `#REF!`
- **Assumption challenged**: `deleteRow` replaces references to deleted cells with `#REF!` as required by `PROJECT.md`.
- **Attack scenario**: Cell `A1` contains `=A2`. User deletes row 2.
- **Blast radius**: `A1` remains `=A2`, silently adopting the value of old `A3` instead of reporting `#REF!`.
- **Mitigation**: A dedicated AST or token-level reference adjuster function must check if `refRow >= rowIndex && refRow < rowIndex + count`, and if so, replace the token with `#REF!`.

#### [High] Challenge 3: Inverted Formula Shifting on Insertion
- **Assumption challenged**: Uniformly applying delta to all relative references inside shifted cells preserves formula integrity.
- **Attack scenario**: Formula `=A1+B1` at `C1`. User inserts column at index 1 (between A and B).
- **Blast radius**: `A1` (which did not move) is shifted to `B1` (blank column), producing `=B1+C1` instead of `=A1+C1`.
- **Mitigation**: When inserting at `index`, only reference tokens targeting `>= index` should be incremented by `+count`.

### Stress Test Results

| Scenario | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|
| Delete row 6 when `A12` has `=A1*100` | `=A1*100` preserved in `A11` | `A11` has `*#REF!*100` | **FAIL** |
| Delete row 2 when `A1` has `=A2` | `A1` becomes `=#REF!` | `A1` remains `=A2` | **FAIL** |
| Delete column B when `D1` has `=A1+B1+C1` | `C1` has `=A1+#REF!+B1` | `C1` has `*#REF!+A1+B1` | **FAIL** |
| Insert col 1 when `C1` has `=A1+B1` | `D1` has `=A1+C1` | `D1` has `=B1+C1` | **FAIL** |
| Insert row 0 when `A2` has `=$A$1` | `A3` has `=$A$2` | `A3` has `=$A$1` | **FAIL** |
| Expand range `=SUM(A1:A5)` on insert row 2 | `=SUM(A1:A6)` | `=SUM(A2:A6)` | **FAIL** |

### Unchallenged Areas
- Cross-sheet references under row/column operations (planned for future milestone).

---

## 5. Conclusion & Actionable Recommendation

**Verdict**: **REJECT**

Milestone M2 cannot be approved in its current state due to critical formula corruption and violation of the `PROJECT.md` interface specification.

### Required Actions for Worker:
Implement coordinate-aware formula reference rewriting in `apps/web/src/operations.ts` (or helper in `packages/formula/src/syntax.ts`):
1. Create a helper:
   ```typescript
   function rewriteFormulaReferencesOnStructuralChange(
     source: string,
     axis: 'row' | 'col',
     op: 'insert' | 'delete',
     index: number,
     count: number
   ): string
   ```
2. When rewriting reference tokens `($?)([A-Za-z]+)($?)([1-9][0-9]*)`:
   - Compute referenced row and column indices.
   - For `axis === 'row'`:
     - If `op === 'insert'`: if `refRow >= index`, new row is `refRow + count`; otherwise `refRow`.
     - If `op === 'delete'`: if `refRow >= index && refRow < index + count`, replace with `#REF!`; else if `refRow >= index + count`, new row is `refRow - count`; otherwise `refRow`.
   - Apply the same logic for `axis === 'col'`.
   - Update BOTH relative and absolute references (`$`) because physical insertion/deletion moves absolute coordinates as well.
3. Apply this rewriting to **ALL formula cells in the sheet**, not only cells below/right of the operation index.

---

## 6. Verification Method

To reproduce and independently verify these failures, run:
```bash
node --import tsx -e '
import { blankWorkbook, deleteRow, insertColumn } from "./apps/web/src/operations.js";
import { getCell } from "./packages/model/src/index.js";

const baseWb = blankWorkbook("Verify");
const sheetId = baseWb.sheetOrder[0];

// Test 1: Header reference corrupted to #REF! on unrelated row delete
const wb1 = { ...baseWb, sheets: { ...baseWb.sheets, [sheetId]: { ...baseWb.sheets[sheetId], tiles: { "0:0": {
  "0:0": { input: { kind: "value", value: 1.08 } },
  "11:0": { input: { kind: "formula", source: "=A1*100" } },
}} } } };
const res1 = deleteRow(wb1, sheetId, 5, 1);
console.log("Bug 1 (A1 -> #REF!):", getCell(res1, { sheetId, row: 10, col: 0 })?.input?.source);

// Test 2: Deleted cell not replaced with #REF!
const wb2 = { ...baseWb, sheets: { ...baseWb.sheets, [sheetId]: { ...baseWb.sheets[sheetId], tiles: { "0:0": {
  "0:0": { input: { kind: "formula", source: "=A2" } },
  "1:0": { input: { kind: "value", value: 42 } },
}} } } };
const res2 = deleteRow(wb2, sheetId, 1, 1);
console.log("Bug 2 (A2 deleted, A1 still =A2):", getCell(res2, { sheetId, row: 0, col: 0 })?.input?.source);
'
```
Expected output of existing code demonstrating the bugs:
```text
Bug 1 (A1 -> #REF!): =#REF!*100
Bug 2 (A2 deleted, A1 still =A2): =A2
```
