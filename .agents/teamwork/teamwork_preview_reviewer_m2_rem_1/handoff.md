# Milestone M2 Remediation Review Handoff Report

## 1. Observation

### Verification Commands Executed
1. `npm run typecheck`:
   - Output: `OPENEXCEL_CLEANUP root=/tmp/tmp.2Jyu0DaPQr removed=yes exit=0`
   - Exit code: `0`
2. `npm test`:
   - Output: `Test Files 12 passed (12)`, `Tests 418 passed (418)`
   - Exit code: `0`
3. `npm run build`:
   - Output: `vite v7.3.7 building client environment for production... ✓ built in 2.27s`
   - Exit code: `0`
4. `npm run test:e2e`:
   - Output: `Running 8 tests using 1 worker`, `8 passed (31.8s)`
   - Exit code: `0`

### Code Inspections & Verifications
1. **Tile divisor alignment in `apps/web/src/operations.ts`**:
   - Lines 1, 176, 301, 360, 427: `TILE_ROWS` (128) and `TILE_COLUMNS` (32) are imported from `@openexcel/model` and used consistently in `const tk = `${Math.floor(r / TILE_ROWS)}:${Math.floor(c / TILE_COLUMNS)}` as TileKey`.
   - Verified that all four operations (`insertRow`, `deleteRow`, `insertColumn`, `deleteColumn`) correctly assign cells in column indices $\ge 32$ (columns `AG` through `XFD`) to matching tile keys (`0:1`, `0:2`, etc.).
2. **Coordinate-aware formula reference translation**:
   - `rewriteFormulaReferences` in lines 99–165 parses tokens via `tokenize(source)` from `@openexcel/formula`.
   - Distinguishes cell reference tokens matching `/^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/`.
   - Correctly shifts references:
     - Insert: row/col $\ge index$ shifted by $+count$; unaffected coordinates preserved.
     - Delete: row/col $\in [index, index + count - 1]$ replaced by `#REF!`; row/col $\ge index + count$ shifted by $-count$; unaffected coordinates preserved.
     - Boundary overflow (row $\ge 1048576$ or col $\ge 16384$) replaced by `#REF!`.
     - Cross-sheet references: only sheet prefixes matching the active sheet name or ID are modified; references to other sheets are retained without alteration.
     - String literals and function names: tokens followed by `(` or inside quotes are not treated as cell references.
   - Applied across **all** formula cells on the sheet in `insertRow`, `deleteRow`, `insertColumn`, and `deleteColumn`.
3. **Drag resize history flood prevention in `apps/web/src/App.tsx`**:
   - Lines 23, 30–32, 40–43: Added `colVisualResize` and `rowVisualResize` transient states, seamlessly integrated into `displayColInfo` and `effectiveRows`.
   - Lines 128–129: In `oe-col-resize` and `oe-row-resize` event listeners:
     - `mousemove` updates only visual state (`setColVisualResize` / `setRowVisualResize`) without invoking `change()` or recording history entries.
     - `mouseup` clears the visual state and invokes `props()` with a single mutation commit if and only if the final size differs from `startWidth` / `startHeight`.
4. **Literal replacement in Find & Replace in `apps/web/src/App.tsx`**:
   - Line 73: `replaceCurrentMatch` uses `curr.replace(..., () => replaceText)`.
   - Line 74: `replaceAllFound` uses `curr.replace(..., () => rep)` and `.split().join()`.
   - Evaluated `$1`, `$&`, `$$` in `replaceText`: verified that JavaScript regex token expansion does not occur and replacement is strictly literal.
5. **Adversarial & Integrity Verification**:
   - Executed standalone reproduction scripts for:
     - Column 32 cell preservation across `insertRow` and `deleteRow` (verified).
     - Column 32/34 cell preservation across `insertColumn` and `deleteColumn` (verified).
     - Unrelated formula preservation (`=A1*100` preserved on row 5 delete) (verified).
     - Target cell reference `#REF!` conversion (`=A2` converted to `source: '=#REF!'` on row 1 delete) (verified).
     - Range reference rewriting (`=SUM(A1:B10)` translated to `=SUM(A1:B9)` on row 5 delete, and `=SUM(#REF!:B9)` on row 0 delete) (verified).
     - Multi-row delete (`=A1 + A2 + A3 + A4 + A5` with rows 1..3 deleted translated to `=A1 + #REF! + #REF! + #REF! + A2`) (verified).
     - Grid boundary overflow (`=A1048576` shifted past max row becoming `source: '=#REF!'`) (verified).
   - Zero hardcoded test shortcuts, facade implementations, or bypassed verification detected.

