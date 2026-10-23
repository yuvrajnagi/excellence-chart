# Forensic Integrity Audit Report: Milestone 2 Remediation

**Work Product**: `apps/web/src/operations.ts` and `apps/web/src/App.tsx` (Milestone 2 Remediation)  
**Profile**: General Project  
**Integrity Mode**: Development (per `ORIGINAL_REQUEST.md` line 8)  
**Verdict**: **CLEAN**

---

## 1. Observation

### Source Code Analysis
1. **Tile Geometry Divisor Alignment (`apps/web/src/operations.ts`)**:
   - Lines 1, 176, 266, 362, 452 import and utilize `TILE_ROWS` and `TILE_COLUMNS` from `@openexcel/model`:
     ```typescript
     import { createId, createWorkbook, entries, getCell, parseCellInput, TILE_ROWS, TILE_COLUMNS } from '@openexcel/model';
     ...
     const tk = `${Math.floor(r / TILE_ROWS)}:${Math.floor(c / TILE_COLUMNS)}` as TileKey;
     ```
   - In `@openexcel/model` (`packages/model/src/coordinates.ts` line 7), `TILE_COLUMNS = 32` and `TILE_ROWS = 128`.
   - Grep search for `/ 64` across `apps/web` returned 0 matches. All row/column insert and delete operations now compute tile keys identically to `tileOf(row, col)` in `@openexcel/model`.

2. **Coordinate-Aware Formula Translation (`apps/web/src/operations.ts`)**:
   - Lines 99–165 implement `rewriteFormulaReferences(source, axis, op, index, count, currentSheetNames)`:
     ```typescript
     export function rewriteFormulaReferences(
      source: string,
      axis: 'row' | 'col',
      op: 'insert' | 'delete',
      index: number,
      count: number,
      currentSheetNames?: string[]
     ): string {
      if (!source || !source.startsWith('=')) return source;
      try {
       const ts = tokenize(source);
       let out = '';
       let p = 0;
       for (let i = 0; i < ts.length; i++) {
        const t = ts[i]!;
        const m = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/.exec(t.text);
        if (m && ts[i + 1]?.text !== '!' && ts[i + 1]?.text !== '(' && t.kind !== 'string') {
         const hasSheetPrefix = ts[i - 1]?.text === '!';
         let prevSheet = '';
         let sheetStart = t.start;
         if (hasSheetPrefix) {
          prevSheet = ts[i - 2]?.text?.replace(/^'|'$/g, '').replace(/''/g, "'") ?? '';
          sheetStart = ts[i - 2]?.start ?? t.start;
          if (currentSheetNames && prevSheet && !currentSheetNames.includes(prevSheet)) {
           out += source.slice(p, t.end);
           p = t.end;
           continue;
          }
         }
         let col = 0;
         for (const c of m[2]!.toUpperCase()) col = col * 26 + c.charCodeAt(0) - 64;
         col = col - 1;
         let row = Number(m[4]) - 1;
         let isRef = false;
         if (axis === 'row') {
          if (op === 'insert') {
           if (row >= index) row += count;
          } else {
           if (row >= index && row < index + count) isRef = true;
           else if (row >= index + count) row -= count;
          }
         } else {
          if (op === 'insert') {
           if (col >= index) col += count;
          } else {
           if (col >= index && col < index + count) isRef = true;
           else if (col >= index + count) col -= count;
          }
         }
         if (isRef || row < 0 || col < 0 || row >= 1048576 || col >= 16384) {
          out += source.slice(p, sheetStart);
          out += '#REF!';
         } else {
          out += source.slice(p, t.start);
          out += m[1] + letters(col) + m[3] + String(row + 1);
         }
         p = t.end;
        }
       }
       return out + source.slice(p);
      } catch {
       return source;
      }
     }
     ```
   - Lines 198, 291, 384, 477 invoke `rewriteFormulaReferences` on every formula cell on the sheet during `insertRow`, `deleteRow`, `insertColumn`, and `deleteColumn`.
   - Inspection of `rewriteFormulaReferences` reveals zero hardcoded test coordinates, zero mock facades, and zero bypass heuristics.

3. **Drag Resize History Protection (`apps/web/src/App.tsx`)**:
   - Lines 23, 40–44 define `colVisualResize` and `rowVisualResize` state and merge them into `displayColInfo` and `effectiveRows` without creating history records.
   - Lines 133–146 define `onMove` and `onUp` handlers:
     - `onMove` calls only `setColVisualResize({col: colResize.current.col, size: newW})` and `setRowVisualResize({row: rowResize.current.row, size: newH})`.
     - `onUp` executes `props(...)` exactly once upon `mouseup` only when the size changed:
       ```typescript
       if (cr && lastW !== cr.startWidth) {
         props({ columnInfo: { ...sheet.properties.columnInfo, [cr.col]: { size: lastW } } });
       }
       ```

4. **Regex Replacement Protection (`apps/web/src/App.tsx`)**:
   - Line 73 in `replaceCurrentMatch` uses `curr.replace(new RegExp(esc, 'i'), () => replaceText)`.
   - Line 74 in `replaceAllFound` uses `c.text.replace(new RegExp(esc, 'gi'), () => rep)`.
   - This prevents `$1`, `$&`, or other special regex replacement patterns in user replace text from expanding into capture groups.

5. **Pre-Populated Artifact Detection**:
   - `find . -not -path '*/.*' -a \( -name '*.log' -o -name '*result*' -o -name '*output*' \)` showed only `artifacts/benchmark-output.txt` (the measured benchmark artifact required by R4 of `ORIGINAL_REQUEST.md`) and standard node_modules/playwright test results. No fabricated test results or verification attestations exist.

