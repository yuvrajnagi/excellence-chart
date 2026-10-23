# Milestone 2 Remediation Review & Adversarial Stress Test Report

## 1. Observation

### Verification Commands Run and Observed Results
1. **`npm run typecheck`**:
   - Exit code: `0`
   - Command: `npx --no-install tsc -b --pretty false; npx --no-install tsc -p tsconfig.tests.json --pretty false`
   - Verified zero TypeScript compilation errors across all project workspaces and test suites.

2. **`npm test`**:
   - Exit code: `0`
   - Results: 12 test files passed, 418 tests passed (0 failed).
     - `apps/server/test/server.test.ts` (5 tests)
     - `packages/interop/test/challenge.test.ts` (1 test)
     - `packages/interop/test/interop.test.ts` (5 tests)
     - `tests/compatibility/engine.test.ts` (24 tests)
     - `tests/compatibility/functions.test.ts` (265 tests)
     - `packages/data/test/data.test.ts` (6 tests)
     - `packages/formatting/test/format.test.ts` (8 tests)
     - `tests/integration/pipeline.test.ts` (8 tests)
     - `packages/formula/test/parser.test.ts` (77 tests)
     - `packages/formula/test/lexer.test.ts` (14 tests)
     - `packages/model/test/api.test.ts` (3 tests)
     - `packages/model/test/history.test.ts` (2 tests)

3. **`npm run build`**:
   - Exit code: `0`
   - Output: `dist/index.html` (0.52 kB), `dist/assets/calculation.worker-Cotc_-rz.js` (113.43 kB), `dist/assets/index-DL9tvAxz.css` (32.78 kB), `dist/assets/index-CLqgyYjB.js` (377.59 kB).
   - Built client production bundle in 2.47s.

4. **`npm run test:e2e`**:
   - Exit code: `0`
   - Results: 8/8 Playwright tests passed (duration 31.0s):
     - `interactions.spec.ts`: cell selection, keyboard navigation, and Name Box jumping (1.9s)
     - `interactions.spec.ts`: formula bar input, in-cell double-click editing, and formula recalculation (2.5s)
     - `interactions.spec.ts`: chart insertion and dynamic reactivity to cell data changes (2.7s)
     - `interactions.spec.ts`: Find & Replace dialog locates matching cells and updates text across sheet (2.2s)
     - `interactions.spec.ts`: sheet tabs creation and tab switching preserves worksheet state (2.0s)
     - `performance.spec.ts`: measure scrolling over 100,000 populated cells (7.9s)
     - `workbook.spec.ts`: edit, calculate, format, chart, persist and XLSX round trip (6.5s)
     - `workbook.spec.ts`: virtual grid reaches last address and supports undo (2.8s)

### Code Inspection Observations
1. **`apps/web/src/operations.ts`**:
   - Lines 1-3: Imported `TILE_ROWS, TILE_COLUMNS` from `@openexcel/model` and `tokenize` from `@openexcel/formula`.
   - Lines 99-165: Implemented `rewriteFormulaReferences(source, axis, op, index, count, currentSheetNames)`.
     - Tokenizes formula source using `@openexcel/formula` lexer (`tokenize(source)`).
     - Token regex `/^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/` matches relative and absolute cell coordinates up to 3-character columns.
     - Detects sheet prefixes: `const hasSheetPrefix = ts[i - 1]?.text === '!'`. Extracts previous token (stripping quotes) to verify target sheet against `currentSheetNames`. Ignores references pointing to other sheets.
     - Coordinate shifting accurately calculates 0-based col and row:
       - Insert: checks if target coord $\ge index$, shifts by $+count$.
       - Delete: if target coord $\in [index, index + count - 1]$, sets `isRef = true` (turns into `#REF!`); if $\ge index + count$, shifts by $-count$.
     - Replaces deleted cell reference with `#REF!`, replacing the entire token including sheet prefix if present (`out += source.slice(p, sheetStart); out += '#REF!';`).
     - Clamps coordinates to valid Excel bounds: `if (isRef || row < 0 || col < 0 || row >= 1048576 || col >= 16384) out += '#REF!'`.
   - Lines 176, 266, 362, 453: Tile key construction in `insertRow`, `deleteRow`, `insertColumn`, and `deleteColumn` uses `${Math.floor(r / TILE_ROWS)}:${Math.floor(c / TILE_COLUMNS)}`, matching `@openexcel/model` constants (`TILE_ROWS = 128`, `TILE_COLUMNS = 32`).
   - Lines 175, 265, 361, 452: Safe grid boundary checks: `if (r < 0 || r >= 1048576 || c < 0 || c >= 16384) return;`, dropping pushed-off-grid cells safely.

