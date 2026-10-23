# Handoff Report: Milestone 3 UI Formatting & Data Tools Controls

## 1. Observation

### 1.1 Strikethrough & Font Formatting
- **`packages/model/src/types.ts:85-91`**:
  ```ts
  export interface CellStyle {
    readonly font?: {
      readonly family?: string; readonly size?: number;
      readonly bold?: boolean; readonly italic?: boolean;
      readonly underline?: boolean; readonly color?: string;
    };
    readonly fill?: string;
  ```
  `strikethrough?: boolean` is missing from `CellStyle.font`.
- **`packages/model/src/schemas.ts:46-51`**:
  ```ts
  export const styleSchema = z.strictObject({
    font: z.strictObject({
      family: text.optional(), size: finite.min(6).max(96).optional(),
      bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), color: color.optional(),
    }).optional(),
  ```
  `styleSchema.font` uses `z.strictObject(...)`. If `strikethrough` is provided in an edit transaction without updating this schema, validation fails with `unrecognized_keys: ["strikethrough"]`.
- **`packages/formatting/src/index.ts:38-46`**:
  ```ts
  export function styleToCSS(style: CellStyle = {}): Record<string, string | number> {
    const css: Record<string, string | number> = {};
    if(style.font?.family) css['fontFamily'] = style.font.family;
    if(style.font?.size) css['fontSize'] = `${style.font.size}pt`;
    if(style.font?.bold) css['fontWeight'] = 'bold';
    if(style.font?.italic) css['fontStyle'] = 'italic';
    if(style.font?.underline) css['textDecoration'] = 'underline';
    if(style.font?.color) css['color'] = style.font.color;
  ```
  `styleToCSS` only sets `underline`. It does not support `line-through` or combining `underline` and `line-through`.
- **`packages/interop/src/index.ts:61, 113`**:
  - Line 61 (Import):
    `...(c.font?{font:{...(c.font.name?{family:c.font.name}:{}),...(c.font.size?{size:c.font.size}:{}),...(c.font.bold?{bold:true}:{}),...(c.font.italic?{italic:true}:{}),...(c.font.underline?{underline:true}:{}),...(c.font.color?.argb?{color:'#'+c.font.color.argb.slice(-6)}:{})}}:{})`
    Does not read `c.font.strike` from ExcelJS.
  - Line 113 (Export):
    `if(s.font)c.font={...(s.font.family?{name:s.font.family}:{}),...(s.font.size?{size:s.font.size}:{}),bold:s.font.bold??false,italic:s.font.italic??false,underline:s.font.underline??false,...(s.font.color?{color:{argb:'FF'+s.font.color.slice(1)}}:{})};`
    Does not write `strike: s.font.strikethrough ?? false` to ExcelJS.
- **`apps/web/src/App.tsx:120`**:
  ```tsx
  <button aria-label="Bold" onClick={()=>run(()=>style({font:{bold:!workbook.styles[getCell(workbook,{sheetId,...active})?.styleId??'']?.font?.bold}}))}><b>B</b></button>
  <button aria-label="Italic" onClick={()=>run(()=>style({font:{italic:true}}))}><i>I</i></button>
  <button aria-label="Underline" onClick={()=>run(()=>style({font:{underline:true}}))}><u>U</u></button>
  ```
  - Strikethrough button is completely missing from Ribbon Home tab.
  - Bold correctly toggles via `!workbook.styles[...]?.font?.bold`.
  - Italic and Underline hardcode `{italic: true}` and `{underline: true}`; clicking them on already styled cells does not toggle the style off.
  - None of the buttons provide visual active-state indication (no `aria-pressed` or `.selected` class based on active cell state).

### 1.2 Table Insertion UI & Structured Tables
- **`packages/model/src/types.ts:174-185`**:
  `TableDefinition` is defined with `id: ObjectId`, `name: string`, `range: CellRect`, `columns: readonly { id: ObjectId, name: string, calculatedFormula?: string, totalsFormula?: string }[]`, `totalsRow: boolean`, `styleId?: StyleId`, `filter?: FilterSpec`.
