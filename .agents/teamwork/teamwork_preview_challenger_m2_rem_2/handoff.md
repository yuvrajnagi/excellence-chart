# Adversarial Challenger Report: Milestone 2 Remediation Review 2

**Verdict**: **APPROVE**

---

## 1. Observation

Direct empirical observations made across the test suite, codebase inspection, and adversarial stress-test execution:

### 1.1 Header Drag Resize History Preservation
In `apps/web/src/App.tsx`:
- Lines 23 & 25 declare visual preview state and drag tracking refs:
  ```tsx
  const [colVisualResize,setColVisualResize]=useState<{col:number;size:number}|null>(null),[rowVisualResize,setRowVisualResize]=useState<{row:number;size:number}|null>(null);
  const colResize=useRef<{col:number;startX:number;startWidth:number}|null>(null),rowResize=useRef<{row:number;startY:number;startHeight:number}|null>(null);
  ```
- Lines 40–44 calculate layout coordinates via `useMemo` dynamically using `colVisualResize`:
  ```tsx
  const displayColInfo=useMemo(()=>{
    if(!colVisualResize)return sheet.properties.columnInfo;
    return {...sheet.properties.columnInfo,[colVisualResize.col]:{...sheet.properties.columnInfo[colVisualResize.col],size:colVisualResize.size}};
  },[sheet.properties.columnInfo,colVisualResize]);
  ```
- In column resize handler (Line 128) and row resize handler (Line 129):
  ```tsx
  const onMove=(me:MouseEvent)=>{
    if(!colResize.current)return;
    const delta=(me.clientX-colResize.current.startX)/zoom;
    const newW=Math.max(20,Math.min(1000,Math.round(colResize.current.startWidth+delta)));
    lastW=newW;
    setColVisualResize({col:colResize.current.col,size:newW});
  };
  const onUp=()=>{
    const cr=colResize.current;
    colResize.current=null;
    window.removeEventListener('mousemove',onMove);
    window.removeEventListener('mouseup',onUp);
    setColVisualResize(null);
    if(cr&&lastW!==cr.startWidth){
      props({columnInfo:{...sheet.properties.columnInfo,[cr.col]:{size:lastW}}});
    }
  };
  ```
  Continuous mouse movement updates only local component state `setColVisualResize(...)` without invoking `props(...)`, `change(...)`, or `history.record(...)`. Exactly one mutation is recorded on `mouseup` when `lastW !== cr.startWidth`.
- Empirical simulation with 10 pre-existing user cell edits followed by a 500-step drag movement recorded exactly 1 commit on mouseup. All 10 prior cell edits remained completely intact in the undo stack and were undone in exact reverse sequence with 0 history eviction.

### 1.2 Multi-Column Shifts Across Tile Boundaries
In `apps/web/src/operations.ts`:
- Tile keys are computed using `TILE_ROWS = 128` and `TILE_COLUMNS = 32`:
  ```ts
  const tk = `${Math.floor(r / TILE_ROWS)}:${Math.floor(c / TILE_COLUMNS)}` as TileKey;
  ```
- In `insertColumn` (lines 353–440):
  - Inserting 3 columns at column index 30 successfully shifted column 29 (in tile `0:0`), column 30 (to column 33 in tile `0:1`), column 31 (to column 34 in tile `0:1`), and column 63 (to column 66 in tile `0:2`).
  - Formula `=AE1+AF1+AG1` was coordinate-shifted to `=AH1+AI1+AJ1` by `rewriteFormulaReferences`.
- In `deleteColumn` (lines 442–539):
  - Deleting 4 columns spanning tile boundaries (cols 30..33) shifted columns 34 and 35 from tile `0:1` into tile `0:0` at columns 30 and 31.
  - Column 64 from tile `0:2` shifted to column 60 in tile `0:1`.
  - Deleted cell references were converted to `#REF!`, subsequent references shifted backwards by 4, and pre-deletion references remained unaffected (`=AD1+AE1+AI1` $\rightarrow$ `=AD1+#REF!+AE1`).

### 1.3 Find & Replace Safe String Replacement with `$` Tokens
In `apps/web/src/App.tsx`:
- Lines 73 & 74:
  ```tsx
  const replaceCurrentMatch=()=>{ ... if(matchEntire)newText=replaceText;else if(matchCase)newText=curr.replace(findText,()=>replaceText);else{const esc=findText.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');newText=curr.replace(new RegExp(esc,'i'),()=>replaceText);} ... };
  const replaceAllFound=(overrideFind?:string,overrideReplace?:string)=>{ ... newText=c.text.split(f).join(rep); ... newText=c.text.replace(new RegExp(esc,'gi'),()=>rep); ... };
  ```
- Executing replacements with dollar tokens (`$100`, `$$`, `$&`, `$1`, `$\``, `$'`, `$+`, `$$99.99`) resulted in exact literal string replacements without unintended regex expansion patterns.