2. **`apps/web/src/App.tsx`**:
   - Lines 23: State `colVisualResize` and `rowVisualResize` decoupled from persistent sheet state.
   - Lines 40-44 & 28-38: `displayColInfo` and `effectiveRows` memoized axes merge visual dimensions dynamically during active mouse drag.
   - Lines 128 & 129: `mousemove` (`onMove`) calls only `setColVisualResize({ col: colResize.current.col, size: newW })` / `setRowVisualResize(...)`, emitting zero history commits. `mouseup` (`onUp`) removes listeners, resets visual state, and commits exactly one transaction via `props(...)` if dimension changed.
   - Lines 73 & 74: `replaceCurrentMatch` and `replaceAllFound` use callback replacement `replace(regex, () => replaceText)` / `split().join()`, preventing regex capture group expansion (`$1`, `$&`, `$'`).

---

## 2. Logic Chain

1. **Defect 1 Resolution (Tile Column Key Divisor)**:
   - Observation: `@openexcel/model` defines `TILE_COLUMNS = 32`. `operations.ts` previously used hardcoded `64`.
   - In M2 remediation, `TILE_COLUMNS = 32` is directly imported and used in all four structural operations (`insertRow`, `deleteRow`, `insertColumn`, `deleteColumn`).
   - Inference: Cells at column $c \ge 32$ (e.g. column `AG` through `XFD`) are stored in the correct tile `${Math.floor(r / 128)}:${Math.floor(c / 32)}` and are immediately retrieved by `getCell(wb, { sheetId, row, col })`.
   - Verified via 44 tile geometry tests spanning columns 0 to 131 and rows 0 to 258.

2. **Defect 2 Resolution (Coordinate-Aware Formula Rewriting)**:
   - Observation: `rewriteFormulaReferences` inspects token coordinates against operation intervals.
   - When inserting at index $k$, only coordinates $\ge k$ are shifted (+count).
   - When deleting at index $k$, coordinates in $[k, k + count - 1]$ become `#REF!`; coordinates $\ge k + count$ are decremented (-count); coordinates $< k$ are unchanged.
   - Cross-sheet references: References to other sheets (e.g. `=Sheet2!A1`) are preserved intact when rows/columns are changed on `Sheet1`. References to the current sheet (both unquoted `=Sheet1!A10` and quoted `='Sheet1'!A10`) are properly rewritten or replaced with `#REF!`.
   - Boundary clamping: Coordinates pushed past Excel limits (row $\ge 1,048,576$ or col $\ge 16,384$) automatically convert to `#REF!`.
   - Verified via 42 formula rewriting tests covering single-, double-, and triple-letter columns (A through XFD) and small to large row indices (1 through 1,048,576).

3. **Defect 3 Resolution (Drag Resize History Stack)**:
   - Observation: Mouse move events during drag resize update local React visual state (`colVisualResize` / `rowVisualResize`) rather than committing to history.
   - Only on mouseup is a single transaction pushed to `history.current.record()`.
   - Inference: The 100-entry undo/redo history stack is completely protected from flooding during drag resize gestures.

4. **Defect 4 Resolution (Regex Replacement Tokens)**:
   - Observation: `replace(regex, () => replaceText)` avoids treating special `$` character sequences as regex capture group substitutions.
   - Verified via test cases preserving literal `$1`, `$$`, `$&`, `$'`, and `$```.

5. **Integrity Review**:
   - Actively evaluated source code in `apps/web/src/operations.ts` and `apps/web/src/App.tsx`.
   - No hardcoded test values, no fake stubs or facade mocks, no shortcuts bypassing core requirements.
   - All operations execute genuine mathematical and structural algorithms.

---

## 3. Caveats

- Cross-sheet structural formula reference rewriting (when row/column changes on Sheet A trigger formula rewrites on Sheet B) is scoped for future milestones as defined in the project plan. Intra-sheet formula references (including explicit self-sheet prefixes) are fully coordinate-aware and verified.
- The `rangeAddresses` utility enforces a 100,000-cell threshold for interactive range edits to maintain UI responsiveness per project specification.

---

## 4. Conclusion

**Verdict: APPROVE**

The remediation changes in `apps/web/src/operations.ts` and `apps/web/src/App.tsx` are fully verified, robust, and correctly resolve all previously identified issues without regressions. All standard verification commands (`npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`) pass with 100% success, and 92 independent adversarial edge case stress tests pass without errors.

---

## 5. Verification Method

To independently reproduce and verify this assessment:

1. **Standard verification commands**:
   ```bash
   npm run typecheck
   npm test
   npm run build
   npm run test:e2e
   ```

2. **Adversarial stress test execution**:
   Run the 92-assertion adversarial edge case verification script:
   ```bash
   node --import tsx artifacts/scratch/adversarial_verification.ts
   ```
   Expected output:
   ```text
   ALL 92/92 ADVERSARIAL STRESS TESTS PASSED!
   ```