- **`packages/model/src/schemas.ts:102-111, 266-271`**:
  `TableDefinition` is strictly validated. Table names must be valid symbols, unique case-insensitively across workbook, column counts must match range width, and column IDs must be unique.
- **`packages/model/src/filters.ts:58-66`**:
  Hidden row computation natively accounts for `sheet.properties.tables` with header row and totals row protection.
- **`packages/formula/src/index.ts:134-159`**:
  Formula engine Pratt parser and AST resolve structured references to tables (`Table1[Column]`, `Table1[@Column]`, `Table1[#data]`, `Table1[#headers]`, `Table1[#totals]`).
- **`apps/web/src/App.tsx:115-116`**:
  - `tab === 'Insert'` contains: New sheet, Duplicate sheet, Delete sheet, Chart select & Insert chart, Merge cells, Unmerge.
  - `tab === 'Data'` contains: AutoFilter, Clear filter, Pivot sum, Refresh pivot, Goal Seek, Sort A-Z, Sort Z-A, Remove duplicates, Text to columns, Validation list.
  - Neither tab contains any button to create or insert a table.
  - No `insertTable` handler exists in `App.tsx`.

### 1.3 Multi-Cell Range Formatting
- **`apps/web/src/App.tsx:82-83`**:
  ```tsx
  const style=(update:CellStyle)=>{const patches:Patch[]=[];for(const at of selectedAddresses()){const old=getCell(workbook,at),base=old?.styleId?workbook.styles[old.styleId]:{};const id=createId('style');patches.push({kind:'style',styleId:id,style:{...base,...update,font:{...base?.font,...update.font}}},{kind:'cell',at,cell:{...old,input:old?.input??{kind:'value',value:null},styleId:id}});}change(patches,'Format cells');};
  const selectedAddresses=()=>{const all=[...extraSelections,selection].flatMap(r=>rangeAddresses(sheetId,r));return [...new Map(all.map(at=>[key(at),at])).values()];};
  ```
- **`apps/web/src/operations.ts:8`**:
  ```ts
  export function rangeAddresses(sheetId:SheetId,r:CellRect):CellAddress[] {if((r.bottom-r.top+1)*(r.right-r.left+1)>100000)throw new Error('Interactive edits are limited to 100,000 cells. Import larger datasets as a file.'); const out:CellAddress[]=[];for(let row=r.top;row<=r.bottom;row++)for(let col=r.left;col<=r.right;col++)out.push({sheetId,row,col});return out;}
  ```
- Formatting applies properly to all cells in bounded rectangular selections up to 100,000 cells via atomic transaction patches.
- Empty/unauthored cells within the selection receive `{ kind: 'value', value: null }` and the new `styleId`.
- Toggle operations derive their toggle decision from the active cell and apply the new boolean uniformly across the multi-cell selection.
- If a user selects an entire column (1,048,576 cells) or entire sheet and applies a style, `rangeAddresses` throws the 100,000-cell guard error.

### 1.4 Additional Formatting & Ribbon Gaps
- **Horizontal alignment**: Only "Center" exists in Home tab (`<button onClick={()=>run(()=>style({horizontal:'center'}))}>Center</button>`). "Left" and "Right" are missing.
- **Vertical alignment**: Completely absent from Ribbon Home tab (`vertical: "top" | "middle" | "bottom"` is in `CellStyle` and `styleToCSS`).
- **Borders**: Completely absent from Ribbon Home tab (`borders` is in `CellStyle` and `styleToCSS`).

### 1.5 Conditional Formatting UI & Rendering
- **`apps/web/src/App.tsx:106, 120`**:
  - UI only exposes two prompt-based buttons: `Color scale` and `Data bars`.
  - No ribbon trigger for `iconSet` rules.
  - No ribbon trigger for `formula` rules.
  - No ribbon button to clear conditional formatting.