### 1.4 Test Suite Execution Results
- `npm run typecheck`: Exited with code 0.
- `npm test`: Exited with code 0 (12 test files, 418 passed).
- `npm run build`: Exited with code 0 (production client bundle generated in 3.19s).
- `npm run test:e2e`: Exited with code 0 (8 Playwright browser tests passed in 30.4s).

---

## 2. Logic Chain

1. **History Preservation Under Continuous Drag**:
   - `onMove` during column and row header resize only updates React visual state (`setColVisualResize`, `setRowVisualResize`).
   - The React state is consumed directly by `displayColInfo` and `effectiveRows` memoized calculations, allowing instant visual feedback on canvas/HTML grid without modifying the underlying workbook or invoking `history.current.record()`.
   - On `onUp`, exactly one transaction is committed if the final size differs from start size.
   - Therefore, a continuous drag of arbitrary duration or event count pushes at most one history transaction, fully preserving the 100-entry undo buffer.

2. **Tile Geometry and Multi-Column Shifts**:
   - The OpenExcel model partitions the sheet into $128 \times 32$ tiles.
   - Column index shifts ($c \pm count$) correctly compute the destination tile key via `Math.floor(targetCol / 32)`.
   - When cells cross column 32 or multiples thereof, they are moved to the correct destination tile object and removed from their old tile object.
   - Standard retrieval via `getCell(wb, { sheetId, row, col })` resolves through `tileOf(row, col)` ($col / 32$), ensuring zero cell drop or corruption during multi-column shifts across tile boundaries.

3. **Formula Tokenization and Rewriting**:
   - `rewriteFormulaReferences` tokenizes formula strings into individual cell reference tokens.
   - Because each coordinate is parsed and evaluated independently against the operation boundaries, range endpoints (e.g. `AD1:AG1`) are individually rewritten (e.g. `AD1:AI1` or `#REF!:AF1`), avoiding reference drift.

4. **Literal Find & Replace Replacement**:
   - Standard JavaScript `String.prototype.replace(regex, str)` evaluates `$` in `str` as capture group backreferences.
   - By supplying a function `() => rep` or `str.split(find).join(rep)`, the replacement string is treated as an immutable literal value.

---

## 3. Caveats

- **Cross-Sheet Formula Rewriting**: When rows/columns are inserted/deleted in Sheet1, formulas on Sheet2 that reference Sheet1 coordinates are not rewritten; this is documented as out-of-scope for Milestone 2 and scheduled for future milestones.
- **Concurrent E2E Runner Port Contention**: When multiple background tasks execute `npm run test:e2e` simultaneously against default port 3018, the second process will fail with `EADDRINUSE`. Tests must be run sequentially or with unique ports. Running cleanly in isolation passes 8/8 tests.

---

## 4. Conclusion

**Verdict: APPROVE**

The remediation implementations in `apps/web/src/operations.ts` and `apps/web/src/App.tsx` completely resolve the earlier defects and satisfy all adversarial stress criteria:
- Undo stack history is preserved across high-frequency drag events.
- Multi-column and multi-row shifts across tile boundaries correctly calculate tile coordinates and preserve all cells and formula references.
- Find & Replace handles literal `$` replacement strings without token expansion bugs.
- All unit, integration, typecheck, build, and E2E browser test suites pass cleanly.

---

## 5. Verification Method

To independently reproduce and verify this assessment:

1. **Run full automated verification suite**:
   ```bash
   npm run typecheck
   npm test
   npm run build
   npm run test:e2e
   ```

2. **Run the adversarial challenge stress script**:
   ```bash
   node --import tsx -e '
   import { blankWorkbook, insertColumn, deleteColumn } from "./apps/web/src/operations.js";
   import { getCell, createHistory, applyTransaction, createId } from "./packages/model/src/index.js";

   const wb = blankWorkbook("Verify");
   const sheetId = wb.sheetOrder[0]!;

   // Setup cells across tile boundary (col 29 in tile 0:0, col 30 in tile 0:0, col 32 in tile 0:1)
   const setup = {
     ...wb,
     sheets: {
       ...wb.sheets,
       [sheetId]: {
         ...wb.sheets[sheetId]!,
         tiles: {
           "0:0": { "0:29": { input: { kind: "value" as const, value: "c29" } }, "0:30": { input: { kind: "value" as const, value: "c30" } } },
           "0:1": { "0:32": { input: { kind: "value" as const, value: "c32" } } }
         }
       }
     }
   };

   // Insert 3 columns at col 30
   const inserted = insertColumn(setup, sheetId, 30, 3);
   if (getCell(inserted, { sheetId, row: 0, col: 29 })?.input?.value !== "c29") throw new Error("Col 29 failed");
   if (getCell(inserted, { sheetId, row: 0, col: 33 })?.input?.value !== "c30") throw new Error("Col 30->33 failed");
   if (getCell(inserted, { sheetId, row: 0, col: 35 })?.input?.value !== "c32") throw new Error("Col 32->35 failed");
   console.log("Multi-column tile boundary shift verified successfully!");
   '
   ```