---

## 2. Logic Chain

1. **Absence of Hardcoded Output and Facade Implementations**:
   - `operations.ts` implements algorithmic reference translation using token streams from `@openexcel/formula` and 2D coordinate transformation.
   - Both column letter parsing (`col * 26 + c - 64`) and generation (`letters(col)`) are completely dynamic.
   - References that point into deleted ranges produce genuine `#REF!` error tokens. References out of grid bounds ($row \ge 1048576$ or $col \ge 16384$) also produce `#REF!`.
   - Both relative and absolute reference indicators (`$`) are preserved in output expressions (`m[1]` and `m[3]`).
   - Cross-sheet references referring to untouched sheets are preserved untouched.
   - Therefore, the implementation is genuine and contains no hardcoded test shortcuts, dummy returns, or mock facades.

2. **Tile Geometry Integrity**:
   - The `@openexcel/model` schema strictly enforces tile keys as `${Math.floor(r / 128)}:${Math.floor(c / 32)}`.
   - Prior code had a divisor mismatch (`c / 64`), placing shifted cells in columns $\ge 32$ into nonexistent tile partitions.
   - With `TILE_COLUMNS = 32`, all cells in all 16,384 columns maintain consistent spatial partitioning across row/column insertions and deletions.
   - Empirical stress tests confirmed that cells across columns 31, 32, 33, 63, 64, 65, 128, 256, and 1000 survive `insertRow`, `insertColumn`, and `deleteColumn` without loss or misplacement.

3. **User Action History Integrity**:
   - In React components, updating persistent document state during `mousemove` pushes dozens to hundreds of undo stack items per second, wiping out legitimate history records.
   - By isolating drag feedback to local visual state (`colVisualResize` and `rowVisualResize`) and committing exclusively on `mouseup`, the undo/redo stack records exactly one undoable operation per drag resize gesture.

4. **Independent Empirical Verification**:
   - `npm run typecheck` passed cleanly with exit code 0.
   - `npm test` executed 12 test suites and passed all 418 tests with exit code 0.
   - `npm run build` completed production client build with exit code 0 in 2.29s.
   - `npm run test:e2e` ran all 8 browser tests in Playwright (including formula entry, dynamic chart reactivity, 100K-cell virtual scrolling, XLSX persistence roundtrip, and undo/redo) and passed 8/8 with exit code 0.
   - Custom adversarial stress test script passed all coordinate shifting, `#REF!` generation, cross-sheet reference isolation, and multi-tile lookups.

---

## 3. Caveats

- Cross-sheet cascading formula reference rewriting (where structural modifications on Sheet 1 automatically rewrite formulas located on Sheet 2) is scheduled for future work, which is documented and permitted within the Milestone 2 roadmap and project specifications.
- Interactive range edits in `operations.ts` remain guarded at 100,000 cells to prevent browser UI thread freezes, consistent with specification constraints.

---

## 4. Conclusion

**Verdict: CLEAN**

The Milestone 2 remediation work product in `apps/web/src/operations.ts` and `apps/web/src/App.tsx` has been independently verified through exhaustive source code inspection, adversarial stress tests, and automated test execution. The implementation:
- Fully aligns tile key calculations with `@openexcel/model` (`TILE_COLUMNS = 32`), eliminating data corruption across columns $\ge 32$.
- Implements genuine, coordinate-aware formula reference translation with boundary validation, `#REF!` generation, and cross-sheet preservation.
- Protects undo history during drag resizing by isolating transient visual state from document commit transactions.
- Contains zero hardcoded test shortcuts, zero facades, and zero fabricated test artifacts.
- Meets all quality criteria under Development Mode.

---

## 5. Verification Method

To independently verify this verdict, run the following commands from `/workspaces/excellence-chart`:

```bash
# 1. Type check
npm run typecheck

# 2. Complete unit and integration test suite (418 tests)
npm test

# 3. Production client build
npm run build

# 4. Playwright End-to-End browser test suite (8 tests)
npm run test:e2e

# 5. Adversarial stress test script
node --import tsx -e '
import { blankWorkbook, insertRow, deleteRow, insertColumn, deleteColumn, rewriteFormulaReferences } from "./apps/web/src/operations.js";
import { getCell, TILE_ROWS, TILE_COLUMNS } from "@openexcel/model";

// Verify coordinate translation with multi-letter columns and boundary overflow
const f1 = "=AA10 + $AB$20 + XFD1048576";
const r1 = rewriteFormulaReferences(f1, "row", "insert", 5, 2);
if (r1 !== "=AA12 + $AB$22 + #REF!") throw new Error("Translation overflow failed");

// Verify mixed reference preservation and #REF! insertion on delete
const f2 = "=A1 + $C$5 + D$10 + $E12";
const r2 = rewriteFormulaReferences(f2, "col", "delete", 2, 1);
if (r2 !== "=A1 + #REF! + C$10 + $D12") throw new Error("Delete reference failed");

// Verify cross-sheet qualification preservation
const f3 = "=Sheet2!A1 + Sheet1!A1 + A1";
const r3 = rewriteFormulaReferences(f3, "row", "insert", 0, 1, ["Sheet1", "sheet-id-1"]);
if (r3 !== "=Sheet2!A1 + Sheet1!A2 + A2") throw new Error("Cross-sheet preservation failed");

console.log("All adversarial checks verified clean!");
'
```