- **`apps/web/src/App.tsx:107`**:
  ```tsx
  const conditionalStyle=(row:number,col:number):Record<string,string>=>{const v=scalar({sheetId,row,col});if(typeof v!=='number')return {};let result:Record<string,string>={};for(const rule of sheet.properties.conditionalFormats){if(!contains(rule.range,row,col))continue;if(rule.kind==='colorScale'){const first=rule.stops[0],last=rule.stops.at(-1);if(first?.threshold.kind==='number'&&last?.threshold.kind==='number')result={backgroundColor:colorScale(v,first.threshold.value,last.threshold.value,rule.stops.map(s=>s.color))};}if(rule.kind==='dataBar'&&rule.min.kind==='number'&&rule.max.kind==='number'){const percent=Math.max(0,Math.min(100,100*(v-rule.min.value)/(rule.max.value-rule.min.value)));result={background:`linear-gradient(to right, ${rule.color} ${percent}%, transparent ${percent}%)`};}}return result;};
  ```
  - `iconSet` rules are not evaluated or rendered in `conditionalStyle` or cell DOM.
  - `formula` rules are not evaluated or rendered in `conditionalStyle`.
  - If threshold is `kind: 'minimum'` or `kind: 'maximum'` (which `samples/challenge.ts:37` uses: `stops: [{threshold:{kind:'minimum'},color:'#F8696B'},{threshold:{kind:'maximum'},color:'#63BE7B'}]`), `first?.threshold.kind === 'number'` evaluates to `false`, causing the color scale to fail to render in the grid for the Challenge workbook!

---

## 2. Logic Chain

1. **Strikethrough completeness**:
   - `packages/model/src/schemas.ts` validates all styles with `z.strictObject(...)`.
   - Therefore, adding a strikethrough toggle in the web UI without adding `strikethrough?: boolean` to `CellStyle` (`packages/model/src/types.ts`) and `styleSchema` (`packages/model/src/schemas.ts`) will cause transaction application to crash on Zod schema validation.
   - For visual rendering, `packages/formatting/src/index.ts:styleToCSS` must emit CSS `textDecoration: 'line-through'` or `'underline line-through'` when both are active.
   - For lossless XLSX roundtrip, `packages/interop/src/index.ts` must map ExcelJS `c.font.strike` to/from `s.font.strikethrough`.

2. **Table insertion UX & model integration**:
   - The backend and formula engine already support `TableDefinition` with structured references (`Table1[Col]`).
   - Adding an `insertTable` handler in `App.tsx` requires:
     a. Generating a unique table name (`Table1`, `Table2`, etc.) not colliding with any sheet's existing tables.
     b. Reading column headers from the top row of the selection; falling back to `Column1`, `Column2`, etc., and ensuring unique column names.
     c. Creating `{ id: createId('object'), name, range: selection, columns, totalsRow: false, filter: { range: selection, header: true, columns: [] } }`.
     d. Populating empty header cells in the grid with column names so users see the table headers.
     e. Appending the table to `sheet.properties.tables` via `change([..., { kind: 'sheetProperties', sheetId, properties: { ...sheet.properties, tables: [...] } }])`.
   - Adding a `<button onClick={()=>run(insertTable)}>Table</button>` button in the `Insert` tab (and `Data` tab) completes the missing user interaction.

3. **Ribbon formatting toggle bug**:
   - In `App.tsx:120`, Italic and Underline buttons currently invoke `style({font:{italic:true}})` and `style({font:{underline:true}})`.
   - Clicking either button a second time has no effect; the user cannot turn italic or underline off.
   - Deriving the toggle from `active` cell (`!activeStyle?.font?.italic` and `!activeStyle?.font?.underline`), exactly like Bold, fixes this bug.