---

## 2. Logic Chain

1. **Tile Geometry**:
   - Observations 1 & 5 confirm that `@openexcel/model` expects tile keys split at intervals of 32 columns.
   - In `operations.ts`, replacing `/ 64` with `/ TILE_COLUMNS` restores exact 1:1 parity with the model's tile indexing (`tileOf(row, col)`).
   - Cells in columns 32 through 16383 remain discoverable by `getCell()` and tile iterations after any structural operation.
2. **Formula Reference Translation**:
   - Observations 2 & 5 establish that token-level reference inspection accurately identifies reference targets in formula ASTs.
   - Translating all formula cells on the sheet ensures that references pointing into or across the modified region are correctly adjusted regardless of whether the cell containing the formula was physically moved.
   - Setting deleted coordinates to `#REF!` aligns behavior with standard spreadsheet semantics and prevents formula corruption.
3. **Undo History Stability**:
   - Observations 3 & 4 verify that continuous mousemove events no longer invoke `history.current.record()`.
   - Sizing feedback is delivered immediately through React visual state, and exactly one undo transaction is recorded when the mouse button is released.
   - User undo stacks are protected against rapid eviction.
4. **Find & Replace String Safety**:
   - Observation 4 confirms that using replacement functions `() => replaceText` neutralizes special replacement patterns (`$1`, `$&`), ensuring true literal text substitution.
5. **Regression & Pipeline Health**:
   - Passing typecheck, unit tests, Vite production client build, and browser Playwright E2E tests confirms no regressions were introduced.

---

## 3. Caveats

- Cross-sheet structural formula reference adjustments (e.g., when inserting a row in Sheet1 alters references in formulas residing on Sheet2) are slated for a future milestone as outlined in the project specification and previous reports; intra-sheet structural rewriting across all cells is fully complete and verified.
- No other caveats.

---

## 4. Conclusion

**Verdict**: **APPROVE**

The remediation in `apps/web/src/operations.ts` and `apps/web/src/App.tsx` completely and rigorously resolves all identified issues:
1. Tile divisor alignment with `TILE_COLUMNS = 32` prevents data loss across columns $\ge 32$.
2. Coordinate-aware formula reference translation correctly rewrites or `#REF!`-flags formulas across the entire sheet on row/column insertions and deletions.
3. Header drag resize maintains transient visual state during drag and commits a single history transaction on mouseup.
4. Find & Replace treats replacement strings literally without regex capture-token expansion.
5. All verification commands (`npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`) pass with zero errors.

---

## 5. Verification Method

To independently verify this assessment, execute the following commands in `/workspaces/excellence-chart`:

```bash
# 1. Typecheck
npm run typecheck

# 2. Unit tests (12 suites, 418 tests)
npm test

# 3. Production client build
npm run build

# 4. End-to-end browser tests (8 tests)
npm run test:e2e

# 5. Adversarial reproduction script
node --import tsx -e '
import { blankWorkbook, insertRow, deleteRow, insertColumn, deleteColumn } from "./apps/web/src/operations.js";
import { getCell } from "./packages/model/src/index.js";

const wb = blankWorkbook("Verification");
const sheetId = wb.sheetOrder[0];

// Test Col 32 tile preservation
const wbCol32 = {
  ...wb,
  sheets: {
    ...wb.sheets,
    [sheetId]: {
      ...wb.sheets[sheetId],
      tiles: { "0:1": { "0:32": { input: { kind: "value", value: "ok" } } } }
    }
  }
};
const res1 = insertRow(wbCol32, sheetId, 0, 1);
if (getCell(res1, { sheetId, row: 1, col: 32 })?.input?.value !== "ok") throw new Error("Col 32 failed");

// Test formula rewrite
const wbF = {
  ...wb,
  sheets: {
    ...wb.sheets,
    [sheetId]: {
      ...wb.sheets[sheetId],
      tiles: { "0:0": { "0:0": { input: { kind: "formula", source: "=B1+C1" } } } }
    }
  }
};
const res2 = deleteColumn(wbF, sheetId, 1, 1);
if (getCell(res2, { sheetId, row: 0, col: 0 })?.input?.source !== "=#REF!+B1") throw new Error("Formula failed");
console.log("All manual checks verified!");
'
```

Invalidation conditions:
- Any failure in `npm run typecheck`, `npm test`, `npm run build`, or `npm run test:e2e`.
- Any cell at column $\ge 32$ becoming inaccessible after row/column insertion or deletion.
- Any formula referencing a deleted cell not becoming `#REF!` or referencing an untouched cell becoming `#REF!`.