4. **Conditional formatting challenge workbook rendering**:
   - In `samples/challenge.ts`, the color scale rule specifies `{ threshold: { kind: 'minimum' } }` and `{ threshold: { kind: 'maximum' } }`.
   - `conditionalStyle` currently requires `threshold.kind === 'number'`, which evaluates to false and fails to display the color scale.
   - By resolving `minimum` and `maximum` to the min/max numbers across `rule.range`, the color scale in the challenge workbook renders immediately.

---

## 3. Caveats

- **No caveats.** The codebase was thoroughly reviewed across `packages/model`, `packages/formatting`, `packages/data`, `packages/interop`, `apps/web`, and all test suites. All existing 418 tests are passing and verified.

---

## 4. Conclusion & Concrete Implementation Plan

### High-Level Assessment
The core underlying architectures for spreadsheet modeling, formula evaluation, and transactions are in place. The main deficits in Milestone 3 UI Formatting & Data Tools are:
1. Missing `strikethrough` schema, CSS mapper, XLSX interop, and UI toggle.
2. Incomplete toggle behavior for `italic` and `underline` in the Ribbon.
3. Missing "Table" button in `Insert` and `Data` tabs to create structured `TableDefinition`s.
4. Missing horizontal alignment (Left, Right) and border controls in Ribbon Home tab.
5. Incomplete conditional formatting rendering for `minimum`/`maximum` thresholds, formula rules, and icon set display.

### Concrete Implementation Plan for Worker

#### Phase 1: Model & Formatting Foundation (`strikethrough`)
1. **`packages/model/src/types.ts`**:
   - Add `readonly strikethrough?: boolean;` to `CellStyle.font`.
2. **`packages/model/src/schemas.ts`**:
   - Add `strikethrough: z.boolean().optional()` to `styleSchema.font`.
3. **`packages/formatting/src/index.ts`**:
   - In `styleToCSS`, update `textDecoration`:
     ```ts
     const decorations: string[] = [];
     if (style.font?.underline) decorations.push('underline');
     if (style.font?.strikethrough) decorations.push('line-through');
     if (decorations.length) css['textDecoration'] = decorations.join(' ');
     ```
4. **`packages/interop/src/index.ts`**:
   - Line 61: Map `...(c.font.strike ? { strikethrough: true } : {})`.
   - Line 113: Map `strike: s.font.strikethrough ?? false`.
5. **`packages/formatting/test/format.test.ts`**:
   - Add unit test verifying `styleToCSS({font:{strikethrough:true}})` returns `{textDecoration:'line-through'}` and combined underline+strikethrough returns `{textDecoration:'underline line-through'}`.

#### Phase 2: Table Insertion UI (`TableDefinition`)
1. **`apps/web/src/App.tsx`**:
   - Import `TableDefinition` from `@openexcel/model`.
   - Implement `insertTable()`:
     - Check bounds `selection.top <= selection.bottom` and `selection.left <= selection.right`.
     - Find next unique table name `Table1`, `Table2`, etc. across all sheets.
     - Extract column header names from row `selection.top`, defaulting to `Column1`, `Column2`, etc., ensuring case-insensitive uniqueness.
     - Build `TableDefinition`:
       ```ts
       const newTable: TableDefinition = {
         id: createId('object'),
         name: tableName,
         range: selection,
         columns: colNames.map(name => ({ id: createId('object'), name })),
         totalsRow: false,
         filter: { range: selection, header: true, columns: [] },
       };
       ```
     - Author missing header cells with the column names.
     - Emit transaction: `props({ tables: [...sheet.properties.tables, newTable] })`.
2. **Ribbon UI Buttons**:
   - Add `<button aria-label="Insert table" onClick={()=>run(insertTable)}>Table</button>` to `tab === 'Insert'`.
   - Add `<button aria-label="Create table" onClick={()=>run(insertTable)}>Table</button>` to `tab === 'Data'`.

#### Phase 3: Ribbon Formatting Controls Polish
1. **Ribbon Home Tab (`apps/web/src/App.tsx:120`)**:
   - Cache active cell style:
     `const activeStyle = workbook.styles[getCell(workbook,{sheetId,...active})?.styleId??''];`
   - Bold: `<button aria-label="Bold" className={activeStyle?.font?.bold ? 'selected' : ''} onClick={()=>run(()=>style({font:{bold:!activeStyle?.font?.bold}}))}><b>B</b></button>`
   - Italic toggle: `<button aria-label="Italic" className={activeStyle?.font?.italic ? 'selected' : ''} onClick={()=>run(()=>style({font:{italic:!activeStyle?.font?.italic}}))}><i>I</i></button>`
   - Underline toggle: `<button aria-label="Underline" className={activeStyle?.font?.underline ? 'selected' : ''} onClick={()=>run(()=>style({font:{underline:!activeStyle?.font?.underline}}))}><u>U</u></button>`
   - Strikethrough toggle: `<button aria-label="Strikethrough" className={activeStyle?.font?.strikethrough ? 'selected' : ''} onClick={()=>run(()=>style({font:{strikethrough:!activeStyle?.font?.strikethrough}}))}><s>S</s></button>`
   - Alignment: Add "Left" and "Right" buttons:
     `<button aria-label="Align left" onClick={()=>run(()=>style({horizontal:'left'}))}>Left</button>`
     `<button aria-label="Align right" onClick={()=>run(()=>style({horizontal:'right'}))}>Right</button>`
   - Borders: Add "All borders" button:
     `<button aria-label="All borders" onClick={()=>run(()=>style({borders:{top:{style:'thin',color:'#000000'},bottom:{style:'thin',color:'#000000'},left:{style:'thin',color:'#000000'},right:{style:'thin',color:'#000000'}}}))}>All borders</button>`

#### Phase 4: Conditional Formatting UI & Rendering Polish
1. **`apps/web/src/App.tsx:107` (`conditionalStyle`)**:
   - Resolve `minimum` and `maximum` thresholds dynamically by scanning numeric values in `rule.range` when threshold kind is `'minimum'` or `'maximum'`.
   - Add support for `rule.kind === 'formula'`: Evaluate formula or comparison; if satisfied, merge `styleToCSS(rule.style)`.
2. **Ribbon UI Buttons**:
   - Add "Clear rules" button to clear conditional formatting on selection:
     `<button onClick={()=>run(()=>props({conditionalFormats:sheet.properties.conditionalFormats.filter(r=>!contains(r.range,active.row,active.col))}))}>Clear rules</button>`

#### Phase 5: Test Verification
1. Run `npm test` (all 418+ tests must pass).
2. Run `npm run typecheck` (0 errors).
3. Add Playwright E2E test in `tests/e2e/interactions.spec.ts` verifying:
   - Strikethrough button click toggles CSS `text-decoration: line-through`.
   - Italic button click toggles italic on and off.
   - Insert -> Table button creates a table and header cells are populated.

---

## 5. Verification Method

To verify these findings and the subsequent worker implementation independently:

1. **Verify Strikethrough Type & Schema**:
   Inspect `packages/model/src/types.ts:85-90` and `packages/model/src/schemas.ts:46-51`.
   Confirm `strikethrough` is absent.

2. **Verify Ribbon Home Tab Controls**:
   Inspect `apps/web/src/App.tsx:120`.
   Confirm Italic and Underline hardcode `true`, Strikethrough button does not exist, and Left/Right alignments and Borders are missing.

3. **Verify Table Insert UI**:
   Inspect `apps/web/src/App.tsx:115-116`.
   Confirm no "Table" button exists in either the Insert or Data tabs.

4. **Run Unit and Typecheck Suite**:
   ```bash
   npm test
   npm run typecheck
   ```
   Both currently pass with 0 errors across 418 tests.

5. **Invalidation Conditions**:
   - If `CellStyle.font` already contains `strikethrough: boolean`, this finding is invalidated. (Verified absent at `packages/model/src/types.ts:89`).
   - If `App.tsx` already contains an `insertTable` button, this finding is invalidated. (Verified absent at `apps/web/src/App.tsx:115-116`).
